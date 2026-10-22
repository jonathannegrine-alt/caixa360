// ===== BALANÇO PATRIMONIAL GERENCIAL =====
// Mesmos critérios do módulo "Balanço e Compras" do Jonathan, com os dados que o Caixa 360 já tem:
//   ATIVO   = caixa e bancos (saldos informados) + a receber confirmado do Mercado Livre
//             + estoque a custo (galpão + Full + o que saiu do galpão e o Full ainda não recebeu)
//   PASSIVO = só o que já é devido na data: tudo que venceu, mais as parcelas futuras do que é DÍVIDA
//             (amortização de empréstimo, compra de mercadoria, imposto apurado). Despesa futura e juros futuros ficam fora.
// Quem é dívida e quem é despesa vem da categoria (Configurações → Categorias, coluna "Tipo passivo").
// Segue o seletor de loja da barra lateral: "Todas" soma tudo; uma loja mostra o caixa, as contas a pagar, o Full
// e o a receber DELA. O galpão vai para as lojas marcadas em Configurar estoque → Depósitos ("quais lojas usam");
// quando mais de uma usa o mesmo galpão, cada produto é repartido pela venda de cada loja nos últimos 90 dias.
// Tratamento de cada categoria no passivo (comprasCfg.balanco.tipos): divida = tudo que está em aberto;
// operacional = só o que já venceu; mes = o que já venceu + o que vence até o fim deste mês; nunca = não entra.
// Desenha no topo da página Saúde patrimonial (#bal-host).

    let bal = { conta: '', aberto: false, classOk: false };
    const blEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const blN = s => String(s == null ? '' : s).trim().toLowerCase();

    // Dívida ou despesa? Vale a escolha do usuário (comprasCfg.balanco.tipos); sem escolha, um palpite pelo nome.
    function balTipoDe(nome){
      const esc = (typeof comprasCfg !== 'undefined' && comprasCfg.balanco && comprasCfg.balanco.tipos) || {};
      const k = blN(nome); if(esc[k]) return esc[k];
      if(/juros/i.test(nome)) return 'operacional';
      return /amortiza|capital de giro|empr[eé]stimo|financiamento|mercadoria|fornecedor|^compras?$|simples nacional|\bdas\b|imposto/i.test(nome || '') ? 'divida' : 'operacional';
    }
    function balClassificarCategorias(){}
    const BAL_TRAT = [['divida', 'Dívida: entra tudo que está em aberto'], ['mes', 'Despesa do mês: vencidas + as deste mês'], ['operacional', 'Despesa: só o que já venceu'], ['nunca', 'Nunca entra no balanço']];
    function balLojasDoGalpao(){
      const deps = (typeof est !== 'undefined' && est.depositos) || [];
      const proprios = deps.filter(d => d.tipo !== 'full' && d.ativo !== false);
      if(!proprios.length || proprios.some(d => !Array.isArray(d.lojas) || !d.lojas.length)) return [];
      return [...new Set(proprios.flatMap(d => d.lojas.map(String)))];
    }

    // participação de cada loja na venda de cada produto (90 dias), com o kit aberto nos componentes
    function balParticipacao(){
      const m = new Map(), V = (typeof comprasVendas !== 'undefined' && comprasVendas.dados) || {};
      const kits = typeof esoKits === 'function' ? esoKits() : new Map();
      Object.keys(V).forEach(sku => { const c = V[sku].c || {};
        (kits.has(blN(sku)) ? kits.get(blN(sku)).map(x => ({ k: blN(x.sku), q: x.qtd })) : [{ k: blN(sku), q: 1 }]).forEach(d => {
          const o = m.get(d.k) || {}; Object.keys(c).forEach(conta => { o[conta] = (o[conta] || 0) + (Number(c[conta]) || 0) * d.q; }); m.set(d.k, o); }); });
      return m;
    }

    function balCalcular(){
      const hoje = getToday(), conta = bal.conta = (typeof lojaAtiva === 'function' ? lojaAtiva() : '');
      const fimMes = hoje.slice(0, 8) + '31';
      // lojas que usam o galpão (união dos depósitos próprios); vazio = todas
      const usam = balLojasDoGalpao();
      const part = balParticipacao(), fatia = k => {
        if(!conta) return 1;
        if(usam.length && !usam.includes(conta)) return 0;
        if(usam.length === 1) return 1;
        const o = part.get(k); if(!o) return 0;
        const t = Object.keys(o).filter(c => !usam.length || usam.includes(c)).reduce((s, c) => s + o[c], 0);
        return t > 0 ? (o[conta] || 0) / t : 0; };
      const custoDe = k => { const e = estoqueGalpao.find(x => blN(x.sku) === k), s = skus.find(x => blN(x.sku) === k); return (e && Number(e.custo_medio) > 0 ? Number(e.custo_medio) : 0) || (s && Number(s.custo)) || 0; };
      const kits = typeof esoKits === 'function' ? esoKits() : new Map();
      const abrir = (sku, q) => kits.has(blN(sku)) ? kits.get(blN(sku)).map(c => ({ k: blN(c.sku), q: q * c.qtd })) : [{ k: blN(sku), q }];

      // ATIVO
      const caixa = (Number(saldoMP) || 0) + (Number(saldoOutros) || 0);
      const libs = (typeof liberacoesTodas !== 'undefined' && liberacoesTodas.length ? liberacoesTodas : liberacoes.map(l => ({ ...l, conta: '' })));
      const receber = libs.filter(l => l.data >= hoje && (!conta || String(l.conta) === conta)).reduce((s, l) => s + (Number(l.val) || 0), 0);
      let galpao = 0, galpaoUn = 0, semCusto = 0;
      estoqueGalpao.forEach(e => { const k = blN(e.sku), q = Math.max(0, Number(e.qtd_galpao) || 0) * fatia(k); if(!q) return; const c = custoDe(k); if(!c) semCusto++; galpao += q * c; galpaoUn += q; });
      let full = 0, fullUn = 0;
      (Array.isArray(estoqueFullML) ? estoqueFullML : []).forEach(f => { if(conta && String(f._conta || '') !== conta) return; const q = Number(f.total_geral) || 0; abrir(f.sku, q).forEach(d => { full += d.q * custoDe(d.k); fullUn += d.q; }); });
      let caminhoFull = 0;
      if(typeof esoACaminhoDoFull === 'function') esoACaminhoDoFull().forEach((q, k) => { caminhoFull += q * fatia(k) * custoDe(k); });
      // cada envio que saiu: custo inteiro e quanto dele o Mercado Livre já mostra no Full (essa parte está em "Estoque no Full")
      const envios = [];
      if(typeof eso !== 'undefined' && Array.isArray(eso.envios)){
        const limite = Date.now() - 15 * 86400000, fml = Array.isArray(estoqueFullML) ? estoqueFullML : [];
        eso.envios.filter(x => x.situacao === 'saiu' && (!x.saiu_em || Date.parse(x.saiu_em) > limite)).forEach(x => {
          let total = 0, falta = 0;
          (x.itens || []).forEach(i => { const q = Number(i.qtd) || 0; if(!q) return;
            const ml = fml.filter(f => blN(f.sku) === blN(i.anuncio_sku) && (!x.ml_user_id || !f._conta || String(f._conta) === String(x.ml_user_id))).reduce((s, f) => s + (Number(f.em_transito) || 0) + (Number(f.pendente) || 0) + (Number(f.em_separacao) || 0), 0);
            const parte = Math.max(0, q - ml) / q;
            (i.componentes || []).forEach(c => { const k = blN(c.sku), v = (Number(c.qtd) || 0) * fatia(k) * custoDe(k); total += v; falta += v * parte; }); });
          if(total > 0) envios.push({ numero: x.numero || ('#' + x.id), total, falta });
        });
      }
      const ativo = caixa + receber + galpao + full + caminhoFull;

      // PASSIVO
      const linhas = pagamentos.filter(p => !p.pago).map(p => {
        const t = balTipoDe(p.cat || ''), vencida = p.data <= hoje;
        const entra = t === 'nunca' ? false : t === 'divida' ? true : t === 'mes' ? (vencida || p.data <= fimMes) : vencida;
        return { p, t, entra, motivo: t === 'nunca' ? 'categoria fora do balanço' : vencida ? 'já venceu' : t === 'divida' ? 'dívida a vencer' : entra ? 'vence neste mês' : 'despesa futura (fora)' }; });
      const grupos = {};
      linhas.filter(l => l.entra).forEach(l => { const g = l.p.cat || 'Sem categoria'; grupos[g] = (grupos[g] || 0) + (Number(l.p.val) || 0); });
      const passivo = Object.values(grupos).reduce((s, v) => s + v, 0);
      const fora = linhas.filter(l => !l.entra).reduce((s, l) => s + (Number(l.p.val) || 0), 0);
      return { caixa, receber, galpao, galpaoUn, full, fullUn, caminhoFull, envios, ativo, grupos, passivo, fora, pl: ativo - passivo, linhas, semCusto };
    }

    async function renderBalanco(){
      const view = document.getElementById('view-patrimonio'); if(!view) return;
      let host = document.getElementById('bal-host');
      if(!host){ host = document.createElement('div'); host.id = 'bal-host'; const ref = view.children[1] || null; view.insertBefore(host, ref); }
      // a tela antiga (índice de cobertura, cenários de liquidação) usava outra conta e contradizia o balanço: fica escondida
      [...view.children].forEach((el, i) => { if(i > 0 && el.id !== 'bal-host') el.style.display = 'none'; });
      const snap = view.querySelector('button[onclick="salvarSnapshotPatrimonio()"]'); if(snap) snap.style.display = 'none';
      balClassificarCategorias();
      if(!host.innerHTML.trim() && typeof carregandoMsg === 'function') carregandoMsg(host, 'Calculando o balanço… (estoque, Full e vendas por loja)');
      await balPreparar();
      balDesenhar();
    }
    // dados que o balanço usa: estoque (movimentações → saldo do galpão), Full (API), envios e a venda por loja.
    // Sem isso, num aparelho que ainda não abriu o Estoque, o galpão sai zerado (o fechamento do mês também chama).
    async function balPreparar(){
      try {
        if(typeof estCarregar === 'function') await estCarregar(false);
        if(typeof esoLer === 'function') await esoLer(false);
        if(typeof comprasCarregarVendas === 'function' && !(comprasVendas && comprasVendas.dados)) await comprasCarregarVendas(false);
        if((!Array.isArray(estoqueFullML) || !estoqueFullML.length) && typeof comprasFullAPI === 'function') await comprasFullAPI();
      } catch(e){}
    }

    function balDesenhar(){
      const host = document.getElementById('bal-host'); if(!host) return;
      const B = balCalcular(), contas = typeof contasML !== 'undefined' ? contasML : [];
      const lin = (rot, val, sub) => `<div class="bl-lin"><span>${rot}${sub ? `<i>${sub}</i>` : ''}</span><b>${fmt(val)}</b></div>`;
      const un = n => Math.round(n).toLocaleString('pt-BR') + ' un.';
      const gr = Object.entries(B.grupos).sort((a, b) => b[1] - a[1]);
      const nomeConta = bal.conta ? ((typeof contaNome === 'function' && contaNome(bal.conta)) || bal.conta) : '';
      host.innerHTML = `
        <div class="card" style="margin-bottom:16px;">
          <div class="card-header" style="flex-wrap:wrap;gap:10px;">
            <div><div class="card-title">Balanço patrimonial gerencial</div><div class="text-muted" style="font-size:12px;">Posição de hoje, ${ptDate(getToday())}. Não substitui o balanço contábil.</div></div>
            <div class="chips">${contas.length > 1 ? `<span class="text-muted" style="font-size:12px;align-self:center;">${bal.conta ? 'Loja: <b>' + blEsc(nomeConta) + '</b>' : 'Todas as lojas juntas'} · troque no seletor de conta</span>` : ''}
              <button class="chip" onclick="balPdf(this)" title="Baixa o balanço em PDF, pronto para imprimir ou enviar">Baixar PDF</button>
              <button class="chip" onclick="balExportar()" title="Baixa o balanço em planilha, com as contas classificadas em outra aba">Baixar Excel</button></div>
          </div>
          <div class="card-body">
            <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));">
              <div class="kpi k-mc"><div class="kpi-label">Ativo</div><div class="kpi-value">${fmt(B.ativo)}</div><div class="kpi-sub">o que a empresa tem</div></div>
              <div class="kpi k-atraso"><div class="kpi-label">Passivo</div><div class="kpi-value">${fmt(B.passivo)}</div><div class="kpi-sub">o que já é devido</div></div>
              <div class="kpi ${B.pl >= 0 ? 'k-venda' : 'k-atraso'}"><div class="kpi-label">Patrimônio líquido</div><div class="kpi-value">${fmt(B.pl)}</div><div class="kpi-sub">ativo menos passivo</div></div>
            </div>
            <div class="bl-cols">
              <div><div class="bl-tit">Ativo</div>
                ${lin('Caixa e bancos', B.caixa, bal.conta ? 'saldos desta loja' : 'saldos informados no Painel financeiro')}
                ${lin('A receber do Mercado Livre', B.receber, 'liberações já confirmadas')}
                ${lin('Estoque no galpão', B.galpao, un(B.galpaoUn) + ' a custo médio')}
                ${lin('Estoque no Full', B.full, un(B.fullUn) + ', kits abertos nos componentes')}
                ${B.caminhoFull || (B.envios || []).length ? lin('A caminho do Full', B.caminhoFull, 'saiu do galpão, o Mercado Livre ainda não mostra no Full' + (B.envios || []).map(e => '<br>Envio ' + blEsc(e.numero) + ': custo total ' + fmt(e.total) + (e.total - e.falta > 0.5 ? ' · ' + fmt(e.total - e.falta) + ' já contados em "Estoque no Full"' : ' · nada no Full ainda')).join('')) : ''}
                <div class="bl-lin bl-tot"><span>Total do ativo</span><b>${fmt(B.ativo)}</b></div>
                ${B.semCusto ? `<div class="text-muted" style="font-size:12px;margin-top:6px;">${B.semCusto} produtos com estoque e sem custo entram valendo zero.</div>` : ''}
              </div>
              <div><div class="bl-tit">Passivo</div>
                ${gr.length ? gr.map(([g, v]) => lin(blEsc(g), v)).join('') : '<div class="text-muted" style="padding:10px 0;">Nenhuma conta devida.</div>'}
                <div class="bl-lin bl-tot"><span>Total do passivo</span><b>${fmt(B.passivo)}</b></div>
                <div class="text-muted" style="font-size:12px;margin-top:6px;">Ficaram de fora ${fmt(B.fora)} de contas que ainda vão vencer ou de categorias fora do balanço. <a class="fx-link" style="color:var(--primary);" onclick="bal.aberto=!bal.aberto;balDesenhar();">${bal.aberto ? 'Esconder' : 'Ver'} as contas classificadas</a></div>
              </div>
            </div>
            ${bal.aberto ? `<div style="margin-top:14px;"><div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">Pense assim: <b>se eu fechasse a empresa hoje, o que teria de pagar?</b> Escolha o tratamento de cada categoria.</div>
              <div style="overflow-x:auto;max-height:420px;"><table class="cp-tab"><thead><tr><th>Categoria</th><th>Tratamento</th><th class="num">Em aberto</th><th class="num">Entra no passivo</th><th class="num">Fica fora</th></tr></thead><tbody>
              ${(() => { const porCat = {}; B.linhas.forEach(l => { const g = l.p.cat || 'Sem categoria'; porCat[g] = porCat[g] || { ab: 0, en: 0, fo: 0 }; const v = Number(l.p.val) || 0; porCat[g].ab += v; if(l.entra) porCat[g].en += v; else porCat[g].fo += v; });
                return Object.entries(porCat).sort((a, b) => b[1].ab - a[1].ab).map(([g, x]) => { const c = true, t = balTipoDe(g);
                  return `<tr><td><b>${blEsc(g)}</b></td><td>${c ? `<select onchange="balTipo('${blEsc(g).replace(/'/g, '&#39;')}', this.value)" style="width:auto;">${BAL_TRAT.map(o => `<option value="${o[0]}" ${t === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>` : 'Despesa'}</td><td class="num">${fmt(x.ab)}</td><td class="num"><b>${fmt(x.en)}</b></td><td class="num text-muted">${fmt(x.fo)}</td></tr>`; }).join(''); })()}
              </tbody></table></div></div>` : ''}
            ${bal.conta ? `<div class="text-muted bal-nota" style="font-size:12px;margin-top:14px;line-height:1.5;">Visão de <b>${blEsc(nomeConta)}</b>: caixa, contas a pagar, Full e a receber são só dessa loja. O galpão entra conforme as lojas marcadas em Configurar estoque → Depósitos.</div>` : ''}
          </div>
        </div>`;
    }
    function balTipo(nome, tipo){
      comprasCfg.balanco = comprasCfg.balanco || {}; comprasCfg.balanco.tipos = comprasCfg.balanco.tipos || {};
      comprasCfg.balanco.tipos[blN(nome)] = tipo;
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
      balDesenhar();
    }

    function balLinhas(){
      const B = balCalcular(), nome = bal.conta ? ((typeof contaNome === 'function' && contaNome(bal.conta)) || bal.conta) : 'Todas as lojas';
      const ativo = [['Caixa e bancos', B.caixa], ['A receber do Mercado Livre', B.receber], ['Estoque no galpão', B.galpao], ['Estoque no Full', B.full]].concat(B.caminhoFull ? [['A caminho do Full', B.caminhoFull]] : []);
      const passivo = Object.entries(B.grupos).sort((a, b) => b[1] - a[1]);
      return { B, nome, ativo, passivo };
    }
    function balExportar(){
      const { B, nome, ativo, passivo } = balLinhas();
      const r = v => Math.round(v * 100) / 100, pc = (v, t) => t ? Math.round(v / t * 10000) / 10000 : 0;
      const n = Math.max(ativo.length, passivo.length);
      const linhas = [['BALANÇO PATRIMONIAL GERENCIAL'], [nome + ' · posição de ' + ptDate(getToday())], [], ['ATIVO', 'Valor', '% do ativo', '', 'PASSIVO', 'Valor', '% do passivo']];
      for(let i = 0; i < n; i++){ const a = ativo[i], p = passivo[i]; linhas.push([a ? a[0] : '', a ? r(a[1]) : '', a ? pc(a[1], B.ativo) : '', '', p ? p[0] : '', p ? r(p[1]) : '', p ? pc(p[1], B.passivo) : '']); }
      linhas.push(['Total do ativo', r(B.ativo), 1, '', 'Total do passivo', r(B.passivo), 1], [], ['PATRIMÔNIO LÍQUIDO (ativo − passivo)', r(B.pl)], [], ['Não substitui o balanço contábil. Estoques a custo médio; passivo conforme o tratamento escolhido para cada categoria.']);
      const ws = XLSX.utils.aoa_to_sheet(linhas);
      ws['!cols'] = [{ wch: 38 }, { wch: 18 }, { wch: 13 }, { wch: 4 }, { wch: 44 }, { wch: 18 }, { wch: 13 }];
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }];
      Object.keys(ws).forEach(k => { if(k[0] === '!') return; const c = ws[k]; if(c.t !== 'n') return; c.z = /^[CG]/.test(k) ? '0.0%' : '"R$" #,##0.00'; });
      const contasCl = B.linhas.map(l => ({ 'Vencimento': ptDate(l.p.data), 'Descrição': l.p.desc, 'Fornecedor': l.p.forn, 'Categoria': l.p.cat, 'Valor': r(Number(l.p.val) || 0), 'Entra no passivo?': l.entra ? 'Sim' : 'Não', 'Tratamento': l.motivo }));
      const ws2 = XLSX.utils.json_to_sheet(contasCl);
      ws2['!cols'] = [{ wch: 12 }, { wch: 50 }, { wch: 34 }, { wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 40 }];
      Object.keys(ws2).forEach(k => { if(/^E\d+$/.test(k) && ws2[k].t === 'n') ws2[k].z = '"R$" #,##0.00'; });
      if(contasCl.length) ws2['!autofilter'] = { ref: 'A1:G' + (contasCl.length + 1) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Balanço');
      XLSX.utils.book_append_sheet(wb, ws2, 'Contas classificadas');
      XLSX.writeFile(wb, 'balanco_' + String(nome).toLowerCase().replace(/\s+/g, '_') + '_' + getToday() + '.xlsx');
    }
    // Balanço em PDF (uma página, pronto para imprimir)
    async function balPdf(bt){
      const rot = bt ? bt.textContent : ''; if(bt){ bt.disabled = true; bt.textContent = 'Gerando…'; }
      try {
        const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem conexão')); document.head.appendChild(s); });
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        const { B, nome, ativo, passivo } = balLinhas();
        const n2 = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), pc = (v, t) => t ? (v / t * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '';
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), L = doc.internal.pageSize.getWidth();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Balanço patrimonial gerencial', 40, 52);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100); doc.text(nome + '  ·  posição de ' + ptDate(getToday()), 40, 70);
        // três números do topo
        const cx = [[ 'Ativo', B.ativo, [22, 163, 74] ], [ 'Passivo', B.passivo, [220, 38, 38] ], [ 'Patrimônio líquido', B.pl, [79, 70, 229] ]], w = (L - 80 - 20) / 3;
        cx.forEach((c, i) => { const x = 40 + i * (w + 10); doc.setDrawColor(225); doc.setFillColor(248, 249, 252); doc.roundedRect(x, 86, w, 54, 6, 6, 'FD'); doc.setFillColor(...c[2]); doc.rect(x, 86, 4, 54, 'F');
          doc.setFontSize(9); doc.setTextColor(110); doc.text(c[0].toUpperCase(), x + 14, 104); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20); doc.text(n2(c[1]), x + 14, 126); doc.setFont('helvetica', 'normal'); });
        const tab = (titulo, linhas, total, rotTotal, y, cor) => { doc.autoTable({ startY: y, margin: { left: 40, right: 40 }, head: [[titulo, 'Valor', '%']], body: linhas.map(l => [l[0], n2(l[1]), pc(l[1], total)]), foot: [[rotTotal, n2(total), '100%']],
          styles: { fontSize: 10, cellPadding: 6 }, headStyles: { fillColor: cor, textColor: 255 }, footStyles: { fillColor: [240, 241, 246], textColor: 20, fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', cellWidth: 60 } }, showFoot: 'lastPage' }); return doc.lastAutoTable.finalY; };
        let y = tab('Ativo — o que a empresa tem', ativo, B.ativo, 'Total do ativo', 158, [22, 163, 74]);
        y = tab('Passivo — o que já é devido', passivo.length ? passivo : [['Nenhuma conta devida', 0]], B.passivo, 'Total do passivo', y + 18, [220, 38, 38]);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20); doc.text('Patrimônio líquido (ativo − passivo): ' + n2(B.pl), 40, y + 30);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(120);
        doc.text(doc.splitTextToSize('Não substitui o balanço contábil. Estoques a custo médio (' + Math.round(B.galpaoUn + B.fullUn).toLocaleString('pt-BR') + ' unidades). Ficaram fora do passivo ' + n2(B.fora) + ' de contas que ainda vão vencer ou de categorias fora do balanço. Gerado pelo Caixa 360 em ' + new Date().toLocaleString('pt-BR') + '.', L - 80), 40, y + 50);
        doc.save('balanco_' + String(nome).toLowerCase().replace(/\s+/g, '_') + '_' + getToday() + '.pdf');
      } catch(e){ if(typeof toast === 'function') toast('Não consegui gerar o PDF: ' + ((e && e.message) || e)); }
      if(bt){ bt.disabled = false; bt.textContent = rot; }
    }
