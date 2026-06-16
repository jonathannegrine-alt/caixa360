// ===== STORAGE =====
    function salvar(){
      localStorage.setItem('mk_pagamentos', JSON.stringify(pagamentos));
      localStorage.setItem('mk_liberacoes', JSON.stringify(liberacoes));
      localStorage.setItem('mk_categorias', JSON.stringify(categorias));
      localStorage.setItem('mk_skus', JSON.stringify(skus));
      localStorage.setItem('mk_componentes', JSON.stringify(componentes));
      localStorage.setItem('mk_composicao', JSON.stringify(composicaoKit));
      localStorage.setItem('mk_vendas_sku', JSON.stringify(vendasSku));
      localStorage.setItem('mk_vendas_meta', JSON.stringify(vendasImportMeta));
      localStorage.setItem('mk_estoque_galpao', JSON.stringify(estoqueGalpao));
      if(typeof estoqueFullML !== 'undefined' && estoqueFullML && estoqueFullML.length > 0){
        localStorage.setItem('mk_estoque_full_ml', JSON.stringify({ itens: Array.from(estoqueFullML), syncAt: estoqueFullML._syncAt||null, fonte: estoqueFullML._fonte||'xls' }));
      }
      localStorage.setItem('mk_ordens_compra', JSON.stringify(ordensCompra));
      localStorage.setItem('mk_meta_comp', JSON.stringify(metaComp));
      localStorage.setItem('mk_p11_cfg', JSON.stringify({metaFullDias, metaGalpaoDias, diasSeguranca, alertaCriticoDias}));
      salvarCfg();
      salvarP11Supabase();
      // Sync nuvem (fire-and-forget — localStorage já garantiu os dados)
      salvarSupabase();
      salvarLiberacoesSupabase();
    }

    function salvarCfg(){
      localStorage.setItem('mk_cfg', JSON.stringify({
        cfgDelay, cfgPct, reservaMinima, periodoHistorico,
        saldoAtual, saldoMP, saldoOutros, modoProjecao, periodoHistoricoML,
        patCfg
      }));
      salvarCfgSupabase();
    }

    function carregar(){
      const p = localStorage.getItem('mk_pagamentos');
      const l = localStorage.getItem('mk_liberacoes');
      const c = localStorage.getItem('mk_categorias');
      const s = localStorage.getItem('mk_skus');
      const cfg = localStorage.getItem('mk_cfg');

      if(p) pagamentos = JSON.parse(p);
      if(l) liberacoes = JSON.parse(l);
      if(c) categorias = JSON.parse(c);
      if(s) skus = JSON.parse(s);

      const comp = localStorage.getItem('mk_composicao');
      const compon = localStorage.getItem('mk_componentes');
      const vs = localStorage.getItem('mk_vendas_sku');
      const eg = localStorage.getItem('mk_estoque_galpao');
      if(compon) componentes = JSON.parse(compon);
      if(comp) composicaoKit = JSON.parse(comp);
      if(vs) vendasSku = JSON.parse(vs);
      if(eg) estoqueGalpao = JSON.parse(eg);
      const efml = localStorage.getItem('mk_estoque_full_ml');
      if(efml){ const o = JSON.parse(efml); estoqueFullML = o.itens || []; estoqueFullML._syncAt = o.syncAt || null; estoqueFullML._fonte = o.fonte || 'api'; }
      const oc = localStorage.getItem('mk_ordens_compra');
      if(oc) ordensCompra = JSON.parse(oc);
      const mc = localStorage.getItem('mk_meta_comp');
      if(mc) metaComp = JSON.parse(mc);
      const p11cfg = localStorage.getItem('mk_p11_cfg');
      if(p11cfg){ const o = JSON.parse(p11cfg); metaFullDias=o.metaFullDias||30; metaGalpaoDias=o.metaGalpaoDias||30; diasSeguranca=o.diasSeguranca||15; alertaCriticoDias=o.alertaCriticoDias||15; }

      if(cfg){
        const obj = JSON.parse(cfg);
        cfgDelay = obj.cfgDelay || 8;
        saldoMP = obj.saldoMP || 0;
        saldoOutros = obj.saldoOutros || 0;
        saldoAtual = obj.saldoAtual || (saldoMP + saldoOutros);
        cfgPct = obj.cfgPct !== undefined ? obj.cfgPct : 0.75;
        reservaMinima = obj.reservaMinima || 0;
        periodoHistorico = obj.periodoHistorico || 30;
        modoProjecao = obj.modoProjecao || 'extrato';
      }

      if(pagamentos.length === 0 && liberacoes.length === 0){
        carregarDadosExemplo();
        salvar();
      }
    }
