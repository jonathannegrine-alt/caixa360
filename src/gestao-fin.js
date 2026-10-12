// ===== GESTÃO FINANCEIRA: ponto de equilíbrio por dia, custo da dívida e fechamento do mês =====
// Junta o que já existe: DRE (dreMontar, src/dre-anual.js), empréstimos (emp, empContas, empResumo), estoque
// (estoqueGalpao, estoqueFullML, balCalcular) e vendas (RPCs vendas_ml_por_dia / vendas_ml_por_mes / vendas_ml_ranking).
// O bloco aparece no Início (#ini-gestao) e no alto da página Empréstimos (#emp-gestao).

    let gf = { chave: '', carregando: false, dias: null, anos: {}, un30: null };
    const gfN = s => String(s == null ? '' : s).trim().toLowerCase();
    const gfMesNome = ym => ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(ym.slice(5, 7)) - 1] + ' de ' + ym.slice(0, 4);
    const gfUltDia = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const gfMesAnt = ym => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

    async function gfAno(ano, conta){
      if(gf.anos[ano]) return gf.anos[ano];
      const r = await supa.rpc('vendas_ml_por_mes', { p_ano: ano, p_conta: conta }), porMes = {};
      (r.data || []).forEach(x => { porMes[x.mes] = { fat: Number(x.faturamento), canc: Number(x.canceladas), imp: Number(x.imposto), frete: Number(x.frete_vendedor), custo: Number(x.custo), tarifa: Number(x.tarifa), vendas: Number(x.vendas), flex: -(Number(x.flex_repasse) || 0) }; });
      return gf.anos[ano] = porMes;
    }
    async function gfCarregar(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || typeof dreMontar !== 'function') return false;
      const hoje = getToday(), conta = typeof contaParam === 'function' ? contaParam() : null, chave = hoje + '|' + (conta || '');
      if(gf.chave === chave && gf.dias) return true;
      if(gf.carregando) return false;
      gf.carregando = true;
      try {
        gf.anos = {};
        const ym = hoje.slice(0, 7), ant = gfMesAnt(ym);
        const [d, rk] = await Promise.all([
          supa.rpc('vendas_ml_por_dia', { p_de: ym + '-01', p_ate: hoje, p_conta: conta }),
          supa.rpc('vendas_ml_ranking', { p_de: addDias(hoje, -30), p_ate: addDias(hoje, -1), p_grupo: 'sku', p_conta: conta }),
          gfAno(Number(ym.slice(0, 4)), conta), gfAno(Number(ant.slice(0, 4)), conta),
          typeof emp !== 'undefined' && !emp.carregado && typeof empCarregar === 'function' ? empCarregar() : null
        ]);
        gf.dias = d.data || []; gf.un30 = new Map((rk.data || []).map(r => [gfN(r.chave), Number(r.un) || 0])); gf.chave = chave;
      } catch(e){ gf.dias = gf.dias || []; }
      gf.carregando = false; return true;
    }
    // DRE de um ano com os mesmos critérios da página "DRE e resultado" (troca o ano e os dados só durante a conta)
    function gfDre(ano){
      const a0 = dreAno, d0 = dreDados, s0 = dreSoPagas;
      try { dreAno = ano; dreSoPagas = false; dreDados = { ml: gf.anos[ano] || {}, cobertura: {}, carregado: true }; return dreMontar(); }
      finally { dreAno = a0; dreDados = d0; dreSoPagas = s0; }
    }
    function gfMes(ym){
      const D = gfDre(Number(ym.slice(0, 4))), m = Number(ym.slice(5, 7)), x = D.meses[m - 1], soma = ls => ls.reduce((s, l) => s + (l.v[m] || 0), 0);
      return { ym, D, m, entrada: x.entrada, ml: D.linhasML.map(l => ({ nome: l.nome, v: l.v[m] || 0 })), variavel: soma(D.variaveis), fixo: x.fixo, mc: x.mc, lucro: x.lucro,
        fixas: D.fixas.map(l => ({ nome: l.nome, v: l.v[m] || 0 })).filter(l => l.v), variaveis: D.variaveis.map(l => ({ nome: l.nome, v: l.v[m] || 0 })).filter(l => l.v) };
    }
    // parcelas de empréstimo do mês que não entram no DRE (devolução do principal)
    function gfParcelas(ym){
      if(typeof emp === 'undefined' || !emp.todos || typeof empContas !== 'function') return 0;
      const vistos = new Set(); let t = 0;
      emp.todos.forEach(c => empContas(c).forEach(p => { if(vistos.has(p) || String(p.data || '').slice(0, 7) !== ym) return; vistos.add(p); if(dreGrupoDe(p.cat) === 'fora') t += Number(p.val) || 0; }));
      return t;
    }

    // ---------- ponto de equilíbrio por dia ----------
    function gfEquilibrio(){
      const hoje = getToday(), ym = hoje.slice(0, 7), M = gfMes(ym), diasMes = gfUltDia(ym), parcelas = gfParcelas(ym);
      const precisa = M.fixo + M.variavel + parcelas;
      // margem das vendas (já sem tarifa, frete, imposto e custo) nos dias fechados do mês
      const fechados = (gf.dias || []).filter(d => String(d.dia).slice(0, 10) < hoje), mcAcum = fechados.reduce((s, d) => s + Number(d.mc || 0), 0), n = Number(hoje.slice(8, 10)) - 1;
      const porDia = n > 0 ? mcAcum / n : 0, meta = precisa / diasMes;
      return { ym, precisa, fixo: M.fixo, variavel: M.variavel, parcelas, diasMes, n, mcAcum, porDia, meta, projecao: porDia * diasMes - precisa };
    }

    // ---------- custo da dívida ----------
    function gfParado(){
      if(typeof estoqueGalpao === 'undefined') return null;
      const est = new Map(), kits = typeof esoKits === 'function' ? esoKits() : new Map();
      const abrir = (sku, q) => kits.has(gfN(sku)) ? kits.get(gfN(sku)).map(c => ({ k: gfN(c.sku), q: q * c.qtd })) : [{ k: gfN(sku), q }];
      estoqueGalpao.forEach(e => { const k = gfN(e.sku), q = Math.max(0, Number(e.qtd_galpao) || 0); if(q) est.set(k, (est.get(k) || 0) + q); });
      (Array.isArray(estoqueFullML) ? estoqueFullML : []).forEach(f => abrir(f.sku, Number(f.total_geral) || 0).forEach(d => { if(d.q) est.set(d.k, (est.get(d.k) || 0) + d.q); }));
      if(!est.size) return null;
      const venda = new Map(); (gf.un30 || new Map()).forEach((un, sku) => abrir(sku, un).forEach(d => venda.set(d.k, (venda.get(d.k) || 0) + d.q)));
      const custoDe = k => { const e = estoqueGalpao.find(x => gfN(x.sku) === k), s = skus.find(x => gfN(x.sku) === k); return (e && Number(e.custo_medio) > 0 ? Number(e.custo_medio) : 0) || (s && Number(s.custo)) || 0; };
      let valor = 0, un = 0, total = 0; const itens = [];
      est.forEach((q, k) => { const c = custoDe(k), sobra = Math.max(0, q - (venda.get(k) || 0) * 3); total += q * c; if(sobra > 0 && c > 0){ valor += sobra * c; un += sobra; itens.push({ sku: k, un: sobra, valor: sobra * c, un30: venda.get(k) || 0 }); } });
      return { valor, un, total, itens: itens.sort((a, b) => b.valor - a.valor) };
    }
    function gfDivida(){
      const hoje = getToday(), ym = hoje.slice(0, 7), lista = (typeof emp !== 'undefined' && emp.lista) || [];
      let saldo = 0, juros = 0, taxaPond = 0;
      lista.forEach(c => { const r = empResumo(c), tx = Number(c.taxa_mes) || 0; saldo += r.saldo; taxaPond += r.saldo * tx;
        const jm = r.contas.filter(p => /juros/i.test(p.desc || '') && String(p.data || '').slice(0, 7) === ym).reduce((s, p) => s + (Number(p.val) || 0), 0);
        juros += jm > 0 ? jm : r.saldo * tx / 100; });
      const ant = gfMes(gfMesAnt(ym));
      return { contratos: lista.length, saldo, juros, taxa: saldo ? taxaPond / saldo : 0, parado: gfParado(), lucroAnt: ant.lucro, mesAnt: ant.ym };
    }

    // ---------- bloco no Início e em Empréstimos ----------
    function gfHtml(soDivida){
      const E = gfEquilibrio(), V = gfDivida(), cor = v => v >= 0 ? 'var(--success,#16a34a)' : 'var(--danger)';
      const pct = E.meta > 0 ? Math.max(0, Math.min(100, E.porDia / E.meta * 100)) : 100;
      const eq = `<div class="card gf-card"><div class="card-header"><div class="card-title">Ponto de equilíbrio de ${gfMesNome(E.ym).split(' de ')[0]}</div><span class="text-muted" style="font-size:12px;">margem das vendas por dia</span></div>
        <div class="gf-eq"><div><small>Precisa por dia</small><b>${fmt(E.meta)}</b></div><div><small>Está fazendo</small><b style="color:${cor(E.porDia - E.meta)}">${E.n > 0 ? fmt(E.porDia) : '—'}</b></div><div><small>Projeção do mês</small><b style="color:${cor(E.projecao)}">${E.n > 0 ? fmt(E.projecao) : '—'}</b></div></div>
        <div class="gf-barra"><i style="width:${pct}%;background:${cor(E.porDia - E.meta)}"></i></div>
        <div class="text-muted gf-nota">Para pagar ${fmt(E.precisa)} no mês: despesas fixas ${fmt(E.fixo)}${E.variavel ? ', outras despesas ' + fmt(E.variavel) : ''}${E.parcelas ? ' e parcelas de empréstimo ' + fmt(E.parcelas) : ''}. ${E.n > 0 ? 'Até ontem a margem somou ' + fmt(E.mcAcum) + ' em ' + E.n + ' dia' + (E.n > 1 ? 's' : '') + '.' : 'O mês começa hoje.'}</div></div>`;
      const cobre = V.juros > 0 ? V.lucroAnt / V.juros : null;
      const dv = V.contratos || (V.parado && V.parado.valor > 0) ? `<div class="card gf-card"><div class="card-header"><div class="card-title">Custo da dívida</div><span class="text-muted" style="font-size:12px;">${V.contratos} contrato${V.contratos === 1 ? '' : 's'} · saldo ${fmt(V.saldo)}</span></div>
        <div class="gf-eq"><div><small>Juros neste mês</small><b style="color:var(--danger)">${fmt(V.juros)}</b></div><div><small title="Estoque acima de 90 dias de venda, a preço de custo">Parado em estoque</small><b>${V.parado ? fmt(V.parado.valor) : '—'}</b></div><div><small>Lucro de ${gfMesNome(V.mesAnt).split(' de ')[0]}</small><b style="color:${cor(V.lucroAnt)}">${fmt(V.lucroAnt)}</b></div></div>
        <div class="text-muted gf-nota">${V.juros > 0 ? (cobre >= 1 ? 'O lucro do mês passado cobre os juros ' + cobre.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' vez' + (cobre >= 2 ? 'es' : '') + '.' : (V.lucroAnt > 0 ? 'Os juros levam ' + Math.round(V.juros / V.lucroAnt * 100) + '% do lucro do mês passado.' : 'O mês passado não deu lucro para cobrir os juros.')) : 'Sem juros lançados para este mês.'}${V.parado && V.parado.valor > 0 && V.taxa > 0 ? ' O estoque parado, à taxa média de ' + V.taxa.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '% ao mês, custa ' + fmt(V.parado.valor * V.taxa / 100) + ' por mês em juros.' : ''}${V.parado && V.parado.itens.length ? ' Maiores: ' + V.parado.itens.slice(0, 3).map(i => String(i.sku).toUpperCase() + ' ' + fmt(i.valor)).join(', ') + '.' : ''}</div></div>` : '';
      const antM = gfMesAnt(E.ym), fech = `<div class="gf-fech-l"><a onclick="gfFechamento('${antM}', this)">Fechamento de ${gfMesNome(antM)} em PDF</a> · <a onclick="gfFechamento('${E.ym}', this)">parcial de ${gfMesNome(E.ym).split(' de ')[0]}</a></div>`;
      return soDivida ? dv : `<div class="gf-grid">${eq}${dv}</div>${fech}`;
    }
    async function gfInicio(){
      const ok = await gfCarregar(); const h = document.getElementById('ini-gestao'); if(!h || !ok) return;
      const hoje = getToday(), dia = Number(hoje.slice(8, 10)), ant = gfMesAnt(hoje.slice(0, 7));
      try { h.innerHTML = gf.html = (dia <= 10 ? `<div class="alert alert-info gf-fech">O fechamento de <b>${gfMesNome(ant)}</b> está pronto. <a onclick="gfFechamento('${ant}', this)" style="cursor:pointer;font-weight:700;">Baixar em PDF →</a></div>` : '') + gfHtml(false); } catch(e){ h.innerHTML = ''; }
    }
    async function gfEmprestimos(){
      const ok = await gfCarregar(); const v = document.getElementById('view-emprestimos'); if(!v || !ok || !v.classList.contains('active')) return;
      let h = document.getElementById('emp-gestao'); if(!h){ h = document.createElement('div'); h.id = 'emp-gestao'; const ref = v.querySelector('.kpi-grid') || v.children[1] || null; v.insertBefore(h, ref); }
      try { h.innerHTML = gfHtml(true); } catch(e){ h.innerHTML = ''; }
    }

    // ---------- fechamento do mês em PDF ----------
    async function gfFechamento(ym, bt){
      const rot = bt ? bt.textContent : ''; if(bt) bt.textContent = 'Gerando…';
      try {
        await gfCarregar();
        const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem conexão')); document.head.appendChild(s); });
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        const conta = typeof contaParam === 'function' ? contaParam() : null, ant = gfMesAnt(ym);
        await Promise.all([gfAno(Number(ym.slice(0, 4)), conta), gfAno(Number(ant.slice(0, 4)), conta)]);
        const M = gfMes(ym), A = gfMes(ant), hoje = getToday(), de = ym + '-01', ate = ym + '-' + String(gfUltDia(ym)).padStart(2, '0');
        const n2 = v => (v < 0 ? '-R$ ' : 'R$ ') + Math.abs(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const pc = (v, t) => t ? (v / t * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '';
        const vr = (a, b) => b ? ((a - b) / Math.abs(b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, signDisplay: 'always' }) + '%' : '';
        // conciliação do mês, se o relatório foi importado
        let conc = null;
        try { const cb = (await supa.rpc('concil_cobertura')).data || [], c = conta || (cb.find(x => x.origem === 'v' && x.de <= ate && x.ate >= de) || {}).ml_user_id;
          if(c && cb.some(x => x.ml_user_id === c && x.origem === 'v' && x.de <= ate && x.ate >= de)){ const [r, d] = await Promise.all([supa.rpc('concil_resumo', { p_de: de, p_ate: ate, p_conta: c }), supa.rpc('concil_divergencias', { p_de: de, p_ate: ate, p_conta: c })]);
            if(!r.error && !d.error) conc = { r: r.data || {}, d: d.data || [], conta: c }; } } catch(e){}
        const B = typeof balCalcular === 'function' ? balCalcular() : null, V = gfDivida();
        const atras = pagamentos.filter(p => !p.pago && p.data < hoje), vAtras = atras.reduce((s, p) => s + (Number(p.val) || 0), 0);
        const prox30 = pagamentos.filter(p => !p.pago && p.data >= hoje && p.data <= addDias(hoje, 30)).reduce((s, p) => s + (Number(p.val) || 0), 0);
        const nome = typeof lojaAtiva === 'function' && lojaAtiva() && typeof contaNome === 'function' ? contaNome(lojaAtiva()) : 'Todas as lojas';

        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), L = doc.internal.pageSize.getWidth();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('Fechamento de ' + gfMesNome(ym), 40, 52);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100); doc.text(nome + '  ·  gerado em ' + new Date().toLocaleString('pt-BR'), 40, 70);
        const cx = [['Faturamento', M.entrada, [79, 70, 229], vr(M.entrada, A.entrada)], ['Margem das vendas', M.mc, [8, 145, 178], pc(M.mc, M.entrada)], ['Despesas fixas', M.fixo, [217, 119, 6], vr(M.fixo, A.fixo)], ['Lucro do mês', M.lucro, M.lucro >= 0 ? [22, 163, 74] : [220, 38, 38], pc(M.lucro, M.entrada)]], w = (L - 80 - 30) / 4;
        cx.forEach((c, i) => { const x = 40 + i * (w + 10); doc.setDrawColor(225); doc.setFillColor(248, 249, 252); doc.roundedRect(x, 86, w, 58, 6, 6, 'FD'); doc.setFillColor(...c[2]); doc.rect(x, 86, 4, 58, 'F');
          doc.setFontSize(8); doc.setTextColor(110); doc.text(c[0].toUpperCase(), x + 12, 102); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20); doc.text(n2(c[1]), x + 12, 121); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120); doc.text(String(c[3] || ''), x + 12, 135); });
        const tab = (head, body, y, cor, foot) => { doc.autoTable({ startY: y, margin: { left: 40, right: 40 }, head: [head], body, foot: foot ? [foot] : undefined, styles: { fontSize: 9, cellPadding: 5 }, headStyles: { fillColor: cor, textColor: 255 }, footStyles: { fillColor: [240, 241, 246], textColor: 20, fontStyle: 'bold' },
          columnStyles: Object.fromEntries(head.map((_, i) => [i, i ? { halign: 'right' } : {}])), showFoot: 'lastPage' }); return doc.lastAutoTable.finalY; };
        const tit = (t, y) => { if(y > 740){ doc.addPage(); y = 50; } doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20); doc.text(t, 40, y); doc.setFont('helvetica', 'normal'); return y + 8; };

        // 1. resultado
        let y = tit('1. Resultado do mês', 172);
        const linhaAnt = k => (A.ml.find(l => l.nome === k) || {}).v || 0;
        const corpo = [['Faturamento (vendas, com as canceladas)', n2(M.entrada), '100%', n2(A.entrada)]]
          .concat(M.ml.filter(l => l.v).map(l => ['(-) ' + l.nome, n2(-l.v), pc(l.v, M.entrada), n2(-linhaAnt(l.nome))]))
          .concat(M.variavel ? [['(-) Outras despesas variáveis (contas a pagar)', n2(-M.variavel), pc(M.variavel, M.entrada), n2(-A.variavel)]] : [])
          .concat([['= Margem de contribuição', n2(M.mc), pc(M.mc, M.entrada), n2(A.mc)], ['(-) Despesas fixas', n2(-M.fixo), pc(M.fixo, M.entrada), n2(-A.fixo)]]);
        y = tab(['', gfMesNome(ym), '% do faturamento', gfMesNome(ant)], corpo, y, [79, 70, 229], ['= Lucro do mês', n2(M.lucro), pc(M.lucro, M.entrada), n2(A.lucro)]);
        if(M.fixas.length){ y = tit('Despesas fixas por categoria', y + 26); y = tab(['Categoria', 'Valor', '% das fixas'], M.fixas.sort((a, b) => b.v - a.v).slice(0, 14).map(l => [l.nome, n2(l.v), pc(l.v, M.fixo)]), y, [217, 119, 6]); }

        // 2. caixa
        y = tit('2. Caixa (posição de hoje)', y + 26);
        y = tab(['', 'Valor'], [['Saldo em conta', n2((Number(saldoMP) || 0) + (Number(saldoOutros) || 0))], ['A receber do Mercado Livre', n2(B ? B.receber : 0)], ['Contas a pagar nos próximos 30 dias', n2(-prox30)], ['Contas em atraso (' + atras.length + ')', n2(-vAtras)]], y, [8, 145, 178]);

        // 3. estoque
        if(B){ y = tit('3. Estoque a preço de custo', y + 26);
          y = tab(['', 'Valor'], [['No galpão', n2(B.galpao)], ['No Full', n2(B.full)], ['A caminho do Full', n2(B.caminhoFull)]].concat(V.parado ? [['Parado: acima de 90 dias de venda', n2(V.parado.valor)]] : []), y, [22, 163, 74], ['Total em estoque', n2(B.galpao + B.full + B.caminhoFull)]); }

        // 4. dívidas
        y = tit('4. Empréstimos', y + 26);
        const lista = (typeof emp !== 'undefined' && emp.lista) || [];
        y = lista.length ? tab(['Contrato', 'Saldo devedor', 'Próxima parcela', 'Termina em'], lista.map(c => { const r = empResumo(c); return [c.nome || c.credor || 'Contrato', n2(r.saldo), r.prox ? n2(r.valorProx) + ' em ' + ptDate(r.prox.data) : '—', r.fim ? ptDate(r.fim) : 'quitado']; }), y, [220, 38, 38], ['Total · juros deste mês ' + n2(V.juros), n2(V.saldo), '', ''])
          : tab([''], [['Nenhum empréstimo cadastrado.']], y, [220, 38, 38]);

        // 5. Mercado Livre (conciliação)
        if(conc){ y = tit('5. Mercado Livre: conferência do repasse', y + 26);
          const av = conc.r.avulsas || [], contra = conc.d.filter(x => x.valor > 0).reduce((s, x) => s + Number(x.valor), 0);
          y = tab(['Cobranças fora das vendas', 'Valor'], av.map(a => [(typeof CN_AVULSA !== 'undefined' && CN_AVULSA[a.tipo]) || a.tipo, n2(a.valor)]), y, [100, 116, 139], ['Total', n2(av.reduce((s, a) => s + Number(a.valor || 0), 0))]);
          doc.setFontSize(9); doc.setTextColor(60); doc.text(doc.splitTextToSize((conc.r.conferidas || 0).toLocaleString('pt-BR') + ' vendas conferidas com o relatório do Mercado Livre; ' + conc.d.length + ' não fecharam, somando ' + n2(contra) + ' contra a loja. Confira se as cobranças acima estão lançadas nas contas a pagar: se não estiverem, o lucro do mês é menor do que o mostrado.', L - 80), 40, y + 16); y += 34; }

        // alertas
        const al = [];
        if(M.lucro < 0) al.push('O mês fechou com prejuízo de ' + n2(-M.lucro) + '.');
        if(A.entrada && M.entrada < A.entrada * 0.92) al.push('O faturamento caiu ' + vr(M.entrada, A.entrada) + ' em relação a ' + gfMesNome(ant) + '.');
        if(M.entrada && A.entrada && M.mc / M.entrada < A.mc / A.entrada - 0.015) al.push('A margem de contribuição caiu de ' + pc(A.mc, A.entrada) + ' para ' + pc(M.mc, M.entrada) + '.');
        if(atras.length) al.push(atras.length + ' conta' + (atras.length > 1 ? 's' : '') + ' em atraso, somando ' + n2(vAtras) + '.');
        if(V.juros > 0 && M.lucro > 0 && V.juros / M.lucro > 0.3) al.push('Os juros de empréstimos (' + n2(V.juros) + ') equivalem a ' + Math.round(V.juros / M.lucro * 100) + '% do lucro do mês.');
        if(V.parado && V.parado.valor > 0) al.push(n2(V.parado.valor) + ' em estoque acima de 90 dias de venda.');
        if(conc){ const c = conc.d.filter(x => x.valor > 0); if(c.length) al.push(c.length + ' vendas em que o Mercado Livre pagou menos do que o esperado (' + n2(c.reduce((s, x) => s + Number(x.valor), 0)) + '). Veja em Conciliação.'); }
        try { const a = JSON.parse(localStorage.getItem('mk_lucro_alerta') || 'null'); if(a && a.prej > 0) al.push(a.prej + ' anúncio' + (a.prej > 1 ? 's' : '') + ' no prejuízo depois da publicidade.'); } catch(e){}
        y = tit('Pontos de atenção', y + 26);
        y = tab([''], (al.length ? al.slice(0, 6) : ['Nenhum ponto de atenção neste fechamento.']).map(t => [t]), y, [51, 65, 85]);
        doc.setFontSize(8); doc.setTextColor(130); doc.text(doc.splitTextToSize('Relatório gerencial, não substitui a contabilidade. Resultado pelos mesmos critérios da página "DRE e resultado". Caixa, estoque e empréstimos mostram a posição do dia em que o relatório foi gerado.', L - 80), 40, Math.min(y + 22, 800));
        doc.save('fechamento_' + ym + '.pdf');
      } catch(e){ if(typeof toast === 'function') toast('Não consegui gerar o fechamento: ' + ((e && e.message) || e)); }
      if(bt) bt.textContent = rot;
    }

    // o bloco "Custo da dívida" acompanha todo redesenho da página Empréstimos
    if(typeof empDesenhar === 'function'){ const _empDesenhar = empDesenhar; empDesenhar = function(){ _empDesenhar.apply(this, arguments); try { gfEmprestimos(); } catch(e){} }; }
