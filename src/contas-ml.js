// ===== GRUPOS DE CONTAS DO MERCADO LIVRE =====
// Um login do Caixa 360 pode ter várias contas do ML conectadas (tabela ml_tokens: uma linha por conta).
// contaAtiva = '' mostra todas juntas; um ml_user_id mostra só aquela conta.
// Recebíveis e extrato chegam do banco com a conta de origem; os arrays globais liberacoes e
// extratoHistorico (usados por todo o app) são sempre o recorte da conta ativa.

    let contasML = [];                                   // [{ id, apelido, atualizado }]
    let contaAtiva = localStorage.getItem('mk_conta_ativa') || '';
    let liberacoesTodas = [];                            // [{ data, val, conta }]
    let extratoTodos = [];                               // [{ data, val_liquido, qtd_pedidos, conta }]

    function contaParam(){ return contaAtiva || null; }
    function contaNome(id){
      const c = contasML.find(x => x.id === String(id));
      return c ? (c.apelido || 'Conta ' + c.id) : '';
    }
    function contaEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

    async function carregarContasML(){
      if(!usuarioAtual) return;
      const { data } = await supa.from('ml_tokens').select('ml_user_id,apelido,updated_at').eq('usuario_id', usuarioAtual.id).order('updated_at');
      contasML = (data || []).map(t => ({ id: String(t.ml_user_id), apelido: t.apelido || null, atualizado: t.updated_at }));
      if(contaAtiva && !contasML.some(c => c.id === contaAtiva)){ contaAtiva = ''; localStorage.removeItem('mk_conta_ativa'); aplicarContaAtiva(false); }
      renderSeletorContas();
      if(typeof lojasAposContas === 'function') lojasAposContas();
      if(typeof curvaCarregar === 'function' && !curva.carregada) curvaCarregar();
    }

    // Recebe as linhas do banco (com ml_user_id) e atualiza os recortes da conta ativa
    function definirDadosML(libRows, extRows){
      if(libRows) liberacoesTodas = libRows.map(l => ({ data: l.data, val: l.val, conta: l.ml_user_id || '' }));
      if(extRows) extratoTodos = extRows.map(e => ({ data: e.data, val_liquido: e.val_liquido, qtd_pedidos: e.qtd_pedidos, conta: e.ml_user_id || '' }));
      aplicarContaAtiva(false);
    }

    function aplicarContaAtiva(redesenhar){
      if(typeof lojasAbsorver === 'function'){ lojasSaldosAbsorver(); lojasAbsorver(); lojasRecortar(); lojasTravarSaldos(); }
      const daConta = x => !contaAtiva || x.conta === contaAtiva;
      liberacoes = liberacoesTodas.filter(daConta);
      // extrato: soma as contas selecionadas por dia
      const porDia = {};
      extratoTodos.filter(daConta).forEach(e => {
        if(!porDia[e.data]) porDia[e.data] = { data: e.data, val_liquido: 0, qtd_pedidos: 0 };
        porDia[e.data].val_liquido += Number(e.val_liquido) || 0;
        porDia[e.data].qtd_pedidos += Number(e.qtd_pedidos) || 0;
      });
      extratoHistorico = Object.values(porDia).sort((a,b) => b.data.localeCompare(a.data));
      localStorage.setItem('mk_liberacoes', JSON.stringify(liberacoes));
      // liberações de hoje por hora (o ml-sync devolve por conta)
      try {
        const porConta = JSON.parse(localStorage.getItem('mk_liberacoes_hoje_contas') || 'null');
        if(porConta){
          const h = {};
          Object.keys(porConta).filter(c => !contaAtiva || c === contaAtiva)
            .forEach(c => (porConta[c] || []).forEach(i => { h[i.hora] = (h[i.hora] || 0) + i.val; }));
          localStorage.setItem('mk_liberacoes_hoje', JSON.stringify(Object.keys(h).sort().map(hora => ({ hora, val: h[hora] }))));
        }
      } catch(e){}
      if(!redesenhar) return;
      // telas que guardam dados da conta anterior
      if(typeof vdDados !== 'undefined'){ vdDados.carregado = false; rfDados.carregado = false; rfRankDados = null; }
      if(typeof inicioVendas !== 'undefined') inicioVendas = null;
      if(typeof atualizarRegressao === 'function') atualizarRegressao();
      if(typeof curvaCalcular === 'function') curvaCalcular();
      const pag = document.querySelector('.view.active');
      if(pag) nav(pag.id.replace('view-', ''), true);
    }

    function trocarContaML(v){
      contaAtiva = v;
      if(v) localStorage.setItem('mk_conta_ativa', v); else localStorage.removeItem('mk_conta_ativa');
      renderSeletorContas();
      aplicarContaAtiva(true);
    }

    // Seletor na barra lateral: aparece quando há pelo menos uma conta conectada
    function renderSeletorContas(){
      const box = document.getElementById('conta-ml-box');
      if(!box) return;
      if(!contasML.length){ box.style.display = 'none'; return; }
      box.style.display = '';
      const opcoes = (contasML.length > 1 ? `<option value="" ${contaAtiva === '' ? 'selected' : ''}>Todas as contas (${contasML.length})</option>` : '')
        + contasML.map(c => `<option value="${c.id}" ${contaAtiva === c.id || contasML.length === 1 ? 'selected' : ''}>${contaEsc(c.apelido || 'Conta ' + c.id)}</option>`).join('');
      box.innerHTML = `
        <label>Conta do Mercado Livre</label>
        <div class="conta-linha">
          <select onchange="trocarContaML(this.value)" ${contasML.length === 1 ? 'disabled' : ''}>${opcoes}</select>
          <button title="Conectar outra conta do Mercado Livre" onclick="adicionarContaML()">+</button>
        </div>`;
    }

    function adicionarContaML(){
      vmlModal('Conectar outra conta do Mercado Livre', `
        <div style="line-height:1.65;">
          <div>Você pode ligar várias contas do Mercado Livre a este login e ver os números <b>juntos</b> ou <b>separados por conta</b>.</div>
          <ol style="margin:12px 0 0 18px;">
            <li>Antes de continuar, entre no site do Mercado Livre <b>com a conta que deseja adicionar</b> (a autorização vale para a conta que estiver logada neste navegador).</li>
            <li>Clique em <b>Conectar</b> e confirme o acesso.</li>
          </ol>
          ${contasML.length ? `<div class="text-muted" style="margin-top:12px;">Contas já conectadas: ${contasML.map(c => contaEsc(c.apelido || c.id)).join(', ')}.</div>` : ''}
        </div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="conectarML()">Conectar</button>`);
    }
