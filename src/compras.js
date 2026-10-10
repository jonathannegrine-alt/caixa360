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
    let comprasFiltro = { sit:'comprar', busca:'', forn:'', fam:'', extra:'' };
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
      const hoje = getToday(), chave = hoje + '|todas';   // estoque único: soma as vendas de todas as contas, qualquer que seja a escolhida no menu
      if(!forcar && comprasVendas.chave === chave && comprasVendas.dados && Date.now() - comprasVendas.em < 10 * 60 * 1000) return;
      const { data, error } = await supa.rpc('vendas_ml_sku_dia', { p_de: addDias(hoje, -121), p_ate: addDias(hoje, -1), p_conta: null });
      // dias já importados do ML: os que faltam não podem contar como 'dia sem venda'
      const cob = await supa.from('vendas_ml_dias').select('dia,ml_user_id').eq('usuario_id', usuarioAtual.id).eq('completo', true).gte('dia', addDias(hoje, -121)).limit(3000);
      const diasConta = {};   // dias já importados de cada conta
      (cob.data || []).forEach(r => { if(String(r.dia).substring(0,10) < hoje) diasConta[r.ml_user_id] = (diasConta[r.ml_user_id] || 0) + 1; });
      const importados = new Set((cob.data || []).map(r => String(r.dia).substring(0,10)));
      comprasVendas = { chave, dados: data || {}, em: Date.now(), erro: error?.message || null, importados, diasConta, diasImportados: [...importados].filter(d => d < hoje).length };
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
      // com as ordens de compra do Olist carregadas, o "a caminho" vem delas (comprado menos conferido); senão, da Lista de Estoque
      const ocUsa = typeof ocTemDados === 'function' && ocTemDados();
      const itens = new Map();
      const item = (sku) => { const k = cpNorm(sku); if(!k) return null; if(!itens.has(k)) itens.set(k, { sku: String(sku).trim(), nome: '', galpao: 0, transito: 0, full: 0, custo: 0, forn: '' }); return itens.get(k); };
      componentes.forEach(c => { const it = item(c.codigo); if(!it) return; it.nome = it.nome || c.descricao || ''; it.custo = cpNum(c.custo_unitario) || it.custo; it.forn = c.fornecedor || it.forn; });
      estoqueGalpao.forEach(e => { if(kits.has(cpNorm(e.sku))) return; const it = item(e.sku); if(!it) return; it.nome = it.nome || e.descricao || ''; it.galpao += cpNum(e.qtd_galpao); if(!ocUsa) it.transito += cpNum(e.em_transito); if(cpNum(e.custo_medio) > 0) it.custo = cpNum(e.custo_medio); });   // custo médio do galpão vale mais que o do cadastro
      skus.forEach(s => { if(kits.has(cpNorm(s.sku))) return; const it = item(s.sku); if(!it) return; it.nome = it.nome || s.titulo || ''; if(!it.custo) it.custo = cpNum(s.custo); });
      if(ocUsa) ocTransitoPorSku().forEach((q, k) => { const it = itens.get(k) || item(k.toUpperCase()); if(it) it.transito += q; });
      // Full: estoque por SKU do anúncio; kits abrem nos componentes
      const addFull = (sku, q) => { const k = cpNorm(sku); if(!q) return; if(kits.has(k)) kits.get(k).forEach(c => { const it = item(c.sku); if(it) it.full += q * c.qtd; }); else { const it = item(sku); if(it) it.full += q; } };
      const temFullAPI = Array.isArray(estoqueFullML) && estoqueFullML.length > 0;
      if(temFullAPI) estoqueFullML.forEach(f => addFull(f.sku, cpNum(f.total_geral) || (cpNum(f.aptos_venda) + cpNum(f.em_transito) + cpNum(f.pendente) + cpNum(f.em_separacao))));   // total_geral = "unidades que ocupam espaço" da planilha do ML (inclui o que está a caminho)   // em_separacao = entrada pendente (a caminho do Full) na planilha do ML
      else estoqueGalpao.forEach(e => addFull(e.sku, cpNum(e.qtd_full) + cpNum(e.qtd_full_pendente)));

      // saiu do galpão para o Full e o Mercado Livre ainda não deu entrada: conta como Full
      if(typeof esoACaminhoDoFull === 'function') esoACaminhoDoFull().forEach((q, k) => { const it = itens.get(k); if(it) it.full += q; });
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

      const fornUlt = cfg.fornecedores || {};   // fornecedor da última compra (Relatório de Compras da UpSeller)
      const linhas = [];
      for(const [k, it] of itens){
        if(!it.forn && fornUlt[k]) it.forn = fornUlt[k];
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
    let comprasOrd = { col: '', dir: 1 };   // '' = ordem padrão (situação, depois valor)
    let comprasFontesAbertas = null;        // painel "De onde vêm os números": abre sozinho se faltar dado

    async function renderCompras(){
      const el = document.getElementById('view-compras');
      if(!el) return;
      if(!comprasVendas.dados) el.innerHTML = '<div class="vazio"><b>Calculando a sugestão de compras…</b></div>';
      const idadeFull = Array.isArray(estoqueFullML) && estoqueFullML._syncAt ? Date.now() - new Date(estoqueFullML._syncAt).getTime() : Infinity;
      const buscaFull = (!Array.isArray(estoqueFullML) || estoqueFullML._fonte !== 'xls') && idadeFull > 30 * 60 * 1000 ? comprasFullAPI() : null;
      await comprasCarregarVendas(false);
      if(buscaFull) await buscaFull;
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      if(typeof estCarregar === 'function') try { await estCarregar(false); if(typeof esoSincronizar === 'function') await esoSincronizar(false); } catch(e){}
      comprasDesenhar();
    }

    const CP_ORDEM_SIT = { URGENTE: 0, Comprar: 1, OK: 2, Excesso: 3, 'Sem venda': 4 };
    const cpEstoque = l => l.it.galpao + l.it.transito + l.it.full;
    const cpFamilia = sku => String(sku || '').split('-').slice(0, 2).join('-');
    // colunas: [chave, título, valor para ordenar, numérica?, dica]
    const CP_COLS = [
      ['sit', 'Situação', l => CP_ORDEM_SIT[l.sit], false, 'Urgente: o estoque acaba antes de chegar uma compra nova'],
      ['sku', 'Produto', l => cpNorm(l.it.sku), false, ''],
      ['forn', 'Fornecedor', l => cpNorm(l.it.forn), false, ''],
      ['cons', 'Venda por dia', l => l.cons, true, 'Venda por dia usada na conta (passe o mouse no número para ver o critério)'],
      ['est', 'Estoque', l => cpEstoque(l), true, 'Galpão + Full + o que está a caminho'],
      ['cob', 'Dura quantos dias', l => (l.cob == null ? -1 : l.cob), true, 'Quantos dias o estoque de hoje aguenta no ritmo de venda atual, comparado ao desejado'],
      ['alvo', 'Dias desejados', l => l.alvoUsado, true, 'Para quantos dias você quer ter estoque. Altere para simular'],
      ['sug', 'Comprar', l => l.sug, true, 'Unidades a comprar para chegar aos dias desejados'],
      ['valor', 'Valor', l => l.valor, true, 'Unidades a comprar × custo unitário'],
    ];

    function comprasOrdenar(col){
      if(comprasOrd.col === col){ if(comprasOrd.dir === 1) comprasOrd.dir = -1; else comprasOrd = { col: '', dir: 1 }; }
      else comprasOrd = { col, dir: CP_COLS.find(c => c[0] === col)[3] ? -1 : 1 };   // números começam do maior
      comprasDesenhar();
    }

    // De onde vêm os números: cada fonte com a situação e o que fazer
    function comprasFontes(C){
      const kitsN = new Set(composicaoKit.map(c => c.sku_comercial)).size;
      const fullUn = C.linhas.reduce((s, l) => s + l.it.full, 0);
      const nFull = Array.isArray(estoqueFullML) ? estoqueFullML.length : 0, fonteFull = (Array.isArray(estoqueFullML) && estoqueFullML._fonte) || '';
      const semCusto = C.linhas.filter(l => l.cons > 0 && !l.custo).length;
      const comForn = C.linhas.filter(l => l.it.forn).length;
      const dias = comprasVendas.diasImportados || 0;
      const dataGalpao = estoqueGalpao.reduce((m, e) => (e.data_atualizacao && e.data_atualizacao > m ? e.data_atualizacao : m), '');
      const nContas = typeof contasML !== 'undefined' ? contasML.length : 0;
      return [
        ...(nContas > 1
          ? contasML.map(ct => { const n = (comprasVendas.diasConta || {})[ct.id] || 0; return { nome: 'Vendas de ' + (ct.apelido || 'conta ' + ct.id), st: n >= 100 ? 'ok' : n > 0 ? 'parcial' : 'falta', txt: n >= 100 ? n + ' de 120 dias importados' : n > 0 ? n + ' de 120 dias importados. A média fica mais precisa quando o histórico terminar de carregar' : 'Histórico ainda não importado: os produtos desta conta aparecem sem venda. A importação roda sozinha, um pouco a cada 15 minutos' }; })
          : [{ nome: 'Vendas do Mercado Livre', st: dias >= 100 ? 'ok' : 'parcial', txt: dias + ' de 120 dias importados' + (dias >= 100 ? '' : '. A média fica mais precisa quando o histórico terminar de carregar') },
             { nome: 'Contas do Mercado Livre', st: 'parcial', txt: 'Só uma conta conectada. Produtos vendidos em outra conta ficam com venda zero aqui' }]),
        { nome: 'Estoque do galpão', st: estoqueGalpao.length ? 'ok' : 'falta', txt: estoqueGalpao.length ? estoqueGalpao.length + ' produtos' + (dataGalpao ? ', atualizado em ' + ptDate(dataGalpao) : '') : 'Não importado: a conta considera galpão zerado', acao: "nav('estoque')", botao: 'Importar' },
        { nome: 'Estoque no Full', st: comprasFullInfo && comprasFullInfo.erro ? 'falta' : fullUn > 0 ? 'ok' : 'falta', sempre: true,
          txt: comprasFullInfo && comprasFullInfo.erro ? 'Não consegui buscar no Mercado Livre: ' + comprasFullInfo.erro
            : fullUn <= 0 ? 'Zerado: a conta considera que não há nada no Full'
            : fonteFull === 'xls' ? cpInt(fullUn) + ' unidades em ' + nFull + ' anúncios, vindas de planilha importada. Clique para trocar pela busca automática'
            : cpInt(fullUn) + ' unidades, buscadas no Mercado Livre' + (estoqueFullML._syncAt ? ' às ' + new Date(estoqueFullML._syncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '') + (comprasFullInfo && comprasFullInfo.contas ? ' (' + comprasFullInfo.contas.map(x => (x.apelido || x.conta) + ' ' + cpInt(x.unidades)).join(' + ') + ' antes de abrir os kits)' : '') + '. Não inclui envio criado que a transportadora ainda não coletou',
          acao: 'comprasBuscarFull(this)', botao: 'Buscar agora no Mercado Livre' },
        { nome: 'Kits', st: kitsN ? 'ok' : 'falta', txt: kitsN ? kitsN + ' kits: a venda do kit desconta cada componente' : 'Nenhum kit cadastrado: cada kit aparece como um produto à parte e os componentes ficam com venda de menos', acao: "nav('skus');setSkuTab('composicoes')", botao: 'Cadastrar kits' },
        { nome: 'Custos', st: semCusto ? 'parcial' : 'ok', txt: semCusto ? semCusto + ' produtos com venda e sem custo: o valor da compra deles fica zerado' : 'Todos os produtos com venda têm custo', acao: semCusto ? "nav('skus');skuFiltrarCusto('sem')" : '', botao: 'Preencher' },
        { nome: 'Fornecedores', st: comForn ? 'ok' : 'falta', txt: comForn ? comForn + ' produtos com fornecedor (o da última compra)' : 'Nenhum produto tem fornecedor: importe o Relatório de Compras da UpSeller para trazer o fornecedor da última compra', acao: 'comprasImportarPO()', botao: 'Importar relatório de compras', sempre: true },
        { nome: 'Compras a caminho', st: 'ok', txt: cpInt(C.linhas.reduce((s, l) => s + l.it.transito, 0)) + ' unidades compradas e ainda não recebidas ' + (typeof ocTemDados === 'function' && ocTemDados() ? '(ordens de compra do Olist menos o que já foi conferido aqui)' : '(vem da Lista de Estoque da UpSeller, coluna Em Trânsito)'), acao: "nav('ordens-compra')", botao: 'Ver ordens', sempre: true },
      ];
    }

    function comprasDesenhar(){
      const el = document.getElementById('view-compras');
      if(!el || !el.classList.contains('active')) return;
      const C = comprasCalcular(), g = C.giro, f = comprasFiltro;
      const fornecedores = [...new Set(C.linhas.map(l => l.it.forn).filter(Boolean))].sort();
      const familias = [...new Set(C.linhas.map(l => cpFamilia(l.it.sku)).filter(Boolean))].sort();
      const cont = s => C.linhas.filter(l => l.sit === s).length;
      const lista = C.linhas.filter(l => {
        if(f.sit === 'comprar' && !(l.sug > 0)) return false;
        if(f.sit !== 'comprar' && f.sit !== 'todos' && l.sit !== f.sit) return false;
        if(f.forn && l.it.forn !== f.forn) return false;
        if(f.fam && cpFamilia(l.it.sku) !== f.fam) return false;
        if(f.extra === 'semcusto' && l.custo) return false;
        if(f.extra === 'ruptura' && !l.zeros) return false;
        if(f.extra === 'sim' && !(comprasSim[l.k] > 0)) return false;
        if(f.busca && !(cpNorm(l.it.sku).includes(cpNorm(f.busca)) || cpNorm(l.it.nome).includes(cpNorm(f.busca)))) return false;
        return true;
      });
      if(comprasOrd.col){
        const fn = CP_COLS.find(c => c[0] === comprasOrd.col)[2];
        lista.sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * comprasOrd.dir; });
      }
      const totalLista = lista.reduce((s,l) => s + l.valor, 0), unLista = lista.reduce((s,l) => s + l.sug, 0);
      const selo = s => `<span class="cp-sit cp-${cpNorm(s).replace(/\s/g,'')}">${s}</span>`;
      const d1 = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits:1, maximumFractionDigits:1 });

      const fontes = comprasFontes(C), pend = fontes.filter(x => x.st !== 'ok').length;
      if(comprasFontesAbertas === null) comprasFontesAbertas = fontes.some(x => x.st === 'falta');
      const stTxt = { ok: 'Em dia', parcial: 'Atenção', falta: 'Faltando' };

      // barra "dura quantos dias": verde quando cobre o desejado, vermelha quando acaba antes da compra chegar
      const barra = l => {
        if(l.cob == null) return '<span class="text-muted">sem venda</span>';
        const pct = Math.max(3, Math.min(100, Math.round(l.cob / (l.alvo || 1) * 100)));
        const cor = l.cob < l.prazo + 7 ? 'r' : l.cob < l.alvo ? 'a' : l.cob > l.alvo * 2 ? 'x' : 'v';
        return `<div class="cp-cob"><div class="cp-cob-n"><b>${cpInt(l.cob)}</b> de ${cpInt(l.alvo)} dias</div><div class="cp-cob-t"><span class="cp-cob-${cor}" style="width:${pct}%;"></span></div></div>`;
      };
      const tend = l => l.tend == null || Math.abs(l.tend) < 0.1 ? '' : `<span class="cp-tend ${l.tend > 0 ? 'up' : 'dn'}" title="Últimos 30 dias contra os 30 anteriores">${l.tend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(l.tend * 100))}%</span>`;
      const seta = c => comprasOrd.col === c ? (comprasOrd.dir === 1 ? ' ▲' : ' ▼') : '';

      el.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Sugestão de compras</div>
            <div class="pg-sub">Quanto comprar de cada produto para ter estoque pelos dias que você deseja, com a venda real do Mercado Livre${typeof contasML !== 'undefined' && contasML.length > 1 ? ' (todas as contas somadas, porque o estoque é um só)' : ''}.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;align-items:center;">
            <button class="btn-out btn-sm" onclick="comprasAtualizar(this)">Atualizar vendas</button>
            <button class="btn-out btn-sm" onclick="comprasParametros()">Regras de compra</button>
            <button class="btn btn-sm" onclick="comprasExportar()">Exportar planilha</button>
          </div>
        </div>
        ${comprasVendas.erro ? `<div class="alert alert-danger">${cpEsc(comprasVendas.erro)}</div>` : ''}

        <div class="card cp-fontes">
          <div class="cp-fontes-cab" onclick="comprasFontesAbertas=!comprasFontesAbertas;comprasDesenhar();">
            <div><b>De onde vêm os números</b> <span class="text-muted">${pend ? '· ' + pend + (pend === 1 ? ' ponto pede atenção' : ' pontos pedem atenção') : '· tudo em dia'}</span></div>
            <div class="cp-fontes-pills">${fontes.map(x => `<span class="cp-pill cp-pill-${x.st}" title="${cpEsc(x.txt)}">${x.nome}</span>`).join('')}<span class="cp-fontes-seta">${comprasFontesAbertas ? '▲' : '▼'}</span></div>
          </div>
          ${comprasFontesAbertas ? `<div class="cp-fontes-lista">${fontes.map(x => `<div class="cp-fonte">
              <span class="cp-pill cp-pill-${x.st}">${stTxt[x.st]}</span>
              <div class="cp-fonte-t"><b>${x.nome}</b><span>${cpEsc(x.txt)}</span></div>
              ${x.acao && (x.st !== 'ok' || x.sempre) ? `<button class="btn-out btn-sm" onclick="event.stopPropagation();${x.acao}">${x.botao}</button>` : ''}
            </div>`).join('')}</div>` : ''}
        </div>

        <div class="kpi-grid">
          <div class="kpi k-venda"><div class="kpi-label">Compra sugerida</div><div class="kpi-value">${fmt(g.sugerido)}</div><div class="kpi-sub"><span><b>${C.linhas.filter(l => l.sug > 0).length}</b> produtos</span><span style="color:var(--danger)"><b style="color:inherit">${g.urgentes}</b> urgentes</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Estoque a custo</div><div class="kpi-value">${fmt(g.estoqueValor)}</div><div class="kpi-sub"><span>${g.dias != null ? `<b>${cpInt(g.dias)}</b> dias de venda` : 'sem venda para medir'}</span></div></div>
          <div class="kpi k-custo"><div class="kpi-label" title="Estoque a custo × juros ao mês das regras">Custo de carregar o estoque</div><div class="kpi-value">${fmt(g.jurosMes)}</div><div class="kpi-sub"><span>por mês, a <b>${(C.taxa * 100).toLocaleString('pt-BR')}%</b> a.m.</span></div></div>
          <div class="kpi k-tarifa"><div class="kpi-label">Custo das vendas</div><div class="kpi-value">${fmt(g.custoDia * 30)}</div><div class="kpi-sub"><span>por mês (<b>${fmt(g.custoDia)}</b> por dia)</span></div></div>
        </div>

        <div class="card"><div class="card-body cp-filtros">
          <div class="chips">
            ${[['comprar','A comprar',C.linhas.filter(l => l.sug > 0).length],['URGENTE','Urgente',cont('URGENTE')],['Comprar','Comprar',cont('Comprar')],['OK','OK',cont('OK')],['Excesso','Excesso',cont('Excesso')],['Sem venda','Sem venda',cont('Sem venda')],['todos','Todos',C.linhas.length]]
              .map(([k,l,n]) => `<button class="chip ${f.sit === k ? 'active' : ''}" onclick="comprasFiltro.sit='${k}';comprasDesenhar();">${l}<span class="n">${n}</span></button>`).join('')}
          </div>
          <div class="cp-filtros-l2">
            <input type="text" id="cp-busca" placeholder="Buscar por SKU ou nome" value="${cpEsc(f.busca)}" oninput="comprasBuscar(this.value)">
            <select onchange="comprasFiltro.fam=this.value;comprasDesenhar();"><option value="">Todas as famílias</option>${familias.map(x => `<option ${f.fam === x ? 'selected' : ''}>${cpEsc(x)}</option>`).join('')}</select>
            <select onchange="comprasFiltro.forn=this.value;comprasDesenhar();"><option value="">Todos os fornecedores</option>${fornecedores.map(x => `<option ${f.forn === x ? 'selected' : ''}>${cpEsc(x)}</option>`).join('')}</select>
            <select onchange="comprasFiltro.extra=this.value;comprasDesenhar();">
              ${[['','Mostrar tudo'],['semcusto','Só sem custo'],['ruptura','Só com dias de ruptura ignorados'],['sim','Só os que eu simulei']].map(([v,t]) => `<option value="${v}" ${(f.extra || '') === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            ${f.busca || f.fam || f.forn || f.extra || comprasOrd.col || Object.keys(comprasSim).length ? `<button class="btn-out btn-sm" onclick="comprasLimpar()">Limpar</button>` : ''}
          </div>
        </div></div>

        <div class="card">
          <div class="card-header"><div class="card-title">${lista.length} produto${lista.length === 1 ? '' : 's'} · ${cpInt(unLista)} unidades · ${fmt(totalLista)}</div>
            <span class="text-muted" style="font-size:12px;">Clique no título de uma coluna para ordenar e arraste a borda para mudar a largura. Altere os <b>dias desejados</b> para simular.</span></div>
          <div style="overflow-x:auto;">
            <table class="cp-tab">
              <thead><tr>${CP_COLS.map(c => `<th class="${c[3] ? 'num' : ''} ${comprasOrd.col === c[0] ? 'ord' : ''}" title="${cpEsc(c[4])}" onclick="comprasOrdenar('${c[0]}')">${c[1]}${seta(c[0])}</th>`).join('')}<th></th></tr></thead>
              <tbody id="tbody-compras">
                ${lista.length ? lista.map(l => `<tr class="cp-l-${cpNorm(l.sit).replace(/\s/g,'')}">
                  <td>${selo(l.sit)}</td>
                  <td class="cp-prod"><b>${cpEsc(l.it.sku)}</b><span title="${cpEsc(l.it.nome)}">${cpEsc(l.it.nome || '—')}</span>${l.vende ? `<i>${cpEsc(l.vende)}</i>` : ''}</td>
                  <td class="cp-forn">${cpEsc(l.it.forn || '—')}</td>
                  <td class="num" title="${cpEsc(l.criterio)}"><b>${d1(l.cons)}</b>${l.zeros ? ` <span class="sem-custo" title="${l.zeros} dias de ruptura ou parada ficaram fora da média">●</span>` : ''}<div class="cp-sub">${tend(l) || '&nbsp;'}</div></td>
                  <td class="num"><b>${cpInt(cpEstoque(l))}</b><div class="cp-sub">galpão ${cpInt(l.it.galpao)} · Full ${cpInt(l.it.full)}${l.it.transito ? ' · a caminho ' + cpInt(l.it.transito) : ''}</div></td>
                  <td>${barra(l)}</td>
                  <td class="num"><input type="number" min="0" step="5" class="cp-dias ${comprasSim[l.k] > 0 ? 'sim' : ''}" value="${l.alvoUsado}" onchange="comprasSimular('${cpEsc(l.k)}', this.value)"></td>
                  <td class="num cp-comprar">${l.sug > 0 ? `<b>${cpInt(l.sug)}</b>` : '<span class="text-muted">—</span>'}${l.mult > 1 ? `<div class="cp-sub">caixa de ${l.mult}</div>` : ''}</td>
                  <td class="num">${l.sug > 0 ? (l.custo ? `<b>${fmt(l.valor)}</b><div class="cp-sub">${fmt(l.custo)} cada</div>` : '<span class="badge badge-warning">sem custo</span>') : '<span class="text-muted">—</span>'}</td>
                  <td><button class="btn-out btn-sm" title="Ver como este número foi calculado" onclick="comprasDetalhe('${cpEsc(l.k)}')">Ver conta</button></td>
                </tr>`).join('') : `<tr><td colspan="10"><div class="vazio"><b>Nada nesta lista</b>Troque os filtros acima.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        ${C.fora.size ? `<div class="alert alert-warning">Vendas sem SKU no anúncio ficaram fora do cálculo (${[...C.fora.values()].reduce((s,v) => s + v, 0)} unidades em 120 dias). Use "Nivelar SKU" no Resumo Financeiro para corrigir.</div>` : ''}`;
      if(typeof initResizableCols === 'function') initResizableCols('tbody-compras');
    }

    let cpBuscaT = null;
    function comprasBuscar(v){
      comprasFiltro.busca = v;
      clearTimeout(cpBuscaT);
      cpBuscaT = setTimeout(() => { comprasDesenhar(); const i = document.getElementById('cp-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    }
    function comprasLimpar(){ comprasFiltro = { sit: comprasFiltro.sit, busca:'', forn:'', fam:'', extra:'' }; comprasOrd = { col:'', dir:1 }; comprasSim = {}; comprasDesenhar(); }
    function comprasSimular(k, v){ const n = Number(v); if(n > 0) comprasSim[k] = n; else delete comprasSim[k]; comprasDesenhar(); }
    async function comprasAtualizar(btn){ if(btn){ btn.disabled = true; btn.textContent = 'Atualizando…'; } await comprasCarregarVendas(true); comprasDesenhar(); }
    // Estoque do Full pela API do Mercado Livre, de todas as contas (Edge Function ml-inventory)
    let comprasFullInfo = null, comprasFullBuscando = false;
    async function comprasFullAPI(){
      if(comprasFullBuscando) return false;
      comprasFullBuscando = true;
      try {
        const sd = await supa.auth.getSession(), sess = sd && sd.data && sd.data.session;
        if(!sess) return false;
        const r = await fetch(SUPA_URL + '/functions/v1/ml-inventory', { method: 'POST', headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        if(!r.ok || j.error || !Array.isArray(j.itens)){ comprasFullInfo = { erro: j.error || ('http ' + r.status) }; return false; }
        estoqueFullML = j.itens;
        estoqueFullML._syncAt = new Date().toISOString();
        estoqueFullML._fonte = 'api';
        try { localStorage.setItem('mk_estoque_full_ml', JSON.stringify({ itens: j.itens, syncAt: estoqueFullML._syncAt, fonte: 'api' })); } catch(e){}
        comprasFullInfo = { contas: j.contas || [] };
        return true;
      } catch(e){ comprasFullInfo = { erro: e.message }; return false; }
      finally { comprasFullBuscando = false; }
    }
    async function comprasBuscarFull(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      await comprasFullAPI();
      comprasDesenhar();
    }

    // A conta de um produto, passo a passo
    function comprasDetalhe(k){
      const l = (comprasCalc?.linhas || []).find(x => x.k === k); if(!l) return;
      const d1 = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits:1, maximumFractionDigits:1 });
      const r = (a,b) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--border);"><span class="text-muted">${a}</span><b style="text-align:right;">${b}</b></div>`;
      const dias = l.alvoUsado + l.prazo, precisa = l.cons * dias * l.fator, tem = cpEstoque(l);
      vmlModal(`${cpEsc(l.it.sku)} — como a sugestão foi calculada`, `
        <div class="v-tit" style="margin-bottom:12px;">${cpEsc(l.it.nome || l.it.sku)}</div>
        <div class="cp-conta">
          <div><span>Venda por dia</span><b>${d1(l.cons)}</b></div><i>×</i>
          <div><span>Dias desejados${l.prazo ? ' + prazo' : ''}</span><b>${cpInt(dias)}</b></div>
          ${Math.abs(l.fator - 1) > 0.005 ? `<i>×</i><div><span>Sazonalidade</span><b>${l.fator.toLocaleString('pt-BR', { maximumFractionDigits:2 })}</b></div>` : ''}
          <i>−</i><div><span>Estoque que já tem</span><b>${cpInt(tem)}</b></div>
          <i>=</i><div class="res"><span>Comprar${l.mult > 1 ? ' (caixa de ' + l.mult + ')' : ''}</span><b>${cpInt(l.sug)}</b></div>
        </div>
        <div class="text-muted" style="font-size:12px;margin:8px 0 16px;">Precisa de ${cpInt(precisa)} unidades para o período e tem ${cpInt(tem)}.${l.mult > 1 ? ' O resultado é arredondado para cima em caixas de ' + l.mult + '.' : ''}</div>
        <div class="responsive-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px;">
          <div>
            ${r('Venda por dia nos últimos 14 dias', d1(l.d14))}${r('Venda por dia nos últimos 30 dias', d1(l.d30))}${r('Venda por dia nos últimos 90 dias', d1(l.d90))}
            ${r('Tendência (30 dias contra os 30 anteriores)', l.tend == null ? '—' : (l.tend >= 0 ? '+' : '') + Math.round(l.tend * 100) + '%')}
            ${r('Dias de ruptura ou parada fora da média', l.zeros)}
          </div>
          <div>
            ${r('Galpão', cpInt(l.it.galpao))}${r('Full', cpInt(l.it.full))}${r('A caminho (compra feita)', cpInt(l.it.transito))}
            ${r('Se quisesse 60 / 90 / 120 dias', `${cpInt(l.c60)} / ${cpInt(l.c90)} / ${cpInt(l.c120)}`)}
            ${r('Custo unitário', l.custo ? fmt(l.custo) : 'não cadastrado')}
          </div>
        </div>
        <div class="alert alert-info" style="margin-top:14px;"><b>Como a venda por dia foi medida:</b>&nbsp;${cpEsc(l.criterio)}</div>`);
    }

    // ----- Regras de compra (formulário em abas; nada é salvo até clicar em Salvar) -----
    let cpEd = null, cpEdAba = 'geral';
    const CP_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    function comprasParametros(){ cpEd = JSON.parse(JSON.stringify(comprasCfg)); cpEd.padrao = cpEd.padrao || {}; cpEdAba = 'geral'; cpEdDesenhar(); }
    function cpEdIr(a){ cpEdAba = a; cpEdDesenhar(); }
    function cpEdSet(lista, i, campo, v){ if(cpEd[lista] && cpEd[lista][i]) cpEd[lista][i][campo] = v; }
    function cpEdSaz(i, m, v){ const r = cpEd.sazonalidade[i]; if(!r) return; r.f = r.f || []; r.f[m] = String(v).trim() === '' ? null : cpNum(v); }
    function cpEdAdd(lista){
      const novo = { regras: { pat:'', cob:'', prazo:'', mult:'', manual:'', base:'', obs:'' }, sazonalidade: { pat:'', f: new Array(12).fill(null), obs:'' }, equivalentes: { de:'', para:'' }, diasIgnorados: { ini:'', fim:'', motivo:'' } }[lista];
      cpEd[lista] = cpEd[lista] || []; cpEd[lista].push(novo); cpEdDesenhar();
    }
    function cpEdDel(lista, i){ cpEd[lista].splice(i, 1); cpEdDesenhar(); }

    function cpEdDesenhar(){
      const c = cpEd, p = c.padrao, v = x => cpEsc(x == null ? '' : x);
      const abas = [['geral','Regra geral'],['produto','Por produto', (c.regras || []).length],['saz','Sazonalidade', (c.sazonalidade || []).length],['equiv','Produtos que mudaram de código', (c.equivalentes || []).length],['ign','Dias ignorados', (c.diasIgnorados || []).length]];
      const inp = (lista, i, campo, val, extra) => `<input ${extra || 'type="text"'} value="${v(val)}" onchange="cpEdSet('${lista}',${i},'${campo}',this.value)">`;
      const del = (lista, i) => `<button class="ico-btn" title="Remover esta linha" onclick="cpEdDel('${lista}',${i})">✕</button>`;
      const mais = (lista, t) => `<button class="btn-out btn-sm" style="margin-top:10px;" onclick="cpEdAdd('${lista}')">+ ${t}</button>`;
      const bases = sel => [['AUTO','Automático'],['30','Últimos 30 dias'],['90','Últimos 90 dias'],['MISTA','Média de 30 e 90']].map(([k,t]) => `<option value="${k}" ${String(sel || '').toUpperCase() === k ? 'selected' : ''}>${t}</option>`).join('');
      let corpo = '';

      if(cpEdAba === 'geral') corpo = `
        <div class="cpp-ajuda"><b>A conta:</b> comprar = venda por dia × (dias de estoque desejados + prazo de entrega) − estoque que você já tem. Aqui ficam os valores que valem para todos os produtos; as exceções ficam na aba "Por produto".</div>
        <div class="cpp-campo"><label>O que conta como "estoque que você já tem"</label>
          <select onchange="cpEd.regra=this.value"><option value="TOTAL" ${cpNorm(c.regra) !== 'galpao' ? 'selected' : ''}>Tudo: galpão + Full + o que está a caminho (recomendado)</option><option value="GALPAO" ${cpNorm(c.regra) === 'galpao' ? 'selected' : ''}>Só o galpão (ignora o que está no Full)</option></select>
          <small>Com "Tudo", os dias desejados valem para o estoque inteiro. Com "Só o galpão", o Full fica de fora e a sugestão sai maior.</small></div>
        <div class="cpp-grid">
          <div class="cpp-campo"><label>Dias de estoque desejados</label><input type="number" value="${cpNum(p.cob) || 90}" onchange="cpEd.padrao.cob=this.value"><small>Para quantos dias de venda você quer ter produto depois da compra.</small></div>
          <div class="cpp-campo"><label>Prazo de entrega (dias)</label><input type="number" value="${cpNum(p.prazo)}" onchange="cpEd.padrao.prazo=this.value"><small>Dias entre fazer o pedido e a mercadoria chegar. É somado aos dias desejados.</small></div>
          <div class="cpp-campo"><label>Comprar em múltiplos de</label><input type="number" value="${cpNum(p.mult) || 1}" onchange="cpEd.padrao.mult=this.value"><small>Tamanho da caixa fechada. Com 1, compra qualquer quantidade.</small></div>
          <div class="cpp-campo"><label>Juros ao mês (%)</label><input type="number" step="0.1" value="${cpNum(c.jurosMes) || 3}" onchange="cpEd.jurosMes=this.value"><small>Usado só para mostrar quanto custa manter o estoque parado.</small></div>
        </div>
        <div class="cpp-campo"><label>Como medir a venda por dia</label>
          <select onchange="cpEd.padrao.base=this.value">${bases(p.base || 'AUTO')}</select>
          <small><b>Automático</b> usa os últimos 30 dias de venda normal. Se o produto é estável e a venda caiu um pouco, faz a média com os 90 dias, para não comprar de menos por causa de uma queda passageira ("sobe rápido, desce devagar"). Em qualquer opção, dias seguidos sem venda por falta de estoque ficam fora da média.</small></div>`;

      if(cpEdAba === 'produto') corpo = `
        <div class="cpp-ajuda">Exceções à regra geral. Preencha só o que for diferente; o que ficar em branco segue a regra geral. Para valer para uma família inteira, termine com <b>*</b>: <b>J-2010*</b> vale para todo produto que começa com J-2010. Se duas linhas servem para o mesmo produto, vale a mais específica.</div>
        <div style="overflow-x:auto;"><table class="cpp-tab"><thead><tr><th>Produto ou família</th><th title="Dias de estoque desejados">Dias desejados</th><th title="Prazo de entrega em dias">Prazo</th><th title="Tamanho da caixa">Múltiplo</th><th title="Preencha para ignorar o histórico e usar este número de vendas por dia">Venda por dia fixa</th><th>Como medir a venda</th><th>Observação</th><th></th></tr></thead><tbody>
          ${(c.regras || []).map((r, i) => `<tr><td>${inp('regras', i, 'pat', r.pat, 'type="text" placeholder="J-2010*" style="min-width:130px;"')}</td><td>${inp('regras', i, 'cob', r.cob, 'type="number" placeholder="geral"')}</td><td>${inp('regras', i, 'prazo', r.prazo, 'type="number" placeholder="geral"')}</td><td>${inp('regras', i, 'mult', r.mult, 'type="number" placeholder="geral"')}</td><td>${inp('regras', i, 'manual', r.manual, 'type="text" placeholder="—"')}</td>
            <td><select onchange="cpEdSet('regras',${i},'base',this.value)"><option value="">Regra geral</option>${bases(r.base)}</select></td><td>${inp('regras', i, 'obs', r.obs, 'type="text" style="min-width:220px;"')}</td><td>${del('regras', i)}</td></tr>`).join('') || '<tr><td colspan="8" class="text-muted" style="padding:16px;text-align:center;">Nenhuma exceção: todos os produtos seguem a regra geral.</td></tr>'}
        </tbody></table></div>${mais('regras', 'Adicionar produto ou família')}`;

      if(cpEdAba === 'saz') corpo = `
        <div class="cpp-ajuda">Ajusta a venda prevista de cada mês. <b>1</b> é um mês normal, <b>1,25</b> vende 25% a mais, <b>0,7</b> vende 30% a menos. A linha <b>PADRAO</b> vale para todos os produtos. As outras linhas valem para um produto ou família (use * no fim, ou no começo: <b>*-Rosa</b>); o mês que ficar em branco segue o PADRAO.</div>
        <div style="overflow-x:auto;"><table class="cpp-tab cpp-saz"><thead><tr><th>Produto ou família</th>${CP_MESES.map(m => `<th>${m}</th>`).join('')}<th>Observação</th><th></th></tr></thead><tbody>
          ${(c.sazonalidade || []).map((r, i) => `<tr><td>${inp('sazonalidade', i, 'pat', r.pat, 'type="text" placeholder="PADRAO" style="min-width:110px;"')}</td>
            ${CP_MESES.map((m, j) => `<td><input type="text" class="cpp-mes ${r.f && r.f[j] != null && r.f[j] !== 1 ? (r.f[j] > 1 ? 'up' : 'dn') : ''}" value="${r.f && r.f[j] != null ? String(r.f[j]).replace('.', ',') : ''}" placeholder="—" onchange="cpEdSaz(${i},${j},this.value)"></td>`).join('')}
            <td>${inp('sazonalidade', i, 'obs', r.obs, 'type="text" style="min-width:220px;"')}</td><td>${del('sazonalidade', i)}</td></tr>`).join('') || '<tr><td colspan="15" class="text-muted" style="padding:16px;text-align:center;">Sem sazonalidade: todos os meses contam igual.</td></tr>'}
        </tbody></table></div>${mais('sazonalidade', 'Adicionar linha')}`;

      if(cpEdAba === 'equiv') corpo = `
        <div class="cpp-ajuda">Quando um produto mudou de código (SKU), as vendas feitas com o código antigo passam a contar para o código atual, para a média não começar do zero.</div>
        <table class="cpp-tab" style="max-width:560px;"><thead><tr><th>Código antigo</th><th>Código atual</th><th></th></tr></thead><tbody>
          ${(c.equivalentes || []).map((r, i) => `<tr><td>${inp('equivalentes', i, 'de', r.de)}</td><td>${inp('equivalentes', i, 'para', r.para)}</td><td>${del('equivalentes', i)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-muted" style="padding:16px;text-align:center;">Nenhum produto mudou de código.</td></tr>'}
        </tbody></table>${mais('equivalentes', 'Adicionar par')}`;

      if(cpEdAba === 'ign') corpo = `
        <div class="cpp-ajuda">Períodos que não devem entrar na média de vendas de nenhum produto, porque a venda foi anormal por um motivo que não vai se repetir (erro do Mercado Livre, conta suspensa, férias).</div>
        <table class="cpp-tab" style="max-width:760px;"><thead><tr><th>De</th><th>Até</th><th>Motivo</th><th></th></tr></thead><tbody>
          ${(c.diasIgnorados || []).map((r, i) => `<tr><td>${inp('diasIgnorados', i, 'ini', r.ini, 'type="date"')}</td><td>${inp('diasIgnorados', i, 'fim', r.fim, 'type="date"')}</td><td>${inp('diasIgnorados', i, 'motivo', r.motivo, 'type="text" style="min-width:300px;"')}</td><td>${del('diasIgnorados', i)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted" style="padding:16px;text-align:center;">Nenhum período ignorado.</td></tr>'}
        </tbody></table>${mais('diasIgnorados', 'Adicionar período')}`;

      vmlModal('Regras de compra', `
        <div class="chips" style="margin-bottom:16px;">${abas.map(([k, t, n]) => `<button class="chip ${cpEdAba === k ? 'active' : ''}" onclick="cpEdIr('${k}')">${t}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>
        <div class="cpp-corpo">${corpo}</div>`,
        `<button class="btn-out" style="margin-right:auto;" onclick="if(confirm('Voltar todas as regras para o padrão do sistema?')){cpEd=JSON.parse(JSON.stringify(CP_PADRAO));cpEdDesenhar();}">Restaurar padrão</button><button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="comprasSalvarParametros()">Salvar regras</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '1080px';
    }

    function comprasSalvarParametros(){
      const c = cpEd; if(!c) return;
      if(document.activeElement && document.activeElement.blur) document.activeElement.blur();   // grava o campo que ainda está em edição
      const t = x => String(x == null ? '' : x).trim();
      comprasCfg = {
        regra: cpNorm(c.regra) === 'galpao' ? 'GALPAO' : 'TOTAL', jurosMes: cpNum(c.jurosMes) || 3,
        padrao: { cob: cpNum(c.padrao.cob) || 90, prazo: cpNum(c.padrao.prazo), mult: cpNum(c.padrao.mult) || 1, base: t(c.padrao.base) || 'AUTO' },
        regras: (c.regras || []).filter(r => t(r.pat)).map(r => ({ pat: t(r.pat), cob: t(r.cob), prazo: t(r.prazo), mult: t(r.mult), manual: t(r.manual), base: t(r.base), obs: t(r.obs) })),
        sazonalidade: (c.sazonalidade || []).filter(r => t(r.pat)).map(r => ({ pat: t(r.pat), f: Array.from({ length: 12 }, (_, i) => (r.f && r.f[i] != null && r.f[i] !== '' ? cpNum(r.f[i]) : null)), obs: t(r.obs) })),
        equivalentes: (c.equivalentes || []).filter(r => t(r.de) && t(r.para)).map(r => ({ de: t(r.de), para: t(r.para), mult: Number(r.mult) > 0 ? Number(r.mult) : 1 })),
        diasIgnorados: (c.diasIgnorados || []).filter(r => t(r.ini)).map(r => ({ ini: t(r.ini), fim: t(r.fim), motivo: t(r.motivo) })),
        fornecedores: comprasCfg.fornecedores || {},
        estoque: comprasCfg.estoque || {},
        balanco: comprasCfg.balanco || {},
      };
      comprasSalvarCfg();
      fecharModal('modal-vml');
      comprasDesenhar();
    }

    // Relatório de Compras da UpSeller: fornecedor da última compra de cada SKU
    function comprasImportarPO(){
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.xlsx,.xls';
      inp.onchange = () => {
        const file = inp.files[0]; if(!file) return;
        const rd = new FileReader();
        rd.onload = e => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
            if(!rows.length || !('SKU' in rows[0]) || !('Fornecedores' in rows[0])){ alert('Este arquivo não parece ser o Relatório de Compras da UpSeller (faltam as colunas SKU e Fornecedores).'); return; }
            const dataDe = t => { const m = String(t || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : 0; };
            const ult = {};
            rows.forEach(r => { const k = cpNorm(r.SKU), f = String(r.Fornecedores || '').trim(); if(!k || !f) return; const d = dataDe(r['Data de Criação']); if(!ult[k] || d >= ult[k].d) ult[k] = { d, f }; });
            const mapa = {}; Object.keys(ult).forEach(k => { mapa[k] = ult[k].f; });
            comprasCfg.fornecedores = mapa;
            comprasSalvarCfg();
            comprasDesenhar();
            alert('Fornecedor da última compra carregado para ' + Object.keys(mapa).length + ' produtos.');
          } catch(err){ alert('Não consegui ler o arquivo: ' + err.message); }
        };
        rd.readAsArrayBuffer(file);
      };
      inp.click();
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
