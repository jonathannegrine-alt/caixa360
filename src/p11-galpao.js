// ===== ESTOQUE GALPAO ABA =====
    function renderEstoqueGalpaoAbaTab(){
      const vazio = document.getElementById('estoque-galpao-aba-vazio');
      const card = document.getElementById('estoque-galpao-aba-card');
      const btnExp = document.getElementById('btn-export-galpao');
      const st = document.getElementById('estoque-galpao-aba-status');
      if(!vazio || !card) return;
      if(estoqueGalpao.length === 0){
        vazio.style.display = '';
        card.style.display = 'none';
        if(btnExp) btnExp.style.display = 'none';
        return;
      }
      vazio.style.display = 'none';
      card.style.display = '';
      if(btnExp) btnExp.style.display = '';
      const tbody = document.getElementById('tbody-estoque-galpao-aba');
      if(!tbody) return;
      const rows = estoqueGalpao.slice().sort((a,b) => (a.sku||'').localeCompare(b.sku||''));
      let totalCapital = 0;
      tbody.innerHTML = rows.map(e => {
        const qtd = e.qtd_galpao || 0;
        // Custo: somente do cadastro de Produtos (skus[] ou custo_kit do kit)
        const skuProd = skus.find(function(s){ return s.sku === e.sku; });
        const kitEntry = composicaoKit.find(function(c){ return c.sku_comercial === e.sku; });
        const custo = skuProd && skuProd.custo > 0 ? skuProd.custo
                    : kitEntry && kitEntry.custo_kit > 0 ? kitEntry.custo_kit : 0;
        const custoSrc = custo > 0 ? 'title="Custo do cadastro de Produtos"' : 'title="Sem custo cadastrado"';
        const total = qtd * custo;
        totalCapital += total;
        const dt = e.data_atualizacao ? e.data_atualizacao.substring(0,10) : '-';
        const skuId = (e.sku||'').replace(/[^a-zA-Z0-9]/g,'-');
        return `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:7px 10px;white-space:nowrap;font-family:monospace;font-size:11px;">${e.sku||''}</td>
          <td style="padding:7px 6px;color:#374151;">${e.descricao||'-'}</td>
          <td id="qty-g-${skuId}" data-sku="${e.sku||''}" style="padding:7px 6px;text-align:right;font-weight:600;cursor:pointer;" title="Clique para editar" onclick="editarQtdGalpao(this.dataset.sku,${qtd})">${qtd}</td>
          <td style="padding:7px 6px;text-align:right;" ${custoSrc}>${custo > 0 ? 'R$ ' + custo.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '-'}</td>
          <td style="padding:7px 6px;text-align:right;">${total > 0 ? 'R$ ' + total.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '-'}</td>
          <td style="padding:7px 6px;text-align:right;font-size:11px;color:#94a3b8;">${dt}</td>
        </tr>`;
      }).join('');
      makeSortable('tbody-estoque-galpao-aba');
      initResizableCols('tbody-estoque-galpao-aba');
      if(st){
        st.textContent = `${estoqueGalpao.length} SKUs — Capital total: R$ ${totalCapital.toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
      }
    }

    function editarQtdGalpao(sku, qtdAtual){
      var skuId = sku.replace(/[^a-zA-Z0-9]/g,'-');
      var cell = document.getElementById('qty-g-'+skuId);
      if(!cell || cell.querySelector('input')) return;
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.value = qtdAtual;
      inp.min = '0';
      inp.style.cssText = 'width:60px;text-align:right;border:1px solid var(--primary);border-radius:4px;padding:2px 4px;';
      inp.addEventListener('blur', function(){ salvarQtdGalpao(sku, this.value); });
      inp.addEventListener('keydown', function(e){ if(e.key==='Enter')this.blur(); if(e.key==='Escape')renderEstoqueGalpaoAbaTab(); });
      inp.addEventListener('click', function(e){ e.stopPropagation(); });
      cell.innerHTML = '';
      cell.appendChild(inp);
      inp.focus();
      inp.select();
    }

    function salvarQtdGalpao(sku, novaQtd){
      var val = parseInt(novaQtd);
      if(isNaN(val) || val < 0){ renderEstoqueGalpaoAbaTab(); return; }
      var idx = estoqueGalpao.findIndex(function(e){ return e.sku===sku; });
      if(idx >= 0){
        estoqueGalpao[idx].qtd_galpao = val;
        estoqueGalpao[idx].data_atualizacao = new Date().toISOString().slice(0,10);
      }
      salvar();
      renderEstoqueGalpaoAbaTab();
    }
    function exportarEstoqueGalpaoCSV(){
      if(estoqueGalpao.length === 0){ alert('Nada para exportar.'); return; }
      const esc = s => (String(s||'')).replace(/;/g,'|');
      const header = 'sku;descricao;qtd_galpao;custo;valor_total;data_atualizacao';
      const linhas = estoqueGalpao.map(e => {
        const sp = skus.find(s => s.sku === e.sku);
        const kc = composicaoKit.find(c => c.sku_comercial === e.sku);
        const custo = sp && sp.custo > 0 ? sp.custo : (kc && kc.custo_kit > 0 ? kc.custo_kit : 0);
        return [esc(e.sku), esc(e.descricao), e.qtd_galpao||0, custo.toFixed(2).replace('.',','), ((e.qtd_galpao||0)*custo).toFixed(2).replace('.',','), e.data_atualizacao||''].join(';');
      });
      const blob = new Blob(['\uFEFF' + header + '\n' + linhas.join('\n')], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'estoque_galpao_' + getToday() + '.csv';
      a.click();
    }

    function baixarTemplateGalpao(){
      const csv = 'SKU,Descricao,Quantidade,Custo_unitario\n' +
        'J-2001,Vaso de Barro Pequeno,50,12.50\n' +
        'J-2005,Vaso Grande Ceramica,30,25.00\n';
      const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'modelo_inventario_galpao.csv';
      a.click();
    }

    function importarGalpaoCSV(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = function(e){
        try {
          const text = e.target.result;
          const sep = text.indexOf(';') > text.indexOf(',') ? ';' : ',';
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          let adicionados = 0, atualizados = 0;
          const hoje = dateStr(getToday());
          lines.forEach(function(line, idx){
            const cols = line.split(sep).map(function(c){ return c.trim().replace(/^["'"]|["'"]$/g,''); });
            if(idx === 0 && isNaN(parseInt(cols[2]))) return; // pular header
            const sku = (cols[0]||'').toUpperCase().trim();
            if(!sku) return;
            const descricao = cols[1]||'';
            const qtd = parseInt(cols[2]) || 0;
            const custo = parseFloat((cols[3]||'0').replace(',','.')) || 0;
            const entry = { sku, descricao, qtd_galpao: qtd, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: custo, data_atualizacao: hoje };
            if(custo > 0){
              const skuIdx = skus.findIndex(function(s){ return s.sku === sku; });
              if(skuIdx >= 0){ if(!skus[skuIdx].custo) skus[skuIdx].custo = custo; }
              else { skus.push({ sku, titulo: descricao, custo, imposto: 0 }); }
            }
            const existente = estoqueGalpao.findIndex(function(eg){ return eg.sku === sku; });
            if(existente >= 0){ Object.assign(estoqueGalpao[existente], entry); atualizados++; }
            else { estoqueGalpao.push(entry); adicionados++; }
          });
          salvar();
          renderEstoqueGalpaoAbaTab();
          alert('Importação concluída: ' + adicionados + ' adicionados, ' + atualizados + ' atualizados.');
        } catch(ex){ alert('Erro ao importar CSV: ' + ex.message); }
        input.value = '';
      };
      reader.readAsText(file, 'UTF-8');
    }

    function atualizarStatusBarEstoque(){
      const bar = document.getElementById('estoque-status-bar');
      const txt = document.getElementById('estoque-status-text');
      if(!bar || !txt) return;
      const partes = [];
      if(vendasSku.length > 0) partes.push(`📊 ${vendasSku.length} SKUs de vendas`);
      if(estoqueGalpao.length > 0){
        const dt = estoqueGalpao[0] && estoqueGalpao[0].data_atualizacao;
        const dias = dt ? Math.floor((new Date() - new Date(dt)) / 86400000) : null;
        const al = (dias !== null && dias > 7) ? ` ⚠️ ${dias}d atrás` : '';
        partes.push(`📦 ${estoqueGalpao.length} componentes no galpão${al}`);
      }
      if(composicaoKit.length > 0){
        const k = [...new Set(composicaoKit.map(c => c.sku_comercial))].length;
        partes.push(`🔗 ${k} kits mapeados`);
      }
      bar.style.display = partes.length ? '' : 'none';
      txt.textContent = partes.join('  ·  ');
    }

    // ----- Cálculo -----
    // Retorna Set dos SKU isolados (físicos/componentes).
    // Fonte: estoqueGalpao (Upseller = somente isolados) + componentes[], excluindo sku_comercial de composicaoKit.
    // Se ambos vazios: retorna Set vazio (caller filtra somente por !skusKit).
    function getSkusIsolados(){
      const kitSkus = new Set(composicaoKit.map(c => c.sku_comercial.toUpperCase()));
      const s = new Set();
      estoqueGalpao.forEach(e => { if(!kitSkus.has(e.sku.toUpperCase())) s.add(e.sku.toUpperCase()); });
      componentes.forEach(c => { if(!kitSkus.has(c.codigo.toUpperCase())) s.add(c.codigo.toUpperCase()); });
      return { isolados: s, kitSkus };
    }

    function calcConsumoComponentes(){
      const consumo = {};
      const dias = vendasSku.length > 0 ? (vendasSku[0].periodo_dias || 30) : 30;

      // skusKitU = SKUs comerciais de kits (sku_comercial em composicaoKit), em uppercase
      const skusKitU = new Set(composicaoKit.map(c => c.sku_comercial.toUpperCase()));

      // 1. Consumo via kits (case-insensitive + dedup de pares kit→componente duplicados)
      const kitCompSeen = new Set();
      vendasSku.forEach(v => {
        const vU = v.sku.toUpperCase();
        composicaoKit.filter(c => c.sku_comercial.toUpperCase() === vU).forEach(c => {
          const pairKey = vU + '|' + c.sku_componente.toUpperCase();
          if(kitCompSeen.has(pairKey)) return;  // ignora entrada duplicada
          kitCompSeen.add(pairKey);
          const compU = c.sku_componente.toUpperCase();
          consumo[compU] = (consumo[compU] || 0) + v.unidades * c.qty;
        });
      });

      // 2. Vendas diretas: qualquer SKU que não seja um kit comercial
      // (não restringe a estoqueGalpao/componentes/skus — qualquer produto vendido conta)
      vendasSku.forEach(v => {
        const vU = v.sku.toUpperCase();
        if(!skusKitU.has(vU)){
          consumo[vU] = (consumo[vU] || 0) + v.unidades;
        }
      });

      const result = {};
      Object.keys(consumo).forEach(sku => {
        result[sku] = { consumo30d: consumo[sku], consumo_diario: consumo[sku] / dias };
      });
      return result;
    }

    function calcCustoComposicao(sku_comercial){
      const comps = composicaoKit.filter(c => c.sku_comercial === sku_comercial);
      if(comps.length > 0){
        // Se custo_kit preenchido diretamente, usa ele (prevalece sobre soma de componentes)
        const custoKit = comps[0].custo_kit || 0;
        if(custoKit > 0) return custoKit;
        return comps.reduce((s, c) => {
          const eg = estoqueGalpao.find(e => e.sku === c.sku_componente);
          const comp = componentes.find(x => x.codigo === c.sku_componente);
          const cu = (eg && eg.custo_medio > 0) ? eg.custo_medio : (comp ? comp.custo_unitario : 0);
          return s + cu * c.qty;
        }, 0);
      }
      // SKU isolado sem composição: buscar custo direto
      const skuEntry = skus.find(s => s.sku === sku_comercial);
      if(skuEntry && skuEntry.custo > 0) return skuEntry.custo;
      const eg = estoqueGalpao.find(e => e.sku === sku_comercial);
      if(eg && eg.custo_medio > 0) return eg.custo_medio;
      const comp = componentes.find(c => c.codigo === sku_comercial);
      if(comp && comp.custo_unitario > 0) return comp.custo_unitario;
      return 0;
    }

    function getMetaComp(sku){
      const mc = metaComp[sku] || {};
      return {
        meta_full:    mc.meta_full    !== undefined ? mc.meta_full    : metaFullDias,
        meta_galpao:  mc.meta_galpao  !== undefined ? mc.meta_galpao  : metaGalpaoDias,
        seg:          mc.seg          !== undefined ? mc.seg          : diasSeguranca,
        alerta:       mc.alerta       !== undefined ? mc.alerta       : alertaCriticoDias
      };
    }

    function calcKitsMontaveis(sku_comercial){
      const comps = composicaoKit.filter(c => c.sku_comercial === sku_comercial);
      if(comps.length === 0) return 0;
      return Math.min(...comps.map(c => {
        const eg = estoqueGalpao.find(e => e.sku === c.sku_componente);
        return eg ? Math.floor((eg.qtd_galpao||0) / c.qty) : 0;
      }));
    }

    function calcRankingPorProduto(incluirExcesso = false){
      const kitSkus = new Set(composicaoKit.map(c => c.sku_comercial));
      const dias = vendasSku.length > 0 ? (vendasSku[0].periodo_dias || 30) : 30;
      const periodoOrig = vendasImportMeta.periodoOriginal || dias;
      const escala = periodoOrig > 0 ? dias / periodoOrig : 1;
      const produtosComVendas = new Set(vendasSku.map(v => v.sku));

      const produtos = [
        ...vendasSku.map(v => ({ sku: v.sku, descricao: v.titulo||'', unidades: Math.round(v.unidades*escala), isKit: kitSkus.has(v.sku) })),
        ...skus.filter(s => !produtosComVendas.has(s.sku)).map(s => ({ sku: s.sku, descricao: s.titulo||s.sku||'', unidades: 0, isKit: kitSkus.has(s.sku) })),
      ];

      return produtos.map(p => {
        const consumo_diario = dias > 0 ? p.unidades / dias : 0;
        const regras = getMetaComp(p.sku);
        const meta_total = regras.meta_full + regras.meta_galpao;
        const qtd_galpao = p.isKit ? calcKitsMontaveis(p.sku) : (estoqueGalpao.find(e=>e.sku===p.sku)||{}).qtd_galpao||0;
        const fullEntry = estoqueFullML.find(e => e.sku.toUpperCase() === p.sku.toUpperCase());
        const qtd_full = fullEntry ? (fullEntry.aptos_venda||0) : 0;
        const qtd_full_pendente = fullEntry ? (fullEntry.em_transito||0) : 0;
        const qtd_total = qtd_galpao + qtd_full;
        const cobertura = consumo_diario > 0 ? qtd_total / consumo_diario : Infinity;
        const kitComps = composicaoKit.filter(c => c.sku_comercial === p.sku);
        const custoKit = kitComps.length > 0 && kitComps[0].custo_kit > 0 ? kitComps[0].custo_kit : 0;
        const skuEntry = skus.find(s => s.sku === p.sku);
        const custo = custoKit > 0 ? custoKit : (skuEntry && skuEntry.custo > 0 ? skuEntry.custo : 0);
        const deficit_dias = Math.max(0, meta_total + regras.seg - cobertura);
        const qtd_sugerida = consumo_diario > 0 ? Math.ceil(deficit_dias * consumo_diario) : 0;
        let data_ruptura = null;
        if(consumo_diario > 0 && cobertura < 9999){ const d = new Date(); d.setDate(d.getDate()+Math.floor(cobertura)); data_ruptura = d; }
        let status = 'ok';
        if(cobertura !== Infinity && cobertura > 180) status = 'excesso_critico';
        else if(cobertura !== Infinity && cobertura > 120) status = 'excesso_mod';
        else if(cobertura < regras.alerta) status = 'critico';
        else if(cobertura < meta_total) status = 'atencao';
        return { sku: p.sku, descricao: p.descricao, isKit: p.isKit, consumo_diario, qtd_galpao, qtd_full, qtd_full_pendente, qtd_total, cobertura, data_ruptura, meta_full: regras.meta_full, meta_galpao: regras.meta_galpao, meta_total, alerta: regras.alerta, status, qtd_sugerida, capital_necessario: qtd_sugerida*custo, custo_unitario: custo };
      }).filter(r => incluirExcesso || !['excesso_critico','excesso_mod'].includes(r.status)).sort((a,b) => a.cobertura - b.cobertura);
    }

    function calcRankingReposicao(){
      const consumo = calcConsumoComponentes();
      const { isolados, kitSkus } = getSkusIsolados();
      // Base: estoqueGalpao filtrado para isolados apenas (Upseller = só isolados)
      const egFiltrado = isolados.size > 0
        ? estoqueGalpao.filter(eg => isolados.has(eg.sku))
        : estoqueGalpao.filter(eg => !kitSkus.has(eg.sku));
      // Fallback: skus[] cadastrados (sem kits), enriquecidos com descricao de componentes/estoqueGalpao
      const base = egFiltrado.length > 0 ? egFiltrado
        : skus.filter(s => !kitSkus.has(s.sku)).map(s => {
            const desc = s.titulo
              || (componentes.find(c => c.codigo === s.sku)||{}).descricao
              || (estoqueGalpao.find(e => e.sku === s.sku)||{}).descricao || '';
            return { sku: s.sku, descricao: desc, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: s.custo };
          });
      return base.map(eg => {
        const c = consumo[eg.sku] || { consumo_diario: 0, consumo30d: 0 };
        const regras = getMetaComp(eg.sku);
        const meta_total = regras.meta_full + regras.meta_galpao;
        // Usar apenas estoque DISPONÍVEL (não conta pendente) para cobertura
        const qtd_full_disp = eg.qtd_full || 0;
        const qtd_total = (eg.qtd_galpao || 0) + qtd_full_disp;
        const cobertura = c.consumo_diario > 0 ? qtd_total / c.consumo_diario : Infinity;
        const comp = componentes.find(x => x.codigo === eg.sku);
        const custo = (eg.custo_medio > 0) ? eg.custo_medio : (comp ? comp.custo_unitario : 0);
        const deficit_dias = Math.max(0, meta_total + regras.seg - cobertura);
        const qtd_sugerida = c.consumo_diario > 0 ? Math.ceil(deficit_dias * c.consumo_diario) : 0;
        let data_ruptura = null;
        if(c.consumo_diario > 0 && cobertura < 9999){
          const d = new Date(); d.setDate(d.getDate() + Math.floor(cobertura));
          data_ruptura = d;
        }
        let status = 'ok';
        if(cobertura !== Infinity && cobertura > 180) status = 'excesso_critico';
        else if(cobertura !== Infinity && cobertura > 120) status = 'excesso_mod';
        else if(cobertura < regras.alerta) status = 'critico';
        else if(cobertura < meta_total) status = 'atencao';
        return {
          sku: eg.sku, descricao: eg.descricao,
          consumo_diario: c.consumo_diario, consumo30d: c.consumo30d,
          qtd_galpao: eg.qtd_galpao || 0,
          qtd_full: qtd_full_disp,
          qtd_full_pendente: eg.qtd_full_pendente || 0,
          qtd_total, em_transito: eg.em_transito || 0,
          cobertura, data_ruptura, meta_full: regras.meta_full, meta_galpao: regras.meta_galpao, meta_total,
          seg: regras.seg, alerta: regras.alerta, status,
          qtd_sugerida, capital_necessario: qtd_sugerida * custo, custo_unitario: custo,
          data_atualizacao: eg.data_atualizacao
        };
      }).sort((a, b) => a.cobertura - b.cobertura);
    }

    // ----- Renders -----
    function renderReposicaoTab(){
      verificarSkusNaoCadastrados();
      const tbody = document.getElementById('tbody-reposicao');
      const vazioEl = document.getElementById('estoque-reposicao-vazio');
      const cardEl = document.getElementById('estoque-reposicao-card');
      if(!tbody) return;
      const periodoOrig = vendasImportMeta.periodoOriginal || (vendasSku[0] ? (vendasSku[0].periodo_import || 30) : 30);
      const avisoRepEl = document.getElementById('rep-periodo-aviso');
      const extrapolando = vendasSku.length > 0 && repVendasDias > periodoOrig;
      const thVxd = document.getElementById('th-rep-vendas-xd');
      if(thVxd) thVxd.textContent = 'Vendas ' + repVendasDias + 'd' + (extrapolando ? ' ⚠' : '');
      const selDias = document.getElementById('rep-vendas-dias');
      if(selDias) selDias.value = String(repVendasDias);
      if(avisoRepEl){
        if(extrapolando){
          avisoRepEl.style.display = '';
          avisoRepEl.textContent = '⚠ O relatório importado tem apenas ' + periodoOrig + ' dias de dados. A coluna "Vendas ' + repVendasDias + 'd" é uma estimativa proporcional — importe um relatório de ' + repVendasDias + ' dias ou mais para dados reais.';
        } else {
          avisoRepEl.style.display = 'none';
        }
      }
      let ranking = calcRankingPorProduto();
      // Aplicar filtros
      const filtroInativ = parseInt(document.getElementById('rep-filtro-inatividade')?.value) || 0;
      const filtroMin = parseInt(document.getElementById('rep-filtro-min-vendas')?.value) || 0;
      const filtroCob = document.getElementById('rep-filtro-cob')?.value || 'todos';
      if(filtroInativ > 0) ranking = ranking.filter(r => r.consumo_diario > 0);
      if(filtroMin > 0) ranking = ranking.filter(r => (r.consumo_diario * 30) >= filtroMin);
      if(filtroCob !== 'todos'){ const maxD = parseInt(filtroCob); ranking = ranking.filter(r => r.cobertura !== Infinity && r.cobertura <= maxD); }
      const capitalTotal = ranking.filter(r => r.capital_necessario > 0).reduce((s,r) => s + r.capital_necessario, 0);
      const alertaEl = document.getElementById('estoque-alerta-capital');
      const capEl = document.getElementById('estoque-capital-total');
      if(alertaEl){ alertaEl.style.display = capitalTotal > 0 ? '' : 'none'; }
      if(capEl) capEl.textContent = fmt(capitalTotal);
      if(ranking.length === 0){
        if(vazioEl) vazioEl.style.display = '';
        if(cardEl) cardEl.style.display = 'none';
        return;
      }
      if(vazioEl) vazioEl.style.display = 'none';
      if(cardEl) cardEl.style.display = '';
      const skuId = s => s.replace(/[^a-zA-Z0-9]/g,'-');
      let html = '';
      ranking.forEach(r => {
        const tipoCritico = `Crítico: cobertura abaixo de ${r.alerta||alertaCriticoDias} dias`;
        const tipoAtencao = `Atenção: cobertura abaixo da meta ${r.meta_total||metaFullDias+metaGalpaoDias} dias`;
        const tipoSaudavel = `Saudável: cobertura na meta ou acima`;
        const sb = r.status === 'critico'
          ? `<span class="badge badge-danger" title="${tipoCritico}">🔴 Crítico</span>`
          : r.status === 'atencao'
          ? `<span class="badge badge-warning" title="${tipoAtencao}">🟡 Atenção</span>`
          : `<span class="badge badge-success" title="${tipoSaudavel}">🟢 Saudável</span>`;
        const cob = r.cobertura === Infinity ? '∞' : Math.floor(r.cobertura) + 'd';
        const rup = r.data_ruptura ? ptDate(r.data_ruptura.toISOString().slice(0,10)) : '—';
        const fullStr = r.qtd_full > 0
          ? (r.qtd_full_pendente > 0 ? `${r.qtd_full} <span style="font-size:10px;color:#999;">(+${r.qtd_full_pendente} pend.)</span>` : String(r.qtd_full))
          : (r.qtd_full_pendente > 0 ? `<span style="color:#999;font-size:10px;">+${r.qtd_full_pendente} pend.</span>` : '—');
        const metaStr = `${r.meta_full}d+${r.meta_galpao}d`;
        const vendasXd = Math.round(r.consumo_diario * repVendasDias);
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="text-align:center;padding:4px 6px;"><input type="checkbox" class="rep-sel-cb" data-sku="${r.sku}" onchange="updateOCBtn('rep')"></td>
          <td style="padding:8px 10px;font-family:monospace;font-size:11px;font-weight:600;white-space:nowrap;">${r.isKit?'🧩 ':''}${r.sku}</td>
          <td style="padding:8px 6px;color:#555;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${r.descricao}">${r.descricao||'—'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;">${vendasXd > 0 ? vendasXd : '—'}</td>
          <td style="padding:8px 6px;text-align:right;">${r.consumo_diario > 0 ? r.consumo_diario.toFixed(1) : '—'}</td>
          <td style="padding:8px 6px;text-align:right;" title="${r.isKit?'Kits montáveis com os componentes em galpão':'Qtd no galpão'}">${r.qtd_galpao}</td>
          <td style="padding:8px 6px;text-align:right;">${fullStr}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;">${r.qtd_total}</td>
          <td style="padding:8px 6px;text-align:right;">${cob}</td>
          <td style="padding:8px 6px;text-align:right;font-size:11px;${r.status==='critico'?'color:var(--danger);font-weight:600;':''}">${rup}</td>
          <td style="padding:8px 6px;text-align:center;font-size:10px;color:#888;">${metaStr}</td>
          <td style="padding:8px 6px;text-align:center;">${sb}</td>
          <td style="padding:8px 6px;text-align:right;">${r.qtd_sugerida > 0 ? r.qtd_sugerida : '—'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;${r.capital_necessario>0?'color:var(--danger);':''}">${r.capital_necessario > 0 ? fmt(r.capital_necessario) : '—'}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      makeSortable('tbody-reposicao', [10,11,12]);
      initResizableCols('tbody-reposicao');
    }

    function gerarIdOC(){
      const hoje = dateStr(getToday()).replace(/-/g,'');
      const prefix = 'OC-' + hoje + '-';
      const ex = ordensCompra.filter(o => o.id && o.id.startsWith(prefix)).length;
      return prefix + String(ex+1).padStart(3,'0');
    }
    function renderOrdensCompra(){
      const tbody = document.getElementById('tbody-ordens-compra');
      const vazio = document.getElementById('oc-vazio');
      const card = document.getElementById('oc-lista-card');
      if(!tbody) return;
      if(ordensCompra.length === 0){
        if(vazio) vazio.style.display = '';
        if(card) card.style.display = 'none';
        return;
      }
      if(vazio) vazio.style.display = 'none';
      if(card) card.style.display = '';
      const formaPgtoLabel = {a_vista:'À vista', boleto:'Boleto', cartao:'Cartão', parcelado:'Parcelado'};
      const statusLabel = {rascunho:'📝 Rascunho', confirmada:'✅ Confirmada', recebida:'📦 Recebida', cancelada:'❌ Cancelada'};
      tbody.innerHTML = ordensCompra.slice().reverse().map((oc, ri) => {
        const idx = ordensCompra.length - 1 - ri;
        const itensCount = (oc.itens||[]).length;
        const capital = oc.capital_total || (oc.itens||[]).reduce((s,i) => s + (i.total||0), 0);
        return `<tr style="border-bottom:1px solid var(--gray-100);cursor:pointer;" onclick="editarOC(${idx})">
          <td style="padding:8px 10px;font-family:monospace;font-size:11px;font-weight:600;">${oc.id||'—'}</td>
          <td style="padding:8px 6px;white-space:nowrap;">${oc.data ? ptDate(oc.data) : '—'}</td>
          <td style="padding:8px 6px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${oc.fornecedor||'—'}</td>
          <td style="padding:8px 6px;text-align:right;">${itensCount}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;color:var(--danger);">R$ ${capital.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
          <td style="padding:8px 6px;text-align:center;">${formaPgtoLabel[oc.forma_pagamento]||oc.forma_pagamento||'—'}</td>
          <td style="padding:8px 6px;text-align:center;">${statusLabel[oc.status]||oc.status||'—'}</td>
          <td style="padding:8px 6px;text-align:center;"><button class="btn-out btn-sm" onclick="event.stopPropagation();editarOC(${idx})">✏️</button></td>
        </tr>`;
      }).join('');
    }
    function abrirModalNovaOC(itens){
      const idx = -1;
      document.getElementById('oc-edit-idx').value = idx;
      document.getElementById('modal-oc-title').textContent = 'Nova Ordem de Compra';
      document.getElementById('btn-del-oc').style.display = 'none';
      document.getElementById('oc-id').value = gerarIdOC();
      document.getElementById('oc-data').value = dateStr(getToday());
      document.getElementById('oc-fornecedor').value = '';
      document.getElementById('oc-forma-pgto').value = 'a_vista';
      document.getElementById('oc-status').value = 'rascunho';
      document.getElementById('oc-detalhamento').value = '';
      _ocItensTemp = itens ? itens.map(i => ({sku:i.sku, descricao:i.descricao||(skus.find(s=>s.sku===i.sku)||{}).titulo||'', qtd:i.qtd||0, custo_un:i.custo_un||i.custo||0, total:i.total||((i.qtd||0)*(i.custo_un||i.custo||0))})) : [];
      renderOCItens();
      document.getElementById('modal-oc').classList.add('open');
    }
    let _ocItensTemp = [];
    function renderOCItens(){
      const tbody = document.getElementById('tbody-oc-itens');
      if(!tbody) return;
      let total = 0;
      tbody.innerHTML = _ocItensTemp.map((item, i) => {
        total += item.total||0;
        return `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:4px 6px;"><input type="text" value="${item.sku||''}" style="width:90px;font-size:11px;font-family:monospace;padding:2px 4px;border:1px solid var(--gray-200);border-radius:4px;" onchange="_ocItensTemp[${i}].sku=this.value"></td>
          <td style="padding:4px 6px;"><input type="text" value="${item.descricao||''}" style="width:160px;font-size:11px;padding:2px 4px;border:1px solid var(--gray-200);border-radius:4px;" onchange="_ocItensTemp[${i}].descricao=this.value"></td>
          <td style="padding:4px 6px;"><input type="number" value="${item.qtd||0}" min="0" style="width:55px;text-align:right;font-size:11px;padding:2px 4px;border:1px solid var(--gray-200);border-radius:4px;" onchange="_ocItensTemp[${i}].qtd=parseInt(this.value)||0;_ocItensTemp[${i}].total=_ocItensTemp[${i}].qtd*_ocItensTemp[${i}].custo_un;renderOCItens()"></td>
          <td style="padding:4px 6px;"><input type="number" value="${item.custo_un||0}" min="0" step="0.01" style="width:80px;text-align:right;font-size:11px;padding:2px 4px;border:1px solid var(--gray-200);border-radius:4px;" onchange="_ocItensTemp[${i}].custo_un=parseFloat(this.value)||0;_ocItensTemp[${i}].total=_ocItensTemp[${i}].qtd*_ocItensTemp[${i}].custo_un;renderOCItens()"></td>
          <td style="padding:4px 6px;text-align:right;font-size:11px;font-weight:600;">${(item.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
          <td style="padding:4px 6px;text-align:center;"><button class="btn-out btn-sm" style="font-size:11px;padding:2px 6px;" onclick="_ocItensTemp.splice(${i},1);renderOCItens()">✕</button></td>
        </tr>`;
      }).join('');
      const capEl = document.getElementById('oc-capital-total');
      if(capEl) capEl.textContent = total.toLocaleString('pt-BR',{minimumFractionDigits:2});
    }
    function adicionarLinhaOC(){
      _ocItensTemp.push({sku:'',descricao:'',qtd:1,custo_un:0,total:0});
      renderOCItens();
    }
    function salvarOC(){
      const idx = parseInt(document.getElementById('oc-edit-idx').value);
      const capital = _ocItensTemp.reduce((s,i) => s+(i.total||0), 0);
      const oc = {
        id: document.getElementById('oc-id').value,
        data: document.getElementById('oc-data').value,
        fornecedor: document.getElementById('oc-fornecedor').value.trim(),
        forma_pagamento: document.getElementById('oc-forma-pgto').value,
        status: document.getElementById('oc-status').value,
        itens: JSON.parse(JSON.stringify(_ocItensTemp)),
        capital_total: capital,
        detalhamento: document.getElementById('oc-detalhamento').value.trim(),
        data_criacao: dateStr(getToday())
      };
      if(idx >= 0){ ordensCompra[idx] = oc; }
      else { ordensCompra.push(oc); }
      salvar(); fecharModal('modal-oc'); renderOrdensCompra();
    }
    function editarOC(idx){
      const oc = ordensCompra[idx];
      if(!oc) return;
      document.getElementById('oc-edit-idx').value = idx;
      document.getElementById('modal-oc-title').textContent = 'Editar OC ' + (oc.id||'');
      document.getElementById('btn-del-oc').style.display = 'block';
      document.getElementById('oc-id').value = oc.id||'';
      document.getElementById('oc-data').value = oc.data||dateStr(getToday());
      document.getElementById('oc-fornecedor').value = oc.fornecedor||'';
      document.getElementById('oc-forma-pgto').value = oc.forma_pagamento||'a_vista';
      document.getElementById('oc-status').value = oc.status||'rascunho';
      document.getElementById('oc-detalhamento').value = oc.detalhamento||'';
      _ocItensTemp = JSON.parse(JSON.stringify(oc.itens||[]));
      renderOCItens();
      document.getElementById('modal-oc').classList.add('open');
    }
    function deletarOC(){
      const idx = parseInt(document.getElementById('oc-edit-idx').value);
      if(idx < 0) return;
      if(!confirm('Excluir esta Ordem de Compra?')) return;
      ordensCompra.splice(idx,1);
      salvar(); fecharModal('modal-oc'); renderOrdensCompra();
    }
    function toggleTodosRep(checked){
      document.querySelectorAll('.rep-sel-cb').forEach(cb => cb.checked = checked);
      updateOCBtn('rep');
    }
    function toggleTodosSkuUnit(checked){
      document.querySelectorAll('.skuunit-sel-cb').forEach(cb => cb.checked = checked);
      updateOCBtn('skuunit');
    }
    function updateOCBtn(tipo){
      const prefix = tipo === 'rep' ? 'rep' : 'skuunit';
      const selecionados = document.querySelectorAll('.' + prefix + '-sel-cb:checked').length;
      const btn = document.getElementById('btn-criar-oc-' + prefix);
      if(btn) btn.style.display = selecionados > 0 ? '' : 'none';
      if(tipo === 'rep'){
        const selAll = document.getElementById('rep-sel-all');
        if(selAll){ const total = document.querySelectorAll('.rep-sel-cb').length; selAll.checked = selecionados === total && total > 0; }
      } else {
        const selAll = document.getElementById('skuunit-sel-all');
        if(selAll){ const total = document.querySelectorAll('.skuunit-sel-cb').length; selAll.checked = selecionados === total && total > 0; }
      }
    }
    function abrirConfigReposicao(){
      document.getElementById('cfg-rep-meta-full').value = metaFullDias;
      document.getElementById('cfg-rep-meta-galpao').value = metaGalpaoDias;
      document.getElementById('cfg-rep-dias-seg').value = diasSeguranca;
      document.getElementById('cfg-rep-alerta').value = alertaCriticoDias;
      document.getElementById('modal-config-reposicao').classList.add('open');
    }
    function salvarConfigReposicao(){
      metaFullDias = parseInt(document.getElementById('cfg-rep-meta-full').value) || 30;
      metaGalpaoDias = parseInt(document.getElementById('cfg-rep-meta-galpao').value) || 30;
      diasSeguranca = parseInt(document.getElementById('cfg-rep-dias-seg').value) || 15;
      alertaCriticoDias = parseInt(document.getElementById('cfg-rep-alerta').value) || 15;
      const p11cfg = {metaFullDias, metaGalpaoDias, diasSeguranca, alertaCriticoDias};
      localStorage.setItem('mk_p11_cfg', JSON.stringify(p11cfg));
      fecharModal('modal-config-reposicao');
      renderEstoque();
    }
    function criarOCdeSelecionados(tipo){
      const prefix = tipo === 'rep' ? 'rep' : 'skuunit';
      const selecionados = [...document.querySelectorAll('.' + prefix + '-sel-cb:checked')];
      if(selecionados.length === 0){ alert('Selecione ao menos um item.'); return; }
      const itens = selecionados.map(cb => {
        const qtd = parseInt(cb.dataset.qtd || cb.closest('tr')?.querySelector('td:nth-child(13)')?.textContent) || 0;
        const custo = parseFloat(cb.dataset.custo) || 0;
        return { sku: cb.dataset.sku, qtd, custo_un: custo, total: qtd * custo };
      });
      const capital = itens.reduce((s, i) => s + i.total, 0);
      // Abrir modal de criação de OC
      if(typeof abrirModalNovaOC === 'function'){
        abrirModalNovaOC(itens);
      } else {
        alert('Itens selecionados:\n' + itens.map(function(i){ return i.sku + ' x' + i.qtd + ' = R$ ' + fmt(i.total); }).join('\n') + '\n\nCapital total: R$ ' + fmt(capital));
      }
    }
    function renderExcessoTab(){
      const tbody = document.getElementById('tbody-excesso');
      const vazioEl = document.getElementById('excesso-vazio');
      const cardEl = document.getElementById('excesso-card');
      if(!tbody) return;
      const ranking = calcRankingPorProduto(true).filter(r => ['excesso_critico','excesso_mod'].includes(r.status))
        .sort((a,b) => b.cobertura - a.cobertura);
      if(ranking.length === 0){
        if(vazioEl) vazioEl.style.display = '';
        if(cardEl) cardEl.style.display = 'none';
        return;
      }
      if(vazioEl) vazioEl.style.display = 'none';
      if(cardEl) cardEl.style.display = '';
      let html = '';
      ranking.forEach(r => {
        const sb = r.status === 'excesso_critico'
          ? '<span class="badge badge-danger">🔴 Excesso crítico</span>'
          : '<span class="badge badge-warning">🟡 Excesso moderado</span>';
        const capitalParado = r.qtd_total * r.custo_unitario;
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:8px 10px;font-family:monospace;font-size:11px;font-weight:600;">${r.sku}</td>
          <td style="padding:8px 6px;color:#555;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${r.descricao}">${r.descricao||'—'}</td>
          <td style="padding:8px 6px;text-align:right;">${r.consumo_diario > 0 ? r.consumo_diario.toFixed(1) : '—'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;">${r.qtd_total}</td>
          <td style="padding:8px 6px;text-align:right;">${Math.floor(r.cobertura)}d</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;color:var(--warning);">${capitalParado > 0 ? fmt(capitalParado) : '—'}</td>
          <td style="padding:8px 6px;text-align:center;">${sb}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      makeSortable('tbody-excesso', [6]);
      initResizableCols('tbody-excesso');
    }

    function renderRentabilidadeTab(){
      const tbody = document.getElementById('tbody-rentabilidade');
      const vazioEl = document.getElementById('estoque-rent-vazio');
      const cardEl = document.getElementById('estoque-rent-card');
      if(!tbody) return;
      if(vendasSku.length === 0){
        if(vazioEl) vazioEl.style.display = '';
        if(cardEl) cardEl.style.display = 'none';
        return;
      }
      if(vazioEl) vazioEl.style.display = 'none';
      if(cardEl) cardEl.style.display = '';
      const _periodo = vendasSku[0] ? (vendasSku[0].periodo_dias || 30) : 30;
      const _periodoOrig = vendasImportMeta.periodoOriginal || (vendasSku[0] ? (vendasSku[0].periodo_import || _periodo) : _periodo);
      const _escala = _periodoOrig > 0 ? _periodo / _periodoOrig : 1;
      let sorted = [...vendasSku].sort((a,b) => b.receita - a.receita);
      if(vendasFiltroInatividade > 0){
        const _hoje = new Date();
        const _lim = new Date(_hoje);
        _lim.setDate(_hoje.getDate() - vendasFiltroInatividade);
        const _limStr = _lim.toISOString().slice(0,10);
        sorted = sorted.filter(v => !v.ultima_venda || v.ultima_venda >= _limStr);
      }
      let html = '';
      sorted.forEach(v => {
        const unids = Math.round(v.unidades * _escala);
        const receita = v.receita * _escala;
        const tarifa = (v.tarifa_ml||0) * _escala;
        const envio = (v.envio||0) * _escala;
        const liquido = (v.liquido||0) * _escala;
        const custoUn = calcCustoComposicao(v.sku);
        const custoTotal = custoUn * unids;
        const margem = liquido - custoTotal;
        const margemPct = receita > 0 ? (margem / receita * 100) : 0;
        const semCusto = custoUn === 0;
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:8px 6px;font-family:monospace;font-size:11px;font-weight:600;">${v.sku}</td>
          <td style="padding:8px 6px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;" title="${v.titulo}">${v.titulo||'—'}</td>
          <td style="padding:8px 6px;text-align:right;">${unids}</td>
          <td style="padding:8px 6px;text-align:right;">${fmt(receita)}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--danger);">${fmt(tarifa)}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--danger);">${fmt(envio)}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;">${fmt(liquido)}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--danger);">${semCusto ? '<span style="color:#999;">sem composição</span>' : fmt(-custoTotal)}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;color:${semCusto?'#999':margem>=0?'var(--success)':'var(--danger)'};">${semCusto ? '—' : fmt(margem)}</td>
          <td style="padding:8px 6px;text-align:right;${!semCusto&&margemPct<10?'color:var(--danger);font-weight:600;':''}">${semCusto ? '—' : margemPct.toFixed(1)+'%'+(margemPct<10?' ⚠️':'')}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      makeSortable('tbody-rentabilidade');
      initResizableCols('tbody-rentabilidade');
    }

    function renderVendasSkuTab(){
      atualizarStatusVendas();
      const vazioEl = document.getElementById('estoque-vendas-vazio');
      const cardEl  = document.getElementById('estoque-vendas-card');
      const tbody   = document.getElementById('tbody-vendas-sku');
      if(!tbody) return;
      if(vendasSku.length === 0){
        if(vazioEl) vazioEl.style.display = '';
        if(cardEl)  cardEl.style.display  = 'none';
        return;
      }
      if(vazioEl) vazioEl.style.display = 'none';
      if(cardEl)  cardEl.style.display  = '';

      const periodo = vendasSku[0] ? (vendasSku[0].periodo_dias || 30) : 30;
      const periodoOrig = vendasImportMeta.periodoOriginal || (vendasSku[0] ? (vendasSku[0].periodo_import || periodo) : periodo);
      const escala = periodoOrig > 0 ? periodo / periodoOrig : 1;
      // Atualizar cabeçalho dinâmico
      const thU = document.getElementById('th-vendas-unidades');
      if(thU) thU.textContent = 'Unid. ' + periodo + 'd';
      // Aplicar filtros
      let sorted = [...vendasSku].sort((a,b) => b.unidades - a.unidades);
      if(vendasFiltroInatividade > 0){
        const hoje = new Date().toISOString().slice(0,10);
        sorted = sorted.filter(function(v){
          if(!v.ultima_venda) return false;
          const diffDias = Math.floor((new Date(hoje)-new Date(v.ultima_venda))/(1000*86400));
          return diffDias <= vendasFiltroInatividade;
        });
      }
      if(filtroMinVendas > 0) sorted = sorted.filter(function(v){ return v.unidades >= filtroMinVendas; });
      if(filtroVendasSku) {
        const q = filtroVendasSku.toLowerCase();
        sorted = sorted.filter(function(v){ return v.sku.toLowerCase().includes(q); });
      }
      let html = '';
      sorted.forEach(v => {
        const unids = Math.round(v.unidades * escala);
        const giro = (unids / periodo).toFixed(1);
        const uAds = Math.round((v.unidades_ads||0) * escala);
        const pctAds = unids > 0 ? Math.round(uAds / unids * 100) : 0;
        const adsStr = uAds > 0 ? `${uAds} <span style="font-size:10px;color:#999;">(${pctAds}%)</span>` : '—';
        const cancs = Math.round((v.cancelamentos||0) * escala);
        const cancStr = cancs > 0 ? `<span style="color:var(--warning);">${cancs}</span>` : '—';
        const receita = v.receita * escala;
        const recCanc = (v.receita_cancelada||0) * escala;
        const receitaStr = receita > 0 ? 'R$ ' + receita.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—';
        const cancelStr = recCanc > 0 ? '<span style="color:var(--danger);">R$ ' + recCanc.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</span>' : '—';
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:8px 10px;font-family:monospace;font-size:11px;font-weight:600;white-space:nowrap;">${v.sku}</td>
          <td style="padding:8px 6px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#555;" title="${v.titulo}">${v.titulo||'—'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:700;">${unids}</td>
          <td style="padding:8px 6px;text-align:right;">${giro}</td>
          <td style="padding:8px 6px;text-align:right;">${adsStr}</td>
          <td style="padding:8px 6px;text-align:right;">${cancStr}</td>
          <td style="padding:8px 6px;text-align:right;font-size:11px;">${receitaStr}</td>
          <td style="padding:8px 6px;text-align:right;font-size:11px;">${cancelStr}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      makeSortable('tbody-vendas-sku');
      initResizableCols('tbody-vendas-sku');
    }

    function renderSkuUnitarioTab(){
      const vazioEl = document.getElementById('estoque-skuunit-vazio');
      const cardEl  = document.getElementById('estoque-skuunit-card');
      const tbody   = document.getElementById('tbody-skuunit');
      if(!tbody) return;
      const { isolados, kitSkus } = getSkusIsolados();
      const temDados = vendasSku.length > 0 || isolados.size > 0;
      if(!temDados){
        if(vazioEl) vazioEl.style.display = '';
        if(cardEl)  cardEl.style.display  = 'none';
        return;
      }
      if(vazioEl) vazioEl.style.display = 'none';
      if(cardEl)  cardEl.style.display  = '';

      const periodoOrigSku = vendasImportMeta.periodoOriginal || (vendasSku[0] ? (vendasSku[0].periodo_import || 30) : 30);
      const extrapolandoSku = vendasSku.length > 0 && skuunitVendasDias > periodoOrigSku;
      const avisoSkuEl = document.getElementById('skuunit-periodo-aviso');
      const thVxd = document.getElementById('th-skuunit-vendas-xd');
      if(thVxd) thVxd.textContent = 'Vendas ' + skuunitVendasDias + 'd' + (extrapolandoSku ? ' ⚠' : '');
      const selDias = document.getElementById('skuunit-vendas-dias');
      if(selDias) selDias.value = String(skuunitVendasDias);
      if(avisoSkuEl){
        if(extrapolandoSku){
          avisoSkuEl.style.display = '';
          avisoSkuEl.textContent = '⚠ O relatório importado tem apenas ' + periodoOrigSku + ' dias de dados. A coluna "Vendas ' + skuunitVendasDias + 'd" é uma estimativa proporcional — importe um relatório de ' + skuunitVendasDias + ' dias ou mais para dados reais.';
        } else {
          avisoSkuEl.style.display = 'none';
        }
      }

      const consumo = calcConsumoComponentes();
      const skusExibir = new Set([
        ...Object.keys(consumo).filter(sku => !kitSkus.has(sku)),
        ...vendasSku.filter(v => !kitSkus.has(v.sku.toUpperCase()) && (isolados.size === 0 || isolados.has(v.sku.toUpperCase()))).map(v => v.sku.toUpperCase())
      ]);

      // Ler filtros
      const filtroBusca = (document.getElementById('skuunit-busca')?.value || '').trim().toUpperCase();
      const filtroInativ = parseInt(document.getElementById('skuunit-filtro-inatividade')?.value) || 0;
      const filtroMin = parseInt(document.getElementById('skuunit-filtro-min-vendas')?.value) || 0;
      const filtroCob = document.getElementById('skuunit-filtro-cob')?.value || 'todos';

      const rows = [];
      skusExibir.forEach(sku => {
        const c = consumo[sku] || { consumo30d: 0, consumo_diario: 0 };
        const vendaDireta = vendasSku.find(v => v.sku.toUpperCase() === sku.toUpperCase());
        const direto = vendaDireta ? vendaDireta.unidades : 0;
        const viaKits = Math.max(0, c.consumo30d - direto);
        const descricao = (componentes.find(x => x.codigo.toUpperCase() === sku.toUpperCase()) || {}).descricao
          || (vendaDireta && vendaDireta.titulo) || '';
        const est = estoqueGalpao.find(e => e.sku.toUpperCase() === sku.toUpperCase());
        const qtdGalpao = est ? (est.qtd_galpao||0) : 0;
        const fullDirectEntry = estoqueFullML.find(f => f.sku.toUpperCase() === sku.toUpperCase());
        const fullDireto = fullDirectEntry ? (fullDirectEntry.aptos_venda||0) : (est ? (est.qtd_full||0) : 0);
        // Via Kits Full: unidades deste SKU embutidas em kits que estão no Full ML
        const fullViaKits = composicaoKit
          .filter(c2 => c2.sku_componente.toUpperCase() === sku.toUpperCase())
          .reduce((sum, c2) => {
            const kitFull = estoqueFullML.find(f => f.sku.toUpperCase() === c2.sku_comercial.toUpperCase());
            return sum + (kitFull ? (kitFull.aptos_venda||0) : 0) * c2.qty;
          }, 0);
        const qtdTotal = est || fullDirectEntry ? qtdGalpao + fullDireto : null;
        const mc = getMetaComp(sku);
        const cobertura = (qtdTotal !== null && c.consumo_diario > 0) ? qtdTotal / c.consumo_diario : Infinity;
        const status = cobertura < mc.alerta ? 'critico' : cobertura < (mc.meta_full + mc.meta_galpao) ? 'atencao' : 'saudavel';
        const targetDias = mc.meta_full + mc.meta_galpao + mc.seg;
        const compraSugerida = c.consumo_diario > 0 ? Math.max(0, Math.ceil(targetDias * c.consumo_diario) - (qtdTotal||0)) : 0;
        const custoUn = (skus.find(s => s.sku === sku)||{}).custo || 0;
        const capital = compraSugerida * custoUn;
        const metaStr = `${mc.meta_full}d+${mc.meta_galpao}d`;
        rows.push({ sku, descricao, total30d: c.consumo30d, direto, viaKits, giro: c.consumo_diario, qtdGalpao, fullDireto, fullViaKits, qtdTotal, cobertura, status, compraSugerida, capital, metaStr, custoUn });
      });

      // Aplicar filtros
      let filtered = rows;
      if(filtroBusca) filtered = filtered.filter(r => r.sku.toUpperCase().includes(filtroBusca) || (r.descricao||'').toUpperCase().includes(filtroBusca));
      if(filtroInativ > 0) filtered = filtered.filter(r => r.giro > 0);
      if(filtroMin > 0) filtered = filtered.filter(r => r.total30d >= filtroMin);
      if(filtroCob !== 'todos'){ const maxD = parseInt(filtroCob); filtered = filtered.filter(r => r.cobertura !== Infinity && r.cobertura <= maxD); }
      filtered.sort((a,b) => b.total30d - a.total30d);

      const btnOC = document.getElementById('btn-criar-oc-skuunit');

      let html = '';
      filtered.forEach(r => {
        const giroStr = r.giro > 0 ? r.giro.toFixed(1) : '—';
        const kitStr = r.viaKits > 0 ? `<span style="font-size:10px;color:var(--primary);">+${r.viaKits}</span>` : '—';
        const estGStr = r.qtdTotal !== null ? String(r.qtdGalpao) : '—';
        const estFDStr = r.qtdTotal !== null ? String(r.fullDireto) : '—';
        const estFVStr = r.fullViaKits > 0 ? String(r.fullViaKits) : '—';
        const estTStr = r.qtdTotal !== null ? String(r.qtdTotal) : '—';
        const vendasXd = Math.round(r.giro * skuunitVendasDias);
        let cobStr = '—';
        if(r.qtdTotal !== null && r.giro > 0){
          const dias = Math.floor(r.cobertura);
          const cor = r.status === 'critico' ? 'var(--danger)' : r.status === 'atencao' ? 'var(--warning)' : 'var(--success)';
          cobStr = `<span style="color:${cor};font-weight:600;">${dias}d</span>`;
        }
        const mc_info = getMetaComp(r.sku);
        const tipoCritico = `Crítico: cobertura < ${mc_info.alerta} dias`;
        const tipoAtencao = `Atenção: cobertura < meta ${mc_info.meta_full + mc_info.meta_galpao} dias`;
        const sb = r.status === 'critico'
          ? `<span class="badge badge-danger" title="${tipoCritico}">🔴 Crítico</span>`
          : r.status === 'atencao'
          ? `<span class="badge badge-warning" title="${tipoAtencao}">🟡 Atenção</span>`
          : `<span class="badge badge-success" title="Saudável: na meta ou acima">🟢 Saudável</span>`;
        const compraStr = r.compraSugerida > 0 ? r.compraSugerida : '—';
        const capStr = r.capital > 0 ? fmt(r.capital) : '—';
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="text-align:center;padding:4px 6px;"><input type="checkbox" class="skuunit-sel-cb" data-sku="${r.sku}" data-qtd="${r.compraSugerida}" data-custo="${r.custoUn}" onchange="updateOCBtn('skuunit')"></td>
          <td style="padding:8px 10px;font-family:monospace;font-size:11px;font-weight:600;white-space:nowrap;">${r.sku}</td>
          <td style="padding:8px 6px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#555;" title="${r.descricao}">${r.descricao||'—'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;">${vendasXd > 0 ? vendasXd : '—'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:700;">${r.total30d}</td>
          <td style="padding:8px 6px;text-align:right;color:#555;">${r.direto > 0 ? r.direto : '—'}</td>
          <td style="padding:8px 6px;text-align:right;">${kitStr}</td>
          <td style="padding:8px 6px;text-align:right;">${giroStr}</td>
          <td style="padding:8px 6px;text-align:right;">${estGStr}</td>
          <td style="padding:8px 6px;text-align:right;">${estFDStr}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--primary);">${estFVStr}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;">${estTStr}</td>
          <td style="padding:8px 6px;text-align:right;">${cobStr}</td>
          <td style="padding:8px 6px;text-align:center;">${sb}</td>
          <td style="padding:8px 6px;text-align:right;">${compraStr}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;${r.capital>0?'color:var(--danger);':''}">${capStr}</td>
          <td style="padding:8px 6px;text-align:center;font-size:10px;color:#888;">${r.metaStr}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      if(btnOC) btnOC.style.display = 'none';
      makeSortable('tbody-skuunit');
      initResizableCols('tbody-skuunit');
    }

    function exportarSkuUnitarioCSV(){
      const consumo = calcConsumoComponentes();
      const { isolados, kitSkus } = getSkusIsolados();
      const periodo = vendasSku[0] ? (vendasSku[0].periodo_dias || 30) : 30;
      const skusExibir = new Set([
        ...Object.keys(consumo).filter(sku => !kitSkus.has(sku)),
        ...vendasSku.filter(v => !kitSkus.has(v.sku.toUpperCase()) && (isolados.size === 0 || isolados.has(v.sku.toUpperCase()))).map(v => v.sku.toUpperCase())
      ]);
      const rows = [['SKU','Descricao','Total_30d','Direto','Via_Kits','Unid_dia','Estoque','Cobertura_dias']];
      [...skusExibir].sort().forEach(sku => {
        const c = consumo[sku] || { consumo30d: 0, consumo_diario: 0 };
        const v = vendasSku.find(x => x.sku === sku);
        const direto = v ? v.unidades : 0;
        const viaKits = Math.max(0, c.consumo30d - direto);
        const desc = (componentes.find(x => x.codigo === sku) || {}).descricao || (v && v.titulo) || '';
        const est = estoqueGalpao.find(e => e.sku === sku);
        const qtd = est ? (est.qtd_galpao||0) + (est.qtd_full||0) : '';
        const cob = (qtd !== '' && c.consumo_diario > 0) ? Math.floor(qtd / c.consumo_diario) : '';
        rows.push([sku, desc, c.consumo30d, direto, viaKits, c.consumo_diario.toFixed(1), qtd, cob]);
      });
      const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url;
      a.download = `sku_unitario_${dateStr(getToday())}.csv`;
      a.click(); URL.revokeObjectURL(url);
    }

    function exportarVendasSkuCSV(){
      if(vendasSku.length === 0) return;
      const consumo = calcConsumoComponentes();
      const skusKit = new Set(composicaoKit.map(c => c.sku_comercial));
      const codigosComp = new Set([...estoqueGalpao.map(e => e.sku), ...componentes.map(c => c.codigo)]);
      const skusExibir = composicaoKit.length === 0
        ? vendasSku.map(v => v.sku)
        : [...new Set([...Object.keys(consumo), ...vendasSku.filter(v => !skusKit.has(v.sku) && codigosComp.has(v.sku)).map(v => v.sku)])];

      const csvRows = [['SKU','Título','Total_30d','Direto','Via_Kits','Unid_dia','ADS','Cancelamentos','Estoque','Cobertura_dias']];
      skusExibir.forEach(sku => {
        const c = consumo[sku] || {consumo30d:0, consumo_diario:0};
        const v = vendasSku.find(x => x.sku === sku);
        const direto = v ? v.unidades : 0;
        const kits = Math.max(0, c.consumo30d - direto);
        const titulo = v ? (v.titulo||'') : '';
        const est = estoqueGalpao.find(e => e.sku === sku);
        const qtd = est ? (est.qtd_galpao||0)+(est.qtd_full||0) : '';
        const cob = (est && c.consumo_diario > 0) ? Math.floor(qtd / c.consumo_diario) : '';
        csvRows.push([sku, titulo, c.consumo30d, direto, kits, c.consumo_diario.toFixed(1), v ? (v.unidades_ads||0) : 0, v ? (v.cancelamentos||0) : 0, qtd, cob]);
      });
      csvRows.sort((a,b) => b[2]-a[2]);
      const csv = csvRows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
      const blob = new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `vendas_sku_${dateStr(getToday())}.csv`;
      a.click(); URL.revokeObjectURL(url);
    }

    function renderCancelamentosTab(){
      const tbody = document.getElementById('tbody-cancelamentos');
      if(!tbody) return;
      if(vendasSku.length === 0){
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#999;">Importe o relatório de vendas ML para ver cancelamentos</td></tr>';
        return;
      }
      const sorted = [...vendasSku].sort((a,b) => b.cancelamentos - a.cancelamentos);
      let html = '';
      sorted.forEach(v => {
        const total = v.unidades + v.cancelamentos;
        const taxa = total > 0 ? (v.cancelamentos / total * 100) : 0;
        const alerta = taxa > 5 ? '⚠️ Revisar qualidade/descrição' : taxa > 2 ? '🟡 Monitorar' : '';
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:8px 6px;font-family:monospace;font-size:11px;">${v.sku}</td>
          <td style="padding:8px 6px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${v.titulo}">${v.titulo||'—'}</td>
          <td style="padding:8px 6px;text-align:right;">${v.unidades}</td>
          <td style="padding:8px 6px;text-align:right;">${v.cancelamentos}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;${taxa>5?'color:var(--danger);':taxa>2?'color:var(--warning);':''}">${taxa.toFixed(1)}%</td>
          <td style="padding:8px 6px;font-size:11px;">${alerta}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      makeSortable('tbody-cancelamentos', [5]);
      initResizableCols('tbody-cancelamentos');
    }

    function renderADSTab(){
      const tbody = document.getElementById('tbody-ads');
      if(!tbody) return;
      if(vendasSku.length === 0){
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#999;">Importe o relatório de vendas ML para ver análise de ADS</td></tr>';
        return;
      }
      const sorted = [...vendasSku].sort((a,b) => b.unidades_ads - a.unidades_ads);
      let html = '';
      sorted.forEach(v => {
        const pctAds = v.unidades > 0 ? (v.unidades_ads / v.unidades * 100) : 0;
        const organico = v.unidades - v.unidades_ads;
        const alerta = pctAds > 60 ? '⚠️ Alta dependência de ADS' : pctAds > 40 ? '🟡 ADS significativo' : '';
        html += `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:8px 6px;font-family:monospace;font-size:11px;">${v.sku}</td>
          <td style="padding:8px 6px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${v.titulo}">${v.titulo||'—'}</td>
          <td style="padding:8px 6px;text-align:right;">${v.unidades}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--success);">${organico}</td>
          <td style="padding:8px 6px;text-align:right;${v.unidades_ads>0?'color:var(--warning);':''}">${v.unidades_ads}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;${pctAds>60?'color:var(--danger);':pctAds>40?'color:var(--warning);':''}">${pctAds.toFixed(1)}%</td>
          <td style="padding:8px 6px;font-size:11px;">${alerta}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
      makeSortable('tbody-ads', [6]);
      initResizableCols('tbody-ads');
    }


    function calcEstoqueKit(sku_comercial){
      const comps = composicaoKit.filter(c => c.sku_comercial === sku_comercial);
      if(comps.length === 0) return null;
      let min = Infinity;
      for(const c of comps){
        const eg = estoqueGalpao.find(e => e.sku === c.sku_componente);
        const qtd = eg ? (eg.qtd_galpao || 0) : 0;
        const kits = Math.floor(qtd / (c.qty || 1));
        if(kits < min) min = kits;
      }
      return min === Infinity ? 0 : min;
    }

    function renderComposicoesTab(){
      const el = document.getElementById('composicoes-lista');
      const vazioEl = document.getElementById('composicoes-vazio');
      const infoEl = document.getElementById('composicoes-info');
      if(!el) return;
      const kitsUnicos = [...new Set(composicaoKit.map(c => c.sku_comercial))].sort();
      if(infoEl) infoEl.textContent = kitsUnicos.length > 0 ? `${kitsUnicos.length} kits · ${composicaoKit.length} mapeamentos` : '';
      const selAll = document.getElementById('kits-sel-all');
      if(selAll) selAll.checked = false;
      atualizarContadorKitsSel();
      if(kitsUnicos.length === 0){
        if(vazioEl) vazioEl.style.display = '';
        el.innerHTML = '';
        return;
      }
      if(vazioEl) vazioEl.style.display = 'none';
      let html = '';
      const kitsExibir = filtroKits ? kitsUnicos.filter(k => k.toLowerCase().includes(filtroKits) || (composicaoKit.find(c=>c.sku_comercial===k)||{}).titulo_comercial?.toLowerCase().includes(filtroKits)) : kitsUnicos;
      kitsExibir.forEach(kitSku => {
        const comps = composicaoKit.filter(c => c.sku_comercial === kitSku);
        const titulo = comps[0] ? comps[0].titulo_comercial : '';
        const custoKit = comps[0] ? (comps[0].custo_kit || 0) : 0;
        const custoCalc = calcCustoComposicao(kitSku);
        const custoLabel = custoKit > 0
          ? `<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">R$ ${fmt(custoKit)}</span>`
          : (custoCalc > 0 ? `<span style="background:#f1f5f9;color:#475569;border-radius:4px;padding:2px 8px;font-size:11px;">≈ ${fmt(custoCalc)} <span style="font-weight:400;font-size:10px;">(soma componentes)</span></span>` : `<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 8px;font-size:11px;">Sem custo</span>`);
        const tags = comps.map(c => `<span style="background:var(--gray-100);border-radius:4px;padding:2px 8px;font-size:11px;font-family:monospace;">${c.sku_componente} ×${c.qty}</span>`).join('');
        const estoqueKit = calcEstoqueKit(kitSku);
        const estoqueKitLabel = estoqueKit !== null
          ? (estoqueKit === 0
            ? `<span style="background:#fee2e2;color:#dc2626;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">📦 0 kits</span>`
            : (estoqueKit <= 5
              ? `<span style="background:#ffedd5;color:#c2410c;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">📦 ${estoqueKit} kits</span>`
              : `<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">📦 ${estoqueKit} kits</span>`))
          : '';
        const _skuKitEnt = skus.find(function(s){ return s.sku === kitSku; });
        const impostoKit = _skuKitEnt ? (_skuKitEnt.imposto || 0) : 0;
        const impostoLabel = impostoKit > 0 ? `<span style="background:#ede9fe;color:#5b21b6;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">${impostoKit.toFixed(2)}% imp.</span>` : '';
        const skuEsc = kitSku.replace(/'/g, "\\'");
        html += `<div class="card mb-2" id="kit-card-${kitSku.replace(/[^a-zA-Z0-9]/g,'-')}">
          <div class="card-body" style="padding:12px 15px;cursor:pointer;" onclick="abrirModalComposicao('${skuEsc}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div style="display:flex;align-items:center;gap:8px;" onclick="event.stopPropagation()">
                <input type="checkbox" class="kit-sel-cb" data-sku="${kitSku}" onchange="atualizarContadorKitsSel()" style="margin:0;">
                <div>
                  <div style="font-family:monospace;font-weight:600;font-size:12px;">${kitSku}</div>
                  <div style="font-size:11px;color:#666;margin-top:2px;">${titulo}</div>
                </div>
              </div>
              <div class="d-flex gap-1" onclick="event.stopPropagation()">
                <button class="btn-out btn-sm" onclick="abrirModalComposicao('${skuEsc}')">✏️</button>
                <button class="btn-out btn-sm" style="color:var(--danger);" onclick="deletarComposicaoKit('${skuEsc}')">🗑️</button>
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">${tags}<span style="margin-left:auto;display:flex;gap:6px;align-items:center;">${estoqueKitLabel}${custoLabel}${impostoLabel}</span></div>
          </div>
        </div>`;
      });
      el.innerHTML = html;
    }
    function atualizarContadorKitsSel(){
      const selecionados = document.querySelectorAll('.kit-sel-cb:checked').length;
      const total = document.querySelectorAll('.kit-sel-cb').length;
      const el = document.getElementById('kits-sel-count');
      if(el) el.textContent = selecionados > 0 ? `${selecionados} de ${total} selecionados` : '';
    }
    function toggleTodosKits(checked){
      document.querySelectorAll('.kit-sel-cb').forEach(cb => cb.checked = checked);
      atualizarContadorKitsSel();
    }
    function showUndoToast(count, label){
      const ex = document.getElementById('undo-toast');
      if(ex) ex.remove();
      const t = document.createElement('div');
      t.id = 'undo-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:12px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.35);white-space:nowrap;';
      const span1 = document.createElement('span');
      span1.textContent = count + ' ' + label + ' excluído(s)';
      const btn1 = document.createElement('button');
      btn1.textContent = '↩ Desfazer';
      btn1.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:5px;padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600;';
      btn1.onclick = function(){ desfazerApagar(); };
      const span2 = document.createElement('span');
      span2.textContent = '15 min';
      span2.style.cssText = 'font-size:11px;color:#9ca3af;';
      const btn2 = document.createElement('button');
      btn2.textContent = '×';
      btn2.style.cssText = 'background:none;border:none;color:#9ca3af;cursor:pointer;font-size:20px;line-height:1;';
      btn2.onclick = function(){ var el=document.getElementById('undo-toast'); if(el)el.remove(); _undoBuffer=null; };
      t.appendChild(span1); t.appendChild(btn1); t.appendChild(span2); t.appendChild(btn2);
      document.body.appendChild(t);
      setTimeout(function(){ var el=document.getElementById('undo-toast'); if(el)el.remove(); _undoBuffer=null; }, 15*60*1000);
    }
    function desfazerApagar(){
      if(!_undoBuffer) return;
      if(_undoBuffer.type==='kits'){
        if(_undoBuffer.data && _undoBuffer.data.composicao){ composicaoKit=_undoBuffer.data.composicao; skus=_undoBuffer.data.skus_bak||skus; }
        else { composicaoKit=_undoBuffer.data; }
        salvar(); renderComposicoesTab(); renderSKUs();
      }
      else if(_undoBuffer.type==='skus'){ skus=_undoBuffer.data; salvar(); renderSKUs(); }
      var t=document.getElementById('undo-toast'); if(t)t.remove();
      _undoBuffer=null;
      alert('Restaurado com sucesso!');
    }
    function abrirModalApagarSKUs(){
      var el=document.getElementById('modal-confirm-apagar');
      el.dataset.contexto='skus';
      var r=document.querySelector('input[name="apagar-modo"][value="selecionados"]');
      if(r) r.checked=true;
      document.getElementById('modal-apagar-descricao').textContent='';
      document.getElementById('modal-apagar-lista').textContent='';
      el.classList.add('open');
    }
    function abrirModalApagarKits(){
      var el=document.getElementById('modal-confirm-apagar');
      el.dataset.contexto='kits';
      var r=document.querySelector('input[name="apagar-modo"][value="selecionados"]');
      if(r) r.checked=true;
      document.getElementById('modal-apagar-descricao').textContent='';
      document.getElementById('modal-apagar-lista').textContent='';
      el.classList.add('open');
    }
    function executarApagar(){
      var el=document.getElementById('modal-confirm-apagar');
      var contexto=el?el.dataset.contexto:null;
      var modoEl=document.querySelector('input[name="apagar-modo"]:checked');
      var modo=modoEl?modoEl.value:'selecionados';

      if(contexto==='skus'){
        var sel=[...document.querySelectorAll('.sku-cb:checked')]
          .map(function(cb){var s=skus[parseInt(cb.dataset.idx)];return s?s.sku:null;}).filter(Boolean);
        var lista=modo==='todos'?skus.map(function(s){return s.sku;}):sel;
        if(lista.length===0){alert(modo==='todos'?'Nenhum SKU cadastrado.':'Nenhum SKU selecionado.');return;}
        fecharModal('modal-confirm-apagar');
        _undoBuffer={type:'skus',data:[...skus]};
        skus=skus.filter(function(s){return !lista.includes(s.sku);});
        salvar(); renderSKUs();
        showUndoToast(lista.length,'SKU(s)');
      } else if(contexto==='kits'){
        var selK=[...document.querySelectorAll('.kit-sel-cb:checked')].map(function(cb){return cb.dataset.sku;});
        var todosK=[...new Set(composicaoKit.map(function(c){return c.sku_comercial;}))];
        var listaK=modo==='todos'?todosK:selK;
        if(listaK.length===0){alert(modo==='todos'?'Nenhum kit cadastrado.':'Nenhum kit selecionado.');return;}
        fecharModal('modal-confirm-apagar');
        _undoBuffer={type:'kits',data:{composicao:[...composicaoKit],skus_bak:[...skus]}};
        skus=skus.filter(function(s){return !listaK.includes(s.sku);});
        composicaoKit=composicaoKit.filter(function(c){return !listaK.includes(c.sku_comercial);});
        salvar(); renderComposicoesTab(); renderSKUs();
        showUndoToast(listaK.length,'kit(s)');
      }
    }
    function deletarKitsSelecionados(){
      const selecionados = [...document.querySelectorAll('.kit-sel-cb:checked')].map(cb => cb.dataset.sku);
      if(selecionados.length === 0){ alert('Nenhum kit selecionado.'); return; }
      if(!confirm(`Remover ${selecionados.length} kit(s) selecionado(s)?`)) return;
      composicaoKit = composicaoKit.filter(c => !selecionados.includes(c.sku_comercial));
      salvar(); renderComposicoesTab();
      const selAll = document.getElementById('kits-sel-all');
      if(selAll) selAll.checked = false;
    }

    // ----- Aviso de SKUs sem cadastro -----
    function verificarSkusNaoCadastrados(){
      const alertEl = document.getElementById('alerta-skus-nao-cadastrados');
      const listaEl = document.getElementById('alerta-skus-lista');
      if(!alertEl || !listaEl) return;
      if(vendasSku.length === 0){ alertEl.style.display = 'none'; return; }
      const skusKit = new Set(composicaoKit.map(c => c.sku_comercial.toUpperCase()));
      const skusCadastrados = new Set([
        ...skus.map(s => s.sku.toUpperCase()),
        ...componentes.map(c => c.codigo.toUpperCase()),
        ...estoqueGalpao.map(e => e.sku.toUpperCase()),
      ]);
      // Verifica só SKUs isolados (não kits) que estão nas vendas mas sem cadastro
      const faltando = vendasSku
        .filter(v => !skusKit.has(v.sku.toUpperCase()) && !skusCadastrados.has(v.sku.toUpperCase()))
        .map(v => v.sku)
        .sort();
      if(faltando.length === 0){ alertEl.style.display = 'none'; return; }
      listaEl.textContent = faltando.join('  ·  ');
      alertEl.style.display = '';
    }

    // ----- Limpar dados de planilhas -----
    function abrirModalLimparDados(){
      const temGalpao = estoqueGalpao.length > 0;
      const temFull = estoqueFullML.length > 0;
      const temVendas = vendasSku.length > 0;
      if(!temGalpao && !temFull && !temVendas){ alert('Nenhum dado importado no momento.'); return; }
      var cb = document.getElementById('limpar-cb-galpao'); if(cb) cb.checked = false; if(cb) cb.disabled = !temGalpao;
      cb = document.getElementById('limpar-cb-full'); if(cb) cb.checked = false; if(cb) cb.disabled = !temFull;
      cb = document.getElementById('limpar-cb-vendas'); if(cb) cb.checked = false; if(cb) cb.disabled = !temVendas;
      var info = document.getElementById('limpar-dados-info');
      if(info) info.innerHTML = [
        temGalpao ? `Galpão: ${estoqueGalpao.length} itens` : null,
        temFull   ? `Full ML: ${estoqueFullML.length} SKUs` : null,
        temVendas ? `Vendas: ${vendasSku.length} SKUs` : null,
      ].filter(Boolean).map(s=>`<span style="font-size:11px;color:#555;">${s}</span>`).join(' &nbsp;·&nbsp; ');
      document.getElementById('modal-limpar-dados').classList.add('open');
    }
    function executarLimparDados(){
      const cbG = document.getElementById('limpar-cb-galpao');
      const cbF = document.getElementById('limpar-cb-full');
      const cbV = document.getElementById('limpar-cb-vendas');
      const limG = cbG && cbG.checked;
      const limF = cbF && cbF.checked;
      const limV = cbV && cbV.checked;
      if(!limG && !limF && !limV){ alert('Selecione ao menos uma opção.'); return; }
      if(limG){ estoqueGalpao = []; }
      if(limF){ estoqueFullML = []; localStorage.removeItem('mk_estoque_full_ml'); }
      if(limV){ vendasSku = []; vendasImportMeta = {}; }
      salvar();
      fecharModal('modal-limpar-dados');
      renderEstoque();
    }
    function toggleLimparTodos(checked){
      ['limpar-cb-galpao','limpar-cb-full','limpar-cb-vendas'].forEach(function(id){
        var cb = document.getElementById(id); if(cb && !cb.disabled) cb.checked = checked;
      });
    }

    // ----- Import handlers -----
    function setVendasFiltroInatividade(n){
      vendasFiltroInatividade = n || 0;
      renderEstoque();
    }
    function setVendasPeriodo(dias){
      vendasImportMeta.periodo = dias || 30;
      vendasSku.forEach(function(v){ v.periodo_dias = vendasImportMeta.periodo; });
      const thU = document.getElementById('th-vendas-unidades');
      if(thU) thU.textContent = 'Unid. ' + (dias||30) + 'd';
      salvar(); renderEstoque();
    }
    function onVendasPeriodoChange(val){
      const v = parseInt(val);
      const customEl = document.getElementById('vendas-periodo-custom');
      if(v === -1){
        if(customEl) customEl.style.display = 'flex';
      } else {
        if(customEl) customEl.style.display = 'none';
        setVendasPeriodo(v);
      }
    }
    function aplicarPeriodoCustom(){
      const ini = document.getElementById('vendas-dt-ini');
      const fim = document.getElementById('vendas-dt-fim');
      if(!ini||!fim||!ini.value||!fim.value){ alert('Selecione data de início e fim.'); return; }
      const d1 = new Date(ini.value), d2 = new Date(fim.value);
      const dias = Math.max(1, Math.round((d2-d1)/(1000*86400))+1);
      setVendasPeriodo(dias);
    }
    function atualizarStatusVendas(){
      // Sincronizar filtros do DOM
      var skuInp = document.getElementById('vendas-filtro-sku');
      if(skuInp) filtroVendasSku = skuInp.value.trim();
      var minInp = document.getElementById('vendas-filtro-min');
      if(minInp) filtroMinVendas = parseInt(minInp.value)||0;
      var card = document.getElementById('vendas-status-card');
      var txt  = document.getElementById('vendas-status-texto');
      var ded  = document.getElementById('vendas-status-dedup');
      var sel  = document.getElementById('vendas-periodo-sel');
      if(!card) return;
      if(vendasSku.length === 0){ card.style.display = 'none'; return; }
      card.style.display = '';
      var dt = vendasImportMeta.importAt ? new Date(vendasImportMeta.importAt).toLocaleString('pt-BR') : '-';
      if(txt) txt.textContent = 'Último relatório: ' + dt + ' — ' + vendasSku.length + ' SKUs';
      if(ded && vendasImportMeta.dedupInfo) ded.textContent = vendasImportMeta.dedupInfo;
      if(sel) sel.value = String(vendasImportMeta.periodo || 30);
      var inpInat = document.getElementById('vendas-inatividade-input');
      if(inpInat) inpInat.value = vendasFiltroInatividade > 0 ? String(vendasFiltroInatividade) : '';
    }
    function _mostrarNovosSkusModal(titulo, novosSkus, origemLabel){
      const modal = document.getElementById('modal-novos-skus');
      const tit = document.getElementById('novos-skus-titulo');
      const lista = document.getElementById('novos-skus-lista');
      if(!modal || !tit || !lista) return;
      tit.textContent = titulo;
      if(novosSkus.length === 0){
        lista.innerHTML = '<div style="color:#6b7280;text-align:center;padding:16px;">Nenhum SKU novo.</div>';
      } else {
        lista.innerHTML = novosSkus.map(function(s){
          const jaExiste = skus.some(function(x){ return x.sku.toUpperCase() === s.sku.toUpperCase(); });
          const sk = s.sku.replace(/'/g,"\\'").replace(/</g,'&lt;');
          const ti = (s.titulo||'').replace(/'/g,"\\'").replace(/</g,'&lt;');
          return '<div data-novo-sku style="border-bottom:1px solid var(--gray-100);">' +
            '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;">' +
              '<span style="font-family:monospace;font-size:12px;min-width:130px;font-weight:600;">' + s.sku + '</span>' +
              '<span style="color:#6b7280;font-size:12px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + (s.titulo||'') + '">' + (s.titulo||'') + '</span>' +
              (jaExiste
                ? '<span style="font-size:11px;color:#10b981;white-space:nowrap;">✓ já cadastrado</span>'
                : '<button class="btn-sm" style="font-size:11px;padding:3px 10px;white-space:nowrap;" onclick="_expandirFormSku(\'' + sk + '\',\'' + ti + '\',this)">+ Criar</button>' +
                  '<button class="btn-out btn-sm" style="font-size:11px;padding:3px 8px;white-space:nowrap;" onclick="this.closest(\'[data-novo-sku]\').style.display=\'none\'">Ignorar</button>'
              ) +
            '</div>' +
          '</div>';
        }).join('');
      }
      document.getElementById('novos-skus-origem').textContent = origemLabel;
      modal.classList.add('open');
    }
    function _expandirFormSku(sku, titulo, btn){
      const row = btn.closest('[data-novo-sku]');
      if(!row) return;
      const sk = sku.replace(/'/g,"\\'");
      const ti = titulo.replace(/'/g,"\\'");
      const tituloEsc = titulo.replace(/</g,'&lt;');
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;">' +
          '<span style="font-family:monospace;font-size:12px;min-width:130px;font-weight:600;">' + sku + '</span>' +
          '<span style="color:#6b7280;font-size:12px;flex:1;">' + tituloEsc + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0 10px;background:#f9fafb;border-radius:6px;padding:6px 8px 8px;">' +
          '<label style="font-size:11px;color:#374151;font-weight:600;">Custo R$</label>' +
          '<input type="number" data-custo step="0.01" min="0" placeholder="0,00" style="width:90px;font-size:12px;padding:4px 7px;border:1px solid var(--gray-200);border-radius:5px;">' +
          '<label style="font-size:11px;color:#374151;font-weight:600;">Imposto %</label>' +
          '<input type="number" data-imposto step="0.1" min="0" max="100" placeholder="0" style="width:65px;font-size:12px;padding:4px 7px;border:1px solid var(--gray-200);border-radius:5px;">' +
          '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px;" onclick="_confirmarCriarSku(\'' + sk + '\',\'' + ti + '\',this)">✓ Criar</button>' +
          '<button class="btn-out btn-sm" style="font-size:11px;padding:4px 8px;" onclick="this.closest(\'[data-novo-sku]\').style.display=\'none\'">Ignorar</button>' +
        '</div>';
      const custoInput = row.querySelector('[data-custo]');
      if(custoInput) custoInput.focus();
    }
    function _confirmarCriarSku(sku, titulo, btn){
      if(skus.some(function(x){ return x.sku.toUpperCase() === sku.toUpperCase(); })){ alert('SKU já existe em Produtos.'); return; }
      const row = btn.closest('[data-novo-sku]');
      const custo = parseFloat(row ? (row.querySelector('[data-custo]')||{}).value : 0) || 0;
      const imposto = parseFloat(row ? (row.querySelector('[data-imposto]')||{}).value : 0) || 0;
      skus.push({ sku: sku.toUpperCase(), titulo: titulo, custo: custo, imposto: imposto, created_at: new Date().toISOString() });
      salvar();
      if(row) row.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--gray-100);">' +
          '<span style="font-family:monospace;font-size:12px;min-width:130px;">' + sku.toUpperCase() + '</span>' +
          '<span style="color:#6b7280;font-size:12px;flex:1;">' + titulo.replace(/</g,'&lt;') + '</span>' +
          '<span style="font-size:11px;color:#10b981;white-space:nowrap;">✓ criado' + (custo > 0 ? ' · R$ ' + custo.toFixed(2) : '') + '</span>' +
        '</div>';
    }

    function onImportVendasML(input){
      var file = input.files[0];
      if(!file) return;
      var reader = new FileReader();
      reader.onload = function(e){
        try {
          var result = parseVendasMLXLS(e.target.result);
          if(result.error){ alert('Erro: ' + result.error); return; }
          // Mostra SKUs que estão nas vendas mas ainda não têm cadastro em Produtos (skus[])
          var novosArr = result.vendas.filter(function(v){ return !skus.some(function(s){ return s.sku.toUpperCase() === v.sku.toUpperCase(); }); });
          var novos = novosArr.length;
          var periodo = vendasImportMeta.periodo || 30;
          result.vendas.forEach(function(v){ v.periodo_dias = periodo; v.periodo_import = periodo; });
          vendasSku = result.vendas;
          vendasImportMeta.periodoOriginal = periodo;
          vendasImportMeta.importAt = new Date().toISOString();
          vendasImportMeta.dedupInfo = novos + ' sem cadastro em Produtos, ' + (result.vendas.length - novos) + ' já cadastrados — ' + result.totalUnidades.toLocaleString('pt-BR') + ' unidades';
          salvar(); renderEstoque();
          if(novos > 0){
            _mostrarNovosSkusModal('Vendas ML — ' + novos + ' SKUs sem cadastro em Produtos',
              novosArr.map(function(v){ return { sku: v.sku, titulo: v.titulo||'' }; }),
              'Importação: ' + new Date().toLocaleString('pt-BR') + ' — ' + vendasSku.length + ' SKUs | ' + result.totalUnidades.toLocaleString('pt-BR') + ' unidades');
          } else {
            alert('Vendas ML importadas!\n\n' + vendasSku.length + ' SKUs  |  todos já cadastrados em Produtos  |  ' + result.totalUnidades.toLocaleString('pt-BR') + ' unidades');
          }
        } catch(err){ alert('Erro ao processar: ' + err.message); }
        input.value = '';
      };
      reader.readAsArrayBuffer(file);
    }

    function onImportKitUpseller(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const result = parseKitUpseller(e.target.result);
          if(result.error){ alert('Erro: ' + result.error); return; }
          // Preservar custo_kit existente por SKU (case-insensitive)
          const custoKitExistente = {};
          composicaoKit.forEach(c => {
            const k = c.sku_comercial.toUpperCase();
            if(!custoKitExistente[k]) custoKitExistente[k] = c.custo_kit || 0;
          });
          // SKUs do arquivo normalizados (dedup case-insensitive)
          const kitSkusArquivoU = [...new Set(result.composicao.map(c => c.sku_comercial.toUpperCase()))];
          // Remover entradas antigas (case-insensitive) → evita duplicatas de re-import
          composicaoKit = composicaoKit.filter(c => !kitSkusArquivoU.includes(c.sku_comercial.toUpperCase()));
          // Adicionar novas entradas preservando custo_kit existente
          const novasEntradas = result.composicao.map(c => ({
            ...c, custo_kit: custoKitExistente[c.sku_comercial.toUpperCase()] || c.custo_kit || 0
          }));
          composicaoKit.push(...novasEntradas);
          const novosKits = kitSkusArquivoU.filter(k => !custoKitExistente[k]);
          const atualizados = kitSkusArquivoU.length - novosKits.length;
          salvar(); renderEstoque();
          alert(`✅ ${novosKits.length} kits novos · ${atualizados} atualizados · ${novasEntradas.length} mapeamentos`);
        } catch(err){ alert('Erro ao processar: ' + err.message); }
        input.value = '';
      };
      reader.readAsArrayBuffer(file);
    }

    function onImportEstoqueUpseller(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const result = parseEstoqueUpseller(e.target.result);
          if(result.error){ alert('Erro: ' + result.error); return; }
          let novos = 0, atualizados = 0;
          const hoje = new Date().toISOString().slice(0,10);
          const ts = new Date().toISOString();
          const novosArr = [];
          result.estoque.forEach(eg => {
            const idx = estoqueGalpao.findIndex(x => x.sku === eg.sku);
            if(idx >= 0){
              estoqueGalpao[idx].qtd_galpao = eg.qtd_galpao;
              estoqueGalpao[idx].data_atualizacao = hoje;
              atualizados++;
            } else {
              estoqueGalpao.push({ sku: eg.sku, descricao: eg.descricao, qtd_galpao: eg.qtd_galpao, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: hoje, created_at: ts });
              novosArr.push({ sku: eg.sku, titulo: eg.descricao });
              novos++;
            }
          });
          salvar(); renderEstoque();
          if(novos > 0){
            _mostrarNovosSkusModal('Estoque Galpão — ' + novos + ' SKUs novos',
              novosArr, 'Importação Upseller: ' + new Date().toLocaleString('pt-BR') + ' — ' + atualizados + ' atualizados, ' + novos + ' novos.');
          } else {
            alert(`✅ Estoque galpão atualizado: ${atualizados} atualizados, 0 novos.`);
          }
        } catch(err){ alert('Erro ao processar: ' + err.message); }
        input.value = '';
      };
      reader.readAsArrayBuffer(file);
    }

    // ----- Parsers -----
    function parseVendasMLXLS(data){
      const wb = XLSX.read(data, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
      if(rows.length < 7) return {error:'Arquivo sem dados suficientes'};

      // Detectar todas as colunas pelo cabeçalho (rows[5])
      const _isMLId = function(v){ return /^(MLB|MLA|MLC|MLM|MLU)\d+/i.test(String(v||'').trim()); };
      const headerRow = rows[5] ? rows[5].map(function(h){ return String(h||'').trim(); }) : [];
      function _findCol(patterns, fallback){
        for(var _pi = 0; _pi < patterns.length; _pi++){
          var idx = headerRow.findIndex(function(h){ return patterns[_pi].test(h); });
          if(idx >= 0) return idx;
        }
        return fallback;
      }
      // Padrões mapeados do relatório "Transações por pedido" do ML
      let colSku     = _findCol([/^sku$/i], 21);
      let colTitulo  = _findCol([/título do anúncio/i, /^título$/i], 25);
      let colUnid    = _findCol([/^unidades$/i], 6);
      let colReceita = _findCol([/receita por produtos/i], 7);
      let colTarifa  = _findCol([/tarifa de venda/i], 10);
      let colEnvio   = _findCol([/tarifas de envio/i], 12);
      let colTotal   = _findCol([/^total \(BRL\)$/i, /^total$/i], 17);
      let colAds     = _findCol([/venda por publicidade/i], 20);

      // Se colSku ainda retornou MLB IDs, ajustar para coluna adjacente com SKU real
      const amostra = rows.slice(6, 16).filter(function(r){ return r.length > colSku; });
      const mlbCount = amostra.filter(function(r){ return _isMLId(r[colSku]); }).length;
      if(amostra.length > 0 && mlbCount > amostra.length / 2){
        for(var delta = 1; delta <= 4; delta++){
          for(var sinal of [1,-1]){
            const c = colSku + delta * sinal;
            if(c < 0) continue;
            const validos = amostra.filter(function(r){ return r[c] && String(r[c]).trim() && !_isMLId(r[c]); }).length;
            if(validos >= amostra.length / 2){ colSku = c; delta = 99; break; }
          }
        }
      }

      const dataRows = rows.slice(6).filter(function(r){ return r[colSku] && String(r[colSku]).trim() !== '' && !_isMLId(r[colSku]); });
      if(dataRows.length === 0) return {error:'Nenhuma linha com SKU de vendedor encontrada. O relatório pode estar usando col '+(colSku+1)+' que contém IDs MLB. Verifique o arquivo.'};

      const _mesesPT={'janeiro':'01','fevereiro':'02','março':'03','abril':'04','maio':'05','junho':'06','julho':'07','agosto':'08','setembro':'09','outubro':'10','novembro':'11','dezembro':'12'};
      function _parseDataVenda(r){
        const v1 = String(r[1]||'');
        const mPT = v1.toLowerCase().match(/(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/);
        if(mPT && _mesesPT[mPT[2]]) return mPT[3]+'-'+_mesesPT[mPT[2]]+'-'+mPT[1].padStart(2,'0');
        for(let dc = 0; dc <= 5; dc++){
          const v = String(r[dc]||'');
          if(/^\d{2}\/\d{2}\/\d{4}/.test(v)){
            const p = v.split('/');
            return p[2].substring(0,4) + '-' + p[1] + '-' + p[0];
          }
          if(/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0,10);
        }
        return null;
      }
      const agg = {};
      dataRows.forEach(r => {
        const sku = String(r[colSku]).trim();
        const cancelado = r[colTotal] !== undefined && parseFloat(r[colTotal]) < 0;
        if(!agg[sku]) agg[sku] = { sku, titulo: String(r[colTitulo]||'').trim(), unidades:0, receita:0, tarifa_ml:0, envio:0, liquido:0, unidades_ads:0, cancelamentos:0, receita_cancelada:0, periodo_dias:30, ultima_venda: null };
        if(cancelado){
          agg[sku].cancelamentos++;
          agg[sku].receita_cancelada += Math.abs(Number(r[colReceita])||0);
        } else {
          agg[sku].unidades  += Number(r[colUnid])||0;
          agg[sku].receita   += Number(r[colReceita])||0;
          agg[sku].tarifa_ml += Number(r[colTarifa])||0;
          agg[sku].envio     += Number(r[colEnvio])||0;
          agg[sku].liquido   += Number(r[colTotal])||0;
          if(r[colAds] && String(r[colAds]).trim() === 'Sim') agg[sku].unidades_ads++;
          const dv = _parseDataVenda(r);
          if(dv && (!agg[sku].ultima_venda || dv > agg[sku].ultima_venda)) agg[sku].ultima_venda = dv;
        }
      });
      const vendas = Object.values(agg);
      return { vendas, totalUnidades: vendas.reduce((s,v) => s+v.unidades,0), dias: 30 };
    }

    function parseKitUpseller(data){
      const wb = XLSX.read(data, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
      if(rows.length < 2) return {error:'Arquivo vazio'};
      const composicao = [];
      rows.slice(1).forEach(r => {
        const kitSku = r[0] ? String(r[0]).trim() : '';
        const titulo  = r[1] ? String(r[1]).trim() : '';
        const compSku = r[7] ? String(r[7]).trim() : '';
        const qty     = parseFloat(r[8]) || 1;
        if(!kitSku || !compSku) return;
        composicao.push({ sku_comercial: kitSku, titulo_comercial: titulo, sku_componente: compSku, qty });
      });
      return { composicao, kits: [...new Set(composicao.map(c => c.sku_comercial))].length };
    }

    function parseEstoqueUpseller(data){
      const wb = XLSX.read(data, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
      if(rows.length < 2) return {error:'Arquivo vazio'};
      const today = new Date().toISOString().slice(0,10);
      const estoque = [];
      rows.slice(1).forEach(r => {
        const sku = r[0] ? String(r[0]).trim() : '';
        if(!sku) return;
        estoque.push({
          sku, descricao: r[1] ? String(r[1]).trim() : '',
          qtd_galpao: Number(r[8]) || 0,  // col[8] = Disponível (não Estoque Atual col[9])
          qtd_full: 0,
          em_transito: Number(r[5]) || 0,
          custo_medio: 0,
          data_atualizacao: today
        });
      });
      return { estoque };
    }

    function parseFULLEstoqueML(data){
      const wb = XLSX.read(data, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
      if(rows.length < 1) return {error:'Arquivo vazio'};
      const today = new Date().toISOString().slice(0,10);
      const mapa = {};
      rows.forEach(r => {
        const sku = r[2] ? String(r[2]).trim() : '';
        if(!sku) return;
        const disp = Number(r[12]) || 0;
        const total = Number(r[17]) || 0;
        const pend = Math.max(0, total - disp);
        if(mapa[sku]){
          mapa[sku].qtd_full += disp;
          mapa[sku].qtd_full_pendente += pend;
        } else {
          mapa[sku] = { sku, qtd_full: disp, qtd_full_pendente: pend };
        }
      });
      return { estoque: Object.values(mapa), data: today };
    }

    function onImportFULLEstoqueML(input){
      const file = input.files[0];
      if(!file) return;
      input.value = '';
      const reader = new FileReader();
      reader.onload = function(e){
        const result = parseFULLEstoqueML(new Uint8Array(e.target.result));
        if(result.error){ alert('Erro: ' + result.error); return; }
        let novos = 0, atualizados = 0;
        result.estoque.forEach(item => {
          let eg = estoqueGalpao.find(e => e.sku === item.sku);
          if(eg){
            eg.qtd_full = item.qtd_full;
            eg.qtd_full_pendente = item.qtd_full_pendente;
            eg.data_atualizacao = result.data;
            atualizados++;
          } else {
            estoqueGalpao.push({
              sku: item.sku, descricao: item.sku,
              qtd_galpao: 0,
              qtd_full: item.qtd_full,
              qtd_full_pendente: item.qtd_full_pendente,
              em_transito: 0, custo_medio: 0,
              data_atualizacao: result.data
            });
            novos++;
          }
        });
        salvar();
        renderEstoque();
        const sb = document.getElementById('estoque-status-text');
        const bar = document.getElementById('estoque-status-bar');
        if(sb && bar){
          sb.textContent = `FULL ML importado: ${atualizados} atualizados, ${novos} novos — ${result.estoque.length} SKUs — ${result.data}`;
          bar.style.display = '';
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function baixarTemplateCSVComponentes(){
      const header = 'codigo,descricao,custo_unitario,fornecedor,lead_time_dias';
      const exemplo = 'J-2001,Produto Exemplo,45.90,Fornecedor ABC,7';
      const csv = header + '\n' + exemplo;
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'template_componentes.csv'; a.click();
      URL.revokeObjectURL(url);
    }

    // ----- CRUD Componentes -----
    let _editCompIdx = -1;
    function abrirModalComponente(idx){
      _editCompIdx = idx !== undefined && idx >= 0 ? idx : -1;
      const c = _editCompIdx >= 0 ? componentes[_editCompIdx] : {};
      document.getElementById('mc-codigo').value = c.codigo || '';
      document.getElementById('mc-descricao').value = c.descricao || '';
      document.getElementById('mc-custo').value = c.custo_unitario || '';
      document.getElementById('mc-fornecedor').value = c.fornecedor || '';
      document.getElementById('mc-lead-time').value = c.lead_time_dias || '';
      const eg = _editCompIdx >= 0 ? estoqueGalpao.find(e => e.sku === c.codigo) : null;
      document.getElementById('mc-qtd-full').value = eg ? (eg.qtd_full || '') : '';
      const mc = c.codigo ? (metaComp[c.codigo] || {}) : {};
      document.getElementById('mc-meta-full').value = mc.meta_full !== undefined ? mc.meta_full : '';
      document.getElementById('mc-meta-galpao').value = mc.meta_galpao !== undefined ? mc.meta_galpao : '';
      document.getElementById('mc-seg').value = mc.seg !== undefined ? mc.seg : '';
      document.getElementById('mc-alerta').value = mc.alerta !== undefined ? mc.alerta : '';
      document.getElementById('modal-componente-title').textContent = _editCompIdx >= 0 ? 'Editar Componente' : 'Novo Componente';
      document.getElementById('mc-codigo').disabled = _editCompIdx >= 0;
      document.getElementById('modal-componente').style.display = 'flex';
    }
    function fecharModalComponente(){ document.getElementById('modal-componente').style.display = 'none'; }
    function salvarComponente(){
      const codigo = document.getElementById('mc-codigo').value.trim().toUpperCase();
      if(!codigo){ alert('Informe o código'); return; }
      const c = {
        codigo,
        descricao: document.getElementById('mc-descricao').value.trim(),
        custo_unitario: parseFloat(document.getElementById('mc-custo').value) || 0,
        fornecedor: document.getElementById('mc-fornecedor').value.trim(),
        lead_time_dias: parseInt(document.getElementById('mc-lead-time').value) || 0
      };
      if(_editCompIdx >= 0){ componentes[_editCompIdx] = {...componentes[_editCompIdx], ...c}; }
      else {
        if(componentes.find(x => x.codigo === codigo)){ alert('Componente já existe'); return; }
        componentes.push(c);
      }
      const qtdFull = parseFloat(document.getElementById('mc-qtd-full').value);
      if(!isNaN(qtdFull)){
        let eg = estoqueGalpao.find(e => e.sku === codigo);
        if(!eg){ eg = { sku: codigo, descricao: c.descricao, qtd_galpao:0, qtd_full:0, em_transito:0, custo_medio:c.custo_unitario, data_atualizacao: new Date().toISOString().slice(0,10) }; estoqueGalpao.push(eg); }
        eg.qtd_full = qtdFull;
      }
      const mf = document.getElementById('mc-meta-full').value;
      const mg = document.getElementById('mc-meta-galpao').value;
      const ms = document.getElementById('mc-seg').value;
      const ma = document.getElementById('mc-alerta').value;
      const override = {};
      if(mf !== '') override.meta_full = parseInt(mf);
      if(mg !== '') override.meta_galpao = parseInt(mg);
      if(ms !== '') override.seg = parseInt(ms);
      if(ma !== '') override.alerta = parseInt(ma);
      if(Object.keys(override).length > 0){ metaComp[codigo] = {...(metaComp[codigo]||{}), ...override}; }
      else { delete metaComp[codigo]; }
      salvar(); fecharModalComponente(); renderEstoque();
    }
    function deletarComponente(idx){
      if(!confirm('Excluir ' + componentes[idx].codigo + '?')) return;
      const codigo = componentes[idx].codigo;
      componentes.splice(idx, 1);
      estoqueGalpao = estoqueGalpao.filter(e => e.sku !== codigo);
      composicaoKit = composicaoKit.filter(c => c.sku_componente !== codigo);
      salvar(); renderEstoque();
    }

    // ----- CRUD Kits -----
    let _editComposicaoKit = null;
    function abrirModalComposicao(kitSku){
      _editComposicaoKit = kitSku || null;
      const comps = kitSku ? composicaoKit.filter(c => c.sku_comercial === kitSku) : [];
      document.getElementById('mcomp-kit-sku').value = kitSku || '';
      document.getElementById('mcomp-kit-sku').disabled = !!kitSku;
      document.getElementById('mcomp-titulo').value = comps.length > 0 ? (comps[0].titulo_comercial || '') : '';
      document.getElementById('mcomp-custo-kit').value = comps.length > 0 && comps[0].custo_kit > 0 ? comps[0].custo_kit : '';
      var _skuKitEntry = kitSku ? skus.find(function(s){ return s.sku === kitSku; }) : null;
      document.getElementById('mcomp-imposto').value = _skuKitEntry ? (_skuKitEntry.imposto || '') : '';
      document.getElementById('modal-composicao-title').textContent = kitSku ? 'Editar Kit' : 'Novo Kit';
      renderLinhasComposicao(comps.length > 0 ? comps : [{}]);
      document.getElementById('modal-composicao').style.display = 'flex';
    }
    function fecharModalComposicao(){ document.getElementById('modal-composicao').style.display = 'none'; }
    function renderLinhasComposicao(comps){
      const container = document.getElementById('mcomp-linhas');
      const opts = componentes.map(c => `<option value="${c.codigo}">${c.codigo}${c.descricao?' — '+c.descricao:''}</option>`).join('');
      let html = '';
      comps.forEach((c, i) => {
        html += `<div class="d-flex gap-1 mb-1" id="mcomp-linha-${i}">
          <select style="flex:2;" class="mcomp-comp-sku" onchange="atualizarEstoqueComp(${i},this.value)"><option value="">Selecionar componente...</option>${opts}</select>
          <input type="number" class="mcomp-qty" placeholder="Qtd" style="width:70px;" step="0.5" min="0.5" value="${c.qty||1}">
          <span class="mcomp-est-disp" style="width:58px;font-size:11px;padding:3px 5px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#6b7280;">—</span>
          <button class="btn-out btn-sm" onclick="adicionarLinhaComposicao()" title="Adicionar linha">+</button>
          <button class="btn-out btn-sm" style="color:var(--danger);" onclick="removerLinhaComposicao(${i})" title="Remover linha">−</button>
        </div>`;
      });
      container.innerHTML = html;
      comps.forEach((c, i) => {
        const sel = container.querySelectorAll('.mcomp-comp-sku')[i];
        if(sel && c.sku_componente){ sel.value = c.sku_componente; atualizarEstoqueComp(i, c.sku_componente); }
      });
    }
    function atualizarEstoqueComp(idx, sku){
      const linha = document.getElementById('mcomp-linha-'+idx);
      if(!linha) return;
      const el = linha.querySelector('.mcomp-est-disp');
      if(!el) return;
      if(!sku){ el.textContent='—'; el.style.color='#6b7280'; return; }
      const eg = estoqueGalpao.find(function(e){ return e.sku===sku; });
      const efml = estoqueFullML.find ? estoqueFullML.find(function(e){ return e.sku===sku; }) : null;
      const qtd = eg ? ((eg.qtd_galpao||0)+(eg.qtd_full||0)) : (efml ? (efml.aptos_venda||0) : null);
      if(qtd === null){ el.textContent='—'; el.style.color='#6b7280'; return; }
      el.textContent = qtd+' un';
      el.style.color = qtd===0 ? 'var(--danger)' : qtd<5 ? 'var(--warning)' : 'var(--success)';
    }
    function adicionarLinhaComposicao(){
      const container = document.getElementById('mcomp-linhas');
      const i = container.children.length;
      const opts = componentes.map(c => `<option value="${c.codigo}">${c.codigo}${c.descricao?' — '+c.descricao:''}</option>`).join('');
      const div = document.createElement('div');
      div.className = 'd-flex gap-1 mb-1'; div.id = 'mcomp-linha-' + i;
      div.innerHTML = `<select style="flex:2;" class="mcomp-comp-sku"><option value="">Selecionar...</option>${opts}</select>
        <input type="number" class="mcomp-qty" placeholder="Qtd" style="width:70px;" step="0.5" min="0.5" value="1">
        <button class="btn-out btn-sm" onclick="adicionarLinhaComposicao()">+</button>
        <button class="btn-out btn-sm" style="color:var(--danger);" onclick="removerLinhaComposicao(${i})">−</button>`;
      container.appendChild(div);
    }
    function removerLinhaComposicao(i){
      const el = document.getElementById('mcomp-linha-' + i);
      if(el && document.getElementById('mcomp-linhas').children.length > 1) el.remove();
    }
    function salvarComposicaoManual(){
      const kitSku = document.getElementById('mcomp-kit-sku').value.trim().toUpperCase();
      const titulo = document.getElementById('mcomp-titulo').value.trim();
      const custoKit = parseFloat(document.getElementById('mcomp-custo-kit').value) || 0;
      const impostoKit = parseFloat(document.getElementById('mcomp-imposto').value) || 0;
      if(!kitSku){ alert('Informe o SKU do kit'); return; }
      const skuEls = document.querySelectorAll('.mcomp-comp-sku');
      const qtyEls = document.querySelectorAll('.mcomp-qty');
      const novas = [];
      skuEls.forEach((sel, i) => {
        const compSku = sel.value.trim();
        const qty = parseFloat(qtyEls[i] ? qtyEls[i].value : 1) || 1;
        if(compSku) novas.push({ sku_comercial: kitSku, titulo_comercial: titulo, sku_componente: compSku, qty, custo_kit: custoKit });
      });
      if(novas.length === 0){ alert('Adicione ao menos um componente'); return; }
      const isNovo = !composicaoKit.some(c => c.sku_comercial === kitSku);
      const ts = isNovo ? new Date().toISOString() : (composicaoKit.find(c => c.sku_comercial === kitSku) || {}).created_at;
      const novasComTs = novas.map(n => ({ ...n, created_at: ts || new Date().toISOString() }));
      composicaoKit = composicaoKit.filter(c => c.sku_comercial !== kitSku);
      composicaoKit.push(...novasComTs);
      // Sincronizar imposto com skus[]
      var _idxSkuKit = skus.findIndex(function(s){ return s.sku === kitSku; });
      if(_idxSkuKit >= 0){ skus[_idxSkuKit].imposto = impostoKit; if(!skus[_idxSkuKit].custo && custoKit > 0) skus[_idxSkuKit].custo = custoKit; }
      else { skus.push({ sku: kitSku, titulo: titulo, custo: custoKit, imposto: impostoKit, created_at: ts || new Date().toISOString() }); }
      salvar(); fecharModalComposicao(); renderEstoque();
    }
    function deletarComposicaoKit(kitSku){
      if(!confirm('Remover kit ' + kitSku + '?')) return;
      composicaoKit = composicaoKit.filter(c => c.sku_comercial !== kitSku);
      skus = skus.filter(s => s.sku !== kitSku);
      salvar(); renderComposicoesTab(); renderSKUs();
    }

    function mostrarUltimosCadastrados(){
      const modal = document.getElementById('modal-ultimos-cadastrados');
      const lista = document.getElementById('ultimos-cadastrados-lista');
      if(!modal || !lista) return;
      const fmtDt = function(iso){ if(!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}); };
      const skuItems = skus
        .filter(function(s){ return s.created_at; })
        .map(function(s){ return { sku: s.sku, titulo: s.titulo||'', tipo: 'SKU', ts: s.created_at }; });
      const kitSkusVistos = new Set();
      const kitItems = composicaoKit
        .filter(function(c){ return c.created_at && !kitSkusVistos.has(c.sku_comercial) && kitSkusVistos.add(c.sku_comercial); })
        .map(function(c){ return { sku: c.sku_comercial, titulo: c.titulo_comercial||'', tipo: 'Kit', ts: c.created_at }; });
      const galpaoItems = estoqueGalpao
        .filter(function(e){ return e.created_at; })
        .map(function(e){ return { sku: e.sku, titulo: e.descricao||'', tipo: 'Galpão', ts: e.created_at }; });
      const todos = [...skuItems, ...kitItems, ...galpaoItems].sort(function(a,b){ return b.ts.localeCompare(a.ts); }).slice(0,30);
      if(todos.length === 0){
        lista.innerHTML = '<div style="color:#6b7280;text-align:center;padding:24px;">Nenhum registro com data de criação.<br><small>Registros criados antes desta versão não têm data.</small></div>';
      } else {
        lista.innerHTML = todos.map(function(it){
          const cor = it.tipo==='Kit' ? '#7c3aed' : it.tipo==='Galpão' ? '#0ea5e9' : '#374151';
          return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--gray-100);">' +
            '<span style="font-size:10px;font-weight:600;padding:2px 6px;background:' + (it.tipo==='Kit'?'#ede9fe':it.tipo==='Galpão'?'#e0f2fe':'#f3f4f6') + ';border-radius:4px;color:' + cor + ';white-space:nowrap;">' + it.tipo + '</span>' +
            '<span style="font-family:monospace;font-size:12px;min-width:140px;">' + it.sku + '</span>' +
            '<span style="color:#6b7280;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + it.titulo + '</span>' +
            '<span style="font-size:11px;color:#9ca3af;white-space:nowrap;">' + fmtDt(it.ts) + '</span>' +
            '</div>';
        }).join('');
      }
      modal.classList.add('open');
    }

    // ----- Templates CSV -----
    function baixarTemplateSKUUn(){
      const header = 'SKU,Descricao,Custo_unitario,Imposto_pct,Lead_time_dias,Fornecedor';
      const exemplo = 'J-2001,Vaso de Barro Pequeno,12.50,0,7,Fornecedor ABC';
      const blob = new Blob([header + '\n' + exemplo + '\n'], {type:'text/csv;charset=utf-8;'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'template_sku_un.csv'; a.click();
    }
    function baixarTemplateKit(){
      const header = 'SKU_kit,Titulo_kit,Custo_kit,SKU_componente,Quantidade';
      const ex1 = 'J-2021-BANANA-CINZA-CASCA,Vaso Completo Bananeira,45.00,J-2001,1';
      const ex2 = 'J-2021-BANANA-CINZA-CASCA,Vaso Completo Bananeira,45.00,J-2005,2';
      const blob = new Blob([header + '\n' + ex1 + '\n' + ex2 + '\n'], {type:'text/csv;charset=utf-8;'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'template_kit.csv'; a.click();
    }

    // ----- Importar CSV templates -----
    function importarCSVSKUUn(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const lines = e.target.result.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('SKU,'));
          let adicionados = 0, atualizados = 0;
          lines.forEach(line => {
            const cols = line.split(',');
            if(cols.length < 2) return;
            const sku = (cols[0]||'').trim().toUpperCase();
            const desc = (cols[1]||'').trim();
            const custo = parseFloat(cols[2])||0;
            const imposto = parseFloat(cols[3])||0;
            const lead = parseInt(cols[4])||0;
            const forn = (cols[5]||'').trim();
            if(!sku) return;
            const idx = componentes.findIndex(c => c.codigo === sku);
            if(idx >= 0){
              componentes[idx].descricao = desc || componentes[idx].descricao;
              componentes[idx].custo_unitario = custo > 0 ? custo : componentes[idx].custo_unitario;
              componentes[idx].lead_time_dias = lead > 0 ? lead : componentes[idx].lead_time_dias;
              componentes[idx].fornecedor = forn || componentes[idx].fornecedor;
              atualizados++;
            } else {
              componentes.push({ codigo: sku, descricao: desc, custo_unitario: custo, imposto_pct: imposto, lead_time_dias: lead, fornecedor: forn });
              adicionados++;
            }
          });
          salvar(); renderEstoque();
          alert(`✅ SKU/un importados: ${adicionados} novos · ${atualizados} atualizados.`);
        } catch(err){ alert('Erro ao processar CSV: ' + err.message); }
        input.value = '';
      };
      reader.readAsText(file, 'UTF-8');
    }

    function importarGalpaoEstoqueOnly(input){
      var file = input.files[0];
      if(!file) return;
      var reader = new FileReader();
      reader.onload = function(e){
        try {
          var wb = XLSX.read(e.target.result, {type:'array'});
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          var atualizados = 0, naoEncontrados = 0;
          var hoje = new Date().toISOString().slice(0,10);
          for(var i = 1; i < rows.length; i++){
            var row = rows[i];
            var sku = String(row[0]||''). trim();
            if(!sku) continue;
            var qtd = parseFloat(row[9]) || 0;
            var titulo = String(row[1]||''). trim();
            var idx = estoqueGalpao.findIndex(function(e){ return e.sku === sku; });
            if(idx >= 0){
              estoqueGalpao[idx].qtd_galpao = qtd;
              estoqueGalpao[idx].data_atualizacao = hoje;
              if(titulo) estoqueGalpao[idx].descricao = titulo;
              atualizados++;
            } else {
              estoqueGalpao.push({ sku: sku, descricao: titulo, qtd_galpao: qtd, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: hoje });
              naoEncontrados++;
            }
          }
          salvar();
          renderEstoqueIfActive();
          alert('Estoque Galpão atualizado!\n\n' + atualizados + ' atualizados\n' + naoEncontrados + ' novos no galpão (sem SKU cadastrado em Produtos)');
        } catch(err){
          alert('Erro ao importar: ' + err.message);
        }
        input.value = '';
      };
      reader.readAsArrayBuffer(file);
    }
    function importarUpsellerEstoque(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = function(e){
        try {
          const wb = XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          // Linha 0 é cabeçalho: ["SKU","Título","Armazém",...,"Estoque Atual","Custo Médio","Subtotal"]
          let criados = 0, atualizados = 0, semSku = 0;
          const hoje = new Date().toISOString().slice(0,10);
          for(let i = 1; i < rows.length; i++){
            const row = rows[i];
            const sku = String(row[0]||'').trim();
            if(!sku){ semSku++; continue; }
            const titulo  = String(row[1]||'').trim();
            const qtd     = parseFloat(row[9]) || 0;
            // custo NAO lido do Upseller — custo é editado manualmente ou via CSV
            // Upsert em skus[] — CONTAGEM baseada aqui (não no estoqueGalpao)
            const idxSku = skus.findIndex(s => s.sku === sku);
            if(idxSku >= 0){
              if(titulo) skus[idxSku].titulo = titulo;
              atualizados++;
            } else {
              skus.push({ sku, titulo, custo: 0, imposto: 0 });
              criados++;
            }
            // Upsert em estoqueGalpao[] (somente qtd)
            const idxEg = estoqueGalpao.findIndex(e => e.sku === sku);
            if(idxEg >= 0){
              estoqueGalpao[idxEg].qtd_galpao = qtd;
              estoqueGalpao[idxEg].data_atualizacao = hoje;
              if(titulo) estoqueGalpao[idxEg].descricao = titulo;
            } else {
              estoqueGalpao.push({ sku, descricao: titulo, qtd_galpao: qtd, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: hoje });
            }
          }
          salvar();
          renderSKUs();
          renderEstoqueIfActive();
          alert('Upseller - Lista de Estoque importada!\n\nCriados: ' + criados + '\nAtualizados: ' + atualizados + '\nIgnorados (sem SKU): ' + semSku);
        } catch(err){
          alert('Erro ao importar Lista Upseller:\n' + err.message);
        } finally {
          input.value = '';
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function importarUpsellerKits(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = function(e){
        try {
          const wb = XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          // Linha 0 é cabeçalho: ["KIT SKU","Título",...,"SKU de Produto","Qtd. SKU de Produto"]
          const novos = {}; // sku_comercial → { titulo, comps: [{sku_componente, qty}] }
          for(let i = 1; i < rows.length; i++){
            const row = rows[i];
            const kitSku  = String(row[0]||'').trim();
            const titulo  = String(row[1]||'').trim();
            const compSku = String(row[7]||'').trim();
            const qty     = parseFloat(row[8]) || 1;
            if(!kitSku || !compSku) continue;
            if(!novos[kitSku]) novos[kitSku] = { titulo, comps: [] };
            novos[kitSku].comps.push({ sku_componente: compSku, qty });
          }
          const kitSkus = Object.keys(novos);
          if(kitSkus.length === 0){ alert('Nenhum kit encontrado no arquivo.'); return; }
          // Remove entradas antigas dos kits que vão ser reimportados
          composicaoKit = composicaoKit.filter(c => !kitSkus.includes(c.sku_comercial));
          // Insere os novos
          kitSkus.forEach(kitSku => {
            const { titulo, comps } = novos[kitSku];
            comps.forEach(c => {
              composicaoKit.push({ sku_comercial: kitSku, titulo_comercial: titulo, sku_componente: c.sku_componente, qty: c.qty, custo_kit: 0 });
            });
          });
          salvar();
          setSkuTab('composicoes');
          alert('Upseller - Kits importados!\n\n' + kitSkus.length + ' kits importados.');
        } catch(err){
          alert('Erro ao importar Kits Upseller:\n' + err.message);
        } finally {
          input.value = '';
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function importarCSVKit(input){
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const sq = v => String(v||'').trim().replace(/^"|"$/g,'');
          const lines = e.target.result.split('\n').map(l => l.trim())
            .filter(l => l && !l.startsWith('SKU_kit,') && !l.startsWith('sku_comercial,'));
          const novosMap = {};
          lines.forEach(line => {
            const cols = line.split(',');
            if(cols.length < 4) return;
            const kitSku = sq(cols[0]).toUpperCase();
            const titulo = sq(cols[1]);
            const custoKit = parseFloat(sq(cols[2]))||0;
            const compSku = sq(cols[3]).toUpperCase();
            const qty = parseFloat(sq(cols[4]))||1;
            if(!kitSku || !compSku) return;
            if(!novosMap[kitSku]) novosMap[kitSku] = { titulo, custoKit, comps: [] };
            novosMap[kitSku].comps.push({ sku_componente: compSku, qty });
          });
          const kitSkus = Object.keys(novosMap);
          if(kitSkus.length === 0){ alert('Nenhum kit encontrado no arquivo.'); return; }
          composicaoKit = composicaoKit.filter(c => !kitSkus.includes(c.sku_comercial));
          kitSkus.forEach(kitSku => {
            const { titulo, custoKit, comps } = novosMap[kitSku];
            comps.forEach(c => {
              composicaoKit.push({ sku_comercial: kitSku, titulo_comercial: titulo, sku_componente: c.sku_componente, qty: c.qty, custo_kit: custoKit });
            });
          });
          salvar(); renderEstoque();
          alert(`✅ ${kitSkus.length} kits importados.`);
        } catch(err){ alert('Erro ao processar CSV: ' + err.message); }
        input.value = '';
      };
      reader.readAsText(file, 'UTF-8');
    }

    // ===== PWA — SERVICE WORKER =====
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('service-worker.js').catch(()=>{});
    }

    // ===== START =====
    // Verifica se já existe sessão ativa (usuário já logado)
    supa.auth.getSession().then(({data}) => {
      if(data.session && data.session.user){
        entrarNoApp(data.session.user);
      }
      // Se não tem sessão, a tela de login já está visível (class "ativo")
    });
