// ===== BALANÇO PATRIMONIAL GERENCIAL =====
// Mesmos critérios do módulo "Balanço e Compras" do Jonathan, com os dados que o Caixa 360 já tem:
//   ATIVO   = caixa e bancos (saldos informados) + a receber confirmado do Mercado Livre
//             + estoque a custo (galpão + Full + o que saiu do galpão e o Full ainda não recebeu)
//   PASSIVO = só o que já é devido na data: tudo que venceu, mais as parcelas futuras do que é DÍVIDA
//             (amortização de empréstimo, compra de mercadoria, imposto apurado). Despesa futura e juros futuros ficam fora.
// Quem é dívida e quem é despesa vem da categoria (Configurações → Categorias, coluna "Tipo passivo").
// Filtro por loja: "as duas" soma tudo; uma loja mostra o estoque dos produtos que ELA vende (o galpão é
// repartido pela venda de cada loja nos últimos 90 dias), o Full e o a receber dela. Caixa e dívidas não são
// separados por loja (toda dívida financia a operação inteira).
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
      const hoje = getToday(), conta = bal.conta;
      const part = balParticipacao(), fatia = k => { if(!conta) return 1; const o = part.get(k); if(!o) return 0; const t = Object.values(o).reduce((s, v) => s + v, 0); return t > 0 ? (o[conta] || 0) / t : 0; };
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
      const ativo = caixa + receber + galpao + full + caminhoFull;

      // PASSIVO
      const linhas = pagamentos.filter(p => !p.pago).map(p => { const t = balTipoDe(p.cat || ''), vencida = p.data <= hoje; return { p, t, entra: vencida || t === 'divida', motivo: vencida ? 'já venceu' : t === 'divida' ? 'dívida a vencer' : 'despesa futura (fora)' }; });
      const grupos = {};
      linhas.filter(l => l.entra).forEach(l => { const g = l.p.cat || 'Sem categoria'; grupos[g] = (grupos[g] || 0) + (Number(l.p.val) || 0); });
      const passivo = Object.values(grupos).reduce((s, v) => s + v, 0);
      const fora = linhas.filter(l => !l.entra).reduce((s, l) => s + (Number(l.p.val) || 0), 0);
      return { caixa, receber, galpao, galpaoUn, full, fullUn, caminhoFull, ativo, grupos, passivo, fora, pl: ativo - passivo, linhas, semCusto };
    }

    async function renderBalanco(){
      const view = document.getElementById('view-patrimonio'); if(!view) return;
      let host = document.getElementById('bal-host');
      if(!host){ host = document.createElement('div'); host.id = 'bal-host'; const ref = view.children[1] || null; view.insertBefore(host, ref); }
      // a tela antiga (índice de cobertura, cenários de liquidação) usava outra conta e contradizia o balanço: fica escondida
      [...view.children].forEach((el, i) => { if(i > 0 && el.id !== 'bal-host') el.style.display = 'none'; });
      const snap = view.querySelector('button[onclick="salvarSnapshotPatrimonio()"]'); if(snap) snap.style.display = 'none';
      balClassificarCategorias();
      // dados que o balanço usa: estoque (movimentações), Full (API), envios e a venda por loja
      try {
        if(typeof estCarregar === 'function') await estCarregar(false);
        if(typeof esoLer === 'function') await esoLer(false);
        if(typeof comprasCarregarVendas === 'function' && !(comprasVendas && comprasVendas.dados)) await comprasCarregarVendas(false);
        if((!Array.isArray(estoqueFullML) || !estoqueFullML.length) && typeof comprasFullAPI === 'function') await comprasFullAPI();
      } catch(e){}
      balDesenhar();
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
            <div class="chips">${[['', contas.length > 1 ? 'As duas lojas' : 'Tudo']].concat(contas.length > 1 ? contas.map(c => [String(c.id), 'Só ' + (c.apelido || c.id)]) : []).map(([k, t]) => `<button class="chip ${bal.conta === k ? 'active' : ''}" onclick="bal.conta='${k}';balDesenhar();">${blEsc(t)}</button>`).join('')}
              <button class="chip" onclick="balExportar()">Exportar</button></div>
          </div>
          <div class="card-body">
            <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));">
              <div class="kpi k-mc"><div class="kpi-label">Ativo</div><div class="kpi-value">${fmt(B.ativo)}</div><div class="kpi-sub">o que a empresa tem</div></div>
              <div class="kpi k-atraso"><div class="kpi-label">Passivo</div><div class="kpi-value">${fmt(B.passivo)}</div><div class="kpi-sub">o que já é devido</div></div>
              <div class="kpi ${B.pl >= 0 ? 'k-venda' : 'k-atraso'}"><div class="kpi-label">Patrimônio líquido</div><div class="kpi-value">${fmt(B.pl)}</div><div class="kpi-sub">ativo menos passivo</div></div>
            </div>
            ${bal.conta ? `<div class="alert alert-info">Visão de <b>&nbsp;${blEsc(nomeConta)}&nbsp;</b>: o estoque é o dos produtos que essa loja vende (o galpão é repartido pela venda de cada loja em 90 dias), mais o Full e o a receber dela. Caixa e dívidas não são separados por loja.</div>` : ''}
            <div class="bl-cols">
              <div><div class="bl-tit">Ativo</div>
                ${lin('Caixa e bancos', B.caixa, 'saldos informados no Painel financeiro')}
                ${lin('A receber do Mercado Livre', B.receber, 'liberações já confirmadas')}
                ${lin('Estoque no galpão', B.galpao, un(B.galpaoUn) + ' a custo médio')}
                ${lin('Estoque no Full', B.full, un(B.fullUn) + ', kits abertos nos componentes')}
                ${B.caminhoFull ? lin('A caminho do Full', B.caminhoFull, 'saiu do galpão, o Mercado Livre ainda não recebeu') : ''}
                <div class="bl-lin bl-tot"><span>Total do ativo</span><b>${fmt(B.ativo)}</b></div>
                ${B.semCusto ? `<div class="text-muted" style="font-size:12px;margin-top:6px;">${B.semCusto} produtos com estoque e sem custo entram valendo zero.</div>` : ''}
              </div>
              <div><div class="bl-tit">Passivo</div>
                ${gr.length ? gr.map(([g, v]) => lin(blEsc(g), v)).join('') : '<div class="text-muted" style="padding:10px 0;">Nenhuma conta devida.</div>'}
                <div class="bl-lin bl-tot"><span>Total do passivo</span><b>${fmt(B.passivo)}</b></div>
                <div class="text-muted" style="font-size:12px;margin-top:6px;">Ficaram de fora ${fmt(B.fora)} de despesas e juros que ainda vão vencer. <a class="fx-link" style="color:var(--primary);" onclick="bal.aberto=!bal.aberto;balDesenhar();">${bal.aberto ? 'Esconder' : 'Ver'} as contas classificadas</a></div>
              </div>
            </div>
            ${bal.aberto ? `<div style="margin-top:14px;"><div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">Cada categoria é <b>dívida</b> (parcelas futuras entram) ou <b>despesa</b> (só entra o que já venceu). Troque aqui se alguma estiver errada.</div>
              <div style="overflow-x:auto;max-height:420px;"><table class="cp-tab"><thead><tr><th>Categoria</th><th>Tratamento</th><th class="num">Em aberto</th><th class="num">Entra no passivo</th><th class="num">Fica fora</th></tr></thead><tbody>
              ${(() => { const porCat = {}; B.linhas.forEach(l => { const g = l.p.cat || 'Sem categoria'; porCat[g] = porCat[g] || { ab: 0, en: 0, fo: 0 }; const v = Number(l.p.val) || 0; porCat[g].ab += v; if(l.entra) porCat[g].en += v; else porCat[g].fo += v; });
                return Object.entries(porCat).sort((a, b) => b[1].ab - a[1].ab).map(([g, x]) => { const c = true, t = balTipoDe(g);
                  return `<tr><td><b>${blEsc(g)}</b></td><td>${c ? `<select onchange="balTipo('${blEsc(g).replace(/'/g, '&#39;')}', this.value)" style="width:auto;"><option value="divida" ${t === 'divida' ? 'selected' : ''}>Dívida: parcelas futuras entram</option><option value="operacional" ${t !== 'divida' ? 'selected' : ''}>Despesa: só o que já venceu</option></select>` : 'Despesa'}</td><td class="num">${fmt(x.ab)}</td><td class="num"><b>${fmt(x.en)}</b></td><td class="num text-muted">${fmt(x.fo)}</td></tr>`; }).join(''); })()}
              </tbody></table></div></div>` : ''}
          </div>
        </div>`;
    }
    function balTipo(nome, tipo){
      comprasCfg.balanco = comprasCfg.balanco || {}; comprasCfg.balanco.tipos = comprasCfg.balanco.tipos || {};
      comprasCfg.balanco.tipos[blN(nome)] = tipo;
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
      balDesenhar();
    }

    function balExportar(){
      const B = balCalcular(), nome = bal.conta ? ((typeof contaNome === 'function' && contaNome(bal.conta)) || bal.conta) : 'consolidado';
      const r = v => Math.round(v * 100) / 100;
      const linhas = [['BALANÇO PATRIMONIAL GERENCIAL', nome, ptDate(getToday())], [], ['ATIVO', ''], ['Caixa e bancos', r(B.caixa)], ['A receber do Mercado Livre', r(B.receber)], ['Estoque no galpão', r(B.galpao)], ['Estoque no Full', r(B.full)], ['A caminho do Full', r(B.caminhoFull)], ['Total do ativo', r(B.ativo)], [], ['PASSIVO', '']]
        .concat(Object.entries(B.grupos).sort((a, b) => b[1] - a[1]).map(([g, v]) => [g, r(v)]), [['Total do passivo', r(B.passivo)], [], ['PATRIMÔNIO LÍQUIDO', r(B.pl)]]);
      const contasCl = B.linhas.map(l => ({ 'Vencimento': l.p.data, 'Descrição': l.p.desc, 'Fornecedor': l.p.forn, 'Categoria': l.p.cat, 'Valor': r(Number(l.p.val) || 0), 'Tratamento': l.motivo }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Balanço');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contasCl), 'Contas classificadas');
      XLSX.writeFile(wb, 'balanco_' + String(nome).toLowerCase().replace(/\s+/g, '_') + '_' + getToday() + '.xlsx');
    }
