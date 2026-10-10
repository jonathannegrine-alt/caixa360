// ===== OLIST (TINY) — CONTAS A PAGAR PELA API =====
// O Olist é a fonte das contas a pagar: o que é lançado, alterado, pago ou cancelado lá aparece aqui.
// Servidor: Edge Function "olist-contas" (o token fica só no servidor; o navegador não consegue lê-lo de volta).
// Cada conta do Olist vira um lançamento com fonte 'olist' e tiny_key 'olist:<id>'. Lançamentos antigos vindos
// da planilha do Tiny (fonte 'tiny') são reaproveitados quando são a mesma conta, para não duplicar.
// Lançamentos manuais do Caixa 360 (sem fonte) nunca são tocados.

    let olist = { conectado: null, desde: null, sincronizando: false, ultimo: null, resumo: null, erro: '', detFaltam: 0, detRodando: false };
    try { olist.ultimo = localStorage.getItem('mk_olist_ultimo') || null; } catch(e){}

    const olEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const olEspera = ms => new Promise(r => setTimeout(r, ms));

    async function olistChamar(corpo){
      const sd = await supa.auth.getSession(), sess = sd && sd.data && sd.data.session;
      if(!sess) return { error: 'Sessão expirada: entre de novo.' };
      try {
        const r = await fetch(SUPA_URL + '/functions/v1/olist-contas', { method: 'POST', headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => ({ error: 'resposta inesperada (http ' + r.status + ')' }));
        if(!r.ok && !j.error) j.error = 'http ' + r.status;
        return j;
      } catch(e){ return { error: 'sem conexão com o servidor' }; }
    }

    async function olistStatus(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return false;
      const { data, error } = await supa.from('olist_config').select('usuario_id,atualizado_em').eq('usuario_id', usuarioAtual.id).maybeSingle();
      if(error){ olist.conectado = false; return false; }
      olist.conectado = !!data; olist.desde = data ? data.atualizado_em : null;
      return olist.conectado;
    }

    // ----- junta as contas do Olist nos lançamentos -----
    function olistDescricao(hist){
      const m = hist.match(/[Pp]arcela[\s]+\(?(\d+)\/(\d+)\)?/);
      if(!m) return { desc: hist, parcela: '', tipo: 'unico' };
      const desc = hist.replace(/\s*-\s*[Pp]arcela\s*\(\d+\/\d+\)/g, '').replace(/\s*\([Pp]arcela\s+\d+\/\d+\)/g, '').trim();
      return { desc: desc || hist, parcela: m[1] + '/' + m[2], tipo: 'parcelado' };
    }
    function olistCategoria(nome){
      const n = String(nome || '').trim(); if(!n) return '';
      const ja = categorias.find(c => String(c.nome).trim().toLowerCase() === n.toLowerCase());
      if(ja) return ja.nome;
      categorias.push({ nome: n, impactaDRE: true, tipoPassivo: 'divida' });
      return n;
    }

    function olistAplicar(contas){
      const hoje = getToday();
      const validas = contas.filter(c => c && c.id && c.venc && !String(c.situacao).startsWith('cancel'));
      const jaOlist = pagamentos.filter(p => p.fonte === 'olist').length;
      // proteção: resposta vazia ou muito menor do que o que já existe não apaga nada
      if(!validas.length || (jaOlist > 20 && validas.length < jaOlist * 0.5)) return { abortado: true, recebidas: validas.length, existentes: jaOlist };

      const porChave = new Map(), antigos = new Map();
      pagamentos.forEach(p => { if(p.fonte === 'olist' && p.tiny_key) porChave.set(p.tiny_key, p); else if(p.fonte === 'tiny' && p.tiny_key) antigos.set(p.tiny_key, p); });
      const usados = new Set();
      const r = { novas: 0, alteradas: 0, vinculadas: 0, baixadas: 0, reabertas: 0, removidas: 0 };

      validas.forEach(c => {
        const chave = 'olist:' + c.id, d = olistDescricao(c.historico || 'Conta sem histórico');
        let p = porChave.get(chave);
        if(!p){
          // mesma conta que já tinha vindo pela planilha do Tiny?
          p = antigos.get((c.historico || '') + '||' + (c.forn || '') + '||' + (c.emissao || ''));
          if(p && usados.has(p)) p = null;
          if(!p) p = pagamentos.find(x => x.fonte === 'tiny' && !usados.has(x) && (x.forn || '') === (c.forn || '') && x.desc === d.desc && (x.parcela || '') === d.parcela && x.data === c.venc) || null;
          if(p){ p.fonte = 'olist'; p.tiny_key = chave; r.vinculadas++; }
        }
        const pago = c.situacao === 'pago';
        const val = c.situacao === 'parcial' && c.saldo > 0 ? c.saldo : c.valor;   // pago em parte: o que falta
        if(!p){
          p = { desc: d.desc, forn: c.forn || '', val, data: c.venc, cat: '', pago, tipo: d.tipo, parcela: d.parcela, fonte: 'olist', tiny_key: chave, desconto: 0, juros: 0 };
          if(pago){ p.valorPago = c.valor; p.dataPaga = c.venc; }     // o Olist não informa o dia do pagamento: usa o vencimento
          pagamentos.push(p); r.novas++;
        } else {
          if(p.desc !== d.desc || (p.forn || '') !== (c.forn || '') || p.val !== val || p.data !== c.venc || (p.parcela || '') !== d.parcela) r.alteradas++;
          p.desc = d.desc; p.forn = c.forn || ''; p.val = val; p.data = c.venc; p.parcela = d.parcela; p.tipo = d.tipo;
          if(pago && !p.pago){ p.pago = true; if(p.valorPago == null) p.valorPago = c.valor; if(!p.dataPaga) p.dataPaga = hoje; r.baixadas++; }   // percebido hoje
          else if(!pago && p.pago){ p.pago = false; p.valorPago = null; p.dataPaga = null; r.reabertas++; }
        }
        if(d.tipo === 'parcelado') p.grupo_id = 'g_olist_' + (d.desc + '||' + (c.forn || '')).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
        if(c.categoria) p.cat = olistCategoria(c.categoria);
        if(c.competencia) p.competencia = c.competencia;
        usados.add(p);
      });

      // contas que estavam aqui como do Olist e não existem mais lá (canceladas ou excluídas)
      const antes = pagamentos.length;
      pagamentos = pagamentos.filter(p => p.fonte !== 'olist' || usados.has(p));
      r.removidas = antes - pagamentos.length;
      r.total = validas.length;
      r.orfas = pagamentos.filter(p => p.fonte === 'tiny').length;   // vieram da planilha antiga e não existem no Olist
      return r;
    }

    function olistRedesenhar(){
      try { if(typeof recalc === 'function') recalc(); } catch(e){}
      const v = document.querySelector('.view.active');
      try {
        if(v && v.id === 'view-pagar') (typeof setPagarView === 'function' && typeof pagarViewMode !== 'undefined' ? setPagarView(pagarViewMode) : renderPagar());
        else if(v && v.id === 'view-planilha') renderPlanilha();
        else if(v && v.id === 'view-inicio' && typeof renderInicio === 'function') renderInicio();
        else if(v && v.id === 'view-config') olistRenderCard();
      } catch(e){}
    }

    async function olistSincronizar(manual){
      if(olist.sincronizando) return;
      if(olist.conectado === null) await olistStatus();
      if(!olist.conectado) return;
      olist.sincronizando = true; olist.erro = ''; if(manual) olistRenderCard();
      try {
        const j = await olistChamar({ acao: 'listar' });
        if(j.error){ olist.erro = j.error; return; }
        const r = olistAplicar(j.contas || []);
        if(r.abortado){ olist.erro = 'O Olist devolveu ' + r.recebidas + ' contas e aqui há ' + r.existentes + '. Por segurança nada foi alterado; tente de novo.'; return; }
        olist.resumo = r; olist.ultimo = new Date().toISOString(); olist.detFaltam = j.semDetalhe || 0;
        try { localStorage.setItem('mk_olist_ultimo', olist.ultimo); } catch(e){}
        salvar();
        olistRedesenhar();
        const faltam = (j.contas || []).filter(c => !c.temDetalhe && !String(c.situacao).startsWith('cancel'));
        if(faltam.length) olistDetalhes(faltam);   // categoria e competência, em segundo plano
      } finally { olist.sincronizando = false; if(manual || document.getElementById('cfg-olist-card')) olistRenderCard(); }
    }

    // Categoria e competência vêm conta por conta (limite do Olist). Em aberto primeiro; ~50 por minuto.
    async function olistDetalhes(lista){
      if(olist.detRodando) return;
      olist.detRodando = true;
      try {
        const ids = lista.slice().sort((a, b) => (a.situacao === 'pago' ? 1 : 0) - (b.situacao === 'pago' ? 1 : 0) || String(b.venc).localeCompare(String(a.venc))).map(c => c.id);
        let lotes = 0;
        while(ids.length && typeof usuarioAtual !== 'undefined' && usuarioAtual){
          const lote = ids.splice(0, 25);
          const j = await olistChamar({ acao: 'detalhes', ids: lote });
          if(j.error){ olist.erro = j.error; break; }
          const feitos = new Set();
          (j.detalhes || []).forEach(d => {
            feitos.add(d.id);
            const p = pagamentos.find(x => x.tiny_key === 'olist:' + d.id);
            if(p){ if(d.categoria) p.cat = olistCategoria(d.categoria); if(d.competencia) p.competencia = d.competencia; }
          });
          lote.filter(id => !feitos.has(id)).forEach(id => ids.unshift(id));   // os que não deu tempo voltam para a fila
          olist.detFaltam = ids.length; lotes++;
          if(lotes % 4 === 0 || !ids.length){ salvar(); olistRedesenhar(); }
          else if(document.getElementById('cfg-olist-card') && document.getElementById('view-config').classList.contains('active')) olistRenderCard();
          if(ids.length) await olEspera(j.limite ? 65000 : 30000);
        }
      } finally { olist.detRodando = false; salvar(); olistRedesenhar(); }
    }

    // ----- Configurações: cartão do Olist -----
    async function olistRenderCard(){
      const view = document.getElementById('view-config');
      if(!view) return;
      let card = document.getElementById('cfg-olist-card');
      if(!card){
        card = document.createElement('div');
        card.id = 'cfg-olist-card'; card.className = 'card'; card.dataset.cfgAba = 'fin';
        view.appendChild(card);
      }
      if(olist.conectado === null) await olistStatus();
      const dt = t => t ? new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
      const r = olist.resumo, nOlist = pagamentos.filter(p => p.fonte === 'olist').length, orfas = pagamentos.filter(p => p.fonte === 'tiny').length;
      const partes = r ? [[r.novas, 'novas'], [r.alteradas, 'alteradas'], [r.baixadas, 'pagas'], [r.reabertas, 'reabertas'], [r.removidas, 'removidas'], [r.vinculadas, 'reaproveitadas da planilha antiga']].filter(x => x[0] > 0).map(x => x[0] + ' ' + x[1]).join(', ') : '';
      card.innerHTML = `
        <div class="card-header"><div class="card-title">Olist (Tiny) — contas a pagar</div>${olist.conectado ? '<span class="badge badge-success">Conectado</span>' : ''}</div>
        <div class="card-body" style="line-height:1.6;">
          ${!olist.conectado ? `
            <div>Ligue o Caixa 360 ao Olist para trazer as contas a pagar sozinho: o que você lança, paga ou cancela lá aparece aqui, sem importar planilha.</div>
            <ol style="margin:10px 0 12px 18px;font-size:13px;">
              <li>No Olist, abra <b>Configurações</b> → aba <b>E-commerce</b> → <b>Token API</b> (a extensão já está instalada na sua conta).</li>
              <li>Copie o conteúdo do campo <b>Token</b>.</li>
              <li>Cole aqui embaixo e clique em Conectar.</li>
            </ol>
            <div class="d-flex" style="gap:8px;flex-wrap:wrap;">
              <input type="password" id="olist-token" placeholder="Cole o token do Olist" autocomplete="off" style="flex:1 1 320px;max-width:520px;font-family:monospace;">
              <button class="btn" onclick="olistConectar(this)">Conectar</button>
            </div>
            <div class="text-muted" style="font-size:12px;margin-top:8px;">O token fica guardado no servidor e não volta a ser mostrado. Ele só é usado para ler as contas a pagar.</div>`
          : `
            <div class="resumo-grid" style="margin-bottom:12px;">
              <div><div class="text-muted" style="font-size:11px;">Contas vindas do Olist</div><div style="font-size:18px;font-weight:700;">${nOlist}</div></div>
              <div><div class="text-muted" style="font-size:11px;">Última sincronização</div><div style="font-size:18px;font-weight:700;">${olist.sincronizando ? 'agora…' : dt(olist.ultimo)}</div></div>
              <div><div class="text-muted" style="font-size:11px;">Categoria e competência</div><div style="font-size:18px;font-weight:700;">${olist.detFaltam ? 'faltam ' + olist.detFaltam : 'em dia'}</div></div>
            </div>
            ${partes ? `<div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">Na última sincronização: ${partes}.</div>` : ''}
            ${olist.detFaltam ? `<div class="alert alert-info">O Olist entrega categoria e competência uma conta por vez. Estou buscando em segundo plano (cerca de 50 por minuto); pode usar o sistema normalmente, mas deixe esta aba aberta.</div>` : ''}
            ${orfas ? `<div class="alert alert-warning" style="justify-content:space-between;flex-wrap:wrap;gap:8px;"><span><b>${orfas} lançamentos antigos</b> vieram da planilha do Tiny e não existem no Olist (foram excluídos ou alterados lá).</span><span class="d-flex" style="gap:6px;"><button class="btn-out btn-sm" onclick="olistVerOrfas()">Ver</button><button class="btn-out btn-sm" style="color:var(--danger);" onclick="olistRemoverOrfas()">Remover todos</button></span></div>` : ''}
            <div class="d-flex" style="gap:8px;flex-wrap:wrap;">
              <button class="btn" onclick="olistSincronizar(true)" ${olist.sincronizando ? 'disabled' : ''}>${olist.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
              <button class="btn-out" onclick="olistDesconectar()">Desconectar</button>
            </div>
            <div class="text-muted" style="font-size:12px;margin-top:8px;">A sincronização roda sozinha ao abrir o sistema e a cada 15 minutos. Lançamentos criados à mão no Caixa 360 não são alterados.</div>`}
          ${olist.erro ? `<div class="alert alert-danger" style="margin-top:12px;">${olEsc(olist.erro)}</div>` : ''}
        </div>`;
      if(typeof cfgMontarAbas === 'function') cfgMontarAbas();
    }

    async function olistConectar(btn){
      const inp = document.getElementById('olist-token'), token = inp ? inp.value.trim() : '';
      if(token.length < 20){ olist.erro = 'Cole o token completo do Olist.'; olistRenderCard(); return; }
      if(btn){ btn.disabled = true; btn.textContent = 'Conferindo…'; }
      olist.erro = '';
      await supa.from('olist_config').delete().eq('usuario_id', usuarioAtual.id);
      const { error } = await supa.from('olist_config').insert({ usuario_id: usuarioAtual.id, token, atualizado_em: new Date().toISOString() });
      if(inp) inp.value = '';
      if(error){ olist.erro = 'Não consegui guardar o token: ' + error.message; olistRenderCard(); return; }
      const t = await olistChamar({ acao: 'testar' });
      if(!t.ok){
        await supa.from('olist_config').delete().eq('usuario_id', usuarioAtual.id);
        olist.conectado = false; olist.erro = t.error || 'O Olist recusou o token.'; olistRenderCard(); return;
      }
      olist.conectado = true; olist.desde = new Date().toISOString();
      olistRenderCard();
      olistSincronizar(true);
    }

    async function olistDesconectar(){
      if(!confirm('Desconectar do Olist? As contas já trazidas continuam aqui, mas param de ser atualizadas.')) return;
      await supa.from('olist_config').delete().eq('usuario_id', usuarioAtual.id);
      olist.conectado = false; olist.resumo = null; olist.erro = '';
      olistRenderCard();
    }

    function olistVerOrfas(){
      const l = pagamentos.filter(p => p.fonte === 'tiny').sort((a, b) => String(a.data).localeCompare(String(b.data)));
      if(typeof vmlModal !== 'function') return;
      vmlModal('Lançamentos antigos que não existem no Olist', `<div class="text-muted" style="margin-bottom:10px;">Vieram da importação antiga da planilha do Tiny. Em aberto: ${fmt(l.filter(p => !p.pago).reduce((s, p) => s + p.val, 0))}.</div>
        <div style="max-height:50vh;overflow:auto;"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Fornecedor</th><th style="text-align:right;">Valor</th><th>Situação</th></tr></thead><tbody>
        ${l.map(p => `<tr><td>${ptDate(p.data)}</td><td>${olEsc(p.desc)}${p.parcela ? ' (' + olEsc(p.parcela) + ')' : ''}</td><td>${olEsc(p.forn || '—')}</td><td style="text-align:right;white-space:nowrap;">${fmt(p.val)}</td><td>${p.pago ? 'Pago' : 'Em aberto'}</td></tr>`).join('')}
        </tbody></table></div>`);
    }
    function olistRemoverOrfas(){
      const n = pagamentos.filter(p => p.fonte === 'tiny').length;
      if(!n || !confirm('Remover os ' + n + ' lançamentos antigos que não existem no Olist? Não dá para desfazer.')) return;
      pagamentos = pagamentos.filter(p => p.fonte !== 'tiny');
      salvar(); olistRedesenhar(); olistRenderCard();
    }

    // sincroniza sozinho: 20 s depois de entrar e a cada 15 minutos, com a aba visível
    let olistEntrouEm = 0;
    setInterval(() => {
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual){ olistEntrouEm = 0; olist.conectado = null; return; }
      if(!olistEntrouEm){ olistEntrouEm = Date.now(); return; }
      if(Date.now() - olistEntrouEm < 20000 || document.hidden || olist.sincronizando || olist.conectado === false) return;
      const idade = olist.ultimo ? Date.now() - new Date(olist.ultimo).getTime() : Infinity;
      if(idade > 15 * 60 * 1000) olistSincronizar(false);
    }, 10000);
