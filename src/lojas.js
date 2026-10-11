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
      // sem escolha gravada: a conta mais antiga (menor número no Mercado Livre) — não depende da ordem de leitura
      return cs.length ? cs.map(c => c.id).sort((a, b) => Number(a) - Number(b))[0] : '';
    }
    function lojaDe(p){ return (p && p.loja) || lojaPadraoId(); }
    function lojaAtiva(){ return _lj.ativo ? _lj.loja : ''; }
    function lojaNome(id){ return (typeof contaNome === 'function' && contaNome(id)) || ''; }
    // loja de um lançamento novo: a ativa; em "Todas", a padrão
    function lojaNova(){ return lojaAtiva() || lojaPadraoId(); }

    // ----- contas a pagar -----
    function lojasAbsorver(){
      if(_lj.aberto) return;
      if(!_lj.filtra){ pagamentosTodos = pagamentos; return; }
      if(_lj.ativo) pagamentos.forEach(p => { if(!_lj.set.has(p) && !p.loja) p.loja = _lj.loja; });
      const antes = _lj.set;
      pagamentosTodos = pagamentosTodos.filter(p => !antes.has(p)).concat(pagamentos);
      _lj.set = new Set(pagamentos);
    }
    function lojasRecortar(){
      if(_lj.aberto) return;
      const ca = typeof contaAtiva !== 'undefined' ? contaAtiva : '';
      _lj.loja = ca; _lj.ativo = !!ca && (typeof contasML === 'undefined' || contasML.length !== 1);
      // contas escondidas (excluídas aqui, mas que continuam existindo no Olist) nunca aparecem
      _lj.filtra = _lj.ativo || pagamentosTodos.some(p => p.oculta);
      pagamentos = _lj.filtra ? pagamentosTodos.filter(p => !p.oculta && (!_lj.ativo || lojaDe(p) === ca)) : pagamentosTodos;
      _lj.set = new Set(pagamentos);
      lojasSaldosRecortar();
    }
    // conjunto completo, já com o que mudou no recorte
    function pagTodos(){ if(_lj.aberto) return pagamentos; lojasAbsorver(); return pagamentosTodos; }
    function lojasDefinirTodos(lista){ _lj.aberto = 0; _lj.ativo = false; _lj.filtra = false; pagamentosTodos = lista; pagamentos = lista; lojasRecortar(); }
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
      saldoAtual = saldoMP + saldoOutros + (typeof saldoAuto === 'function' ? saldoAuto() : 0);
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
      if(!veio){ if(total === null || total === undefined) return false; if(lojasVarias()) return false; saldoMP = total; saldoAtual = saldoMP + saldoOutros + (typeof saldoAuto === 'function' ? saldoAuto() : 0); return true; }
      if(_lj.ativo || lojasVarias()) lojasSaldosRecortar();
      else { saldoMP = (contas || []).reduce((t, x) => t + (Number(x.saldoMP) || 0), 0); saldoAtual = saldoMP + saldoOutros + (typeof saldoAuto === 'function' ? saldoAuto() : 0); }
      return true;
    }
    function lojasDebitarMP(valor){
      if(_lj.ativo || !lojasVarias()){ saldoMP = Math.max(0, saldoMP - valor); saldoAtual = saldoMP + saldoOutros + (typeof saldoAuto === 'function' ? saldoAuto() : 0); return; }
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
    function lojasCfg(){
      lojasSaldosAbsorver();
      try { localStorage.setItem('mk_saldo_em', JSON.stringify(saldoEm)); } catch(e){}
      try { if(lojaPadrao) localStorage.setItem('mk_loja_padrao', lojaPadrao); localStorage.setItem('mk_saldos_loja', JSON.stringify(saldosLoja)); } catch(e){}
      return { lojaPadrao: lojaPadrao || null, saldosLoja, saldoEm, saldoAutoLigado };
    }
    function lojasCarregarCfg(c){
      if(!c) return;
      if(c.saldoEm && typeof c.saldoEm === 'object' && Object.keys(c.saldoEm).length) saldoEm = c.saldoEm;
      else { try { const s = JSON.parse(localStorage.getItem('mk_saldo_em') || 'null'); if(s && typeof s === 'object') saldoEm = s; } catch(e){} }
      if(c.saldoAutoLigado === false) saldoAutoLigado = false;
      if(c.lojaPadrao) lojaPadrao = String(c.lojaPadrao);
      else { try { lojaPadrao = localStorage.getItem('mk_loja_padrao') || lojaPadrao; } catch(e){} }   // cópia local: sobrevive a uma aba antiga que regrave a configuração
      if(c.saldosLoja && typeof c.saldosLoja === 'object' && Object.keys(c.saldosLoja).length) saldosLoja = c.saldosLoja;
      else { try { const s = JSON.parse(localStorage.getItem('mk_saldos_loja') || 'null'); if(s && typeof s === 'object') saldosLoja = s; } catch(e){} }
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

    // ----- Configurações → Mercado Livre: lista das contas, desconectar cada uma, loja padrão -----
    async function atualizarStatusMLConfig(){
      const el = document.getElementById('cfg-ml-status'), bt = document.getElementById('cfg-btn-desconectar');
      if(!el) return;
      if(bt) bt.style.display = 'none';
      if(!usuarioAtual){ el.textContent = 'Faça login para ver o status.'; return; }
      if(!contasML.length){
        const { data } = await supa.from('ml_tokens').select('ml_user_id').eq('usuario_id', usuarioAtual.id).limit(1);
        if(data && data.length) await carregarContasML();
      }
      if(!contasML.length){ el.innerHTML = '<span style="color:var(--danger);font-weight:600;">Nenhuma conta conectada</span> — clique em "Conectar / Reconectar" abaixo.'; return; }
      const padrao = lojaPadraoId();
      el.innerHTML = `<div class="cfg-contas">${contasML.map(c => `
        <div class="cfg-conta">
          <div class="cfg-conta-nome"><b>${contaEsc(c.apelido || 'Conta ' + c.id)}</b><span>nº ${c.id}${c.atualizado ? ' · acesso renovado em ' + new Date(c.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span></div>
          ${contasML.length > 1 ? (c.id === padrao ? '<span class="badge badge-success" title="Contas a pagar sem loja marcada (as do Olist, por exemplo) pertencem a esta loja">Loja padrão</span>'
            : `<button class="btn-out btn-sm" title="Contas a pagar sem loja marcada passam a pertencer a esta loja" onclick="lojasDefinirPadrao('${c.id}');atualizarStatusMLConfig()">Tornar padrão</button>`) : ''}
          <button class="btn-out btn-sm" style="color:var(--danger);" onclick="desconectarContaML('${c.id}', this)">Desconectar</button>
        </div>`).join('')}</div>
        ${contasML.length > 1 ? '<div class="text-muted" style="font-size:12px;margin-top:8px;">Loja padrão: é a dona das contas a pagar que chegam sem loja marcada (as que vêm do Olist, por exemplo).</div>' : ''}`;
    }
    async function desconectarContaML(id, bt){
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar'; setTimeout(() => { if(bt.isConnected){ bt.dataset.conf = ''; bt.textContent = 'Desconectar'; } }, 5000); return; }
      if(bt) bt.disabled = true;
      const { error } = await supa.from('ml_tokens').delete().eq('usuario_id', usuarioAtual.id).eq('ml_user_id', id);
      if(error){ toast('Não consegui desconectar: ' + error.message); if(bt) bt.disabled = false; return; }
      if(contaAtiva === String(id)) trocarContaML('');
      contasML = contasML.filter(c => c.id !== String(id));
      await carregarContasML();
      atualizarStatusMLConfig();
      if(typeof verificarConexaoML === 'function') verificarConexaoML();
      toast('Conta desconectada. Os dados já importados continuam guardados.');
    }

    // ===== SALDO QUE ANDA SOZINHO =====
    // O saldo digitado vale para o momento em que foi informado (saldoEm[loja]). Dali em diante o sistema soma o que
    // o Mercado Livre liberou e desconta as contas baixadas, e o "Total em caixa" (saldoAtual) acompanha.
    // Ao digitar um saldo novo, a contagem recomeça daquele momento. Sem data informada, nada é somado.
    let saldoEm = {};                 // { [ml_user_id | '_']: 'AAAA-MM-DDTHH:MM' }
    let saldoAutoLigado = true;

    function saldoLojasDaVez(){
      if(_lj.ativo) return [_lj.loja];
      return typeof contasML !== 'undefined' && contasML.length ? contasML.map(c => c.id) : ['_'];
    }
    function saldoInformado(){
      const d = new Date(), agora = dateStr(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      if(!_lj.ativo && lojasVarias()) return;          // em "Todas" os campos não são editáveis
      saldoLojasDaVez().forEach(k => { saldoEm[k] = agora; });
    }
    function saldoMovimento(loja){
      const em = saldoEm[loja]; if(!em || !saldoAutoLigado) return null;
      const emD = em.slice(0, 10), emH = Number(em.slice(11, 13)), hoje = getToday(), horaAgora = new Date().getHours();
      const daLoja = c => loja === '_' || String(c || '') === loja;
      // dias inteiros já passados (extrato) + as horas de hoje que já caíram
      let entrou = (typeof extratoTodos !== 'undefined' ? extratoTodos : []).filter(e => daLoja(e.conta) && e.data > emD && e.data < hoje).reduce((s, e) => s + (Number(e.val_liquido) || 0), 0);
      try {
        const porConta = JSON.parse(localStorage.getItem('mk_liberacoes_hoje_contas') || 'null');
        const horas = porConta ? Object.keys(porConta).filter(daLoja).flatMap(c => porConta[c] || []) : (loja === '_' ? JSON.parse(localStorage.getItem('mk_liberacoes_hoje') || '[]') : []);
        horas.forEach(i => { const h = parseInt(i.hora); if(h < horaAgora && (emD < hoje || h >= emH)) entrou += Number(i.val) || 0; });
      } catch(e){}
      const pagas = (typeof pagTodos === 'function' ? pagTodos() : pagamentos).filter(p => p.pago && !p.oculta && (loja === '_' || lojaDe(p) === loja) && String(p.dataPaga || '') > emD);
      const saiu = pagas.reduce((s, p) => s + (Number(p.valorPago != null ? p.valorPago : p.val) || 0), 0);
      return { em, entrou, saiu, n: pagas.length };
    }
    function saldoAuto(){
      return saldoLojasDaVez().reduce((t, k) => { const m = saldoMovimento(k); return t + (m ? m.entrou - m.saiu : 0); }, 0);
    }
    function saldoRecalcular(){
      saldoAtual = (Number(saldoMP) || 0) + (Number(saldoOutros) || 0) + saldoAuto();
      const label = document.getElementById('saldo-total-label'); if(label) label.textContent = fmt(saldoAtual);
      saldoNota();
    }
    function saldoNota(){
      const el = document.getElementById('saldo-auto-nota'); if(!el) return;
      const ms = saldoLojasDaVez().map(k => saldoMovimento(k)).filter(Boolean);
      const dt = s => ptDate(s.slice(0, 10)).slice(0, 5) + ' às ' + s.slice(11, 16);
      if(!saldoAutoLigado){ el.innerHTML = 'Atualização automática do saldo desligada. <a class="fx-link" style="color:var(--primary);cursor:pointer;" onclick="saldoAutoTrocar(true)">Ligar</a>'; return; }
      if(!ms.length){ el.innerHTML = 'Digite o saldo de hoje nos campos acima: dali em diante ele anda sozinho, somando o que o Mercado Livre liberar e descontando as contas que você der baixa.'; return; }
      const ent = ms.reduce((s, m) => s + m.entrou, 0), sai = ms.reduce((s, m) => s + m.saiu, 0), n = ms.reduce((s, m) => s + m.n, 0), mais = ms.map(m => m.em).sort()[0];
      el.innerHTML = `Saldo informado em <b>${dt(mais)}</b>${ms.length > 1 ? ' (a loja mais antiga)' : ''}: ${fmt((Number(saldoMP) || 0) + (Number(saldoOutros) || 0))}. Desde então: <b class="text-success">+ ${fmt(ent)}</b> liberado pelo Mercado Livre e <b class="text-danger">− ${fmt(sai)}</b> em ${n} conta${n === 1 ? '' : 's'} baixada${n === 1 ? '' : 's'}. Para acertar, digite o saldo real de novo. <a class="fx-link" style="color:var(--primary);cursor:pointer;" onclick="saldoAutoTrocar(false)">Desligar</a>`;
    }
    function saldoAutoTrocar(v){ saldoAutoLigado = !!v; saldoRecalcular(); if(typeof salvarCfg === 'function') salvarCfg(); if(typeof recalc === 'function') recalc(); }
