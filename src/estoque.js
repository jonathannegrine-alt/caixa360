// ===== CONTROLE DE ESTOQUE (modelo inspirado na UpSeller) =====
// Depósitos do usuário (ex.: Galpão e Full). O saldo físico de um produto num depósito é a soma das
// movimentações (tabela estoque_mov): toda entrada, saída ou ajuste deixa uma linha com motivo e referência.
//   a caminho  = comprado e ainda não conferido (ordens de compra)
//   ocupado    = vendido e ainda não enviado + envio ao Full em preparação
//   disponível = físico − ocupado
// O depósito do tipo "full" não tem movimentações: mostra o estoque buscado no Mercado Livre.
// Compatibilidade: estoqueGalpao[] (usado pela Sugestão de compras) passa a ser um ESPELHO do saldo do
// primeiro depósito próprio; quem manda é o registro de movimentações.
// Banco: supabase/migrations/20261011_estoque.sql

    let est = { depositos: [], saldo: [], carregadoEm: 0, carregando: false, erro: '', dep: null, busca: '', so: '' };
    const esN = s => String(s == null ? '' : s).trim().toLowerCase();
    const esEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const esInt = n => Math.round(Number(n) || 0).toLocaleString('pt-BR');
    const ES_MOTIVO = { carga_inicial: 'Carga inicial', compra: 'Chegada de compra', venda: 'Venda enviada', envio_full: 'Envio ao Full', contagem: 'Contagem de estoque', ajuste: 'Ajuste manual', transferencia: 'Transferência', devolucao: 'Devolução' };

    function estDepProprio(){ return est.depositos.find(d => d.tipo === 'proprio' && d.ativo) || null; }
    function estSaldoDe(depId, sku){ const r = est.saldo.find(s => Number(s.deposito_id) === Number(depId) && s.sku_norm === esN(sku)); return r ? Number(r.fisico) || 0 : 0; }

    async function estCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return false;
      if(est.carregando) return true;
      if(!forcar && est.carregadoEm && Date.now() - est.carregadoEm < 2 * 60 * 1000) return true;
      est.carregando = true; est.erro = '';
      try {
        let d = await supa.from('estoque_depositos').select('*').eq('usuario_id', usuarioAtual.id).order('id');
        if(d.error){ est.erro = d.error.message; return false; }
        if(!d.data.length){
          // primeiro uso: cria Galpão e Full
          await supa.from('estoque_depositos').insert([{ usuario_id: usuarioAtual.id, nome: 'Galpão', tipo: 'proprio' }, { usuario_id: usuarioAtual.id, nome: 'Full', tipo: 'full' }]);
          d = await supa.from('estoque_depositos').select('*').eq('usuario_id', usuarioAtual.id).order('id');
        }
        est.depositos = d.data || [];
        if(!est.dep || !est.depositos.some(x => x.id === est.dep)) est.dep = (estDepProprio() || est.depositos[0] || {}).id || null;
        await estLerSaldo();
        // primeiro uso com estoque já importado da UpSeller: vira a carga inicial
        const g = estDepProprio();
        if(g && !est.saldo.some(s => Number(s.deposito_id) === g.id) && estoqueGalpao.length){
          const linhas = estoqueGalpao.filter(e => Number(e.qtd_galpao) > 0).map(e => ({ usuario_id: usuarioAtual.id, deposito_id: g.id, sku: e.sku, qtd: Number(e.qtd_galpao), motivo: 'carga_inicial', ref: 'carga-' + getToday(), obs: 'Estoque que já estava importado da UpSeller' }));
          if(linhas.length){ const r = await supa.from('estoque_mov').insert(linhas); if(r.error) est.erro = r.error.message; await estLerSaldo(); }
        }
        est.carregadoEm = Date.now();
        return true;
      } finally { est.carregando = false; }
    }
    async function estLerSaldo(){
      const s = await supa.from('estoque_saldo').select('*').eq('usuario_id', usuarioAtual.id).limit(5000);
      if(s.error){ est.erro = s.error.message; return; }
      est.saldo = s.data || [];
      estEspelhar();
    }

    // copia o saldo do depósito próprio para estoqueGalpao[] (lido pela Sugestão de compras e pelo patrimônio)
    function estEspelhar(){
      const g = estDepProprio(); if(!g) return;
      const meus = est.saldo.filter(s => Number(s.deposito_id) === g.id);
      if(!meus.length) return;
      const visto = new Set();
      meus.forEach(s => {
        visto.add(s.sku_norm);
        let e = estoqueGalpao.find(x => esN(x.sku) === s.sku_norm);
        if(!e){ e = { sku: s.sku, descricao: s.sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }; estoqueGalpao.push(e); }
        e.qtd_galpao = Number(s.fisico) || 0;
      });
      estoqueGalpao.forEach(e => { if(!visto.has(esN(e.sku))) e.qtd_galpao = 0; });
      try { localStorage.setItem('mk_estoque_galpao', JSON.stringify(estoqueGalpao)); } catch(e){}
    }

    // grava movimentações e atualiza o saldo. linhas: [{ sku, qtd, motivo, ref, obs, custo_unit }]
    async function estMovimentar(depId, linhas){
      const reg = linhas.filter(l => l.sku && Number(l.qtd)).map(l => ({ usuario_id: usuarioAtual.id, deposito_id: depId, sku: String(l.sku).trim(), qtd: Number(l.qtd), motivo: l.motivo, ref: l.ref || null, obs: l.obs || null, custo_unit: l.custo_unit == null ? null : Number(l.custo_unit) }));
      if(!reg.length) return { ok: true, n: 0 };
      // custo médio: a entrada de compra pondera o custo novo pelo saldo que havia
      reg.filter(l => l.motivo === 'compra' && l.qtd > 0 && l.custo_unit > 0).forEach(l => {
        const e = estoqueGalpao.find(x => esN(x.sku) === esN(l.sku)); if(!e) return;
        const antes = Math.max(0, estSaldoDe(depId, l.sku)), cAntes = Number(e.custo_medio) || 0;
        e.custo_medio = antes > 0 && cAntes > 0 ? (antes * cAntes + l.qtd * l.custo_unit) / (antes + l.qtd) : l.custo_unit;
      });
      const r = await supa.from('estoque_mov').insert(reg);
      if(r.error) return { ok: false, erro: r.error.message };
      await estLerSaldo();
      if(typeof salvar === 'function') salvar();
      return { ok: true, n: reg.length };
    }

    // ----- tela -----
    async function estRender(){
      const view = document.getElementById('view-estoque');
      if(!view) return;
      let host = document.getElementById('est-host');
      [...view.children].forEach(el => { if(el.id !== 'est-host') el.style.display = 'none'; });
      if(!host){ host = document.createElement('div'); host.id = 'est-host'; view.appendChild(host); }
      if(!est.carregadoEm) host.innerHTML = '<div class="vazio"><b>Carregando o estoque…</b></div>';
      await estCarregar(false);
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      estDesenhar();
    }

    function estLinhas(dep){
      const caminho = typeof ocTransitoPorSku === 'function' && typeof ocTemDados === 'function' && ocTemDados() ? ocTransitoPorSku() : new Map();
      const ocup = typeof estOcupadoPorSku === 'function' ? estOcupadoPorSku(dep.id) : new Map();
      const mapa = new Map();
      const pega = sku => { const k = esN(sku); if(!mapa.has(k)) mapa.set(k, { sku, k, nome: '', fisico: 0, caminho: 0, ocupado: 0, custo: 0 }); return mapa.get(k); };
      est.saldo.filter(s => Number(s.deposito_id) === dep.id).forEach(s => { pega(s.sku).fisico = Number(s.fisico) || 0; });
      caminho.forEach((q, k) => { const l = mapa.get(k) || pega(k.toUpperCase()); l.caminho = q; });
      ocup.forEach((q, k) => { const l = mapa.get(k) || pega(k.toUpperCase()); l.ocupado = q; });
      mapa.forEach(l => {
        const e = estoqueGalpao.find(x => esN(x.sku) === l.k), s = skus.find(x => esN(x.sku) === l.k);
        l.nome = (s && s.titulo) || (e && e.descricao !== e.sku && e.descricao) || '';
        if(e && esN(e.sku) === l.k) l.sku = e.sku;
        l.custo = (e && Number(e.custo_medio) > 0 ? Number(e.custo_medio) : 0) || (s && Number(s.custo)) || 0;
        l.disp = l.fisico - l.ocupado;
      });
      return [...mapa.values()];
    }

    function estDesenhar(){
      const host = document.getElementById('est-host'); if(!host) return;
      const dep = est.depositos.find(d => d.id === est.dep) || est.depositos[0];
      if(!dep){ host.innerHTML = `<div class="alert alert-danger">${esEsc(est.erro || 'Não consegui carregar os depósitos.')}</div>`; return; }
      const abas = `<div class="chips" style="margin-bottom:14px;">${est.depositos.filter(d => d.ativo).map(d => `<button class="chip ${d.id === dep.id ? 'active' : ''}" onclick="est.dep=${d.id};estDesenhar();">${esEsc(d.nome)}</button>`).join('')}<button class="chip" onclick="estNovoDeposito()" title="Criar outro depósito">+ Depósito</button></div>`;
      const cab = `<div class="pg-head"><div><div class="pg-title">Estoque</div><div class="pg-sub">Quanto existe em cada depósito, o que está a caminho e o que já está vendido e ainda não saiu.</div></div>
        <div class="d-flex gap-1" style="flex-wrap:wrap;">${dep.tipo === 'full' ? `<button class="btn-out btn-sm" onclick="estAtualizarFull(this)">Atualizar do Mercado Livre</button>` : `<button class="btn-out btn-sm" onclick="estAjuste()">Ajuste manual</button><button class="btn btn-sm" onclick="estCargaPlanilha()">Carregar planilha da UpSeller</button>`}</div></div>`;
      const erro = est.erro ? `<div class="alert alert-danger">${esEsc(est.erro)}</div>` : '';

      if(dep.tipo === 'full'){
        const itens = Array.isArray(estoqueFullML) ? estoqueFullML.slice() : [];
        const b = esN(est.busca), lista = itens.filter(x => !b || esN(x.sku).includes(b) || esN(x.titulo).includes(b)).sort((a, c) => (Number(c.total_geral) || 0) - (Number(a.total_geral) || 0));
        const tot = itens.reduce((s, x) => s + (Number(x.total_geral) || 0), 0), disp = itens.reduce((s, x) => s + (Number(x.aptos_venda) || 0), 0), transf = itens.reduce((s, x) => s + (Number(x.em_transito) || 0), 0);
        host.innerHTML = cab + erro + abas + `
          <div class="kpi-grid k4i">
            <div class="kpi k-venda"><div class="kpi-label">Unidades no Full</div><div class="kpi-value">${esInt(tot)}</div><div class="kpi-sub">${itens.length} anúncios (kits contam como anúncio)</div></div>
            <div class="kpi k-mc"><div class="kpi-label">Disponíveis para venda</div><div class="kpi-value">${esInt(disp)}</div><div class="kpi-sub">&nbsp;</div></div>
            <div class="kpi k-frete"><div class="kpi-label">Em transferência</div><div class="kpi-value">${esInt(transf)}</div><div class="kpi-sub">entre centros do Mercado Livre</div></div>
            <div class="kpi k-neutro"><div class="kpi-label">Atualizado</div><div class="kpi-value" style="font-size:18px;">${estoqueFullML && estoqueFullML._syncAt ? new Date(estoqueFullML._syncAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}</div><div class="kpi-sub">${estoqueFullML && estoqueFullML._fonte === 'xls' ? 'planilha importada' : 'direto do Mercado Livre'}</div></div>
          </div>
          <div class="card"><div class="sku-barra"><input type="text" id="est-busca" placeholder="Buscar por SKU ou título" value="${esEsc(est.busca)}" oninput="estBuscar(this.value)"></div>
          <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Anúncio</th><th>Conta</th><th class="num">Disponível</th><th class="num">Em transferência</th><th class="num">Sem condição de venda</th><th class="num">Total</th></tr></thead><tbody>
            ${lista.length ? lista.map(x => `<tr><td class="cp-prod" style="max-width:520px;"><b>${esEsc(x.sku)}</b><span title="${esEsc(x.titulo)}">${esEsc(x.titulo || '')}</span></td><td class="cp-forn">${esEsc((typeof contaNome === 'function' && x._conta && contaNome(x._conta)) || '—')}</td><td class="num"><b>${esInt(x.aptos_venda)}</b></td><td class="num">${esInt(x.em_transito)}</td><td class="num" title="${esEsc(x.detalhe || '')}">${esInt(x.nao_aptos)}</td><td class="num"><b>${esInt(x.total_geral)}</b></td></tr>`).join('') : '<tr><td colspan="6"><div class="vazio"><b>Sem estoque do Full carregado</b>Clique em Atualizar do Mercado Livre.</div></td></tr>'}
          </tbody></table></div></div>`;
        return;
      }

      const todas = estLinhas(dep), b = esN(est.busca);
      const lista = todas.filter(l => (!b || l.k.includes(b) || esN(l.nome).includes(b)) && (est.so === '' || (est.so === 'zerado' ? l.fisico <= 0 : est.so === 'caminho' ? l.caminho > 0 : est.so === 'ocupado' ? l.ocupado > 0 : est.so === 'semcusto' ? !(l.custo > 0) && l.fisico > 0 : true)))
        .sort((a, c) => c.fisico * c.custo - a.fisico * a.custo || c.fisico - a.fisico || a.k.localeCompare(c.k));
      const un = todas.reduce((s, l) => s + Math.max(0, l.fisico), 0), valor = todas.reduce((s, l) => s + Math.max(0, l.fisico) * l.custo, 0);
      const cam = todas.reduce((s, l) => s + l.caminho, 0), ocp = todas.reduce((s, l) => s + l.ocupado, 0);
      const semMov = !est.saldo.some(s => Number(s.deposito_id) === dep.id);
      host.innerHTML = cab + erro + abas + `
        ${semMov ? `<div class="alert alert-warning">Este depósito ainda não tem estoque lançado. Clique em <b>&nbsp;Carregar planilha da UpSeller&nbsp;</b> e escolha a Lista de Estoque (a de produtos, não a de kits).</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Estoque físico</div><div class="kpi-value">${esInt(un)} un.</div><div class="kpi-sub">${fmt(valor)} a custo médio</div></div>
          <div class="kpi k-frete"><div class="kpi-label">A caminho</div><div class="kpi-value">${esInt(cam)} un.</div><div class="kpi-sub">comprado e ainda não conferido</div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Ocupado</div><div class="kpi-value">${esInt(ocp)} un.</div><div class="kpi-sub">vendido ou separado, ainda não saiu</div></div>
          <div class="kpi k-mc"><div class="kpi-label">Disponível</div><div class="kpi-value">${esInt(un - ocp)} un.</div><div class="kpi-sub">físico menos ocupado</div></div>
        </div>
        <div class="card"><div class="sku-barra">
          <input type="text" id="est-busca" placeholder="Buscar por SKU ou nome" value="${esEsc(est.busca)}" oninput="estBuscar(this.value)">
          <div class="chips">${[['', 'Todos'], ['caminho', 'Com compra a caminho'], ['ocupado', 'Com ocupado'], ['zerado', 'Zerados'], ['semcusto', 'Sem custo']].map(([k, t]) => `<button class="chip ${est.so === k ? 'active' : ''}" onclick="est.so='${k}';estDesenhar();">${t}</button>`).join('')}</div>
        </div>
        <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num" title="Comprado e ainda não conferido">A caminho</th><th class="num" title="Vendido ou separado, ainda não saiu">Ocupado</th><th class="num" title="Físico menos ocupado">Disponível</th><th class="num" title="O que está no depósito">Estoque físico</th><th class="num">Custo médio</th><th class="num">Valor</th><th></th></tr></thead><tbody>
          ${lista.length ? lista.map(l => `<tr>
            <td class="cp-prod" style="max-width:440px;"><b>${esEsc(l.sku)}</b><span title="${esEsc(l.nome)}">${esEsc(l.nome || '')}</span></td>
            <td class="num">${l.caminho ? esInt(l.caminho) : '<span class="text-muted">—</span>'}</td>
            <td class="num">${l.ocupado ? esInt(l.ocupado) : '<span class="text-muted">—</span>'}</td>
            <td class="num ${l.disp < 0 ? 'text-danger' : ''}">${esInt(l.disp)}</td>
            <td class="num"><b class="${l.fisico < 0 ? 'text-danger' : ''}">${esInt(l.fisico)}</b></td>
            <td class="num">${l.custo ? fmt(l.custo) : '<span class="badge badge-warning">sem custo</span>'}</td>
            <td class="num">${l.custo ? fmt(Math.max(0, l.fisico) * l.custo) : '—'}</td>
            <td style="text-align:right;"><button class="btn-out btn-sm" onclick="estMovimentos('${esEsc(l.k)}')">Movimentações</button></td>
          </tr>`).join('') : '<tr><td colspan="8"><div class="vazio"><b>Nada nesta lista</b>Troque a busca ou o filtro.</div></td></tr>'}
        </tbody></table></div></div>`;
    }

    let estBuscaT = null;
    function estBuscar(v){ est.busca = v; clearTimeout(estBuscaT); estBuscaT = setTimeout(() => { estDesenhar(); const i = document.getElementById('est-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }

    async function estAtualizarFull(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      if(typeof comprasFullAPI === 'function') await comprasFullAPI();
      estDesenhar();
    }

    async function estNovoDeposito(){
      const nome = (prompt('Nome do novo depósito (ex.: Galpão 2, Loja):') || '').trim();
      if(!nome) return;
      const r = await supa.from('estoque_depositos').insert({ usuario_id: usuarioAtual.id, nome, tipo: 'proprio' });
      if(r.error){ alert('Não consegui criar o depósito: ' + r.error.message); return; }
      await estCarregar(true); estDesenhar();
    }

    // histórico de um produto no depósito aberto
    async function estMovimentos(k){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep) return;
      const r = await supa.from('estoque_mov').select('*').eq('usuario_id', usuarioAtual.id).eq('deposito_id', dep.id).eq('sku_norm', k).order('criado_em', { ascending: false }).limit(300);
      const mv = r.data || [];
      let saldo = estSaldoDe(dep.id, k);
      const dt = t => new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      const linhas = mv.map(m => { const depois = saldo; saldo -= Number(m.qtd); return `<tr><td>${dt(m.criado_em)}</td><td>${ES_MOTIVO[m.motivo] || m.motivo}${m.ref ? ` <span class="ap-parc">${esEsc(m.ref)}</span>` : ''}</td><td class="num ${Number(m.qtd) < 0 ? 'text-danger' : 'text-success'}"><b>${Number(m.qtd) > 0 ? '+' : ''}${esInt(m.qtd)}</b></td><td class="num">${esInt(depois)}</td><td class="text-muted" style="font-size:12px;white-space:normal;">${esEsc(m.obs || '')}</td></tr>`; }).join('');
      vmlModal(`${esEsc(k.toUpperCase())} — movimentações em ${esEsc(dep.nome)}`, mv.length ? `<div style="max-height:60vh;overflow:auto;"><table class="cp-tab"><thead><tr><th>Quando</th><th>Motivo</th><th class="num">Quantidade</th><th class="num">Saldo depois</th><th>Observação</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="vazio"><b>Sem movimentações</b>Este produto ainda não teve entrada nem saída neste depósito.</div>');
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }

    function estAjuste(){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep) return;
      vmlModal('Ajuste manual — ' + esEsc(dep.nome), `
        <div class="text-muted" style="margin-bottom:12px;">Use para corrigir um produto isolado. Para acertar vários de uma vez, faça uma contagem.</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">SKU</label><input type="text" id="est-aj-sku" list="est-aj-lista" placeholder="Ex.: J-2010-Branco"><datalist id="est-aj-lista">${estLinhas(dep).map(l => `<option value="${esEsc(l.sku)}">`).join('')}</datalist></div>
          <div class="form-group"><label class="form-label">Quantidade (use menos para tirar)</label><input type="number" id="est-aj-qtd" placeholder="Ex.: 10 ou -3"></div>
        </div>
        <div class="form-group"><label class="form-label">Motivo</label><input type="text" id="est-aj-obs" placeholder="Ex.: avaria, brinde, erro de lançamento"></div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="estAjusteSalvar()">Lançar ajuste</button>`);
    }
    async function estAjusteSalvar(){
      const sku = (document.getElementById('est-aj-sku').value || '').trim(), qtd = Number(document.getElementById('est-aj-qtd').value), obs = (document.getElementById('est-aj-obs').value || '').trim();
      if(!sku || !qtd){ alert('Informe o SKU e a quantidade.'); return; }
      if(!obs){ alert('Escreva o motivo do ajuste: ele fica no histórico do produto.'); return; }
      const r = await estMovimentar(est.dep, [{ sku, qtd, motivo: 'ajuste', obs }]);
      if(!r.ok){ alert('Não consegui lançar: ' + r.erro); return; }
      fecharModal('modal-vml'); estDesenhar();
    }

    // Carga pela Lista de Estoque da UpSeller: o físico de cada produto passa a ser o "Estoque Atual" da planilha.
    // Grava só a DIFERENÇA para o saldo atual (como uma contagem), e traz o custo médio.
    function estCargaPlanilha(){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep) return;
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls';
      inp.onchange = () => {
        const file = inp.files[0]; if(!file) return;
        const rd = new FileReader();
        rd.onload = async e => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
            if(!rows.length || !('SKU' in rows[0]) || !('Estoque Atual' in rows[0])){
              alert(rows.length && ('KIT SKU' in rows[0]) ? 'Esta é a lista de KITS. Preciso da Lista de Estoque de produtos: na UpSeller, Estoque → Lista de Estoque → aba SKU → Importar & Exportar.' : 'Este arquivo não parece ser a Lista de Estoque da UpSeller (faltam as colunas SKU e Estoque Atual).');
              return;
            }
            const armazens = [...new Set(rows.map(r => String(r['Armazém'] || '').trim()).filter(Boolean))];
            let armazem = '';
            if(armazens.length > 1){
              armazem = (prompt('A planilha tem mais de um armazém:\n' + armazens.join('\n') + '\n\nDigite o nome do armazém que corresponde a "' + dep.nome + '":', armazens[0]) || '').trim();
              if(!armazem) return;
            }
            const alvo = new Map();
            rows.forEach(r => { const sku = String(r.SKU || '').trim(); if(!sku) return; if(armazem && String(r['Armazém'] || '').trim() !== armazem) return;
              const k = esN(sku), a = alvo.get(k) || { sku, qtd: 0, custo: 0, titulo: String(r['Título'] || '').trim() };
              a.qtd += Number(r['Estoque Atual']) || 0; if(Number(r['Custo Médio']) > 0) a.custo = Number(r['Custo Médio']); alvo.set(k, a); });
            const mov = [], ref = 'planilha-' + new Date().toISOString().substring(0, 16);
            alvo.forEach((a, k) => { const dif = a.qtd - estSaldoDe(dep.id, k); if(dif) mov.push({ sku: a.sku, qtd: dif, motivo: est.saldo.some(s => Number(s.deposito_id) === dep.id) ? 'contagem' : 'carga_inicial', ref, obs: 'Lista de Estoque da UpSeller: ' + file.name }); });
            // produtos com saldo aqui e que não vieram na planilha ficam como estão (a planilha pode ser parcial)
            const maiores = mov.filter(m => Math.abs(m.qtd) > 0).length;
            if(!confirm('Planilha lida: ' + alvo.size + ' produtos.\n' + maiores + ' terão o estoque físico ajustado para o valor da planilha.\n\nAplicar em "' + dep.nome + '"?')) return;
            alvo.forEach((a, k) => { let g = estoqueGalpao.find(x => esN(x.sku) === k); if(!g){ g = { sku: a.sku, descricao: a.titulo || a.sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }; estoqueGalpao.push(g); } if(a.titulo) g.descricao = a.titulo; if(a.custo > 0) g.custo_medio = a.custo; g.data_atualizacao = getToday(); });
            const r = await estMovimentar(dep.id, mov);
            if(!r.ok){ alert('Não consegui gravar: ' + r.erro); return; }
            if(!mov.length && typeof salvar === 'function') salvar();
            estDesenhar();
            alert('Estoque de "' + dep.nome + '" atualizado: ' + r.n + ' produtos ajustados.');
          } catch(err){ alert('Não consegui ler o arquivo: ' + err.message); }
        };
        rd.readAsArrayBuffer(file);
      };
      inp.click();
    }
