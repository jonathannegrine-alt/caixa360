// ===== OLIST (TINY) — CONTAS A PAGAR PELA API =====
// O Olist é a fonte das contas a pagar: o que é lançado, alterado, pago ou cancelado lá aparece aqui.
// Servidor: Edge Function "olist-contas" (o token fica só no servidor; o navegador não consegue lê-lo de volta).
// Cada conta do Olist vira um lançamento com fonte 'olist' e tiny_key 'olist:<id>'. Lançamentos antigos vindos
// da planilha do Tiny (fonte 'tiny') são reaproveitados quando são a mesma conta, para não duplicar.
// Lançamentos manuais do Caixa 360 (sem fonte) nunca são tocados.

    let olist = { v3: null, v3Erro: '', clientId: '', ordens: null, conectado: null, desde: null, sincronizando: false, ultimo: null, resumo: null, erro: '', detFaltam: 0, detRodando: false };
    try { olist.ultimo = localStorage.getItem('mk_olist_ultimo') || null; } catch(e){}

    const olEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const olTodos = () => (typeof pagTodos === 'function' ? pagTodos() : pagamentos);
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
      const { data, error } = await supa.from('olist_config').select('usuario_id,atualizado_em,v3_em,v3_erro,client_id').eq('usuario_id', usuarioAtual.id).maybeSingle();
      if(error){ olist.conectado = false; return false; }
      olist.conectado = !!data; olist.desde = data ? data.atualizado_em : null;
      olist.v3 = data ? data.v3_em : null; olist.v3Erro = data ? (data.v3_erro || '') : ''; olist.clientId = data ? (data.client_id || '') : '';
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
      categorias.push({ nome: n, impactaDRE: true, tipoPassivo: /juros/i.test(n) ? 'operacional' : /amortiza|capital de giro|empr[eé]stimo|financiamento|mercadoria|fornecedor|simples nacional|imposto/i.test(n) ? 'divida' : 'operacional' });
      return n;
    }

    function olistAplicar(contas){
      if(typeof comTodasAsLojas === 'function') return comTodasAsLojas(() => olistAplicarTudo(contas));
      return olistAplicarTudo(contas);
    }
    function olistAplicarTudo(contas){
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
          // campo alterado aqui pelo usuário fica travado (p.travas): o Olist não sobrescreve
          const tv = Array.isArray(p.travas) ? p.travas : [], livre = k => !tv.includes(k);
          const nv = { desc: d.desc, forn: c.forn || '', val, data: c.venc };
          if(['desc', 'forn', 'val', 'data'].some(k => livre(k) && (p[k] || '') !== (nv[k] || '')) || (p.parcela || '') !== d.parcela) r.alteradas++;
          ['desc', 'forn', 'val', 'data'].forEach(k => { if(livre(k)) p[k] = nv[k]; });
          p.parcela = d.parcela; p.tipo = d.tipo;
          if(livre('pago')){
            if(pago && !p.pago){ p.pago = true; if(p.valorPago == null) p.valorPago = c.valor; if(!p.dataPaga) p.dataPaga = hoje; r.baixadas++; }   // percebido hoje
            else if(!pago && p.pago){ p.pago = false; p.valorPago = null; p.dataPaga = null; r.reabertas++; }
          }
        }
        if(d.tipo === 'parcelado') p.grupo_id = 'g_olist_' + (d.desc + '||' + (c.forn || '')).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
        const tv2 = Array.isArray(p.travas) ? p.travas : [];
        if(c.categoria && !tv2.includes('cat')) p.cat = olistCategoria(c.categoria);
        if(c.competencia && !tv2.includes('competencia')) p.competencia = c.competencia;
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

    // Categorias financeiras do Olist com o grupo do plano de contas (o DRE usa o grupo para saber onde a categoria entra)
    async function olistImportarCategorias(){
      if(typeof olistChamarCompras !== 'function') return { erro: 'Olist não conectado' };
      const j = await olistChamarCompras({ acao: 'categorias' });
      if(!j || j.error || !Array.isArray(j.categorias)) return { erro: (j && j.error) || 'sem resposta' };
      const r = { total: j.categorias.length, novas: 0, mudaram: 0 };
      j.categorias.forEach(x => {
        if(!x.nome) return;
        let c = categorias.find(k => String(k.nome).trim().toLowerCase() === x.nome.toLowerCase());
        if(!c){ c = { nome: x.nome, impactaDRE: true, tipoPassivo: 'operacional' }; categorias.push(c); r.novas++; }
        if(!c.grupoManual && (c.grupo || '') !== (x.grupo || '')){ c.grupo = x.grupo || null; r.mudaram++; }
      });
      if(r.novas || r.mudaram) salvar();
      try { localStorage.setItem('mk_olist_cat_em', String(Date.now())); } catch(e){}
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
        olistPagamentos();                          // data real de pagamento (API nova), em segundo plano
        if(olist.v3 && (Date.now() - Number(localStorage.getItem('mk_olist_cat_em') || 0) > 86400000 || !categorias.some(c => c.grupo))) olistImportarCategorias().then(() => olistRedesenhar()).catch(() => {});
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
            const p = olTodos().find(x => x.tiny_key === 'olist:' + d.id);
            if(p){ const tv = Array.isArray(p.travas) ? p.travas : []; if(d.categoria && !tv.includes('cat')) p.cat = olistCategoria(d.categoria); if(d.competencia && !tv.includes('competencia')) p.competencia = d.competencia; }
          });
          lote.filter(id => !feitos.has(id)).forEach(id => ids.unshift(id));   // os que não deu tempo voltam para a fila
          olist.detFaltam = ids.length; lotes++;
          if(lotes % 4 === 0 || !ids.length){ salvar(); olistRedesenhar(); }
          else if(document.getElementById('cfg-olist-card') && document.getElementById('view-config').classList.contains('active')) olistRenderCard();
          if(ids.length) await olEspera(j.limite ? 65000 : 30000);
        }
      } finally { olist.detRodando = false; salvar(); olistRedesenhar(); }
    }

    // A API antiga não diz QUANDO a conta foi paga. Com o aplicativo novo autorizado, busca a data de liquidação
    // e o valor pago de cada conta paga, uma vez por conta (ids conferidos ficam em mk_olist_pago_ok).
    async function olistPagamentos(){
      if(olist.pagRodando || !olist.v3 || typeof olistChamarCompras !== 'function') return;
      olist.pagRodando = true;
      try {
        let feitos; try { feitos = new Set(JSON.parse(localStorage.getItem('mk_olist_pago_ok') || '[]')); } catch(e){ feitos = new Set(); }
        const fila = olTodos().filter(p => p.fonte === 'olist' && p.pago && p.tiny_key).map(p => Number(String(p.tiny_key).split(':')[1])).filter(id => id && !feitos.has(id));
        olist.pagFaltam = fila.length;
        let lotes = 0;
        while(fila.length && typeof usuarioAtual !== 'undefined' && usuarioAtual){
          const lote = fila.splice(0, 25);
          const j = await olistChamarCompras({ acao: 'pagamentos', ids: lote });
          if(j.error) break;
          const vistos = new Set();
          (j.pagamentos || []).forEach(d => {
            vistos.add(d.id); feitos.add(d.id);
            const p = olTodos().find(x => x.tiny_key === 'olist:' + d.id); if(!p) return;
            if(Array.isArray(p.travas) && p.travas.includes('pago')) return;
            if(d.pago_em) p.dataPaga = d.pago_em;
            if(d.valor_pago > 0) p.valorPago = d.valor_pago;
            if(d.competencia && !p.competencia) p.competencia = d.competencia;
          });
          lote.filter(id => !vistos.has(id)).forEach(id => fila.unshift(id));
          olist.pagFaltam = fila.length; lotes++;
          try { localStorage.setItem('mk_olist_pago_ok', JSON.stringify([...feitos].slice(-5000))); } catch(e){}
          if(lotes % 4 === 0 || !fila.length){ salvar(); olistRedesenhar(); }
          if(fila.length) await olEspera(j.limite ? 65000 : 20000);
        }
      } finally { olist.pagRodando = false; }
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
              <div><div class="text-muted" style="font-size:11px;">Data real de pagamento</div><div style="font-size:18px;font-weight:700;">${!olist.v3 ? 'falta autorizar' : olist.pagFaltam ? 'faltam ' + olist.pagFaltam : 'em dia'}</div></div>
            </div>
            ${partes ? `<div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">Na última sincronização: ${partes}.</div>` : ''}
            ${olist.detFaltam ? `<div class="alert alert-info">O Olist entrega categoria e competência uma conta por vez. Estou buscando em segundo plano (cerca de 50 por minuto); pode usar o sistema normalmente, mas deixe esta aba aberta.</div>` : ''}
            ${orfas ? `<div class="alert alert-warning" style="justify-content:space-between;flex-wrap:wrap;gap:8px;"><span><b>${orfas} lançamentos antigos</b> vieram da planilha do Tiny e não existem no Olist (foram excluídos ou alterados lá).</span><span class="d-flex" style="gap:6px;"><button class="btn-out btn-sm" onclick="olistVerOrfas()">Ver</button><button class="btn-out btn-sm" style="color:var(--danger);" onclick="olistRemoverOrfas()">Remover todos</button></span></div>` : ''}
            <div class="d-flex" style="gap:8px;flex-wrap:wrap;">
              <button class="btn" onclick="olistSincronizar(true)" ${olist.sincronizando ? 'disabled' : ''}>${olist.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
              <button class="btn-out" onclick="olistDesconectar()">Desconectar</button>
            </div>
            <div class="text-muted" style="font-size:12px;margin-top:8px;">A sincronização roda sozinha ao abrir o sistema e a cada 15 minutos. Lançamentos criados à mão no Caixa 360 não são alterados.</div>
            ${olistBlocoCompras(dt)}`}
          ${olist.erro ? `<div class="alert alert-danger" style="margin-top:12px;">${olEsc(olist.erro)}</div>` : ''}
        </div>`;
      if(typeof cfgMontarAbas === 'function') cfgMontarAbas();
    }

    // Ordens de compra: precisam do "aplicativo" do Olist (API nova), com duas chaves e uma autorização
    function olistBlocoCompras(dt){
      const cab = '<div style="border-top:1px solid var(--border);margin:18px 0 14px;"></div><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><b>Ordens de compra do Olist</b>' + (olist.v3 && !olist.v3Erro ? '<span class="badge badge-success">Autorizado</span>' : '<span class="badge badge-warning">Falta autorizar</span>') + '</div>';
      if(olist.v3 && !olist.v3Erro) return cab + `
        <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">Autorizado em ${dt(olist.v3)}. O acesso é renovado sozinho a cada 2 horas.${olist.ordens ? ' Última busca: ' + olist.ordens + '.' : ''}</div>
        <div class="d-flex" style="gap:8px;flex-wrap:wrap;"><button class="btn-out" onclick="olistBuscarOrdens(this)">Buscar ordens de compra agora</button><button class="btn-out" onclick="olistAutorizar(true)">Autorizar de novo</button></div>`;
      return cab + `
        ${olist.v3Erro ? '<div class="alert alert-warning">' + olEsc(olist.v3Erro) + '</div>' : ''}
        <ol style="margin:6px 0 12px 18px;font-size:13px;">
          <li>No Olist, em <b>Configurações → Aplicativos API</b>, salve o aplicativo <b>Caixa 360</b> (o formulário já está preenchido).</li>
          <li>Depois de salvar, o Olist mostra o <b>Client ID</b> e o <b>Client Secret</b>. Cole os dois aqui.</li>
          <li>Clique em Autorizar e, na tela do Olist que abrir, confirme o acesso.</li>
        </ol>
        <div class="d-flex" style="gap:8px;flex-wrap:wrap;">
          <input type="text" id="olist-cid" placeholder="Client ID" autocomplete="off" value="${olEsc(olist.clientId)}" style="flex:1 1 240px;max-width:360px;font-family:monospace;">
          <input type="password" id="olist-sec" placeholder="Client Secret" autocomplete="off" style="flex:1 1 240px;max-width:360px;font-family:monospace;">
          <button class="btn" onclick="olistAutorizar(false)">Autorizar</button>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:8px;">As chaves ficam guardadas no servidor. O aplicativo só tem permissão de leitura.</div>`;
    }

    // guarda as chaves (se foram digitadas) e manda para a tela de autorização do Olist
    async function olistAutorizar(reutilizar){
      const cid = reutilizar ? olist.clientId : (document.getElementById('olist-cid')?.value || '').trim();
      const sec = reutilizar ? '' : (document.getElementById('olist-sec')?.value || '').trim();
      if(!cid || (!reutilizar && sec.length < 8)){ olist.erro = 'Cole o Client ID e o Client Secret do aplicativo do Olist.'; olistRenderCard(); return; }
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const state = [...crypto.getRandomValues(new Uint8Array(40))].map(x => abc[x % abc.length]).join('');
      const campos = reutilizar ? { oauth_state: state, v3_erro: null } : { client_id: cid, client_secret: sec, oauth_state: state, v3_erro: null };
      const { error } = await supa.from('olist_config').update(campos).eq('usuario_id', usuarioAtual.id);
      if(error){ olist.erro = 'Não consegui guardar as chaves: ' + error.message; olistRenderCard(); return; }
      const retorno = SUPA_URL + '/functions/v1/olist-callback';
      location.href = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?client_id=' + encodeURIComponent(cid) + '&redirect_uri=' + encodeURIComponent(retorno) + '&scope=openid&response_type=code&state=' + state;
    }

    async function olistChamarCompras(corpo){
      const sd = await supa.auth.getSession(), sess = sd && sd.data && sd.data.session;
      if(!sess) return { error: 'Sessão expirada: entre de novo.' };
      try {
        const r = await fetch(SUPA_URL + '/functions/v1/olist-compras', { method: 'POST', headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        return await r.json().catch(() => ({ error: 'resposta inesperada (http ' + r.status + ')' }));
      } catch(e){ return { error: 'sem conexão com o servidor' }; }
    }
    async function olistBuscarOrdens(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      const j = await olistChamarCompras({ acao: 'ordens' });
      if(j.error){ olist.erro = j.error; olist.ordens = null; }
      else { olist.erro = ''; const ab = (j.ordens || []).filter(o => o.situacao === 0 || o.situacao === 3).length; olist.ordens = (j.total || 0) + ' ordens (' + ab + ' em aberto ou em andamento)' + (j.faltaDetalhe ? ', faltam os itens de ' + j.faltaDetalhe : ''); }
      await olistStatus(); olistRenderCard();
    }

    // volta da tela de autorização do Olist (?olist=ok | recusado | erro)
    (function(){
      const m = location.search.match(/[?&]olist=(ok|recusado|erro)/);
      if(!m) return;
      try { history.replaceState(null, '', location.pathname); } catch(e){}
      const abrir = setInterval(() => {
        if(typeof usuarioAtual === 'undefined' || !usuarioAtual || typeof nav !== 'function') return;
        clearInterval(abrir);
        olist.conectado = null;
        if(m[1] !== 'ok') olist.erro = m[1] === 'recusado' ? 'O Olist não concluiu a autorização. Confira o Client ID e o Client Secret e tente de novo.' : 'A autorização do Olist não foi concluída. Tente de novo.';
        try { sessionStorage.setItem('mk_cfg_aba', 'fin'); if(typeof cfgAbaAtiva !== 'undefined') cfgAbaAtiva = 'fin'; } catch(e){}
        nav('config');
        if(m[1] === 'ok') setTimeout(() => olistBuscarOrdens(null), 1500);
      }, 500);
    })();

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
      else if(!olist.pagTentou && olist.conectado){ olist.pagTentou = true; olistPagamentos(); }   // data real de pagamento, uma vez por sessão
      else if(olist.conectado === null) olistStatus();
    }, 10000);
