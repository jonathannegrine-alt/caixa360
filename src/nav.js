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
      if(navEl) navEl.classList.add('active');

      // Renderizar
      if(page === 'dashboard') renderDashboard();
      else if(page === 'planilha'){ if(planilhaViewMode==='cal') renderPlanilhaCal(); else renderPlanilha(); }
      else if(page === 'pagar') renderPagar();
      else if(page === 'simulador') renderFormSimulador();
      else if(page === 'skus') setSkuTab(skuCurrentTab || 'lista');
      else if(page === 'estoque') renderEstoque();
      else if(page === 'analise') renderAnalise();
      else if(page === 'receber'){ renderReceber(); verificarConexaoML(); }
      else if(page === 'config'){ renderCategorias(); renderConfig(); atualizarStatusMLConfig(); renderPipelineMaturidade(); }
      else if(page === 'resultado'){ setResultadoTab('dre'); }
      else if(page === 'patrimonio'){ renderPatrimonio(); }
      else if(page === 'ordens-compra') renderOrdensCompra();
    }
