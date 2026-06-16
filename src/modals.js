// ===== MODALS =====
    function abrirModalLanc(){
      editandoIdx = null;
      document.getElementById('modal-lanc-title').textContent = 'Novo Lançamento';
      document.getElementById('btn-del-lanc').style.display = 'none';
      
      // Limpar form
      document.getElementById('lanc-desc').value = '';
      document.getElementById('lanc-forn').value = '';
      document.getElementById('lanc-val').value = '';
      document.getElementById('lanc-data').value = '';
      document.getElementById('lanc-pago').checked = false;
      
      // Popular categorias
      const selCat = document.getElementById('lanc-cat');
      selCat.innerHTML = categorias.map(c => `<option>${c.nome}</option>`).join('');
      
      // Popular categorias nos 3 forms
      const opts = categorias.map(c => `<option>${c.nome}</option>`).join('');
      ['lanc-cat','parc-cat','rec-lanc-cat'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.innerHTML = opts;
      });

      switchTab('unico');
      document.getElementById('modal-lanc').classList.add('open');
    }

    function editarLanc(idx){
      editandoIdx = idx;
      const p = pagamentos[idx];
      
      document.getElementById('modal-lanc-title').textContent = 'Editar Lançamento';
      document.getElementById('btn-del-lanc').style.display = 'block';
      
      document.getElementById('lanc-desc').value = p.desc;
      document.getElementById('lanc-forn').value = p.forn || '';
      document.getElementById('lanc-val').value = p.val;
      document.getElementById('lanc-data').value = p.data;
      document.getElementById('lanc-pago').checked = p.pago;
      
      const selCat = document.getElementById('lanc-cat');
      selCat.innerHTML = categorias.map(c => `<option>${c.nome}</option>`).join('');
      selCat.value = p.cat;
      
      switchTab('unico');
      document.getElementById('modal-lanc').classList.add('open');
    }
    
    function abrirModalImportarProdutos(){
      document.getElementById('modal-importar-produtos').classList.add('open');
    }
    function abrirModalImportarKits(){
      document.getElementById('modal-importar-kits-prod').classList.add('open');
    }
    function deletarTodosSKUs(){
      if(skus.length === 0){ alert('Nenhum SKU cadastrado.'); return; }
      if(!confirm('Apagar TODOS os ' + skus.length + ' SKUs cadastrados? Esta ação não pode ser desfeita.')) return;
      skus = [];
      salvar(); renderSKUs();
    }
    function abrirModalLoteKits(){
      document.getElementById('imposto-lote-kits').value = '';
      var kitSkus = [...new Set(composicaoKit.map(function(c){ return c.sku_comercial; }))];
      var prev = document.getElementById('lote-kits-preview');
      if(prev) prev.textContent = kitSkus.length + ' kits serão afetados';
      document.getElementById('modal-imposto-lote-kits').classList.add('open');
    }
    function aplicarImpostoLoteKits(){
      var novoImposto = document.getElementById('imposto-lote-kits').value;
      if(novoImposto === ''){ alert('Informe o imposto'); return; }
      novoImposto = parseFloat(novoImposto);
      if(isNaN(novoImposto)){ alert('Valor inválido'); return; }
      var kitSkus = new Set(composicaoKit.map(function(c){ return c.sku_comercial; }));
      var afetados = 0;
      kitSkus.forEach(function(kitSku){
        var idx = skus.findIndex(function(s){ return s.sku === kitSku; });
        if(idx >= 0){
          skus[idx].imposto = novoImposto;
        } else {
          skus.push({ sku: kitSku, titulo: '', custo: 0, imposto: novoImposto });
        }
        afetados++;
      });
      salvar();
      fecharModal('modal-imposto-lote-kits');
      alert('Imposto atualizado em ' + afetados + ' kits.');
    }
    function deletarTodosKits(){
      var total = new Set(composicaoKit.map(function(c){ return c.sku_comercial; })).size;
      if(total === 0){ alert('Nenhum kit cadastrado.'); return; }
      if(!confirm('Apagar TODOS os ' + total + ' kits cadastrados? Esta ação não pode ser desfeita.')) return;
      composicaoKit = [];
      salvar(); renderComposicoesTab();
    }
    function abrirModalImportarEstoque(){
      document.getElementById('modal-importar-estoque').classList.add('open');
    }
    function fecharModal(id){
      document.getElementById(id).classList.remove('open');
    }
    
    function switchTab(tab){
      tabAtual = tab;
      
      // Tabs
      document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
      document.querySelector(`.tabs .tab:nth-child(${tab==='unico'?1:tab==='parcelado'?2:3})`).classList.add('active');
      
      // Forms
      document.getElementById('form-unico').style.display = tab === 'unico' ? 'block' : 'none';
      document.getElementById('form-parcelado').style.display = tab === 'parcelado' ? 'block' : 'none';
      document.getElementById('form-recorrente').style.display = tab === 'recorrente' ? 'block' : 'none';
    }
    
    function salvarLanc(){
      const lanc = {
        desc: document.getElementById('lanc-desc').value,
        forn: document.getElementById('lanc-forn').value,
        val: parseFloat(document.getElementById('lanc-val').value),
        data: document.getElementById('lanc-data').value,
        cat: document.getElementById('lanc-cat').value,
        pago: document.getElementById('lanc-pago').checked,
        tipo: 'unico'
      };
      
      if(!lanc.desc || !lanc.val || !lanc.data){
        alert('Preencha todos os campos obrigatórios');
        return;
      }
      
      if(editandoIdx !== null){
        pagamentos[editandoIdx] = lanc;
      } else {
        pagamentos.push(lanc);
      }
      
      salvar();
      fecharModal('modal-lanc');
      renderPagar();
      recalc();
    }
    
    function deletarLanc(){
      if(!confirm('Deletar este lançamento?')) return;
      pagamentos.splice(editandoIdx, 1);
      salvar();
      fecharModal('modal-lanc');
      renderPagar();
      recalc();
    }
    
    // ===== CONTROLES =====
    function togglePlanilha(mode){
      planilhaMode = mode;
      if(planilhaViewMode === 'cal') renderPlanilhaCal();
      else renderPlanilha();
    }
    
    function recalc(){
      atualizarRegressao();
      if(document.getElementById('view-dashboard').classList.contains('active')){
        renderDashboard();
      }
      if(document.getElementById('view-planilha').classList.contains('active')){
        if(planilhaViewMode === 'cal') renderPlanilhaCal(); else renderPlanilha();
      }
    }
