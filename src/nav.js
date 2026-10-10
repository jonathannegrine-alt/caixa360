// ===== NAVEGAÇÃO =====
    function toggleSidebar(){
      document.querySelector('.sidebar').classList.toggle('mob-open');
      document.getElementById('sidebar-overlay').classList.toggle('open');
    }

    function nav(page, fromPopState){
      localStorage.setItem('mk_last_page', page);
      // Empurra estado no histórico do browser (exceto quando chamado pelo próprio popstate)
      if(!fromPopState && usuarioAtual){
        history.pushState({page}, '', location.pathname + location.search);
      }

      // Fechar sidebar no mobile
      document.querySelector('.sidebar').classList.remove('mob-open');
      document.getElementById('sidebar-overlay').classList.remove('open');

      // Remover active de todos
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

      // Ativar página
      document.getElementById('view-' + page).classList.add('active');
      const navEl = document.querySelector(`[onclick="nav('${page}')"]`);
      if(navEl){
        navEl.classList.add('active');
        // abre a categoria do menu que contém a página
        if(navEl.dataset.sec && !navSecsAbertas().includes(navEl.dataset.sec)) toggleNavSec(navEl.dataset.sec);
      }

      // Renderizar
      if(page === 'inicio') renderInicio();
      else if(page === 'dashboard') renderDashboard();
      else if(page === 'planilha'){ if(planilhaViewMode==='cal') renderPlanilhaCal(); else renderPlanilha(); }
      else if(page === 'pagar') renderPagar();
      else if(page === 'simulador') renderFormSimulador();
      else if(page === 'skus') setSkuTab(skuCurrentTab || 'lista');
      else if(page === 'estoque') renderEstoque();
      else if(page === 'analise') renderAnalise();
      else if(page === 'receber'){ renderReceber(); verificarConexaoML(); }
      else if(page === 'config'){ renderCategorias(); renderConfig(); atualizarStatusMLConfig(); renderPipelineMaturidade(); if(typeof cfgMontarAbas === 'function') cfgMontarAbas(); }
      else if(page === 'resultado'){ setResultadoTab('anual'); }
      else if(page === 'patrimonio'){ renderPatrimonio(); }
      else if(page === 'ordens-compra') renderOrdensCompra();
      else if(page === 'vendas') renderVendas();
      else if(page === 'resumo-fin') renderResumoFin();
      else if(page === 'perguntas') renderPerguntas();
      else if(page === 'mensagens') renderMensagens();
    }

    // ===== MENU LATERAL — categorias recolhíveis =====
    function navSecsAbertas(){
      try { return JSON.parse(localStorage.getItem('mk_nav_secs') || '[]'); } catch(e){ return []; }
    }

    function aplicarNavSecs(){
      const abertas = navSecsAbertas();
      document.querySelectorAll('.nav-sec[data-sec]').forEach(s => s.classList.toggle('aberta', abertas.includes(s.dataset.sec)));
      document.querySelectorAll('.nav-item[data-sec]').forEach(i => i.classList.toggle('sec-oculta', !abertas.includes(i.dataset.sec)));
    }

    function toggleNavSec(sec){
      let abertas = navSecsAbertas();
      abertas = abertas.includes(sec) ? abertas.filter(s => s !== sec) : abertas.concat(sec);
      localStorage.setItem('mk_nav_secs', JSON.stringify(abertas));
      aplicarNavSecs();
    }

    document.addEventListener('DOMContentLoaded', aplicarNavSecs);
