// ===== SUGESTÃO DE COMPRAS =====
// Porta para dentro do Caixa 360 as regras do módulo "Balanço e Compras" do Jonathan (gerarCompras):
//  - venda por dia vinda das vendas do ML (tabela vendas_ml), kits abertos nos componentes;
//  - ficam fora os períodos ignorados e as sequências de dias fracos longas demais para serem acaso
//    (ruptura / anúncio parado); a média usa os 30 dias "normais" mais recentes, voltando até 90;
//  - base AUTO: "sobe rápido, desce devagar" (só usa a mista quando um produto estável caiu até 25%);
//  - sazonalidade por mês (geral e por família), alvo de cobertura por SKU/família, múltiplo de caixa;
//  - regra TOTAL: comprar = venda prevista até (alvo + prazo) − galpão − Full − em trânsito.
// Estoque: galpão e em trânsito de estoqueGalpao (importação do UpSeller); Full de estoqueFullML (API).
// Parâmetros ficam em comprasCfg (configuracoes.cfg.comprasCfg + localStorage mk_compras_cfg).

    const CP_PADRAO = {
      regra: 'TOTAL', jurosMes: 3,
      padrao: { cob: 90, prazo: 0, mult: 1, base: 'AUTO' },
      regras: [
        { pat: 'J-2010-Branco', cob: 110, prazo: 0, mult: 200, manual: '', base: '', obs: 'Importado (container): 90 dias entre lotes + 10 de atraso + 10 de folga. Caixa com 200.' },
        { pat: 'J-2010*', cob: 110, prazo: 0, mult: '', manual: '', base: '', obs: 'Importado (container): 90 dias entre lotes + 10 de atraso + 10 de folga.' },
      ],
      sazonalidade: [
        { pat: 'PADRAO', f: [0.5, 0.55, 1, 1, 1, 1, 1, 1, 1, 1, 1.25, 0.7], obs: 'Novembro +25%, dezembro -30%, janeiro e fevereiro -45 a -50%' },
        { pat: 'J-2010*', f: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], obs: 'Buquê de rosas: sem ajuste de sazonalidade' },
        { pat: '*-Rosa', f: [null, null, null, 1.5, 1.5, null, null, null, null, 1.3, null, null], obs: 'Produtos rosa: Dia das Mães e Outubro Rosa' },
      ],
      equivalentes: [ { de: 'J-2006-Rosa', para: 'J-2005-Rosa' }, { de: 'J-2015', para: 'J-2015-18' } ],
      diasIgnorados: [ { ini: '2026-10-02', fim: '2026-10-07', motivo: 'Bug do Mercado Livre: estoque do Full aparecendo indisponível' } ],
    };
    let comprasCfg = JSON.parse(JSON.stringify(CP_PADRAO));
    try { const l = JSON.parse(localStorage.getItem('mk_compras_cfg') || 'null'); if(l) comprasCfg = { ...comprasCfg, ...l }; } catch(e){}
    let comprasVendas = { chave:'', dados:null, em:0, erro:null };
    let comprasSim = {};                  // dias de estoque simulados por SKU (não é salvo)
    let comprasFiltro = { sit:'comprar', busca:'', forn:'' };
    let comprasCalc = null;

    function comprasCarregarCfg(c){ if(c && typeof c === 'object'){ comprasCfg = { ...JSON.parse(JSON.stringify(CP_PADRAO)), ...c }; localStorage.setItem('mk_compras_cfg', JSON.stringify(comprasCfg)); } }
    function comprasSalvarCfg(){ localStorage.setItem('mk_compras_cfg', JSON.stringify(comprasCfg)); if(typeof salvarCfgSupabase === 'function') salvarCfgSupabase(); }

    const cpNorm = s => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const cpNum = v => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
    const cpGlob = p => new RegExp('^' + cpNorm(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const cpEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const cpInt = n => Math.round(Number(n) || 0).toLocaleString('pt-BR');

    // ----- dados de venda (120 dias, por SKU e por dia) -----
    async function comprasCarregarVendas(forcar){
      if(!usuarioAtual) return;
      const hoje = getToday(), chave = hoje + '|' + (typeof contaAtiva !== 'undefined' ? contaAtiva : '');
      if(!forcar && comprasVendas.chave === chave && comprasVendas.dados && Date.now() - comprasVendas.em < 10 * 60 * 1000) return;
      const { data, error } = await supa.rpc('vendas_ml_sku_dia', { p_de: addDias(hoje, -121), p_ate: addDias(hoje, -1), p_conta: typeof contaParam === 'function' ? contaParam() : null });
      // dias já importados do ML: os que faltam não podem contar como 'dia sem venda'
      let qd = supa.from('vendas_ml_dias').select('dia').eq('usuario_id', usuarioAtual.id).eq('completo', true).gte('dia', addDias(hoje, -121)).limit(1000);
      if(typeof contaAtiva !== 'undefined' && contaAtiva) qd = qd.eq('ml_user_id', contaAtiva);
      const cob = await qd;
      const importados = new Set((cob.data || []).map(r => String(r.dia).substring(0,10)));
      comprasVendas = { chave, dados: data || {}, em: Date.now(), erro: error?.message || null, importados, diasImportados: [...importados].filter(d => d < hoje).length };
    }

    // ----- cálculo (porta de gerarCompras) -----
    function comprasCalcular(){
      const cfg = comprasCfg, hoje = getToday(), fim = addDias(hoje, -1);       // último dia completo
      const TOTAL = cpNorm(cfg.regra) !== 'galpao', taxa = (cpNum(cfg.jurosMes) || 3) / 100, ALVO_PAD = TOTAL ? 90 : 45;
      const pad = cfg.padrao || {};
      const regras = (cfg.regras || []).filter(r => r.pat).map(r => ({ ...r, re: cpGlob(r.pat), n: cpNorm(r.pat).replace(/\*/g, '').length }));
      const regraDe = k => regras.filter(r => r.re.test(k)).sort((a,b) => b.n - a.n)[0] || null;
      const sazRows = (cfg.sazonalidade || []).filter(r => r.pat).map(r => ({ pad: cpNorm(r.pat) === 'padrao', re: cpGlob(r.pat), f: r.f || [] }));
      const sazPad = (sazRows.find(r => r.pad) || { f: [] }).f, sazCache = new Map();
      const fatoresDe = k => { if(!sazCache.has(k)){ const r = sazRows.find(x => !x.pad && x.re.test(k)); sazCache.set(k, Array.from({ length: 12 }, (_, m) => (r && r.f[m] > 0 ? r.f[m] : sazPad[m] > 0 ? sazPad[m] : 1))); } return sazCache.get(k); };
      const dFim = parseDate(fim);
      // "dias equivalentes": quantos dias de venda no ritmo atual cabem nos próximos h dias, dado o fator de cada mês
      const eqDias = (k, h) => {
        const fz = fatoresDe(k); let base = 0;
        for(let j = 0; j < 30; j++){ const d = new Date(dFim); d.setDate(d.getDate() - j); base += fz[d.getMonth()]; }
        base /= 30; let s = 0;
        for(let i = 1; i <= Math.round(h); i++){ const d = new Date(dFim); d.setDate(d.getDate() + i); s += fz[d.getMonth()]; }
        return base > 0 ? s / base : h;
      };
      const alias = new Map((cfg.equivalentes || []).filter(e => e.de && e.para).map(e => [cpNorm(e.de), cpNorm(e.para)]));
      // dias válidos (fora dos períodos ignorados); índice 0 = ontem
      const ign = (cfg.diasIgnorados || []).filter(g => g.ini).map(g => ({ ini: g.ini, fim: g.fim || '9999-12-31' }));
      const validos = [];
      const imp = comprasVendas.importados;
      for(let i = 0; i < 120; i++){ const d = addDias(fim, -i); if(imp && imp.size && !imp.has(d)) continue; if(!ign.some(g => d >= g.ini && d <= g.fim)) validos.push(i); }
      const disp = validos.length, N = n => Math.min(n, disp);

      // kits: SKU comercial → componentes
      const kits = new Map();
      composicaoKit.forEach(c => { const k = cpNorm(c.sku_comercial); if(!kits.has(k)) kits.set(k, []); kits.get(k).push({ sku: c.sku_componente, qtd: cpNum(c.qty) || 1 }); });

      // universo de SKUs únicos + estoque
      const itens = new Map();
      const item = (sku) => { const k = cpNorm(sku); if(!k) return null; if(!itens.has(k)) itens.set(k, { sku: String(sku).trim(), nome: '', galpao: 0, transito: 0, full: 0, custo: 0, forn: '' }); return itens.get(k); };
      componentes.forEach(c => { const it = item(c.codigo); if(!it) return; it.nome = it.nome || c.descricao || ''; it.custo = cpNum(c.custo_unitario) || it.custo; it.forn = c.fornecedor || it.forn; });
      estoqueGalpao.forEach(e => { if(kits.has(cpNorm(e.sku))) return; const it = item(e.sku); if(!it) return; it.nome = it.nome || e.descricao || ''; it.galpao += cpNum(e.qtd_galpao); it.transito += cpNum(e.em_transito); if(!it.custo) it.custo = cpNum(e.custo_medio); });
      skus.forEach(s => { if(kits.has(cpNorm(s.sku))) return; const it = item(s.sku); if(!it) return; it.nome = it.nome || s.titulo || ''; if(!it.custo) it.custo = cpNum(s.custo); });
      // Full: estoque por SKU do anúncio; kits abrem nos componentes
      const addFull = (sku, q) => { const k = cpNorm(sku); if(!q) return; if(kits.has(k)) kits.get(k).forEach(c => { const it = item(c.sku); if(it) it.full += q * c.qtd; }); else { const it = item(sku); if(it) it.full += q; } };
      const temFullAPI = Array.isArray(estoqueFullML) && estoqueFullML.length > 0;
      if(temFullAPI) estoqueFullML.forEach(f => addFull(f.sku, cpNum(f.aptos_venda) + cpNum(f.em_transito) + cpNum(f.pendente)));
      else estoqueGalpao.forEach(e => addFull(e.sku, cpNum(e.qtd_full) + cpNum(e.qtd_full_pendente)));

      // vendas por SKU único e por dia
      const porSku = new Map(), porConta = new Map(), fora = new Map();
      const add = (k, idx, q) => { if(!porSku.has(k)) porSku.set(k, new Float64Array(120)); if(idx >= 0 && idx < 120) porSku.get(k)[idx] += q; };
      const addC = (k, conta, q) => { if(!porConta.has(k)) porConta.set(k, {}); porConta.get(k)[conta] = (porConta.get(k)[conta] || 0) + q; };
      const V = comprasVendas.dados || {};
      Object.keys(V).forEach(skuVenda => {
        const k0 = cpNorm(skuVenda), k = alias.get(k0) || k0, reg = V[skuVenda] || {};
        const destinos = kits.has(k) ? kits.get(k).map(c => ({ k: cpNorm(c.sku), sku: c.sku, m: c.qtd })) : [{ k, sku: skuVenda, m: 1 }];
        destinos.forEach(d => { if(!itens.has(d.k)){ if(k0 === '(sem sku)') return; item(d.sku).nome = reg.t || ''; } });
        Object.keys(reg.d || {}).forEach(dia => { const idx = diasDif(dia, fim); const q = cpNum(reg.d[dia]); destinos.forEach(d => add(d.k, idx, q * d.m)); });
        Object.keys(reg.c || {}).forEach(conta => destinos.forEach(d => addC(d.k, conta, cpNum(reg.c[conta]) * d.m)));
        if(k0 === '(sem sku)') fora.set('(sem SKU)', Object.values(reg.d || {}).reduce((s,q) => s + cpNum(q), 0));
      });
      const vendeEm = k => { const m = Object.entries(porConta.get(k) || {}).sort((a,b) => b[1] - a[1]); if(m.length < 2) return m.length && typeof contaNome === 'function' ? (contaNome(m[0][0]) || '') : ''; const t = m.reduce((a,x) => a + x[1], 0); return m.map(([c,v]) => `${(typeof contaNome === 'function' && contaNome(c)) || c} ${Math.round(100 * v / t)}%`).join(' + '); };

      const linhas = [];
      for(const [k, it] of itens){
        const bruto = porSku.get(k) || new Float64Array(120), s = Float64Array.from(validos, i => bruto[i]);
        const soma = (a, b) => { let t = 0; for(let i = a; i < b; i++) t += s[i]; return t; };
        const n14 = N(14), n30 = N(30), n90 = N(90);
        const u30 = soma(0, n30), u90 = soma(0, n90), ant = disp >= 60 ? soma(30, 60) : null;
        if(!u90 && !it.galpao && !it.full && !it.transito) continue;
        // dia fraco = sem venda ou muito abaixo do normal do próprio SKU
        const w = Array.from(s.slice(0, n90)), vend = w.filter(x => x > 0).sort((a,b) => a - b), med = vend.length ? vend[Math.floor(vend.length / 2)] : 0;
        const fraco = w.map(x => !x || x < 0.3 * med);
        let excl = new Array(n90).fill(false);
        for(let rodada = 0; rodada < 3; rodada++){
          let su = 0, cn = 0; for(let i = 0; i < n90; i++) if(!excl[i]){ su += w[i]; cn++; }
          const ritmo = cn ? su / cn : 0, nx = new Array(n90).fill(false);
          for(let i = 0; i < n90;){ if(!fraco[i]){ i++; continue; } let j = i; while(j < n90 && fraco[j]) j++; if(ritmo * (j - i) >= 4) for(let t = i; t < j; t++) nx[t] = true; i = j; }
          excl = nx;
        }
        const bonsT = []; let zeros = 0;
        for(let i = 0; i < n90; i++){ if(!excl[i]) bonsT.push(w[i]); else if(bonsT.length < 30) zeros++; }
        const bons = bonsT.slice(0, 30);
        const d14 = n14 ? soma(0, n14) / n14 : 0, d30 = n30 ? u30 / n30 : 0, d90 = n90 ? u90 / n90 : 0;
        const rg = regraDe(k), pega = c => (rg && rg[c] !== '' && rg[c] != null ? rg[c] : pad[c]);
        const manual = cpNum(pega('manual'));
        const dSel = bons.length >= 7 ? bons.reduce((a,x) => a + x, 0) / bons.length : d30;
        const dG90 = bonsT.length >= 7 ? bonsT.reduce((a,x) => a + x, 0) / bonsT.length : d90;
        const desvio = dG90 > 0 ? dSel / dG90 - 1 : 0, estavel = bonsT.length >= 75 && Math.abs(desvio) <= 0.25;
        const cfgBase = String(pega('base') || 'AUTO').toUpperCase();
        const base = ['30','90','MISTA'].includes(cfgBase) ? cfgBase : (estavel && desvio < 0 ? 'MISTA' : '30');
        const cons = manual > 0 ? manual : base === '90' ? dG90 : base === 'MISTA' ? (dSel + dG90) / 2 : dSel;
        const obsRup = zeros ? ` (${zeros} dias de ruptura ou parada ignorados)` : '';
        const criterio = manual > 0 ? 'Manual (parâmetros)' : !cons ? 'Sem venda no período'
          : base === 'MISTA' ? 'Mista: 2/3 últimos 30 dias + 1/3 anteriores' + obsRup
          : base === '90' ? 'Média de 90 dias' + obsRup
          : 'Últimos 30 dias' + obsRup + (cfgBase === 'AUTO' && bonsT.length >= 75 ? ` — venda ${desvio > 0 ? 'subiu' : 'caiu'} ${Math.abs(Math.round(desvio * 100))}% frente aos 90 dias` : cfgBase === 'AUTO' ? ' — histórico curto ou com ruptura longa' : '');
        const prazo = cpNum(pega('prazo'));
        const alvo = cpNum(pega('cob')) || ALVO_PAD, mult = Math.max(1, cpNum(pega('mult')) || 1);
        const comprar = dias => Math.max(0, Math.ceil((cons * eqDias(k, dias + prazo) - it.galpao - it.transito - (TOTAL ? it.full : 0)) / mult) * mult);
        const estoque = it.galpao + it.transito + (TOTAL ? it.full : 0);
        const cob = cons ? estoque / cons : null;
        const alvoUsado = comprasSim[k] > 0 ? comprasSim[k] : alvo;
        const sug = comprar(alvoUsado);
        const sit = !cons ? 'Sem venda' : cob < prazo + 7 ? 'URGENTE' : sug > 0 ? 'Comprar' : cob > alvo * 2 ? 'Excesso' : 'OK';
        linhas.push({ k, it, d14, d30, d90, tend: ant ? u30 / ant - 1 : null, zeros, cons, criterio, alvo, alvoUsado, prazo, mult, cob, sug, c60: comprar(60), c90: comprar(90), c120: comprar(120),
          custo: it.custo, valor: sug * (it.custo || 0), sit, vende: vendeEm(k), fator: (alvoUsado + prazo) > 0 ? eqDias(k, alvoUsado + prazo) / (alvoUsado + prazo) : 1 });
      }
      const ordem = { URGENTE: 0, Comprar: 1, OK: 2, Excesso: 3, 'Sem venda': 4 };
      linhas.sort((a,b) => ordem[a.sit] - ordem[b.sit] || b.valor - a.valor || b.cons - a.cons);
      // giro e caixa
      const estoqueValor = linhas.reduce((s,l) => s + (l.it.galpao + l.it.transito + l.it.full) * (l.custo || 0), 0);
      const custoDia = linhas.reduce((s,l) => s + l.cons * (l.custo || 0), 0);
      comprasCalc = {
        linhas, fora, disp, temFullAPI, TOTAL, taxa,
        giro: { estoqueValor, custoDia, dias: custoDia ? estoqueValor / custoDia : null, jurosMes: estoqueValor * taxa,
                sugerido: linhas.reduce((s,l) => s + l.valor, 0), urgentes: linhas.filter(l => l.sit === 'URGENTE').length,
                excesso: linhas.filter(l => l.sit === 'Excesso').reduce((s,l) => s + Math.max(0, (l.it.galpao + l.it.transito + l.it.full) - l.cons * l.alvo) * (l.custo || 0), 0) }
      };
      return comprasCalc;
    }

    // ----- tela -----
    async function renderCompras(){
      const el = document.getElementById('view-compras');
      if(!el) return;
      if(!comprasVendas.dados) el.innerHTML = '<div class="vazio"><b>Calculando a sugestão de compras…</b></div>';
      await comprasCarregarVendas(false);
      comprasDesenhar();
    }

    function comprasDesenhar(){
      const el = document.getElementById('view-compras');
      if(!el || !el.classList.contains('active')) return;
      const C = comprasCalcular(), g = C.giro, f = comprasFiltro;
      const semEstoque = !estoqueGalpao.length;
      const fornecedores = [...new Set(C.linhas.map(l => l.it.forn).filter(Boolean))].sort();
      const cont = s => C.linhas.filter(l => l.sit === s).length;
      const lista = C.linhas.filter(l => {
        if(f.sit === 'comprar' && !(l.sug > 0)) return false;
        if(f.sit !== 'comprar' && f.sit !== 'todos' && l.sit !== f.sit) return false;
        if(f.forn && l.it.forn !== f.forn) return false;
        if(f.busca && !(cpNorm(l.it.sku).includes(cpNorm(f.busca)) || cpNorm(l.it.nome).includes(cpNorm(f.busca)))) return false;
        return true;
      });
      const totalLista = lista.reduce((s,l) => s + l.valor, 0);
      const selo = s => `<span class="cp-sit cp-${cpNorm(s).replace(/\s/g,'')}">${s}</span>`;
      const d1 = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits:1, maximumFractionDigits:1 });

      el.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Sugestão de compras</div>
            <div class="pg-sub">Quanto comprar de cada produto para cobrir os dias de estoque desejados, com a venda real do Mercado Livre.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;align-items:center;">
            <button class="btn-out btn btn-sm" onclick="comprasAtualizar(this)">↻ Atualizar vendas</button>
            <button class="btn-out btn btn-sm" onclick="comprasParametros()">⚙ Parâmetros</button>
            <button class="btn btn-sm" onclick="comprasExportar()">⬇ Exportar</button>
          </div>
        </div>
        ${comprasVendas.erro ? `<div class="alert alert-danger">${cpEsc(comprasVendas.erro)}</div>` : ''}
        ${semEstoque ? `<div class="alert alert-warning" style="justify-content:space-between;flex-wrap:wrap;"><span><b>Estoque do galpão não importado.</b> Sem ele a sugestão considera estoque zero no galpão. Importe a lista de estoque do UpSeller em Estoque e reposição.</span><button class="btn btn-sm" onclick="nav('estoque')">Ir para Estoque</button></div>` : ''}
        ${!C.temFullAPI ? `<div class="alert alert-info" style="justify-content:space-between;flex-wrap:wrap;"><span>Estoque do Full ainda não foi buscado no Mercado Livre nesta sessão.</span><button class="btn-out btn btn-sm" onclick="comprasBuscarFull(this)">Buscar estoque Full</button></div>` : ''}
        ${(comprasVendas.diasImportados || 0) < 100 ? `<div class="alert alert-info">As vendas ainda estão sendo importadas do Mercado Livre: <b>&nbsp;${comprasVendas.diasImportados || 0} de 120 dias&nbsp;</b> disponíveis. A venda por dia fica mais precisa quando o histórico terminar de carregar.</div>` : ''}

        <div class="kpi-grid">
          <div class="kpi k-venda"><div class="kpi-label">Compra sugerida</div><div class="kpi-value">${fmt(g.sugerido)}</div><div class="kpi-sub"><span><b>${C.linhas.filter(l => l.sug > 0).length}</b> produtos</span><span style="color:var(--danger)"><b style="color:inherit">${g.urgentes}</b> urgentes</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Estoque a custo</div><div class="kpi-value">${fmt(g.estoqueValor)}</div><div class="kpi-sub"><span>${g.dias != null ? `<b>${cpInt(g.dias)}</b> dias de venda` : 'sem venda para medir'}</span></div></div>
          <div class="kpi k-custo"><div class="kpi-label" title="Estoque a custo × juros ao mês dos parâmetros">Custo de carregar o estoque</div><div class="kpi-value">${fmt(g.jurosMes)}</div><div class="kpi-sub"><span>por mês, a <b>${(C.taxa * 100).toLocaleString('pt-BR')}%</b> a.m.</span></div></div>
          <div class="kpi k-tarifa"><div class="kpi-label">Custo das vendas</div><div class="kpi-value">${fmt(g.custoDia * 30)}</div><div class="kpi-sub"><span>por mês (<b>${fmt(g.custoDia)}</b> por dia)</span></div></div>
        </div>

        <div class="card"><div class="card-body">
          <div class="chips" style="align-items:center;">
            ${[['comprar','A comprar',C.linhas.filter(l => l.sug > 0).length],['URGENTE','Urgente',cont('URGENTE')],['OK','OK',cont('OK')],['Excesso','Excesso',cont('Excesso')],['Sem venda','Sem venda',cont('Sem venda')],['todos','Todos',C.linhas.length]]
              .map(([k,l,n]) => `<button class="chip ${f.sit === k ? 'active' : ''}" onclick="comprasFiltro.sit='${k}';comprasDesenhar();">${l}<span class="n">${n}</span></button>`).join('')}
            <span style="flex:1;"></span>
            <select style="width:auto;" onchange="comprasFiltro.forn=this.value;comprasDesenhar();"><option value="">Todos os fornecedores</option>${fornecedores.map(x => `<option ${f.forn === x ? 'selected' : ''}>${cpEsc(x)}</option>`).join('')}</select>
            <input type="text" placeholder="Buscar SKU ou produto" value="${cpEsc(f.busca)}" style="width:220px;" onchange="comprasFiltro.busca=this.value;comprasDesenhar();">
          </div>
        </div></div>

        <div class="card">
          <div class="card-header"><div class="card-title">${lista.length} produto${lista.length === 1 ? '' : 's'} · ${fmt(totalLista)}</div>
            <span class="text-muted" style="font-size:12px;">Altere os <b>dias considerados</b> para simular; ao recarregar volta ao padrão.</span></div>
          <div style="overflow-x:auto;">
            <table class="rf-table cp-tab">
              <thead><tr><th>Situação</th><th>SKU</th><th>Produto</th><th>Fornecedor</th><th class="num" title="Venda por dia considerada no cálculo">Venda/dia</th><th class="num">Galpão</th><th class="num">Full</th><th class="num">Em trânsito</th><th class="num">Dias de estoque hoje</th><th class="num">Dias considerados</th><th class="num">Comprar (un.)</th><th class="num">Valor</th><th></th></tr></thead>
              <tbody>
                ${lista.length ? lista.map(l => `<tr>
                  <td>${selo(l.sit)}</td>
                  <td><b>${cpEsc(l.it.sku)}</b>${l.vende ? `<div class="text-muted" style="font-size:11px;">${cpEsc(l.vende)}</div>` : ''}</td>
                  <td style="max-width:240px;white-space:normal;">${cpEsc(l.it.nome || '—')}</td>
                  <td>${cpEsc(l.it.forn || '—')}</td>
                  <td class="num" title="${cpEsc(l.criterio)}">${d1(l.cons)}${l.zeros ? ' <span class="sem-custo" title="dias de ruptura ou parada ignorados">●</span>' : ''}</td>
                  <td class="num">${cpInt(l.it.galpao)}</td><td class="num">${cpInt(l.it.full)}</td><td class="num">${cpInt(l.it.transito)}</td>
                  <td class="num">${l.cob == null ? '—' : cpInt(l.cob)}</td>
                  <td class="num"><input type="number" min="0" step="5" class="cp-dias ${comprasSim[l.k] > 0 ? 'sim' : ''}" value="${l.alvoUsado}" onchange="comprasSimular('${cpEsc(l.k)}', this.value)"></td>
                  <td class="num"><b>${cpInt(l.sug)}</b>${l.mult > 1 ? `<div class="text-muted" style="font-size:10.5px;">caixa de ${l.mult}</div>` : ''}</td>
                  <td class="num"><b>${l.custo ? fmt(l.valor) : '<span class="sem-custo">sem custo</span>'}</b></td>
                  <td><button class="ico-btn" title="Ver o cálculo" onclick="comprasDetalhe('${cpEsc(l.k)}')">≡</button></td>
                </tr>`).join('') : `<tr><td colspan="13"><div class="vazio"><b>Nada nesta lista</b>Troque o filtro acima.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        ${C.fora.size ? `<div class="alert alert-warning">Vendas sem SKU no anúncio ficaram fora do cálculo (${[...C.fora.values()].reduce((s,v) => s + v, 0)} unidades em 120 dias). Use "Nivelar SKU" no Resumo Financeiro para corrigir.</div>` : ''}`;
    }

    function comprasSimular(k, v){ const n = Number(v); if(n > 0) comprasSim[k] = n; else delete comprasSim[k]; comprasDesenhar(); }
    async function comprasAtualizar(btn){ if(btn){ btn.disabled = true; btn.textContent = 'Atualizando…'; } await comprasCarregarVendas(true); comprasDesenhar(); }
    async function comprasBuscarFull(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      try { if(typeof sincronizarEstoqueFull === 'function') await sincronizarEstoqueFull(); } catch(e){}
      comprasDesenhar();
    }

    function comprasDetalhe(k){
      const l = (comprasCalc?.linhas || []).find(x => x.k === k); if(!l) return;
      const d1 = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits:1, maximumFractionDigits:1 });
      const r = (a,b) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--border);"><span class="text-muted">${a}</span><b style="text-align:right;">${b}</b></div>`;
      vmlModal(`${cpEsc(l.it.sku)} — como a sugestão foi calculada`, `
        <div class="v-tit" style="margin-bottom:12px;">${cpEsc(l.it.nome || l.it.sku)}</div>
        <div class="responsive-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px;">
          <div>
            ${r('Venda/dia — 14 dias', d1(l.d14))}${r('Venda/dia — 30 dias', d1(l.d30))}${r('Venda/dia — 90 dias', d1(l.d90))}
            ${r('Tendência (30d x 30d anteriores)', l.tend == null ? '—' : (l.tend >= 0 ? '+' : '') + Math.round(l.tend * 100) + '%')}
            ${r('Dias de ruptura/parada ignorados', l.zeros)}
            ${r('Venda/dia considerada', d1(l.cons))}
          </div>
          <div>
            ${r('Galpão + em trânsito + Full', `${cpInt(l.it.galpao)} + ${cpInt(l.it.transito)} + ${cpInt(l.it.full)}`)}
            ${r('Alvo de estoque / prazo', `${l.alvo} dias / ${l.prazo} dias`)}
            ${r('Fator sazonal no período', l.fator.toLocaleString('pt-BR', { maximumFractionDigits:2 }))}
            ${r('Compra para 60 / 90 / 120 dias', `${cpInt(l.c60)} / ${cpInt(l.c90)} / ${cpInt(l.c120)}`)}
            ${r('Custo unitário', l.custo ? fmt(l.custo) : 'não cadastrado')}
            ${r('Sugestão', `${cpInt(l.sug)} un. · ${fmt(l.valor)}`)}
          </div>
        </div>
        <div class="alert alert-info" style="margin-top:14px;"><b>Critério:</b>&nbsp;${cpEsc(l.criterio)}</div>`);
    }

    // Parâmetros: regra geral + padrão + regras por SKU/família + listas em texto (uma por linha)
    function comprasParametros(){
      const c = comprasCfg, p = c.padrao || {};
      const linhasRegras = (c.regras || []).map(r => [r.pat, r.cob, r.prazo, r.mult, r.manual, r.base, r.obs].map(x => x == null ? '' : x).join(';')).join('\n');
      const linhasSaz = (c.sazonalidade || []).map(r => [r.pat, ...(r.f || []).map(x => x == null ? '' : String(x).replace('.', ',')), r.obs || ''].join(';')).join('\n');
      const linhasEq = (c.equivalentes || []).map(e => e.de + ';' + e.para).join('\n');
      const linhasIgn = (c.diasIgnorados || []).map(g => [g.ini ? ptDate(g.ini) : '', g.fim ? ptDate(g.fim) : '', g.motivo || ''].join(';')).join('\n');
      vmlModal('Parâmetros de compras', `
        <div class="form-row">
          <div class="form-group"><label class="form-label">Regra geral</label><select id="cp-regra"><option value="TOTAL" ${cpNorm(c.regra) !== 'galpao' ? 'selected' : ''}>TOTAL — o alvo vale para galpão + Full + em trânsito</option><option value="GALPAO" ${cpNorm(c.regra) === 'galpao' ? 'selected' : ''}>GALPÃO — o alvo vale só para o galpão</option></select></div>
          <div class="form-group"><label class="form-label">Juros ao mês (%) — custo de carregar o estoque</label><input type="number" step="0.1" id="cp-juros" value="${cpNum(c.jurosMes) || 3}"></div>
        </div>
        <div class="form-label" style="margin-top:6px;">Padrão (vale para todo SKU sem regra própria)</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
          <div><label class="form-label">Dias de estoque</label><input type="number" id="cp-cob" value="${cpNum(p.cob) || 90}"></div>
          <div><label class="form-label">Prazo de entrega</label><input type="number" id="cp-prazo" value="${cpNum(p.prazo)}"></div>
          <div><label class="form-label">Múltiplo de compra</label><input type="number" id="cp-mult" value="${cpNum(p.mult) || 1}"></div>
          <div><label class="form-label">Base da venda</label><select id="cp-base">${['AUTO','30','90','MISTA'].map(b => `<option ${String(p.base || 'AUTO').toUpperCase() === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">Regras por SKU ou família — SKU;DIAS;PRAZO;MÚLTIPLO;VENDA/DIA MANUAL;BASE;OBSERVAÇÃO (use * para a família, ex.: J-2010*)</label><textarea id="cp-regras" rows="4" style="font-family:monospace;font-size:12px;">${cpEsc(linhasRegras)}</textarea></div>
        <div class="form-group"><label class="form-label">Sazonalidade — SKU;JAN;FEV;MAR;ABR;MAI;JUN;JUL;AGO;SET;OUT;NOV;DEZ;OBSERVAÇÃO (1 = mês normal; PADRAO vale para todos)</label><textarea id="cp-saz" rows="4" style="font-family:monospace;font-size:12px;">${cpEsc(linhasSaz)}</textarea></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">SKUs equivalentes — ANTIGO;ATUAL</label><textarea id="cp-eq" rows="3" style="font-family:monospace;font-size:12px;">${cpEsc(linhasEq)}</textarea></div>
          <div class="form-group"><label class="form-label">Dias ignorados — INÍCIO;FIM;MOTIVO (dd/mm/aaaa)</label><textarea id="cp-ign" rows="3" style="font-family:monospace;font-size:12px;">${cpEsc(linhasIgn)}</textarea></div>
        </div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="comprasSalvarParametros()">Salvar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }

    function comprasSalvarParametros(){
      const linhas = id => document.getElementById(id).value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(';').map(x => x.trim()));
      const dmyISO = t => { const m = String(t || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : ''; };
      comprasCfg = {
        regra: document.getElementById('cp-regra').value, jurosMes: cpNum(document.getElementById('cp-juros').value) || 3,
        padrao: { cob: cpNum(document.getElementById('cp-cob').value) || 90, prazo: cpNum(document.getElementById('cp-prazo').value), mult: cpNum(document.getElementById('cp-mult').value) || 1, base: document.getElementById('cp-base').value },
        regras: linhas('cp-regras').map(c => ({ pat: c[0], cob: c[1] || '', prazo: c[2] || '', mult: c[3] || '', manual: c[4] || '', base: c[5] || '', obs: c[6] || '' })),
        sazonalidade: linhas('cp-saz').map(c => ({ pat: c[0], f: Array.from({ length: 12 }, (_, i) => c[i + 1] ? cpNum(c[i + 1]) : null), obs: c[13] || '' })),
        equivalentes: linhas('cp-eq').filter(c => c[0] && c[1]).map(c => ({ de: c[0], para: c[1] })),
        diasIgnorados: linhas('cp-ign').map(c => ({ ini: dmyISO(c[0]), fim: dmyISO(c[1]), motivo: c[2] || '' })).filter(g => g.ini),
      };
      comprasSalvarCfg();
      fecharModal('modal-vml');
      comprasDesenhar();
    }

    function comprasExportar(){
      const C = comprasCalc || comprasCalcular();
      const r = (v, d) => Math.round((Number(v) || 0) * Math.pow(10, d)) / Math.pow(10, d);
      const linhas = C.linhas.map(l => ({
        'Situação': l.sit, 'SKU': l.it.sku, 'Produto': l.it.nome, 'Fornecedor': l.it.forn, 'Vende em': l.vende,
        'Venda/dia 14d': r(l.d14, 1), 'Venda/dia 30d': r(l.d30, 1), 'Venda/dia 90d': r(l.d90, 1), 'Tendência %': l.tend == null ? '' : r(l.tend * 100, 0),
        'Dias de ruptura ignorados': l.zeros, 'Venda/dia considerada': r(l.cons, 1), 'Critério': l.criterio,
        'Galpão': l.it.galpao, 'Em trânsito': l.it.transito, 'Full': l.it.full, 'Dias de estoque hoje': l.cob == null ? '' : r(l.cob, 0),
        'Alvo (dias)': l.alvoUsado, 'Prazo (dias)': l.prazo, 'Múltiplo': l.mult, 'Sugestão (un.)': l.sug, 'Custo unit.': r(l.custo, 2), 'Valor da compra': r(l.valor, 2),
        'Compra p/ 60 dias': l.c60, 'Compra p/ 90 dias': l.c90, 'Compra p/ 120 dias': l.c120, 'Fator sazonal': r(l.fator, 2)
      }));
      if(!linhas.length){ alert('Nada para exportar.'); return; }
      const porForn = {};
      C.linhas.filter(l => l.sug > 0).forEach(l => { const k = l.it.forn || '(sem fornecedor)'; if(!porForn[k]) porForn[k] = { 'Fornecedor': k, 'Produtos': 0, 'Unidades': 0, 'Valor': 0 }; porForn[k].Produtos++; porForn[k].Unidades += l.sug; porForn[k].Valor = r(porForn[k].Valor + l.valor, 2); });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.filter(x => x['Sugestão (un.)'] > 0)), 'Resumo');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Compras');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(porForn).sort((a,b) => b.Valor - a.Valor)), 'Por fornecedor');
      XLSX.writeFile(wb, `sugestao_de_compras_${getToday()}.xlsx`);
    }
