// ===== ANÁLISE DE VENDAS =====
// Página "analise": tudo vem das vendas importadas do Mercado Livre (nada de planilha).
//   Visão geral    faturamento dos últimos 12 meses em barras (RPC vendas_ml_por_mes, ano atual e anterior)
//   Produtos       rentabilidade por SKU com curva ABC (RPC vendas_ml_ranking)
//   Compradores    recorrência e maiores compradores (RPC vendas_ml_analise)
//   Estados        venda por UF de entrega (vendas_ml.uf, preenchido pelo ml-envios; histórico entra aos poucos)
//   Cancelamentos  taxa geral, por tipo de envio e por produto
//   ADS            anúncios pagos por anúncio, com ACOS e TACOS (Edge Function ml-ads + ranking por MLB)
// Obedece ao seletor de conta da barra lateral.

    let an = { aba: 'geral', dias: 30, chave: '', meses: null, cob: {}, dados: null, rank: null, rankMlb: null, ads: null, adsErro: '', erro: '', ord: {}, busca: '' };
    const anE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const anN = (v, d) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
    const anP = (a, b, d) => b ? anN(a / b * 100, d == null ? 1 : d) + '%' : '–';
    const AN_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const AN_UF = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };

    function anPeriodo(){ const ate = getToday(); return { de: addDias(ate, -(an.dias - 1)), ate }; }

    async function anRender(){
      const view = document.getElementById('view-analise'); if(!view) return;
      let host = document.getElementById('an-host');
      if(!host){ [...view.children].forEach(el => { el.style.display = 'none'; }); host = document.createElement('div'); host.id = 'an-host'; view.appendChild(host); }
      const conta = typeof contaParam === 'function' ? contaParam() : null;
      const chave = (conta || '') + '|' + an.dias;
      if(an.chave !== chave){ an.chave = chave; an.dados = null; an.rank = null; an.rankMlb = null; an.ads = null; an.adsErro = ''; if(an.contaMeses !== (conta || '')){ an.meses = null; an.contaMeses = conta || ''; } }
      anDesenhar();
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const p = anPeriodo(), ano = new Date().getFullYear();
      try {
        if(!an.meses){
          const [a, b, dias] = await Promise.all([
            supa.rpc('vendas_ml_por_mes', { p_ano: ano, p_conta: conta }), supa.rpc('vendas_ml_por_mes', { p_ano: ano - 1, p_conta: conta }),
            (() => { let q = supa.from('vendas_ml_dias').select('dia').eq('usuario_id', usuarioAtual.id).gte('dia', (ano - 1) + '-01-01').eq('completo', true).limit(3000); if(conta) q = q.eq('ml_user_id', conta); return q; })()
          ]);
          if(an.chave !== chave) return;
          if(a.error) throw a.error;
          const m = {};
          (b.data || []).forEach(r => { m[(ano - 1) + '-' + String(r.mes).padStart(2, '0')] = r; });
          (a.data || []).forEach(r => { m[ano + '-' + String(r.mes).padStart(2, '0')] = r; });
          an.meses = m;
          const cob = {}, vistos = new Set();
          (dias.data || []).forEach(d => { const k = String(d.dia).slice(0, 10); if(vistos.has(k)) return; vistos.add(k); cob[k.slice(0, 7)] = (cob[k.slice(0, 7)] || 0) + 1; });
          an.cob = cob;
          anDesenhar();
        }
        if(!an.dados || !an.rank){
          const [d, r] = await Promise.all([
            supa.rpc('vendas_ml_analise', { p_de: p.de, p_ate: p.ate, p_conta: conta }),
            supa.rpc('vendas_ml_ranking', { p_de: p.de, p_ate: p.ate, p_grupo: 'sku', p_conta: conta })
          ]);
          if(an.chave !== chave) return;
          if(d.error) throw d.error;
          an.dados = d.data || {}; an.rank = r.data || [];
          anDesenhar();
        }
        if(an.aba === 'ads' && !an.ads && !an.adsErro) await anCarregarAds(chave, conta, p);
        an.erro = '';
      } catch(e){ an.erro = (e && e.message) || String(e); anDesenhar(); }
    }

    async function anCarregarAds(chave, conta, p){
      an.adsCarregando = true; anDesenhar();
      try {
        const sd = await supa.auth.getSession(), s = sd && sd.data && sd.data.session;
        const [r, rk] = await Promise.all([
          fetch(SUPA_URL + '/functions/v1/ml-ads', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ de: p.de, ate: p.ate, conta: conta || undefined }) }).then(x => x.json()).catch(() => ({ error: 'sem conexão com o servidor' })),
          supa.rpc('vendas_ml_ranking', { p_de: p.de, p_ate: p.ate, p_grupo: 'mlb', p_conta: conta })
        ]);
        if(an.chave !== chave) return;
        if(r.error){ an.adsErro = r.error; } else { an.ads = r; an.rankMlb = rk.data || []; }
      } finally { an.adsCarregando = false; if(an.chave === chave) anDesenhar(); }
    }

    function anAba(a){ an.aba = a; an.busca = ''; anRender(); }
    function anDias(d){ an.dias = d; anRender(); }
    function anOrdenar(col){ const o = an.ord[an.aba] || {}; an.ord[an.aba] = { col, desc: o.col === col ? !o.desc : true }; anDesenhar(); }
    // tabela ordenável: cols = [{ k, t, num, fmt(linha), val(linha) }]
    function anTabela(linhas, cols, padrao){
      const o = an.ord[an.aba] || { col: padrao, desc: true };
      const c = cols.find(x => x.k === o.col) || cols[0];
      const val = l => c.val ? c.val(l) : l[c.k];
      const ord = linhas.slice().sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === 'string' || typeof y === 'string' ? String(x || '').localeCompare(String(y || '')) : (Number(x) || 0) - (Number(y) || 0); return o.desc ? -r : r; });
      return `<div style="overflow-x:auto;"><table class="cp-tab an-tab"><thead><tr>${cols.map(x => `<th class="${x.num ? 'num' : ''} an-th" onclick="anOrdenar('${x.k}')">${x.t}${o.col === x.k ? (o.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>
        ${ord.length ? ord.map(l => `<tr>${cols.map(x => `<td class="${x.num ? 'num' : ''}">${x.fmt ? x.fmt(l) : anE(l[x.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="text-muted" style="text-align:center;padding:22px;">Nada no período.</td></tr>`}
      </tbody></table></div>`;
    }
    const anKpi = (cls, rot, val, sub) => `<div class="kpi ${cls}"><div class="kpi-label">${rot}</div><div class="kpi-value">${val}</div><div class="kpi-sub">${sub || ''}</div></div>`;
    const anVazio = t => `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>${t}</b></div></div>`;

    function anDesenhar(){
      const host = document.getElementById('an-host'); if(!host) return;
      const abas = [['geral', 'Visão geral'], ['produtos', 'Produtos'], ['compradores', 'Compradores'], ['estados', 'Estados'], ['cancel', 'Cancelamentos'], ['ads', 'ADS']];
      const corpo = an.aba === 'geral' ? anGeral() : an.aba === 'produtos' ? anProdutos() : an.aba === 'compradores' ? anCompradores() : an.aba === 'estados' ? anEstados() : an.aba === 'cancel' ? anCancel() : anAds();
      host.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Análise de vendas</div><div class="pg-sub">Crescimento, produtos, compradores, estados, cancelamentos e anúncios pagos — direto das vendas do Mercado Livre.</div></div>
          ${an.aba === 'geral' ? '' : `<div class="seg">${[30, 60, 90].map(d => `<button class="btn-toggle ${an.dias === d ? 'active' : ''}" onclick="anDias(${d})">${d} dias</button>`).join('')}</div>`}
        </div>
        <div class="chips" style="margin-bottom:14px;">${abas.map(([k, t]) => `<button class="chip ${an.aba === k ? 'active' : ''}" onclick="anAba('${k}')">${t}</button>`).join('')}</div>
        ${an.erro ? `<div class="alert alert-danger">Não consegui carregar: ${anE(an.erro)}</div>` : ''}
        ${corpo}`;
    }

    // ----- visão geral: 12 meses -----
    function anGeral(){
      if(!an.meses) return anVazio('Carregando as vendas…');
      const hoje = new Date(), lista = [];
      for(let i = 11; i >= 0; i--){
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1), k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), r = an.meses[k] || {};
        const fat = (Number(r.faturamento) || 0) - (Number(r.canceladas) || 0);
        const mc = fat - (Number(r.imposto) || 0) - (Number(r.frete_vendedor) || 0) - (Number(r.custo) || 0) - (Number(r.tarifa) || 0);
        const diasMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), esperado = i === 0 ? hoje.getDate() : diasMes;
        lista.push({ k, rot: AN_MES[d.getMonth()] + '/' + String(d.getFullYear()).slice(2), fat, mc, vendas: Number(r.vendas) || 0, atual: i === 0, parcial: (an.cob[k] || 0) < esperado - 1, cob: an.cob[k] || 0, esperado });
      }
      const max = Math.max(1, ...lista.map(x => x.fat)), tot = lista.reduce((s, x) => s + x.fat, 0), totV = lista.reduce((s, x) => s + x.vendas, 0);
      const fech = lista.filter(x => !x.atual), ult = fech[fech.length - 1], pen = fech[fech.length - 2];
      const cresc = ult && pen && pen.fat ? (ult.fat / pen.fat - 1) * 100 : null;
      const atual = lista[lista.length - 1], proj = atual.fat && hoje.getDate() > 1 ? atual.fat / hoje.getDate() * new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate() : 0;
      const semDados = lista.filter(x => x.parcial && !x.atual).length;
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-venda', 'Faturamento em 12 meses', fmt(tot), anN(totV) + ' vendas aprovadas')}
          ${anKpi(cresc == null ? 'k-neutro' : cresc >= 0 ? 'k-mc' : 'k-atraso', 'Último mês fechado', ult ? fmt(ult.fat) : '–', cresc == null ? '' : (cresc >= 0 ? '▲ ' : '▼ ') + anN(Math.abs(cresc), 1) + '% sobre ' + pen.rot)}
          ${anKpi('k-hoje', 'Mês atual até hoje', fmt(atual.fat), proj ? 'no ritmo atual fecha em ' + fmt(proj) : '')}
          ${anKpi('k-frete', 'Ticket médio (12 meses)', totV ? fmt(tot / totV) : '–', 'por venda aprovada')}
        </div>
        <div class="card"><div class="card-header"><div class="card-title">Faturamento mês a mês</div><span class="text-muted" style="font-size:12px;">vendas aprovadas, valor dos produtos · abaixo de cada barra, a variação sobre o mês anterior</span></div>
          <div class="card-body"><div class="an-barras">
            ${lista.map((x, i) => { const ant = lista[i - 1], v = ant && ant.fat && !x.atual ? (x.fat / ant.fat - 1) * 100 : null;
              return `<div class="an-barra${x.atual ? ' an-atual' : ''}" title="${x.rot}: ${fmt(x.fat)} · ${anN(x.vendas)} vendas · margem ${anP(x.mc, x.fat)}${x.parcial ? ' · vendas ainda sendo importadas (' + x.cob + ' de ' + x.esperado + ' dias)' : ''}">
                <span class="an-val">${x.fat >= 1000 ? anN(x.fat / 1000, x.fat >= 100000 ? 0 : 1) + ' mil' : anN(x.fat)}</span>
                <div class="an-col"><i style="height:${Math.max(2, x.fat / max * 100)}%"></i></div>
                <b>${x.rot}${x.parcial && !x.atual ? '*' : ''}</b>
                <em class="${v == null ? '' : v >= 0 ? 'an-sobe' : 'an-desce'}">${v == null ? (x.atual ? 'em curso' : '&nbsp;') : (v >= 0 ? '▲' : '▼') + anN(Math.abs(v), 0) + '%'}</em>
              </div>`; }).join('')}
          </div>
          ${semDados ? `<div class="text-muted" style="font-size:12px;margin-top:10px;">* ${semDados} ${semDados === 1 ? 'mês ainda está' : 'meses ainda estão'} com as vendas sendo importadas do Mercado Livre (o histórico entra aos poucos, sozinho). Esses valores vão subir.</div>` : ''}
          </div></div>`;
    }

    // ----- produtos -----
    function anProdutos(){
      if(!an.rank) return anVazio('Carregando os produtos…');
      const tot = an.rank.reduce((s, r) => s + Number(r.bruto), 0), totMc = an.rank.reduce((s, r) => s + Number(r.mc), 0), totUn = an.rank.reduce((s, r) => s + Number(r.un), 0);
      let ac = 0;
      const linhas = an.rank.map(r => { ac += Number(r.bruto); const p = tot ? ac / tot : 1; return { ...r, bruto: Number(r.bruto), mc: Number(r.mc), custo: Number(r.custo), un: Number(r.un), vendas: Number(r.vendas), mc_pct: Number(r.mc_pct), part: tot ? Number(r.bruto) / tot * 100 : 0, curva: p <= 0.8 ? 'A' : p <= 0.95 ? 'B' : 'C' }; });
      const b = an.busca.trim().toLowerCase(), filt = b ? linhas.filter(l => (l.chave + ' ' + (l.titulo || '')).toLowerCase().includes(b)) : linhas;
      const semCusto = linhas.filter(l => !l.custo).length;
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-venda', 'Faturamento', fmt(tot), anN(totUn) + ' unidades em ' + an.dias + ' dias')}
          ${anKpi('k-mc', 'Margem de contribuição', fmt(totMc), anP(totMc, tot) + ' do faturamento')}
          ${anKpi('k-hoje', 'Produtos vendidos', anN(linhas.length), linhas.filter(l => l.curva === 'A').length + ' fazem 80% do faturamento')}
          ${anKpi(semCusto ? 'k-atraso' : 'k-neutro', 'Sem custo cadastrado', anN(semCusto), semCusto ? 'a margem deles aparece maior do que é' : 'todos com custo')}
        </div>
        <div class="card"><div class="card-header"><div class="card-title">Rentabilidade por produto</div><input type="text" placeholder="Buscar SKU ou título" value="${anE(an.busca)}" oninput="an.busca=this.value;clearTimeout(an._t);an._t=setTimeout(()=>{anDesenhar();const i=document.querySelector('#an-host .card-header input');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}},350)" style="max-width:260px;"></div>
        ${anTabela(filt, [
          { k: 'curva', t: 'Curva', fmt: l => `<span class="an-curva an-${l.curva}">${l.curva}</span>` },
          { k: 'chave', t: 'Produto', fmt: l => `<div class="cp-prod" style="max-width:340px;"><b>${anE(l.chave)}</b><span>${anE(l.titulo || '')}</span></div>` },
          { k: 'un', t: 'Unidades', num: 1, fmt: l => anN(l.un) }, { k: 'vendas', t: 'Vendas', num: 1, fmt: l => anN(l.vendas) },
          { k: 'bruto', t: 'Faturamento', num: 1, fmt: l => '<b>' + fmt(l.bruto) + '</b>' }, { k: 'part', t: '% do total', num: 1, fmt: l => anN(l.part, 1) + '%' },
          { k: 'custo', t: 'Custo', num: 1, fmt: l => l.custo ? fmt(l.custo) : '<span class="text-danger">sem custo</span>' },
          { k: 'mc', t: 'Margem R$', num: 1, fmt: l => fmt(l.mc) }, { k: 'mc_pct', t: 'Margem %', num: 1, fmt: l => `<span class="${l.mc_pct < 10 ? 'text-danger' : ''}">${anN(l.mc_pct, 1)}%</span>` }
        ], 'bruto')}</div>`;
    }

    // ----- compradores -----
    function anCompradores(){
      if(!an.dados) return anVazio('Carregando os compradores…');
      const c = an.dados.compradores || {}, top = (c.top || []).map(x => ({ ...x, pedidos: Number(x.pedidos), un: Number(x.un), bruto: Number(x.bruto) }));
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-venda', 'Compradores', anN(c.total), 'em ' + an.dias + ' dias')}
          ${anKpi('k-mc', 'Compraram mais de uma vez', anN(c.recorrentes), anP(c.recorrentes, c.total) + ' dos compradores do período')}
          ${anKpi('k-hoje', 'Já eram clientes', anN(c.ja_clientes), 'tinham comprado antes deste período')}
          ${anKpi('k-frete', 'Faturamento de quem voltou', fmt(Number(c.bruto_recorrentes) || 0), anP(c.bruto_recorrentes, c.bruto) + ' do faturamento')}
        </div>
        <div class="card"><div class="card-header"><div class="card-title">Quem mais comprou</div><span class="text-muted" style="font-size:12px;">50 maiores do período · o Mercado Livre só informa o apelido</span></div>
        ${anTabela(top, [
          { k: 'apelido', t: 'Comprador', fmt: l => '<b>' + anE(l.apelido || l.comprador_id) + '</b>' },
          { k: 'pedidos', t: 'Pedidos', num: 1, fmt: l => anN(l.pedidos) }, { k: 'un', t: 'Unidades', num: 1, fmt: l => anN(l.un) },
          { k: 'bruto', t: 'Faturamento', num: 1, fmt: l => '<b>' + fmt(l.bruto) + '</b>' },
          { k: 'primeira', t: 'Primeira compra', fmt: l => ptDate(String(l.primeira).slice(0, 10)) }, { k: 'ultima', t: 'Última compra', fmt: l => ptDate(String(l.ultima).slice(0, 10)) }
        ], 'pedidos')}</div>`;
    }

    // ----- estados -----
    function anEstados(){
      if(!an.dados) return anVazio('Carregando os estados…');
      const todos = (an.dados.estados || []).map(x => ({ uf: x.uf, vendas: Number(x.vendas), un: Number(x.un), bruto: Number(x.bruto) }));
      const com = todos.filter(x => AN_UF[x.uf]), sem = todos.filter(x => !AN_UF[x.uf]);
      const tot = com.reduce((s, x) => s + x.bruto, 0), totV = com.reduce((s, x) => s + x.vendas, 0), semV = sem.reduce((s, x) => s + x.vendas, 0);
      const max = Math.max(1, ...com.map(x => x.bruto));
      const cobertura = totV + semV ? totV / (totV + semV) * 100 : 0;
      if(!com.length) return `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>O estado de cada venda ainda está sendo buscado</b>O Mercado Livre informa o estado no envio de cada pedido. O Caixa 360 busca sozinho, das vendas mais novas para as mais antigas (alguns milhares por hora). Volte em alguns minutos.</div></div>`;
      const reg = { Sudeste: ['SP', 'RJ', 'MG', 'ES'], Sul: ['PR', 'SC', 'RS'], Nordeste: ['BA', 'PE', 'CE', 'MA', 'PB', 'RN', 'AL', 'SE', 'PI'], 'Centro-Oeste': ['GO', 'DF', 'MT', 'MS'], Norte: ['PA', 'AM', 'RO', 'TO', 'AC', 'AP', 'RR'] };
      const porReg = Object.entries(reg).map(([n, ufs]) => ({ n, bruto: com.filter(x => ufs.includes(x.uf)).reduce((s, x) => s + x.bruto, 0) })).sort((a, b) => b.bruto - a.bruto);
      return `
        <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));">${porReg.map((r, i) => anKpi(i === 0 ? 'k-venda' : 'k-neutro', r.n, fmt(r.bruto), anP(r.bruto, tot) + ' do faturamento')).join('')}</div>
        ${cobertura < 98 ? `<div class="alert alert-info">${anN(cobertura, 0)}% das vendas do período já têm o estado. O restante está sendo buscado no Mercado Livre e entra sozinho.</div>` : ''}
        <div class="card"><div class="card-header"><div class="card-title">Vendas por estado</div><span class="text-muted" style="font-size:12px;">estado de entrega · vendas aprovadas em ${an.dias} dias</span></div>
          <div class="card-body"><div class="an-ufs">
            ${com.sort((a, b) => b.bruto - a.bruto).map(x => `<div class="an-uf"><b title="${AN_UF[x.uf]}">${x.uf}</b><span class="an-uf-n">${AN_UF[x.uf]}</span><div class="an-uf-t"><i style="width:${Math.max(1, x.bruto / max * 100)}%"></i></div><span class="an-uf-v">${fmt(x.bruto)}</span><span class="an-uf-p">${anP(x.bruto, tot)}</span><span class="an-uf-q">${anN(x.vendas)} vendas</span></div>`).join('')}
          </div></div></div>`;
    }

    // ----- cancelamentos -----
    function anCancel(){
      if(!an.dados) return anVazio('Carregando os cancelamentos…');
      const c = an.dados.cancelamentos || {}, pp = (c.por_produto || []).map(x => ({ ...x, canc: Number(x.canc), total: Number(x.total), valor: Number(x.valor), taxa: Number(x.total) ? Number(x.canc) / Number(x.total) * 100 : 0 }));
      const pe = (c.por_envio || []).map(x => ({ envio: x.envio, canc: Number(x.canc), total: Number(x.total) })).filter(x => x.total).sort((a, b) => b.total - a.total);
      const pior = pp.filter(x => x.total >= 10).sort((a, b) => b.taxa - a.taxa)[0];
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-atraso', 'Vendas canceladas', anN(c.qtd), 'de ' + anN(c.total) + ' vendas em ' + an.dias + ' dias')}
          ${anKpi('k-hoje', 'Taxa de cancelamento', anP(c.qtd, c.total, 2), 'das vendas do período')}
          ${anKpi('k-frete', 'Valor cancelado', fmt(Number(c.valor) || 0), 'valor dos produtos')}
          ${anKpi('k-neutro', 'Maior taxa (10+ vendas)', pior ? anN(pior.taxa, 1) + '%' : '–', pior ? anE(pior.sku) : '')}
        </div>
        ${pe.length ? `<div class="card"><div class="card-header"><div class="card-title">Por tipo de envio</div></div><div class="card-body"><div class="an-ufs">${pe.map(x => `<div class="an-uf"><b style="width:70px;">${anE(x.envio)}</b><span class="an-uf-n"></span><div class="an-uf-t"><i class="an-verm" style="width:${Math.min(100, Math.max(1, x.canc / x.total * 100 * 5))}%"></i></div><span class="an-uf-v">${anP(x.canc, x.total, 2)}</span><span class="an-uf-p"></span><span class="an-uf-q">${anN(x.canc)} de ${anN(x.total)}</span></div>`).join('')}</div></div></div>` : ''}
        <div class="card"><div class="card-header"><div class="card-title">Produtos com cancelamento</div></div>
        ${anTabela(pp, [
          { k: 'sku', t: 'Produto', fmt: l => `<div class="cp-prod" style="max-width:380px;"><b>${anE(l.sku)}</b><span>${anE(l.titulo || '')}</span></div>` },
          { k: 'canc', t: 'Canceladas', num: 1, fmt: l => '<b>' + anN(l.canc) + '</b>' }, { k: 'total', t: 'Vendas', num: 1, fmt: l => anN(l.total) },
          { k: 'taxa', t: 'Taxa', num: 1, fmt: l => `<span class="${l.taxa > 5 ? 'text-danger' : ''}">${anN(l.taxa, 1)}%</span>` }, { k: 'valor', t: 'Valor cancelado', num: 1, fmt: l => fmt(l.valor) }
        ], 'canc')}</div>`;
    }

    // ----- ADS -----
    function anAds(){
      if(an.adsErro) return `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>Não consegui ler os anúncios pagos</b>${anE(an.adsErro)}<div style="margin-top:12px;"><button class="btn-out btn-sm" onclick="an.adsErro='';anRender()">Tentar de novo</button></div></div></div>`;
      if(!an.ads) return anVazio('Buscando os anúncios pagos no Mercado Livre…');
      const venda = new Map((an.rankMlb || []).map(r => [r.chave, Number(r.bruto) || 0]));
      const totVenda = (an.rank || []).reduce((s, r) => s + Number(r.bruto), 0);
      const linhas = an.ads.anuncios.map(a => { const vt = venda.get(a.item_id) || 0; return { ...a, ctr: a.impressoes ? a.cliques / a.impressoes * 100 : 0, cpc: a.cliques ? a.investimento / a.cliques : 0, acos: a.vendas_ads ? a.investimento / a.vendas_ads * 100 : (a.investimento ? 999 : 0), venda_total: vt, tacos: vt ? a.investimento / vt * 100 : (a.investimento ? 999 : 0) }; })
        .filter(a => a.investimento > 0 || a.impressoes > 0);
      const inv = linhas.reduce((s, a) => s + a.investimento, 0), vAds = linhas.reduce((s, a) => s + a.vendas_ads, 0);
      const avisos = (an.ads.contas || []).filter(c => c.erro).map(c => (c.apelido || c.conta) + ': ' + c.erro);
      const pc = v => v >= 999 ? '<span class="text-danger">sem venda</span>' : anN(v, 1) + '%';
      const b = an.busca.trim().toLowerCase(), filt = b ? linhas.filter(l => (l.item_id + ' ' + l.titulo).toLowerCase().includes(b)) : linhas;
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-atraso', 'Investimento em ADS', fmt(inv), linhas.length + ' anúncios com gasto ou impressão')}
          ${anKpi('k-venda', 'Vendas por publicidade', fmt(vAds), 'diretas e indiretas')}
          ${anKpi('k-hoje', 'ACOS', anP(inv, vAds), 'investimento ÷ vendas por publicidade')}
          ${anKpi('k-mc', 'TACOS', anP(inv, totVenda, 2), 'investimento ÷ faturamento total (' + fmt(totVenda) + ')')}
        </div>
        ${avisos.length ? `<div class="alert alert-warning">${avisos.map(anE).join(' · ')}</div>` : ''}
        <div class="card"><div class="card-header"><div class="card-title">Anúncios pagos por anúncio</div><input type="text" placeholder="Buscar título ou MLB" value="${anE(an.busca)}" oninput="an.busca=this.value;clearTimeout(an._t);an._t=setTimeout(()=>{anDesenhar();const i=document.querySelector('#an-host .card-header input');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}},350)" style="max-width:260px;"></div>
        ${anTabela(filt, [
          { k: 'titulo', t: 'Anúncio', fmt: l => `<div class="an-anuncio">${l.foto ? `<img src="${anE(l.foto)}" loading="lazy" alt="">` : ''}<div class="cp-prod" style="max-width:320px;"><b>${anE(l.titulo)}</b><span>${anE(l.item_id)}${l.status && l.status !== 'active' ? ' · ' + anE(({ paused: 'pausado', hold: 'suspenso', idle: 'parado', recommended: 'recomendado' })[l.status] || l.status) : ''}${typeof lojasVarias === 'function' && lojasVarias() && !lojaAtiva() ? ' · ' + anE(lojaNome(l.conta)) : ''}</span></div></div>` },
          { k: 'impressoes', t: 'Impressões', num: 1, fmt: l => anN(l.impressoes) }, { k: 'cliques', t: 'Cliques', num: 1, fmt: l => anN(l.cliques) },
          { k: 'ctr', t: 'CTR', num: 1, fmt: l => anN(l.ctr, 2) + '%' }, { k: 'cpc', t: 'CPC', num: 1, fmt: l => fmt(l.cpc) },
          { k: 'investimento', t: 'Investimento', num: 1, fmt: l => '<b>' + fmt(l.investimento) + '</b>' }, { k: 'vendas_ads', t: 'Vendas ADS', num: 1, fmt: l => fmt(l.vendas_ads) },
          { k: 'acos', t: 'ACOS', num: 1, fmt: l => pc(l.acos) }, { k: 'venda_total', t: 'Venda total', num: 1, fmt: l => fmt(l.venda_total) }, { k: 'tacos', t: 'TACOS', num: 1, fmt: l => pc(l.tacos) }
        ], 'investimento')}
        <div class="text-muted" style="font-size:12px;padding:12px 18px;">ACOS = investimento ÷ vendas que vieram da publicidade. TACOS = investimento ÷ tudo que o anúncio vendeu no período (com e sem publicidade): mostra o peso real do ADS no produto.</div></div>`;
    }
