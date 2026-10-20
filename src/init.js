// ===== INIT =====
    function renderConfig(){
      // Saldos
      const mpEl = document.getElementById('saldo-mp');
      const outrosEl = document.getElementById('saldo-inicial');
      const totalEl = document.getElementById('saldo-total-label');
      if(mpEl) mpEl.value = saldoMP > 0 ? fmtMoney(saldoMP) : '';
      if(outrosEl) outrosEl.value = saldoOutros > 0 ? fmtMoney(saldoOutros) : '';
      if(totalEl) totalEl.textContent = fmt(saldoAtual);
      if(typeof lojasTravarSaldos === 'function') lojasTravarSaldos();
      if(typeof saldoRecalcular === 'function') saldoRecalcular();

      // Fator Prudencial
      const pctVal = Math.round(cfgPct * 100);
      const rangePct = document.getElementById('range-pct');
      const valPct = document.getElementById('val-pct');
      if(rangePct) rangePct.value = pctVal;
      if(valPct) valPct.textContent = pctVal + '%';

      // Reserva mínima
      const reservaEl = document.getElementById('input-reserva');
      if(reservaEl) reservaEl.value = reservaMinima > 0 ? fmtMoney(reservaMinima) : '';

      // Período histórico
      const histEl = document.getElementById('range-hist');
      const valHist = document.getElementById('val-hist');
      if(histEl) histEl.value = periodoHistorico;
      if(valHist) valHist.textContent = periodoHistorico + ' dias';

      // Modo projeção
      const modoEl = document.getElementById('modo-extrato');
      if(modoEl && modoProjecao === 'extrato') modoEl.checked = true;

      // Delay calculado (informativo)
      const delayCalc = calcularDelayReal();
      const delayEl = document.getElementById('delay-calc');
      if(delayEl) delayEl.textContent = delayCalc !== null ? delayCalc + ' dias' : '— (sem dados ML)';

      // Motor de Reposição — regras globais
      const cfgMF = document.getElementById('cfg-meta-full');
      const cfgMG = document.getElementById('cfg-meta-galpao');
      const cfgDS = document.getElementById('cfg-dias-seg');
      const cfgAC = document.getElementById('cfg-alerta-critico');
      if(cfgMF) cfgMF.value = metaFullDias;
      if(cfgMG) cfgMG.value = metaGalpaoDias;
      if(cfgDS) cfgDS.value = diasSeguranca;
      if(cfgAC) cfgAC.value = alertaCriticoDias;

      // Categorias
      atualizarSelectCategorias();
    }

    function init(){
      renderConfig();

      // Restaurar última página visitada (ou dashboard como padrão)
      // Primeira vez após a criação da página Início: abre nela
      // ao entrar no sistema abre sempre no Início; só o F5 (mesma aba) volta para a página em que estava
      // endereço com a página no fim (#compras, aberto em outra guia ou nos favoritos) vale primeiro
      const daUrl = decodeURIComponent(location.hash.slice(1));
      let lastPage = 'inicio'; try { lastPage = sessionStorage.getItem('mk_pagina') || 'inicio'; } catch(e){}
      if(daUrl && document.getElementById('view-' + daUrl)) lastPage = daUrl;
      if(!document.getElementById('view-' + lastPage)) lastPage = 'inicio';
      localStorage.setItem('mk_viu_inicio', '1');
      window._navPronto = true;
      nav(['calendario'].includes(lastPage) ? 'dashboard' : lastPage);
    }
    
    // ===== ENTER = TAB em inputs (exceto textarea e botões) =====
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      const el = e.target;
      const tag = el.tagName;
      if(tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if(tag === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'checkbox' || el.type === 'radio')) return;
      e.preventDefault();
      // Disparar blur para garantir save (onblur dos inputs de saldo, etc.)
      el.blur();
      // Mover foco para próximo elemento tabulável
      const tabulaveis = Array.from(document.querySelectorAll(
        'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(x => x.offsetParent !== null); // apenas visíveis
      const idx = tabulaveis.indexOf(el);
      if(idx >= 0 && idx < tabulaveis.length - 1){
        tabulaveis[idx + 1].focus();
      }
    });

    // ===== BOTÃO VOLTAR DO BROWSER — intercepta para navegar entre páginas do app =====
    window.addEventListener('popstate', function(e){
      if(!usuarioAtual) return; // não logado: deixa o browser agir normalmente
      const h = decodeURIComponent(location.hash.slice(1));
      const page = (e.state && e.state.page) ? e.state.page : (h && document.getElementById('view-' + h) ? h : 'inicio');
      nav(page, true); // fromPopState=true evita loop de pushState
    });

    // ===== SALVAR SALDO ANTES DE FECHAR/F5 =====
    // onblur não dispara quando o usuário pressiona F5 diretamente
    window.addEventListener('beforeunload', function(){
      if(!usuarioAtual) return;
      const mpEl = document.getElementById('saldo-mp');
      const outrosEl = document.getElementById('saldo-inicial');
      let changed = false;
      if(mpEl && mpEl.readOnly) return;   // em "Todas as contas" os campos mostram a soma e não são gravados
      if(mpEl && mpEl.value.trim() !== ''){
        const v = parseMoney(mpEl.value);
        if(v !== saldoMP){ saldoMP = v; changed = true; }
      }
      if(outrosEl && outrosEl.value.trim() !== ''){
        const v = parseMoney(outrosEl.value);
        if(v !== saldoOutros){ saldoOutros = v; changed = true; }
      }
      if(changed){
        if(typeof saldoInformado === 'function') saldoInformado();
        saldoAtual = saldoMP + saldoOutros + (typeof saldoAuto === 'function' ? saldoAuto() : 0);
        salvarCfg(); // localStorage é síncrono — garante o save antes do unload
      }
    });
