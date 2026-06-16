// ===== P11 — MOTOR DE REPOSIÇÃO =====

    function setEstoqueTab(tab){
      estoqueCurrentTab = tab;
      const tabs = ['galpao','full','vendas','reposicao','skuunit','excesso'];
      tabs.forEach(t => {
        const btn = document.getElementById('estoque-tab-' + t);
        const view = document.getElementById('estoque-view-' + t);
        if(btn) btn.classList.toggle('active', t === tab);
        if(view) view.style.display = t === tab ? '' : 'none';
      });
      if(tab === 'reposicao') renderReposicaoTab();
      else if(tab === 'excesso') renderExcessoTab();
      else if(tab === 'vendas') renderVendasSkuTab();
      else if(tab === 'skuunit') renderSkuUnitarioTab();
      else if(tab === 'full') renderEstoqueFullTab();
      else if(tab === 'galpao') renderEstoqueGalpaoAbaTab();
    }

    let analiseCurrentTab = 'rentabilidade';

    function setAnaliseTab(tab){
      analiseCurrentTab = tab;
      const tabs = ['rentabilidade','cancelamentos','ads'];
      tabs.forEach(t => {
        const btn = document.getElementById('analise-tab-' + t);
        const view = document.getElementById('analise-view-' + t);
        if(btn) btn.classList.toggle('active', t === tab);
        if(view) view.style.display = t === tab ? '' : 'none';
      });
      if(tab === 'rentabilidade') renderRentabilidadeTab();
      else if(tab === 'cancelamentos') renderCancelamentosTab();
      else if(tab === 'ads') renderADSTab();
    }

    function renderAnalise(){
      setAnaliseTab(analiseCurrentTab || 'rentabilidade');
    }

    function renderEstoque(){
      atualizarStatusBarEstoque();
      setEstoqueTab(estoqueCurrentTab || 'galpao');
    }

    function renderEstoqueIfActive(){
      const v = document.getElementById('view-estoque');
      if(v && v.style.display !== 'none') renderEstoque();
    }

    // ===== ESTOQUE FULL ML =====
    function renderEstoqueFullTab(){
      const vazio = document.getElementById('estoque-full-vazio');
      const card = document.getElementById('estoque-full-card');
      const btnExp = document.getElementById('btn-export-full');
      const st = document.getElementById('estoque-full-status');
      if(!vazio || !card) return;
      if(estoqueFullML.length === 0){
        vazio.style.display = '';
        card.style.display = 'none';
        if(btnExp) btnExp.style.display = 'none';
        return;
      }
      vazio.style.display = 'none';
      card.style.display = '';
      if(btnExp) btnExp.style.display = '';
      const tbody = document.getElementById('tbody-estoque-full');
      if(!tbody) return;
      const rows = estoqueFullML.slice().sort((a,b) => (a.sku||'').localeCompare(b.sku||''));
      tbody.innerHTML = rows.map(e => {
        const cls = e.aptos_venda === 0 ? 'color:#ef4444;font-weight:600;' : (e.aptos_venda < 5 ? 'color:#f97316;font-weight:600;' : '');
        return `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:7px 10px;white-space:nowrap;font-family:monospace;font-size:11px;">${e.sku||''}</td>
          <td style="padding:7px 6px;color:#374151;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.titulo||''}">${e.titulo||'-'}</td>
          <td style="padding:7px 6px;text-align:right;${cls}" title="Disponíveis para venda">${e.aptos_venda||0}</td>
          <td style="padding:7px 6px;text-align:right;color:#64748b;" title="Em separação">${e.em_separacao||0}</td>
          <td style="padding:7px 6px;text-align:right;color:#0ea5e9;" title="A caminho do CD">${e.em_transito||0}</td>
          <td style="padding:7px 6px;text-align:right;color:#ef4444;" title="Avariados">${e.nao_aptos||0}</td>
          <td style="padding:7px 6px;text-align:right;font-weight:600;" title="Total no CD">${e.total_cd||0}</td>
          <td style="padding:7px 6px;text-align:right;color:#7c3aed;font-size:11px;" title="Vendas 30d">${e.vendas_30d||0}</td>
        </tr>`;
      }).join('');
      makeSortable('tbody-estoque-full');
      initResizableCols('tbody-estoque-full');
      if(st){
        const dt = estoqueFullML._syncAt ? new Date(estoqueFullML._syncAt).toLocaleString('pt-BR') : '';
        const label = estoqueFullML._fonte === 'xls' ? 'Importado via XLS' : 'Última sincronização';
        st.textContent = dt ? `${label}: ${dt} — ${estoqueFullML.length} SKUs` : `${estoqueFullML.length} SKUs carregados`;
      }
    }

    async function sincronizarEstoqueFull(){
      const btn = document.getElementById('btn-sync-full');
      const st = document.getElementById('estoque-full-status');
      if(btn){ btn.disabled = true; btn.textContent = '⏳ Buscando...'; }
      if(st) st.textContent = 'Conectando...';
      try {
        const sd = await supa.auth.getSession();
        const session = sd && sd.data && sd.data.session;
        if(!session) throw new Error('Sessão expirada — faça login novamente.');
        const url = SUPA_URL + '/functions/v1/ml-inventory';
        if(st) st.textContent = 'Buscando itens no ML...';
        const ctrl = new AbortController();
        const toid = setTimeout(() => ctrl.abort(), 50000);
        let res;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario_id: session.user.id }),
            signal: ctrl.signal
          });
        } finally { clearTimeout(toid); }
        if(st) st.textContent = 'Processando resposta...';
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch(e) { throw new Error(`HTTP ${res.status} — resposta inesperada`); }
        if(!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
        estoqueFullML = json.itens || [];
        estoqueFullML._syncAt = new Date().toISOString();
        localStorage.setItem('mk_estoque_full_ml', JSON.stringify({ itens: estoqueFullML, syncAt: estoqueFullML._syncAt }));
        renderEstoqueFullTab();
      } catch(err){
        if(st) st.textContent = 'Erro: ' + err.message;
        alert('Erro ao sincronizar estoque Full:\n' + err.message);
      } finally {
        if(btn){ btn.disabled = false; btn.textContent = '🔄 Sincronizar ML'; }
      }
    }

    function exportarKitsCSV(){
      if(composicaoKit.length === 0){ alert('Nenhum kit cadastrado.'); return; }
      var rows = ['sku_comercial,titulo_comercial,sku_componente,qty,custo_kit'];
      composicaoKit.forEach(function(k){
        rows.push([
          k.sku_comercial, k.titulo_comercial||'', k.sku_componente,
          k.qty, (k.custo_kit||0).toFixed(2)
        ].map(function(v){ return '"' + String(v||0).replace(/"/g,'""')+'"'; }).join(','));
      });
      var blob = new Blob(['\uFEFF' + rows.join('\n')], {type:'text/csv;charset=utf-8'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kits_' + getToday() + '.csv';
      a.click();
    }
    function exportarEstoqueFullCSV(){
      if(estoqueFullML.length === 0){ alert('Nada para exportar.'); return; }
      const esc = s => (String(s||'')).replace(/;/g,'|');
      const header = 'sku;titulo;aptos_venda;em_transito;pendente;total';
      const linhas = estoqueFullML.map(e => [
        esc(e.sku), esc(e.titulo), e.aptos_venda||0, e.em_transito||0, e.pendente||0,
        (e.aptos_venda||0)+(e.em_transito||0)+(e.pendente||0)
      ].join(';'));
      const blob = new Blob(['\uFEFF' + header + '\n' + linhas.join('\n')], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'estoque_full_' + getToday() + '.csv';
      a.click();
    }

    function importarEstoqueFullXLS(input){
      const file = input.files[0];
      if(!file) return;
      const st = document.getElementById('estoque-full-status');
      if(st) st.textContent = 'Lendo arquivo...';
      const reader = new FileReader();
      reader.onload = function(e){
        try {
          const wb = XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
          const itens = [];
          for(const row of rows){
            const sku = String(row[2]||'').trim();
            if(!sku) continue;
            // Ignora linha de cabeçalho se houver
            if(/^sku|seller.?sku/i.test(sku)) continue;
            const titulo = String(row[5]||'').trim();
            const aptos = parseInt(row[12])||0;
            const em_separacao = parseInt(row[14])||0;
            const em_transito = parseInt(row[15])||0;
            const nao_aptos = parseInt(row[16])||0;
            const total_cd = parseInt(row[17])||0;
            const total_geral = parseInt(row[22])||0;
            const vendas_30d = parseInt(row[10])||0;
            const itemId = String(row[0]||'').trim();
            const status = String(row[8]||'').trim();
            const prazo = String(row[28]||'-').trim();
            itens.push({ sku, titulo, aptos_venda: aptos, em_separacao, em_transito, nao_aptos, total_cd, total_geral, vendas_30d, item_id: itemId, status, prazo });
          }
          if(itens.length === 0){ alert('Nenhum SKU encontrado no arquivo.\nVerifique se o arquivo é o relatório "Estoque Full" do Mercado Livre.'); if(st) st.textContent = 'Importação cancelada — arquivo inválido'; return; }
          estoqueFullML = itens;
          estoqueFullML._syncAt = new Date().toISOString();
          estoqueFullML._fonte = 'xls';
          localStorage.setItem('mk_estoque_full_ml', JSON.stringify({ itens: estoqueFullML, syncAt: estoqueFullML._syncAt, fonte: 'xls' }));
          salvar();
          renderEstoqueFullTab();
          if(st) st.textContent = 'Importado via XLS: ' + new Date().toLocaleString('pt-BR') + ' — ' + itens.length + ' SKUs';
          alert('Estoque Full ML importado!\n\n' + itens.length + ' SKUs');
        } catch(err){
          if(st) st.textContent = 'Erro ao importar: ' + err.message;
          alert('Erro ao importar XLS:\n' + err.message);
        } finally {
          input.value = '';
        }
      };
      reader.readAsArrayBuffer(file);
    }
