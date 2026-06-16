// ===== SUPABASE =====
    const SUPA_URL = 'https://qasrccmtrllotukyeiax.supabase.co';
    const SUPA_KEY = 'sb_publishable_7TU_CA9JlPgoYTpKHkH8dA_FSBgvPVd';
    const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
    let usuarioAtual = null;

    // ===== AUTH =====
    let loginTab = 'entrar';

    function mudarTab(tab){
      loginTab = tab;
      document.getElementById('tab-entrar').className = 'login-tab' + (tab==='entrar'?' active':'');
      document.getElementById('tab-cadastrar').className = 'login-tab' + (tab==='cadastrar'?' active':'');
      document.getElementById('campo-nome').style.display = tab==='cadastrar' ? 'block' : 'none';
      document.getElementById('campo-termos').style.display = tab==='cadastrar' ? 'block' : 'none';
      document.getElementById('login-btn').textContent = tab==='entrar' ? 'Entrar' : 'Criar conta';
      document.getElementById('link-esqueceu').style.display = tab==='entrar' ? 'block' : 'none';
      document.getElementById('login-msg').textContent = '';
      // Botão desabilitado no cadastro até marcar o checkbox
      const chk = document.getElementById('chk-termos');
      document.getElementById('login-btn').disabled = tab==='cadastrar' && !chk.checked;
    }

    function abrirTermos(comBotaoAceitar){
      const footer = document.getElementById('modal-termos-footer');
      if(comBotaoAceitar){
        footer.innerHTML = '<button class="btn" onclick="aceitarTermosModal()">Aceitar e continuar</button>';
      } else {
        footer.innerHTML = '<button class="btn-out" onclick="fecharModal(\'modal-termos\')">Fechar</button>';
      }
      document.getElementById('modal-termos').classList.add('open');
    }

    async function fazerLogin(){
      const email = document.getElementById('login-email').value.trim();
      const senha = document.getElementById('login-senha').value;
      const nome  = document.getElementById('login-nome').value.trim();
      const msg   = document.getElementById('login-msg');

      if(!email || !senha){ msg.className='login-msg erro'; msg.textContent='Preencha e-mail e senha.'; return; }
      msg.className='login-msg'; msg.textContent='Aguarde...';

      let res;
      if(loginTab === 'entrar'){
        res = await supa.auth.signInWithPassword({email, password:senha});
      } else {
        if(!nome){ msg.className='login-msg erro'; msg.textContent='Informe seu nome.'; return; }
        if(!document.getElementById('chk-termos').checked){
          msg.className='login-msg erro'; msg.textContent='Aceite os Termos de Uso para criar sua conta.'; return;
        }
        res = await supa.auth.signUp({email, password:senha, options:{data:{nome}}});
      }

      if(res.error){
        msg.className='login-msg erro';
        msg.textContent = traduzirErroAuth(res.error.message);
        return;
      }

      if(loginTab === 'cadastrar' && !res.data.session){
        msg.className='login-msg ok';
        msg.textContent='Conta criada! Verifique seu e-mail para confirmar.';
        return;
      }

      await entrarNoApp(res.data.user);
    }

    async function aceitarTermosModal(){
      if(!usuarioAtual) return;
      fecharModal('modal-termos');
      await supa.from('termos_aceite').insert({
        usuario_id: usuarioAtual.id,
        versao_termos: 'v0.1-beta',
        aceito_em: new Date().toISOString()
      });
      localStorage.setItem('mk_termos_' + usuarioAtual.id, 'v0.1-beta');
      // Continuar entrada no app normalmente
      document.getElementById('login-sync').style.display = 'flex';
      document.querySelector('.login-form').style.display = 'none';
      document.querySelector('.login-tabs').style.display = 'none';
      document.getElementById('login-sync-msg').textContent = 'Carregando seus dados...';
      limparSessaoLocal();
      await carregarDoSupabase();
      document.getElementById('tela-login').classList.remove('ativo');
      document.getElementById('user-bar').style.display = 'block';
      document.getElementById('user-bar-email').textContent = usuarioAtual.email;
      document.getElementById('card-minha-conta').style.display = 'block';
      document.getElementById('card-feedbacks').style.display = 'block';
      const mlCode = new URLSearchParams(window.location.search).get('code');
      if(mlCode){
        nav('receber');
        await handleMLCallback(mlCode);
      } else {
        await verificarConexaoML();
        renderDashboard();
        autoSyncML();
      }
    }

    function traduzirErroAuth(msg){
      if(!msg) return 'Erro desconhecido.';
      if(msg.includes('Failed to fetch') || msg.includes('fetch')) return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
      if(msg.includes('Invalid login')) return 'E-mail ou senha incorretos.';
      if(msg.includes('already registered')) return 'Este e-mail já está cadastrado. Tente entrar.';
      if(msg.includes('Password should be') || msg.includes('password')) return 'Senha deve ter pelo menos 6 caracteres.';
      if(msg.includes('Unable to validate') || msg.includes('invalid')) return 'E-mail inválido.';
      if(msg.includes('Email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
      if(msg.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
      return 'Erro: ' + msg;
    }

    async function entrarNoApp(user){
      usuarioAtual = user;
      document.getElementById('login-sync').style.display = 'flex';
      document.querySelector('.login-form').style.display = 'none';
      document.querySelector('.login-tabs').style.display = 'none';
      document.getElementById('login-sync-msg').textContent = 'Carregando seus dados...';

      try {
        // Verificar se já aceitou os termos — cache local primeiro para evitar piscar modal a cada login
        const termosLocalKey = 'mk_termos_' + user.id;
        const termosLocal = localStorage.getItem(termosLocalKey);
        if(!termosLocal){
          const { data: termosData } = await supa.from('termos_aceite').select('id').eq('usuario_id', user.id).maybeSingle();
          if(!termosData){
            // Restaurar tela de login antes de abrir modal (evita tela congelada)
            document.getElementById('login-sync').style.display = 'none';
            document.querySelector('.login-form').style.display = 'flex';
            document.querySelector('.login-tabs').style.display = 'flex';
            abrirTermos(true);
            return;
          }
          // Cachear localmente para não consultar toda hora
          localStorage.setItem(termosLocalKey, 'v0.1-beta');
        }

        // Salvar localStorage como backup ANTES de qualquer reset ou load do Supabase
        const _lsPag    = JSON.parse(localStorage.getItem('mk_pagamentos')    || '[]');
        const _lsLib    = JSON.parse(localStorage.getItem('mk_liberacoes')    || '[]');
        const _lsCfg    = JSON.parse(localStorage.getItem('mk_cfg')           || '{}');
        const _lsSku    = JSON.parse(localStorage.getItem('mk_skus')          || '[]');
        const _lsCat    = JSON.parse(localStorage.getItem('mk_categorias')    || '[]');
        const _lsComp   = JSON.parse(localStorage.getItem('mk_componentes')   || '[]');
        const _lsCompos = JSON.parse(localStorage.getItem('mk_composicao')    || '[]');
        const _lsVendas = JSON.parse(localStorage.getItem('mk_vendas_sku')    || '[]');
        const _lsMeta = localStorage.getItem('mk_vendas_meta');
        if(_lsMeta){ try{ vendasImportMeta = JSON.parse(_lsMeta); }catch(e){} }
        const _lsEst    = JSON.parse(localStorage.getItem('mk_estoque_galpao')|| '[]');

        // Resetar variáveis JS
        pagamentos=[]; liberacoes=[]; skus=[]; categorias=[];
        extratoHistorico=[]; diasPipeline=0;
        saldoMP=0; saldoOutros=0; saldoAtual=0; cfgPct=0.75; reservaMinima=0; periodoHistorico=30; periodoHistoricoML=90;
        componentes=[]; composicaoKit=[]; vendasSku=[]; estoqueGalpao=[]; metaComp={};

        await carregarDoSupabase();

        // Merge: se Supabase retornou vazio, restaurar do backup local
        let _syncNeeded = false;
        if(pagamentos.length   === 0 && _lsPag.length    > 0){ pagamentos    = _lsPag;    _syncNeeded = true; }
        if(liberacoes.length   === 0 && _lsLib.length    > 0){ liberacoes    = _lsLib;    _syncNeeded = true; }
        if(skus.length         === 0 && _lsSku.length    > 0){ skus          = _lsSku;    _syncNeeded = true; }
        if(categorias.length   === 0 && _lsCat.length    > 0){ categorias    = _lsCat;    _syncNeeded = true; }
        if(componentes.length  === 0 && _lsComp.length   > 0) componentes   = _lsComp;
        if(composicaoKit.length=== 0 && _lsCompos.length > 0) composicaoKit = _lsCompos;
        if(_lsVendas.length > 0 && _lsVendas.length >= vendasSku.length)    vendasSku     = _lsVendas;
        if(_lsEst.length    > 0 && _lsEst.length    >= estoqueGalpao.length) estoqueGalpao = _lsEst;
        // Para saldo: Supabase pode estar desatualizado (save async não concluiu antes do F5)
        if(saldoMP === 0 && _lsCfg.saldoMP > 0){ saldoMP = _lsCfg.saldoMP; saldoAtual = saldoMP + saldoOutros; }
        if(saldoOutros === 0 && _lsCfg.saldoOutros > 0){ saldoOutros = _lsCfg.saldoOutros; saldoAtual = saldoMP + saldoOutros; }
        if(_lsCfg.patCfg) patCfg = {...patCfg, ..._lsCfg.patCfg};
        // Dados restaurados do localStorage → sincronizar imediatamente para nuvem
        if(_syncNeeded) salvarSupabase();

        document.getElementById('tela-login').classList.remove('ativo');
        document.getElementById('user-bar').style.display = 'block';
        document.getElementById('user-bar-email').textContent = user.email;
        document.getElementById('card-minha-conta').style.display = 'block';
        document.getElementById('card-feedbacks').style.display = 'block';

        // Verificar callback OAuth do ML (?code=...)
        const mlCode = new URLSearchParams(window.location.search).get('code');
        if(mlCode){
          nav('receber');
          await handleMLCallback(mlCode);
        } else {
          await verificarConexaoML();
          init(); // popula inputs de saldo + renderDashboard
          autoSyncML(); // background, sem await
        }
      } catch(err) {
        console.error('entrarNoApp:', err);
        document.getElementById('login-sync').style.display = 'none';
        document.querySelector('.login-form').style.display = 'flex';
        document.querySelector('.login-tabs').style.display = 'flex';
        const msg = document.getElementById('login-msg');
        msg.className = 'login-msg erro';
        msg.textContent = 'Erro ao carregar. Verifique sua conexão e tente novamente.';
      }
    }

    function limparSessaoLocal(){
      ['mk_pagamentos','mk_liberacoes','mk_skus','mk_categorias','mk_cfg',
       'mk_liberacoes_hoje','mk_ultimo_sync_ml',
       'mk_componentes','mk_composicao','mk_vendas_sku','mk_estoque_galpao','mk_meta_comp','mk_p11_cfg'].forEach(k => localStorage.removeItem(k));
      pagamentos=[]; liberacoes=[]; skus=[]; categorias=[];
      extratoHistorico=[]; diasPipeline=0;
      saldoMP=0; saldoOutros=0; saldoAtual=0; cfgPct=0.75; reservaMinima=0; periodoHistorico=30; periodoHistoricoML=90;
      componentes=[]; composicaoKit=[]; vendasSku=[]; estoqueGalpao=[]; metaComp={};
      const mlSt = document.getElementById('ml-status');
      if(mlSt) mlSt.textContent = '';
    }

    async function sair(){
      if(!confirm('Sair da conta?')) return;
      limparSessaoLocal();
      await supa.auth.signOut();
      usuarioAtual = null;
      document.getElementById('tela-login').classList.add('ativo');
      document.getElementById('user-bar').style.display = 'none';
      document.getElementById('card-minha-conta').style.display = 'none';
      document.querySelector('.login-form').style.display = 'flex';
      document.querySelector('.login-tabs').style.display = 'flex';
      document.getElementById('login-sync').style.display = 'none';
      document.getElementById('login-msg').textContent = '';
      document.getElementById('login-email').value = '';
      document.getElementById('login-senha').value = '';
      ocultarResetSenha();
    }

    // ===== RESET / TROCA DE SENHA =====
    function mostrarResetSenha(){
      document.querySelector('.login-form').style.display = 'none';
      document.querySelector('.login-tabs').style.display = 'none';
      document.getElementById('reset-form').style.display = 'flex';
      document.getElementById('reset-email').value = document.getElementById('login-email').value;
      document.getElementById('reset-msg').textContent = '';
    }

    function ocultarResetSenha(){
      document.getElementById('reset-form').style.display = 'none';
      document.querySelector('.login-form').style.display = 'flex';
      document.querySelector('.login-tabs').style.display = 'flex';
      document.getElementById('reset-msg').textContent = '';
    }

    async function enviarResetSenha(){
      const email = document.getElementById('reset-email').value.trim();
      const msg = document.getElementById('reset-msg');
      if(!email){ msg.className='login-msg erro'; msg.textContent='Informe o e-mail.'; return; }
      msg.className='login-msg'; msg.textContent='Enviando...';
      const { error } = await supa.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if(error){
        msg.className='login-msg erro';
        msg.textContent = 'Erro: ' + error.message;
      } else {
        msg.className='login-msg ok';
        msg.textContent = 'Link enviado! Verifique seu e-mail.';
      }
    }

    async function trocarSenha(){
      const nova = document.getElementById('nova-senha').value;
      const confirmar = document.getElementById('confirmar-senha').value;
      const msgEl = document.getElementById('msg-trocar-senha');
      msgEl.style.color = '';
      if(!nova || nova.length < 6){ msgEl.style.color='var(--danger)'; msgEl.textContent='A senha deve ter pelo menos 6 caracteres.'; return; }
      if(nova !== confirmar){ msgEl.style.color='var(--danger)'; msgEl.textContent='As senhas não coincidem.'; return; }
      msgEl.textContent = 'Salvando...';
      const { error } = await supa.auth.updateUser({ password: nova });
      if(error){
        msgEl.style.color = 'var(--danger)';
        msgEl.textContent = 'Erro: ' + error.message;
      } else {
        msgEl.style.color = 'var(--success)';
        msgEl.textContent = 'Senha alterada com sucesso!';
        document.getElementById('nova-senha').value = '';
        document.getElementById('confirmar-senha').value = '';
      }
    }

    async function confirmarApagarTudo(){
      const ok = confirm('⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL.\n\nTodos os dados serão apagados permanentemente:\n• Contas a pagar\n• Recebíveis importados\n• SKUs e categorias\n• Configurações\n\nTem certeza absoluta?');
      if(!ok) return;
      const ok2 = confirm('Última confirmação: apagar TUDO e começar do zero?');
      if(!ok2) return;
      // Limpa localStorage
      ['mk_pagamentos','mk_liberacoes','mk_skus','mk_categorias','mk_config'].forEach(k => localStorage.removeItem(k));
      // Limpa dados P11 do Motor de Reposição
      ['mk_componentes','mk_estoque_galpao','mk_composicao_kit','mk_vendas_sku'].forEach(k => localStorage.removeItem(k));
      // Limpa Supabase se logado
      if(usuarioAtual){
        const uid = usuarioAtual.id;
        await Promise.all([
          supa.from('pagamentos').delete().eq('usuario_id', uid),
          supa.from('liberacoes').delete().eq('usuario_id', uid),
          supa.from('skus').delete().eq('usuario_id', uid),
          supa.from('categorias').delete().eq('usuario_id', uid),
          supa.from('configuracoes').delete().eq('usuario_id', uid),
          supa.from('extrato_historico').delete().eq('usuario_id', uid),
        ]);
      }
      // Reseta variáveis
      pagamentos = []; liberacoes = []; skus = []; categorias = [];
      componentes = []; estoqueGalpao = []; composicaoKit = []; vendasSku = [];
      saldoMP = 0; saldoOutros = 0; cfgDelay = 7; cfgPct = 0.75; reservaMinima = 0; periodoHistorico = 90;
      alert('✅ Todos os dados foram apagados.');
      nav('dashboard');
    }

    // ===== SUPABASE — CARREGAR DADOS =====
    async function carregarDoSupabase(){
      if(!usuarioAtual) return;
      const uid = usuarioAtual.id;

      const dataCorte90 = addDias(getToday(), -90);
      const [rPag, rLib, rSku, rCat, rCfg, rExt, rSnap] = await Promise.all([
        supa.from('pagamentos').select('*').eq('usuario_id', uid),
        supa.from('liberacoes').select('*').eq('usuario_id', uid),
        supa.from('skus').select('*').eq('usuario_id', uid),
        supa.from('categorias').select('*').eq('usuario_id', uid),
        supa.from('configuracoes').select('*').eq('usuario_id', uid).single(),
        supa.from('extrato_historico').select('data,val_liquido,qtd_pedidos').eq('usuario_id', uid).gte('data', dataCorte90).order('data', {ascending:false}),
        supa.from('snapshots_ml').select('data_captura').eq('usuario_id', uid).limit(9999)
      ]);

      if(rPag.data) pagamentos = rPag.data.map(p => ({
        id:p.id, desc:p.descricao, forn:p.forn, val:p.val, data:p.data,
        cat:p.cat, pago:p.pago, tipo:p.tipo, grupo_id:p.grupo_id,
        parcela:p.parcela, valorPago:p.valor_pago,
        dataPaga:p.data_paga||null, desconto:p.desconto||0, juros:p.juros||0,
        tiny_key:p.tiny_key||null, fonte:p.fonte||null
      }));

      if(rLib.data) liberacoes = rLib.data.map(l => ({data:l.data, val:l.val}));

      if(rSku.data) skus = rSku.data.map(s => ({id:s.id, sku:s.sku, custo:s.custo, imposto:s.imposto}));

      if(rCat.data) categorias = rCat.data.map(c => ({id:c.id, nome:c.nome, impactaDRE:c.impacta_dre, tipoPassivo:c.tipo_passivo||'divida'}));

      if(rCfg.data && rCfg.data.cfg){
        const c = rCfg.data.cfg;
        if(c.saldoMP !== undefined) saldoMP = c.saldoMP;
        if(c.saldoOutros !== undefined) saldoOutros = c.saldoOutros;
        if(c.cfgPct !== undefined) cfgPct = c.cfgPct;
        if(c.reservaMinima !== undefined) reservaMinima = c.reservaMinima;
        if(c.periodoHistorico !== undefined) periodoHistorico = c.periodoHistorico;
        if(c.modoProjecao !== undefined) modoProjecao = c.modoProjecao;
        if(c.periodoHistoricoML !== undefined) periodoHistoricoML = c.periodoHistoricoML;
        if(c.patCfg) patCfg = {...patCfg, ...c.patCfg};
        saldoAtual = saldoMP + saldoOutros;
      }

      if(rExt.data) extratoHistorico = rExt.data.map(e => ({data:e.data, val_liquido:e.val_liquido, qtd_pedidos:e.qtd_pedidos}));

      diasPipeline = new Set((rSnap.data || []).map(r => r.data_captura)).size;
      atualizarRegressao();
      // P11 — carregar dados de estoque/vendas/composição em paralelo
      await carregarP11Supabase();
    }

    // ===== SUPABASE — SALVAR DADOS =====
    async function salvarSupabase(){
      if(!usuarioAtual) return {ok:false, error:'sem sessão'};
      const uid = usuarioAtual.id;

      // Captura snapshot antes de qualquer await (evita race condition com limparSessaoLocal)
      const snapPag = pagamentos.map(p => ({
        usuario_id: uid,
        descricao: p.desc, forn: p.forn||'', val: p.val, data: p.data,
        cat: p.cat||'', pago: p.pago||false, tipo: p.tipo||'unico',
        grupo_id: p.grupo_id||p.grupoId||null, parcela: p.parcela||null, valor_pago: p.valorPago||null,
        data_paga: p.dataPaga||null, desconto: p.desconto||0, juros: p.juros||0,
        tiny_key: p.tiny_key||null, fonte: p.fonte||null
      }));
      const snapCat = categorias.map(c => ({usuario_id: uid, nome: c.nome, impacta_dre: c.impactaDRE||false, tipo_passivo: c.tipoPassivo||'divida'}));
      const snapSku = skus.map(s => ({usuario_id: uid, sku: s.sku, custo: s.custo, imposto: s.imposto}));

      // Pagamentos: delete + insert em lotes de 200
      const { error: ePagDel } = await supa.from('pagamentos').delete().eq('usuario_id', uid);
      if(ePagDel){ console.error('salvarSupabase pagamentos delete:', ePagDel); return {ok:false, error:'delete pagamentos: ' + ePagDel.message}; }
      if(snapPag.length > 0){
        for(let i = 0; i < snapPag.length; i += 200){
          const { error: ePagIns } = await supa.from('pagamentos').insert(snapPag.slice(i, i+200));
          if(ePagIns){ console.error('salvarSupabase pagamentos insert lote', i, ePagIns); return {ok:false, error:'insert pagamentos lote ' + i + ': ' + ePagIns.message}; }
        }
      }

      // Categorias
      const { error: eCatDel } = await supa.from('categorias').delete().eq('usuario_id', uid);
      if(!eCatDel && snapCat.length > 0){
        const { error: eCatIns } = await supa.from('categorias').insert(snapCat);
        if(eCatIns){ console.error('salvarSupabase categorias insert:', eCatIns); return {ok:false, error:'insert categorias: ' + eCatIns.message}; }
      }

      // SKUs
      const { error: eSkuDel } = await supa.from('skus').delete().eq('usuario_id', uid);
      if(!eSkuDel && snapSku.length > 0){
        const { error: eSkuIns } = await supa.from('skus').insert(snapSku);
        if(eSkuIns){ console.error('salvarSupabase skus insert:', eSkuIns); return {ok:false, error:'insert skus: ' + eSkuIns.message}; }
      }

      return {ok:true, pagamentos: snapPag.length, categorias: snapCat.length, skus: snapSku.length};
    }

    async function forceSyncNuvem(btn){
      const msg = document.getElementById('msg-sync-nuvem');
      btn.disabled = true;
      msg.style.color = '#666';
      msg.textContent = 'Sincronizando...';
      const r = await salvarSupabase();
      btn.disabled = false;
      if(r?.ok){
        msg.style.color = 'var(--success)';
        msg.textContent = `Concluído: ${r.pagamentos} pagamentos · ${r.skus} SKUs · ${r.categorias} categorias`;
      } else {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Erro: ' + (r?.error || 'desconhecido');
      }
    }

    async function salvarCfgSupabase(){
      if(!usuarioAtual) return;
      const cfg = {saldoMP, saldoOutros, cfgPct, reservaMinima, periodoHistorico, modoProjecao, periodoHistoricoML, patCfg};
      await supa.from('configuracoes').upsert({usuario_id: usuarioAtual.id, cfg, updated_at: new Date().toISOString()});
    }

    async function salvarLiberacoesSupabase(){
      if(!usuarioAtual) return;
      const uid = usuarioAtual.id;
      await supa.from('liberacoes').delete().eq('usuario_id', uid);
      if(liberacoes.length > 0){
        const rows = liberacoes.map(l => ({usuario_id: uid, data: l.data, val: l.val}));
        await supa.from('liberacoes').insert(rows);
      }
    }

    // ===== SUPABASE — SYNC P11 =====
    async function salvarP11Supabase(){
      if(!usuarioAtual) return;
      const uid = usuarioAtual.id;
      try {
        // Componentes
        const snapComp = componentes.map(c => ({
          usuario_id: uid, codigo: c.codigo, descricao: c.descricao||'',
          custo_unitario: c.custo_unitario||0, fornecedor: c.fornecedor||'', lead_time_dias: c.lead_time_dias||0
        }));
        await supa.from('sku_componentes').delete().eq('usuario_id', uid);
        if(snapComp.length > 0) await supa.from('sku_componentes').insert(snapComp);

        // Composição
        const snapComp2 = composicaoKit.map(c => ({
          usuario_id: uid, sku_comercial: c.sku_comercial, titulo_comercial: c.titulo_comercial||'',
          sku_componente: c.sku_componente, qty: c.qty
        }));
        await supa.from('sku_composicao').delete().eq('usuario_id', uid);
        if(snapComp2.length > 0) await supa.from('sku_composicao').insert(snapComp2);

        // Vendas SKU
        const snapVendas = vendasSku.map(v => ({
          usuario_id: uid, sku: v.sku, titulo: v.titulo||'',
          unidades: v.unidades||0, receita: v.receita||0, tarifa_ml: v.tarifa_ml||0,
          envio: v.envio||0, liquido: v.liquido||0, unidades_ads: v.unidades_ads||0,
          cancelamentos: v.cancelamentos||0, periodo_dias: v.periodo_dias||30
        }));
        await supa.from('vendas_sku').delete().eq('usuario_id', uid);
        if(snapVendas.length > 0) await supa.from('vendas_sku').insert(snapVendas);

        // Estoque componentes
        const snapEst = estoqueGalpao.map(e => ({
          usuario_id: uid, sku: e.sku, descricao: e.descricao||'',
          qtd_galpao: e.qtd_galpao||0, qtd_full: e.qtd_full||0, qtd_full_pendente: e.qtd_full_pendente||0,
          em_transito: e.em_transito||0, custo_medio: e.custo_medio||0, data_atualizacao: e.data_atualizacao||''
        }));
        await supa.from('estoque_componentes').delete().eq('usuario_id', uid);
        if(snapEst.length > 0) await supa.from('estoque_componentes').insert(snapEst);
      } catch(err){ console.error('salvarP11Supabase:', err); }
    }

    async function carregarP11Supabase(){
      if(!usuarioAtual) return;
      const uid = usuarioAtual.id;
      try {
        const [rComp, rCompos, rVendas, rEst] = await Promise.all([
          supa.from('sku_componentes').select('*').eq('usuario_id', uid),
          supa.from('sku_composicao').select('*').eq('usuario_id', uid),
          supa.from('vendas_sku').select('*').eq('usuario_id', uid),
          supa.from('estoque_componentes').select('*').eq('usuario_id', uid)
        ]);
        if(rComp.data && rComp.data.length > 0)
          componentes = rComp.data.map(c => ({codigo:c.codigo, descricao:c.descricao, custo_unitario:c.custo_unitario, fornecedor:c.fornecedor, lead_time_dias:c.lead_time_dias}));
        if(rCompos.data && rCompos.data.length > 0)
          composicaoKit = rCompos.data.map(c => ({sku_comercial:c.sku_comercial, titulo_comercial:c.titulo_comercial, sku_componente:c.sku_componente, qty:c.qty}));
        if(rVendas.data && rVendas.data.length > 0)
          vendasSku = rVendas.data.map(v => ({sku:v.sku, titulo:v.titulo, unidades:v.unidades, receita:v.receita, tarifa_ml:v.tarifa_ml, envio:v.envio, liquido:v.liquido, unidades_ads:v.unidades_ads, cancelamentos:v.cancelamentos, periodo_dias:v.periodo_dias}));
        if(rEst.data && rEst.data.length > 0)
          estoqueGalpao = rEst.data.map(e => ({sku:e.sku, descricao:e.descricao, qtd_galpao:e.qtd_galpao, qtd_full:e.qtd_full, qtd_full_pendente:e.qtd_full_pendente||0, em_transito:e.em_transito, custo_medio:e.custo_medio, data_atualizacao:e.data_atualizacao}));
      } catch(err){ console.error('carregarP11Supabase:', err); }
    }

    // ===== FEEDBACK =====
    function abrirFeedback(){ document.getElementById('modal-feedback').classList.add('open'); }
    async function enviarFeedback(){
      const texto = document.getElementById('feedback-texto').value.trim();
      if(!texto) return;
      if(usuarioAtual){
        await supa.from('feedbacks').insert({
          usuario_id: usuarioAtual.id,
          mensagem: texto,
          pagina: document.querySelector('.nav-item.active')?.textContent || ''
        });
      }
      document.getElementById('feedback-texto').value = '';
      document.getElementById('modal-feedback').classList.remove('open');
      alert('Feedback enviado! Obrigado.');
    }

    async function carregarFeedbacks(){
      if(!usuarioAtual) return;
      const el = document.getElementById('lista-feedbacks');
      el.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">Carregando...</div>';
      const { data } = await supa.from('feedbacks')
        .select('mensagem,pagina,created_at')
        .eq('usuario_id', usuarioAtual.id)
        .order('created_at', {ascending:false})
        .limit(50);
      if(!data || data.length === 0){
        el.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">Nenhum feedback enviado ainda.</div>';
        return;
      }
      el.innerHTML = data.map(f => {
        const dt = new Date(f.created_at);
        const dtStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
        return `<div style="padding:12px 16px;border-bottom:1px solid var(--gray-100);">
          <div style="font-size:11px;color:#999;margin-bottom:4px;">${dtStr}${f.pagina ? ' · ' + f.pagina.trim() : ''}</div>
          <div style="font-size:13px;">${f.mensagem}</div>
        </div>`;
      }).join('');
      initResizableCols('tbody-categorias');
    }

    // ===== LOG DE ERROS =====
    window.onerror = function(msg, url, line, col, err){
      if(usuarioAtual){
        supa.from('erros_log').insert({
          usuario_id: usuarioAtual.id,
          erro: msg,
          stack: err?.stack || '',
          pagina: document.querySelector('.nav-item.active')?.textContent || ''
        });
      }
    };

    function toggleDropdown(id){
      var el = document.getElementById(id);
      if(!el) return;
      var menu = el.querySelector('.dd-menu');
      if(!menu) return;
      var isOpen = menu.style.display === 'block';
      closeDropdowns();
      if(!isOpen) menu.style.display = 'block';
    }
    function closeDropdowns(){
      document.querySelectorAll('.dd-menu').forEach(function(el){ el.style.display = 'none'; });
    }
    document.addEventListener('click', function(e){
      if(!e.target.closest('.dd-wrap')) closeDropdowns();
    });
