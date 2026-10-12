// ===== FERRAMENTAS DE GESTÃO (abas da Análise de vendas) =====
//   lucro    Lucro real por anúncio: margem das vendas menos o gasto com publicidade, com alerta de prejuízo
//   degrau   Preço no degrau do frete: anúncios logo acima de uma faixa de preço em que baixar centavos paga menos frete
//   ruptura  Venda perdida: dias inteiros sem venda em anúncio que vende todo dia (falta de estoque ou pausa)
// Usa o estado e os auxiliares de src/analise.js (an, anN, anE, anKpi, anTabela, anVazio) e a tabela de frete de
// src/promo-frete.js (frTabela). Dados: RPCs vendas_ml_lucro_mlb, vendas_ml_degrau, vendas_ml_dias_item + função ml-ads.

    let gs = { chave: '', lucro: null, ads: null, adsErro: '', degrau: null, rupt: null, filtro: 'todos' };
    const GS_ABAS = [['lucro', 'Lucro real'], ['degrau', 'Degrau do frete'], ['ruptura', 'Venda perdida']];
    const GS_DEGRAUS = [19, 49, 79, 100, 120, 150, 200];
    function gsMin(){ const v = Number(localStorage.getItem('mk_lucro_min')); return localStorage.getItem('mk_lucro_min') !== null && v >= 0 && v < 100 ? v : 10; }
    function gsMinMudar(v){ v = Number(String(v).replace(',', '.')); if(!(v >= 0 && v < 100)) return; localStorage.setItem('mk_lucro_min', String(v)); anDesenhar(); }
    function gsFiltro(f){ gs.filtro = f; anDesenhar(); }
    const gsFoto = (l) => l.thumbnail || l.foto ? `<img src="${anE(String(l.thumbnail || l.foto).replace(/^http:/, 'https:'))}" loading="lazy" alt="">` : '';
    const gsAnuncio = (l, extra) => `<div class="an-anuncio">${gsFoto(l)}<div class="cp-prod" style="max-width:320px;"><b>${anE(l.titulo || l.item_id)}</b><span>${anE(l.sku || '')}${l.sku ? ' · ' : ''}${anE(l.item_id)}${extra || ''}</span></div></div>`;

    async function gsCarregar(chave, conta, p){
      if(gs.chave !== chave) gs = { chave, lucro: null, ads: null, adsErro: '', degrau: null, rupt: null, filtro: 'todos' };
      try {
        if(an.aba === 'lucro' && !gs.lucro){
          const sd = await supa.auth.getSession(), s = sd && sd.data && sd.data.session;
          const [l, a] = await Promise.all([
            supa.rpc('vendas_ml_lucro_mlb', { p_de: p.de, p_ate: p.ate, p_conta: conta }),
            an.ads ? Promise.resolve(an.ads) : fetch(SUPA_URL + '/functions/v1/ml-ads', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ de: p.de, ate: p.ate, conta: conta || undefined }) }).then(x => x.json()).catch(() => ({ error: 'sem conexão com o servidor' }))
          ]);
          if(gs.chave !== chave) return;
          if(l.error) throw l.error;
          gs.lucro = l.data || []; if(a.error){ gs.adsErro = a.error; gs.ads = { anuncios: [] }; } else gs.ads = a;
        }
        if(an.aba === 'degrau' && !gs.degrau){
          if(typeof frTabela === 'function') await frTabela();
          const r = await supa.rpc('vendas_ml_degrau', { p_conta: conta }); if(gs.chave !== chave) return; if(r.error) throw r.error; gs.degrau = r.data || [];
        }
        if(an.aba === 'ruptura' && !gs.rupt){
          const r = await supa.rpc('vendas_ml_dias_item', { p_dias: 90, p_conta: conta }); if(gs.chave !== chave) return; if(r.error) throw r.error; gs.rupt = r.data || [];
        }
      } catch(e){ gs.erro = (e && e.message) || String(e); }
      if(an.chave === chave) anDesenhar();
    }
    function gsCorpo(aba){ return aba === 'lucro' ? gsLucro() : aba === 'degrau' ? gsDegrau() : aba === 'ruptura' ? gsRuptura() : ''; }

    // ---------- lucro real por anúncio ----------
    function gsLucroLinhas(){
      const inv = new Map(); ((gs.ads && gs.ads.anuncios) || []).forEach(a => inv.set(a.item_id, { v: (inv.get(a.item_id) || { v: 0 }).v + (Number(a.investimento) || 0), foto: a.foto, titulo: a.titulo }));
      const L = (gs.lucro || []).map(r => { const a = inv.get(r.item_id) || { v: 0 }; inv.delete(r.item_id); return { ...r, bruto: Number(r.bruto), mc: Number(r.mc), ads: a.v, foto: a.foto, lucro: Number(r.mc) - a.v }; });
      // anúncio com gasto de publicidade e nenhuma venda no período
      inv.forEach((a, id) => { if(a.v > 0) L.push({ item_id: id, titulo: a.titulo, foto: a.foto, un: 0, vendas: 0, bruto: 0, mc: 0, sem_custo: 0, canceladas: 0, canc_bruto: 0, ads: a.v, lucro: -a.v }); });
      L.forEach(l => { l.pct = l.bruto > 0 ? l.lucro / l.bruto * 100 : (l.lucro < 0 ? -999 : 0); l.mcPct = l.bruto > 0 ? l.mc / l.bruto * 100 : 0; l.cancPct = (Number(l.vendas) + Number(l.canceladas)) > 0 ? l.canceladas / (Number(l.vendas) + Number(l.canceladas)) * 100 : 0; });
      return L.filter(l => l.bruto > 0 || l.ads > 0);
    }
    function gsLucro(){
      if(gs.erro && !gs.lucro) return anVazio('Não consegui calcular: ' + anE(gs.erro));
      if(!gs.lucro) return anVazio('Calculando o lucro por anúncio e lendo a publicidade no Mercado Livre…');
      const min = gsMin(), L = gsLucroLinhas(), T = L.reduce((s, l) => { s.b += l.bruto; s.mc += l.mc; s.ads += l.ads; return s; }, { b: 0, mc: 0, ads: 0 });
      const prej = L.filter(l => l.lucro < 0), abaixo = L.filter(l => l.lucro >= 0 && l.pct < min);
      try { localStorage.setItem('mk_lucro_alerta', JSON.stringify({ em: Date.now(), prej: prej.length, abaixo: abaixo.length, min, perda: prej.reduce((s, l) => s - l.lucro, 0) })); } catch(e){}
      const vis = gs.filtro === 'prej' ? prej : gs.filtro === 'abaixo' ? abaixo : L;
      const cor = l => l.lucro < 0 ? 'var(--danger)' : (l.pct < min ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)');
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-venda', 'Margem das vendas', fmt(T.mc), anP(T.mc, T.b) + ' de ' + fmt(T.b) + ' vendidos')}
          ${anKpi('k-atraso', 'Publicidade', fmt(T.ads), anP(T.ads, T.b, 2) + ' do faturamento')}
          ${anKpi('k-mc', 'Lucro depois da publicidade', fmt(T.mc - T.ads), anP(T.mc - T.ads, T.b) + ' do faturamento')}
          ${anKpi('k-hoje', 'Anúncios para olhar', (prej.length + abaixo.length).toLocaleString('pt-BR'), prej.length + ' no prejuízo · ' + abaixo.length + ' abaixo de ' + anN(min, min % 1 ? 1 : 0) + '%')}
        </div>
        ${gs.adsErro ? `<div class="alert alert-warning">Não consegui ler a publicidade (${anE(gs.adsErro)}). Os números abaixo estão sem o desconto do ADS.</div>` : ''}
        <div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div class="card-title">Lucro por anúncio</div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;"><div class="chips">${[['todos', 'Todos (' + L.length + ')'], ['prej', 'No prejuízo (' + prej.length + ')'], ['abaixo', 'Abaixo do mínimo (' + abaixo.length + ')']].map(([k, t]) => `<button class="chip ${gs.filtro === k ? 'active' : ''}" onclick="gsFiltro('${k}')">${t}</button>`).join('')}</div>
          <label class="text-muted" style="display:flex;align-items:center;gap:6px;margin:0;">Mínimo aceitável <input type="number" min="0" max="99" step="1" value="${min}" onchange="gsMinMudar(this.value)" style="width:68px;" aria-label="Lucro mínimo aceitável em %"> %</label></div></div>
        ${anTabela(vis, [
          { k: 'titulo', t: 'Anúncio', fmt: l => gsAnuncio(l, Number(l.sem_custo) > 0 ? ' · <span class="text-danger" title="Há vendas deste anúncio sem custo cadastrado: a margem está maior do que a real">sem custo em ' + l.sem_custo + ' vendas</span>' : '') },
          { k: 'un', t: 'Un.', num: 1, fmt: l => anN(l.un) }, { k: 'bruto', t: 'Vendido', num: 1, fmt: l => fmt(l.bruto) },
          { k: 'mc', t: 'Margem', num: 1, fmt: l => fmt(l.mc) + ' <small class="text-muted">' + anN(l.mcPct, 1) + '%</small>' },
          { k: 'ads', t: 'Publicidade', num: 1, fmt: l => l.ads ? fmt(l.ads) : '<span class="text-muted">—</span>' },
          { k: 'lucro', t: 'Lucro', num: 1, fmt: l => `<b style="color:${cor(l)}">${fmt(l.lucro)}</b>` },
          { k: 'pct', t: '% do vendido', num: 1, fmt: l => `<b style="color:${cor(l)}">${l.pct <= -999 ? 'sem venda' : anN(l.pct, 1) + '%'}</b>` },
          { k: 'cancPct', t: 'Canceladas', num: 1, fmt: l => Number(l.canceladas) ? anN(l.canceladas) + ' <small class="text-muted">' + anN(l.cancPct, 1) + '%</small>' : '<span class="text-muted">—</span>' }
        ], 'lucro')}
        <div class="text-muted" style="font-size:12px;padding:12px 18px;">Margem = venda menos tarifa, frete, imposto e custo do produto. Lucro = margem menos o que o anúncio gastou em publicidade no período. Armazenagem do Full e devoluções não estão aqui: aparecem na Conciliação.</div></div>`;
    }

    // ---------- degrau do frete ----------
    function gsDegrauLinhas(){
      const t = typeof fr !== 'undefined' && fr.tab ? fr.tab[frVersaoHoje()] : null; if(!t) return null;
      const out = [];
      (gs.degrau || []).forEach(r => {
        const preco = Number(r.preco), frete = Number(r.frete), faixa = GS_DEGRAUS.filter(x => preco >= x).length; if(!faixa) return;
        const linha = t.v.findIndex(v => v && Math.abs((v[faixa] || 0) - frete) < 0.02); if(linha < 0) return;
        const novoFrete = t.v[linha][faixa - 1], novoPreco = GS_DEGRAUS[faixa - 1] - 0.01, baixa = preco - novoPreco;
        if(novoFrete == null || !(novoFrete < frete)) return;
        const fica = 1 - (Number(r.tarifa_pct) || 0) / 100 - (Number(r.imposto_pct) || 0) / 100, ganho = (frete - novoFrete) - baixa * fica;
        out.push({ ...r, preco, frete, novoPreco, novoFrete, baixa, ganho, mes: ganho * Number(r.un30 || 0), un30: Number(r.un30 || 0) });
      });
      return out;
    }
    function gsDegrau(){
      if(gs.erro && !gs.degrau) return anVazio('Não consegui calcular: ' + anE(gs.erro));
      if(!gs.degrau) return anVazio('Lendo os preços e fretes das últimas vendas…');
      const L = gsDegrauLinhas(); if(!L) return anVazio('A tabela de frete não está disponível agora. Abra a Conferência de frete uma vez e volte aqui.');
      const vale = L.filter(l => l.ganho > 0.05), perto = L.filter(l => l.ganho <= 0.05 && l.baixa <= 5);
      const vis = gs.filtro === 'perto' ? perto : vale, tot = vale.reduce((s, l) => s + l.mes, 0);
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-mc', 'Ganho possível por mês', fmt(tot), 'somando os anúncios em que vale baixar')}
          ${anKpi('k-venda', 'Vale baixar o preço', String(vale.length), 'o frete cai mais do que o preço')}
          ${anKpi('k-hoje', 'Perto do degrau, não compensa', String(perto.length), 'a até R$ 5 da faixa de baixo')}
          ${anKpi('k-atraso', 'Anúncios analisados', String((gs.degrau || []).length), 'com venda de 1 unidade nos últimos 14 dias')}
        </div>
        <div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div class="card-title">Preço logo acima de um degrau do frete</div>
          <div class="chips">${[['todos', 'Vale baixar (' + vale.length + ')'], ['perto', 'Perto, mas não compensa (' + perto.length + ')']].map(([k, t]) => `<button class="chip ${(gs.filtro === 'perto' ? 'perto' : 'todos') === k ? 'active' : ''}" onclick="gsFiltro('${k}')">${t}</button>`).join('')}</div></div>
        ${anTabela(vis, [
          { k: 'titulo', t: 'Anúncio', fmt: l => gsAnuncio(l) },
          { k: 'preco', t: 'Preço de venda', num: 1, fmt: l => fmt(l.preco) }, { k: 'frete', t: 'Frete hoje', num: 1, fmt: l => fmt(l.frete) },
          { k: 'novoPreco', t: 'Baixando para', num: 1, fmt: l => '<b>' + fmt(l.novoPreco) + '</b> <small class="text-muted">-' + fmt(l.baixa) + '</small>' },
          { k: 'novoFrete', t: 'Frete passa a', num: 1, fmt: l => fmt(l.novoFrete) + ' <small class="text-muted">-' + fmt(l.frete - l.novoFrete) + '</small>' },
          { k: 'ganho', t: 'Sobra por venda', num: 1, fmt: l => `<b style="color:${l.ganho > 0 ? 'var(--success,#16a34a)' : 'var(--danger)'}">${fmt(l.ganho)}</b>` },
          { k: 'un30', t: 'Un. em 30 dias', num: 1, fmt: l => anN(l.un30) },
          { k: 'mes', t: 'Por mês', num: 1, fmt: l => `<b style="color:${l.mes > 0 ? 'var(--success,#16a34a)' : 'var(--danger)'}">${fmt(l.mes)}</b>` }
        ], 'mes')}
        <div class="text-muted" style="font-size:12px;padding:12px 18px;">O frete é definido pela faixa do preço de venda (R$ 19, 49, 79, 100, 120, 150 e 200). "Preço de venda" e "Frete hoje" são os que mais se repetiram nas vendas de 1 unidade dos últimos 14 dias. "Sobra por venda" = o que o frete cai menos o que você deixa de receber ao baixar o preço, já descontando tarifa e imposto. O preço de venda é o que o comprador paga: se o anúncio está em promoção, o ajuste é no preço da promoção.</div></div>`;
    }

    // ---------- venda perdida ----------
    function gsRupturaLinhas(){
      const hoje = getToday(), out = [];
      // junta os anúncios do mesmo produto: venda que só mudou de um anúncio para outro não é venda perdida
      const porSku = new Map();
      (gs.rupt || []).forEach(it => {
        const k = (it.conta || '') + '|' + String(it.sku || it.item_id).trim().toLowerCase(), o = porSku.get(k);
        if(!o){ porSku.set(k, { ...it, dias: { ...(it.dias || {}) }, anuncios: 1, un: Number(it.un) || 0 }); return; }
        o.anuncios++; if((Number(it.un) || 0) > o.un){ o.un = Number(it.un); o.titulo = it.titulo; o.thumbnail = it.thumbnail; o.item_id = it.item_id; o.logistica = it.logistica; }
        Object.keys(it.dias || {}).forEach(d => { const a = o.dias[d], b = it.dias[d]; o.dias[d] = a ? [Number(a[0]) + Number(b[0]), Number(a[1]) + Number(b[1]), Number(a[2]) + Number(b[2]), a[3] == null ? b[3] : (b[3] == null ? a[3] : Math.min(Number(a[3]), Number(b[3])))] : b; });
      });
      [...porSku.values()].forEach(it => {
        const dias = it.dias || {}, ks = Object.keys(dias).sort(); if(ks.length < 10) return;
        const un = ks.reduce((s, k) => s + Number(dias[k][0]), 0), bruto = ks.reduce((s, k) => s + Number(dias[k][1]), 0), mc = ks.reduce((s, k) => s + Number(dias[k][2]), 0);
        // dia parado = vendeu menos de um quarto do ritmo (mediana dos 14 dias normais anteriores); o que faltou é a perda
        let d = ks[0], recentes = [], buracos = [], atual = null;
        while(d < hoje){
          const x = dias[d], unDia = x ? Number(x[0]) : 0;
          const ord = recentes.slice().sort((a, b) => a - b), ritmo = ord.length >= 7 ? ord[Math.floor(ord.length / 2)] : 0;
          if(ritmo >= 3 && unDia < ritmo * 0.25){
            if(!atual){ const ant = dias[addDias(d, -1)]; atual = { de: d, n: 0, ritmo, falta: 0, zerou: !!(ant && ant[3] != null && Number(ant[3]) <= ritmo) }; }
            if(atual.n < 14){ atual.n++; atual.ate = d; atual.falta += ritmo - unDia; } else { atual.longa = true; }
          } else {
            if(atual){ buracos.push(atual); atual = null; if(buracos[buracos.length - 1].longa) recentes = []; }
            if(x){ recentes.push(unDia); if(recentes.length > 14) recentes.shift(); }
          }
          d = addDias(d, 1);
        }
        if(atual){ atual.aberto = !atual.longa; buracos.push(atual); }
        if(!buracos.length) return;
        const diasSem = buracos.reduce((s, b) => s + b.n, 0), unPerd = buracos.reduce((s, b) => s + b.falta, 0), ult = buracos[buracos.length - 1];
        out.push({ ...it, diasSem, unPerd, vPerd: un ? unPerd * bruto / un : 0, mcPerd: un ? unPerd * mc / un : 0, vezes: buracos.length, ult, aberto: !!ult.aberto, confirmado: buracos.some(b => b.zerou) });
      });
      return out;
    }
    function gsRuptura(){
      if(gs.erro && !gs.rupt) return anVazio('Não consegui calcular: ' + anE(gs.erro));
      if(!gs.rupt) return anVazio('Lendo as vendas dia a dia dos últimos 90 dias…');
      const L = gsRupturaLinhas(), T = L.reduce((s, l) => { s.v += l.vPerd; s.mc += l.mcPerd; s.d += l.diasSem; return s; }, { v: 0, mc: 0, d: 0 }), abertos = L.filter(l => l.aberto);
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-atraso', 'Venda perdida em 90 dias', fmt(T.v), 'estimativa pelos dias quase sem venda')}
          ${anKpi('k-mc', 'Margem que deixou de entrar', fmt(T.mc), 'pela margem média de cada anúncio')}
          ${anKpi('k-venda', 'Dias parados', anN(T.d), 'somando ' + L.length + ' produto' + (L.length === 1 ? '' : 's'))}
          ${anKpi('k-hoje', 'Parados agora', String(abertos.length), abertos.length ? 'quase sem venda até ontem' : 'nenhum produto forte parado')}
        </div>
        <div class="card"><div class="card-header"><div class="card-title">Produtos que vendem todo dia e pararam</div></div>
        ${anTabela(L, [
          { k: 'titulo', t: 'Produto', fmt: l => gsAnuncio(l, (l.anuncios > 1 ? ' e mais ' + (l.anuncios - 1) + ' anúncio' + (l.anuncios > 2 ? 's' : '') : '') + (l.logistica === 'fulfillment' ? ' · Full' : '')) },
          { k: 'diasSem', t: 'Dias parados', num: 1, fmt: l => '<b>' + l.diasSem + '</b> <small class="text-muted">em ' + l.vezes + ' vez' + (l.vezes > 1 ? 'es' : '') + '</small>' },
          { k: 'ult', t: 'Última parada', val: l => l.ult.de, fmt: l => ptDate(l.ult.de) + (l.ult.n > 1 ? ' a ' + ptDate(l.ult.ate) : '') + (l.aberto ? ' <span class="text-danger"><b>· ainda parado</b></span>' : '') + (l.ult.zerou ? '<br><small class="text-muted">estoque do anúncio estava no fim</small>' : '') },
          { k: 'ritmo', t: 'Vendia por dia', num: 1, val: l => l.ult.ritmo, fmt: l => anN(l.ult.ritmo) + ' un.' },
          { k: 'unPerd', t: 'Un. perdidas', num: 1, fmt: l => anN(l.unPerd) },
          { k: 'vPerd', t: 'Venda perdida', num: 1, fmt: l => '<b>' + fmt(l.vPerd) + '</b>' },
          { k: 'mcPerd', t: 'Margem perdida', num: 1, fmt: l => `<b style="color:var(--danger)">${fmt(l.mcPerd)}</b>` }
        ], 'mcPerd')}
        <div class="text-muted" style="font-size:12px;padding:12px 18px;">É uma estimativa. Os anúncios do mesmo SKU são somados. Dia parado é aquele em que o produto vendeu menos de um quarto do que vinha vendendo (mediana dos 14 dias normais anteriores, para produtos de pelo menos 3 unidades por dia). Uma parada conta no máximo 14 dias: depois disso o sistema entende que o produto saiu de linha. O motivo pode ser falta de estoque, anúncio pausado ou perda de posição: o sistema não diferencia. As unidades perdidas são o que faltou para chegar ao ritmo de antes em cada dia parado. A partir de agora o sistema grava o estoque do anúncio depois de cada venda; quando a parada vier logo depois de o estoque chegar ao fim, a linha avisa.</div></div>`;
    }

    // ---------- alerta no Início (lê o último cálculo de lucro guardado neste navegador) ----------
    function gsAlertaInicio(){
      try { const a = JSON.parse(localStorage.getItem('mk_lucro_alerta') || 'null'); if(!a || Date.now() - a.em > 7 * 86400000) return null;
        if(a.prej > 0) return { t: 'danger', i: '!', tx: `<b>${a.prej} anúncio${a.prej > 1 ? 's' : ''} no prejuízo</b> depois da publicidade (${fmt(a.perda)} no período analisado)${a.abaixo ? ' e ' + a.abaixo + ' abaixo de ' + a.min + '%' : ''}.`, ac: "an.aba='lucro';gs.filtro='prej';nav('analise')", la: 'Ver anúncios' };
        if(a.abaixo > 0) return { t: 'warning', i: '!', tx: `<b>${a.abaixo} anúncio${a.abaixo > 1 ? 's' : ''}</b> com lucro abaixo de ${a.min}% depois da publicidade.`, ac: "an.aba='lucro';gs.filtro='abaixo';nav('analise')", la: 'Ver anúncios' };
      } catch(e){} return null;
    }
