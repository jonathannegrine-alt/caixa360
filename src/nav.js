// ===== NAVEGAÇÃO =====
    function toggleSidebar(){
      document.querySelector('.sidebar').classList.toggle('mob-open');
      document.getElementById('sidebar-overlay').classList.toggle('open');
    }

    // Itens do menu viram links de verdade: um <a href="#pagina"> cobre cada item. Clique normal continua trocando a tela
    // aqui (onclick do item); clique do meio, Ctrl/Shift+clique e "Abrir em nova guia" abrem a tela em outra guia.
    function navLinks(){
      document.querySelectorAll('.nav-item[onclick]').forEach(li => {
        const m = (li.getAttribute('onclick') || '').match(/^nav\('([\w-]+)'\)$/); if(!m || li.querySelector('.nav-a')) return;
        const a = document.createElement('a'); a.className = 'nav-a'; a.href = '#' + m[1]; a.tabIndex = -1; a.setAttribute('aria-hidden', 'true');
        li.style.position = 'relative'; li.appendChild(a);
      });
    }
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('.nav-a'); if(!a) return;
      if(e.ctrlKey || e.metaKey || e.shiftKey) e.stopPropagation();   // o navegador abre a guia; esta não troca de tela
      else e.preventDefault();                                         // clique normal: só o onclick do item
    }, true);
    navLinks();

    function nav(page, fromPopState){
      // trocar de página fecha qualquer janela que tenha ficado aberta (algumas abrem por style, outras por classe)
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      document.querySelectorAll('.modal').forEach(m => { if(m.style.display && m.style.display !== 'none') m.style.display = 'none'; });
      localStorage.setItem('mk_last_page', page);
      // só depois que o sistema terminou de abrir: os redesenhos do carregamento não podem trocar a página guardada
      if(window._navPronto){ try { sessionStorage.setItem('mk_pagina', page); } catch(e){} }
      // Empurra estado no histórico do browser (exceto quando chamado pelo próprio popstate). O endereço leva a página
      // no fim (#compras): dá para abrir em outra guia, salvar nos favoritos e voltar com F5 na mesma tela.
      if(!fromPopState && usuarioAtual){
        const url = location.pathname + location.search + '#' + page;
        if(location.hash === '#' + page) history.replaceState({page}, '', url); else history.pushState({page}, '', url);
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
      else if(page === 'pagar'){ if(typeof pagarMesSel !== 'undefined') pagarMesSel = ''; if(typeof pagarFiltro === 'function') pagarFiltro('mescal', ''); else renderPagar(); }
      else if(page === 'simulador') renderFormSimulador();
      else if(page === 'skus') setSkuTab(skuCurrentTab || 'lista');
      else if(page === 'estoque'){ if(typeof estRender === 'function') estRender(); else renderEstoque(); }
      else if(page === 'analise'){ if(typeof anRender === 'function') anRender(); else renderAnalise(); }
      else if(page === 'receber'){ renderReceber(); verificarConexaoML(); }
      else if(page === 'config'){ renderCategorias(); renderConfig(); atualizarStatusMLConfig(); renderPipelineMaturidade(); if(typeof olistRenderCard === 'function') olistRenderCard(); if(typeof dsRenderCard === 'function') dsRenderCard(); if(typeof vrRenderCard === 'function') vrRenderCard().then(() => { if(typeof cfgMontarAbas === 'function') cfgMontarAbas(); }); if(typeof iaRenderCard === 'function') iaRenderCard().then(() => { if(typeof cfgMontarAbas === 'function') cfgMontarAbas(); }); if(typeof nfeRenderCard === 'function') nfeRenderCard().then(() => { if(typeof cfgMontarAbas === 'function') cfgMontarAbas(); }); if(typeof cfgMontarAbas === 'function') cfgMontarAbas(); }
      else if(page === 'resultado'){ setResultadoTab('anual'); }
      else if(page === 'flex'){ if(typeof fxRender === 'function') fxRender(); }
      else if(page === 'conciliacao'){ if(typeof cnRender === 'function') cnRender(); }
      else if(page === 'full'){ if(typeof pflPagina === 'function') pflPagina(); }
      else if(page === 'envios'){ if(typeof esoPagina === 'function') esoPagina(); }
      else if(page === 'frete'){ if(typeof frRender === 'function') frRender(); }
      else if(page === 'promocoes'){ if(typeof pmRender === 'function') pmRender(); }
      else if(page === 'emprestimos'){ if(typeof renderEmprestimos === 'function') renderEmprestimos(); }
      else if(page === 'patrimonio'){ renderPatrimonio(); if(typeof renderBalanco === 'function') renderBalanco(); }
      else if(page === 'fornecedores'){ if(typeof fnRender === 'function') fnRender(); }
      else if(page === 'notas'){ if(typeof nfeRender === 'function') nfeRender(); }
      else if(page === 'ordens-compra'){ if(typeof ocRender === 'function') ocRender(); else renderOrdensCompra(); }
      else if(page === 'vendas') renderVendas();
      else if(page === 'resumo-fin') renderResumoFin();
      else if(page === 'posvenda'){ if(typeof renderPosVenda === 'function') renderPosVenda(); }
      else if(page === 'perguntas') renderPerguntas();
      else if(page === 'pedidos'){ if(typeof renderPedidos === 'function') renderPedidos(); }
      else if(page === 'compras') renderCompras();
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

    // um grupo aberto por vez: abrir um fecha os outros; clicar no aberto fecha ele
    function toggleNavSec(sec){
      const abertas = navSecsAbertas().includes(sec) ? [] : [sec];
      try { localStorage.setItem('mk_nav_secs', JSON.stringify(abertas)); } catch(e){}
      aplicarNavSecs();
    }
    document.addEventListener('DOMContentLoaded', aplicarNavSecs);
