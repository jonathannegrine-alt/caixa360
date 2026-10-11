// ===== LOJAS SEPARADAS =====
// Com mais de uma conta do Mercado Livre conectada, cada loja funciona como um sistema à parte: o seletor de
// conta da barra lateral recorta contas a pagar, saldos, fluxo, DRE, balanço e empréstimos. "Todas" junta.
//
// Como funciona: pagamentosTodos guarda tudo; o array global pagamentos (usado pelo app inteiro) é sempre o
// recorte da loja ativa. Antes de gravar ou trocar de loja, lojasAbsorver() devolve ao conjunto completo o que
// foi incluído, alterado ou excluído no recorte. Quem precisa enxergar tudo (Olist, empréstimos, backup) usa
// pagTodos() / lojasAbrir() + lojasFechar().
// Conta sem loja marcada pertence à loja padrão (as que vêm do Olist, por exemplo).

    let pagamentosTodos = [];
    let lojaPadrao = '';                  // ml_user_id da loja das contas sem loja marcada
    let saldosLoja = {};                  // { [ml_user_id]: { mp, outros } }
    let _lj = { ativo: false, loja: '', set: new Set(), aberto: 0 };

    function lojasVarias(){ return typeof contasML !== 'undefined' && contasML.length > 1; }
    function lojaPadraoId(){
      const cs = typeof contasML !== 'undefined' ? contasML : [];
      if(lojaPadrao && (!cs.length || cs.some(c => c.id === lojaPadrao))) return lojaPadrao;
      return cs[0] ? cs[0].id : '';
    }
    function lojaDe(p){ return (p && p.loja) || lojaPadraoId(); }
    function lojaAtiva(){ return _lj.ativo ? _lj.loja : ''; }
    function lojaNome(id){ return (typeof contaNome === 'function' && contaNome(id)) || ''; }
    // loja de um lançamento novo: a ativa; em "Todas", a padrão
    function lojaNova(){ return lojaAtiva() || lojaPadraoId(); }

    // ----- contas a pagar -----
    function lojasAbsorver(){
      if(_lj.aberto) return;
      if(!_lj.ativo){ pagamentosTodos = pagamentos; return; }
      pagamentos.forEach(p => { if(!_lj.set.has(p) && !p.loja) p.loja = _lj.loja; });
      const antes = _lj.set;
      pagamentosTodos = pagamentosTodos.filter(p => !antes.has(p)).concat(pagamentos);
      _lj.set = new Set(pagamentos);
    }
    function lojasRecortar(){
      if(_lj.aberto) return;
      const ca = typeof contaAtiva !== 'undefined' ? contaAtiva : '';
      _lj.loja = ca; _lj.ativo = !!ca && (typeof contasML === 'undefined' || contasML.length !== 1);
      pagamentos = _lj.ativo ? pagamentosTodos.filter(p => lojaDe(p) === ca) : pagamentosTodos;
      _lj.set = new Set(pagamentos);
      lojasSaldosRecortar();
    }
    // conjunto completo, já com o que mudou no recorte
    function pagTodos(){ if(_lj.aberto) return pagamentos; lojasAbsorver(); return pagamentosTodos; }
    function lojasDefinirTodos(lista){ _lj.aberto = 0; _lj.ativo = false; pagamentosTodos = lista; pagamentos = lista; lojasRecortar(); }
    // para código que mexe no conjunto completo usando a variável pagamentos
    function lojasAbrir(){ if(_lj.aberto === 0){ lojasAbsorver(); pagamentos = pagamentosTodos; } _lj.aberto++; }
    function lojasFechar(){ if(_lj.aberto > 0 && --_lj.aberto === 0){ pagamentosTodos = pagamentos; lojasRecortar(); } }
    function comTodasAsLojas(fn){ lojasAbrir(); try { return fn(); } finally { lojasFechar(); } }

    // ----- saldos -----
    function lojasSaldosAbsorver(){
      const n = v => Number(v) || 0;
      if(_lj.ativo) saldosLoja[_lj.loja] = { mp: n(saldoMP), outros: n(saldoOutros) };
      else if(!lojasVarias() && lojaPadraoId()) saldosLoja[lojaPadraoId()] = { mp: n(saldoMP), outros: n(saldoOutros) };
    }
    function lojasSaldosRecortar(){
      const ids = Object.keys(saldosLoja);
      if(!ids.length || (!_lj.ativo && !lojasVarias())) return;
      const n = v => Number(v) || 0;
      if(_lj.ativo){ const s = saldosLoja[_lj.loja] || {}; saldoMP = n(s.mp); saldoOutros = n(s.outros); }
      else {
        const vivos = ids.filter(id => contasML.some(c => c.id === id));
        saldoMP = vivos.reduce((t, id) => t + n(saldosLoja[id].mp), 0);
        saldoOutros = vivos.reduce((t, id) => t + n(saldosLoja[id].outros), 0);
      }
      saldoAtual = saldoMP + saldoOutros;
    }
    // saldo do Mercado Pago que o ml-sync devolve por conta
    function lojasSaldoMPDaAPI(contas, total){
      lojasSaldosAbsorver();
      let veio = false;
      (contas || []).forEach(x => {
        if(x.saldoMP === null || x.saldoMP === undefined) return;
        veio = true;
        const s = saldosLoja[x.ml_user_id] || (saldosLoja[x.ml_user_id] = { mp: 0, outros: 0 });
        s.mp = Number(x.saldoMP) || 0;
      });
      if(!veio){ if(total === null || total === undefined) return false; if(lojasVarias()) return false; saldoMP = total; saldoAtual = saldoMP + saldoOutros; return true; }
      if(_lj.ativo || lojasVarias()) lojasSaldosRecortar();
      else { saldoMP = (contas || []).reduce((t, x) => t + (Number(x.saldoMP) || 0), 0); saldoAtual = saldoMP + saldoOutros; }
      return true;
    }
    function lojasDebitarMP(valor){
      if(_lj.ativo || !lojasVarias()){ saldoMP = Math.max(0, saldoMP - valor); saldoAtual = saldoMP + saldoOutros; return; }
      const s = saldosLoja[lojaPadraoId()] || (saldosLoja[lojaPadraoId()] = { mp: 0, outros: 0 });
      s.mp = Math.max(0, (Number(s.mp) || 0) - valor); lojasSaldosRecortar();
    }
    // Em "Todas as contas" os campos de saldo mostram a soma e não aceitam digitação
    function lojasTravarSaldos(){
      const soma = !_lj.ativo && lojasVarias();
      ['saldo-mp', 'saldo-inicial'].forEach(id => {
        const el = document.getElementById(id); if(!el) return;
        el.readOnly = soma;
        el.title = soma ? 'Soma das lojas. Para alterar, escolha uma loja no seletor de conta.' : '';
        el.style.opacity = soma ? '.75' : '';
      });
      const lb = document.getElementById('saldo-loja-nota');
      if(lb) lb.textContent = !lojasVarias() ? '' : soma ? 'Soma das lojas — escolha uma loja para alterar' : 'Saldo da loja ' + lojaNome(_lj.loja);
    }

    // chamado quando a lista de contas do ML termina de carregar
    function lojasAposContas(){
      if(!contasML.length) return;
      if(!Object.keys(saldosLoja).length && (saldoMP || saldoOutros)){
        // primeira vez: o saldo que existia era um só; fica na loja padrão até o ML informar o de cada conta
        saldosLoja[lojaPadraoId()] = { mp: _lj.ativo && _lj.loja !== lojaPadraoId() ? 0 : Number(saldoMP) || 0, outros: Number(saldoOutros) || 0 };
      }
      const antes = pagamentos.length + '|' + saldoAtual;
      lojasAbsorver(); lojasRecortar(); lojasTravarSaldos();
      if(antes !== pagamentos.length + '|' + saldoAtual){
        const pag = document.querySelector('.view.active');
        if(pag && typeof nav === 'function') try { nav(pag.id.replace('view-', ''), true); } catch(e){}
      }
    }

    // ----- configuração (vai dentro de configuracoes.cfg) -----
    function lojasCfg(){ lojasSaldosAbsorver(); return { lojaPadrao: lojaPadrao || null, saldosLoja }; }
    function lojasCarregarCfg(c){
      if(!c) return;
      if(c.lojaPadrao) lojaPadrao = String(c.lojaPadrao);
      if(c.saldosLoja && typeof c.saldosLoja === 'object') saldosLoja = c.saldosLoja;
    }
    function lojasDefinirPadrao(id){
      lojasAbsorver(); lojaPadrao = String(id || ''); lojasRecortar();
      if(typeof salvarCfg === 'function') salvarCfg();
      const pag = document.querySelector('.view.active');
      if(pag) nav(pag.id.replace('view-', ''), true);
    }

    // aviso rápido no rodapé
    function toast(msg){
      let el = document.getElementById('toast-geral');
      if(!el){ el = document.createElement('div'); el.id = 'toast-geral'; el.className = 'toast-geral'; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 6000);
    }

    // seletor de loja para formulários (só aparece com mais de uma loja)
    function lojaSelect(id, valor){
      if(!lojasVarias()) return '';
      const v = valor || lojaNova();
      return `<select id="${id}">${contasML.map(c => `<option value="${c.id}" ${c.id === v ? 'selected' : ''}>${contaEsc(c.apelido || 'Conta ' + c.id)}</option>`).join('')}</select>`;
    }
    function lojaEtiqueta(p){
      if(!lojasVarias() || _lj.ativo) return '';
      const nome = lojaNome(lojaDe(p)); if(!nome) return '';
      return `<span class="loja-tag">${contaEsc(nome)}</span>`;
    }
