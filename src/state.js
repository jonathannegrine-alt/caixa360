// ===== ESTADO GLOBAL =====
    let pagamentos = [];
    let liberacoes = [];
    let skus = [];
    let categorias = [];
    
    // Configurações
    let saldoAtual = 0;    // total = saldoMP + saldoOutros
    let saldoMP = 0;        // saldo Mercado Pago (pode vir da API)
    let saldoOutros = 0;    // outros bancos (manual)
    let cfgDelay = 8;       // mantido para compatibilidade — lógica agora usa faixas fixas D+1-7/D+8+
    let cfgPct = 0.75;      // Fator Prudencial de Caixa (padrão 75%)
    let reservaMinima = 0;
    let periodoHistorico = 30;
    let modoProjecao = 'extrato'; // 'extrato' | 'pipeline' | 'hibrido'
    let extratoHistorico = [];   // [{data, val_liquido, qtd_pedidos}] — creditados reais (released=yes)
    let diasPipeline = 0;        // dias distintos de snapshot acumulados
    let periodoHistoricoML = 90; // período usado no cálculo da projeção (15/30/60/90)
    
    // P1 — Regressão linear
    let regressaoAtual = null;       // {a, b, xUltimo, dataUltimo} ou null
    let modoProjecaoAtivo = 'media'; // 'media' | 'tendencia'

    // P11 — Motor de Reposição
    let componentes = [];    // [{codigo, descricao, custo_unitario, fornecedor, lead_time_dias}]
    let composicaoKit = [];  // [{sku_comercial, titulo_comercial, sku_componente, qty}]
    let vendasSku = [];      // [{sku, titulo, unidades, receita, tarifa_ml, envio, liquido, unidades_ads, cancelamentos, periodo_dias}]
    let vendasImportMeta = { importAt: null, periodo: 30 };
    let vendasFiltroInatividade = 0;
    let filtroVendasSku = '';
    let filtroMinVendas = 0;
    let filtroKits = '';
    let repVendasDias = 30;
    let skuunitVendasDias = 30;
    let _undoBuffer = null;
    let _apagarPendente = null;
    let estoqueGalpao = [];  // [{sku, descricao, qtd_galpao, qtd_full, qtd_full_pendente, em_transito, custo_medio, data_atualizacao}]
    let ordensCompra = [];    // [{id, data, fornecedor, forma_pagamento, status, itens, capital_total, detalhamento, data_criacao}]
    // Regras globais (padrão)
    let metaFullDias = 30;      // meta de dias de cobertura no FULL
    let metaGalpaoDias = 30;    // meta de dias de cobertura no galpão
    let diasSeguranca = 15;     // buffer de segurança (atraso fornecedor etc.)
    let alertaCriticoDias = 15; // abaixo disso → status crítico
    // Regras por componente (override do padrão) — {[sku]: {meta_full, meta_galpao, seg, alerta}}
    let metaComp = {};
    let estoqueCurrentTab = 'galpao';
    let estoqueFullML = []; // [{sku, titulo, aptos_venda, em_transito, pendente}]

    // Estado UI
    let planilhaMode = 'confirmado';
    let planilhaDias = 30;
    let planilhaCustomMode = false;
    let planilhaViewMode = 'tabela';
    let planilhaCal_mes = new Date();
    let calendarioMode = 'confirmado';
    let mesAtual = new Date();
    let tipoSimulador = 'vista';
    let editandoIdx = null;
    let editandoIdxSKU = null;
    let tabAtual = 'unico';
    
    // ===== DADOS DE EXEMPLO =====
    function carregarDadosExemplo(){
      // Categorias padrão
      categorias = [
        {nome:'Fornecedor',               impactaDRE:true,  tipoPassivo:'divida'},
        {nome:'Imposto',                  impactaDRE:true,  tipoPassivo:'divida'},
        {nome:'Pró-labore',               impactaDRE:true,  tipoPassivo:'operacional'},
        {nome:'Salário',                  impactaDRE:true,  tipoPassivo:'operacional'},
        {nome:'Aluguel',                  impactaDRE:true,  tipoPassivo:'operacional'},
        {nome:'ADS/Marketing',            impactaDRE:true,  tipoPassivo:'operacional'},
        {nome:'Capital de Giro - Amortização', impactaDRE:false, tipoPassivo:'divida'},
        {nome:'Capital de Giro - Juros',  impactaDRE:true,  tipoPassivo:'divida'},
        {nome:'Outro',                    impactaDRE:true,  tipoPassivo:'divida'}
      ];
      
      // Liberações ML exemplo (próximos 15 dias)
      const hoje = new Date();
      for(let i=1; i<=15; i++){
        const d = new Date(hoje);
        d.setDate(d.getDate() + i);
        liberacoes.push({
          data: dateStr(d),
          val: 1000 + Math.random() * 2000
        });
      }
      
      // Pagamentos exemplo
      for(let i=1; i<=10; i++){
        const d = new Date(hoje);
        d.setDate(d.getDate() + (i * 3));
        pagamentos.push({
          desc: 'Fornecedor ' + String.fromCharCode(64 + i),
          forn: 'Fornecedor ' + String.fromCharCode(64 + i),
          val: 500 + Math.random() * 1500,
          data: dateStr(d),
          cat: categorias[Math.floor(Math.random() * 3)].nome,
          pago: false,
          tipo: 'unico'
        });
      }
    }
