// ===== EQUIPE (colaboradores) =====
// O dono cria em Configurações → Equipe um login para um colaborador e marca as telas que ele vê (por enquanto só
// Pedidos). O colaborador entra no mesmo site: o sistema lê os dados do DONO só nessas telas, sem gravar nada.
// Proteção em duas camadas: no banco o colaborador só tem políticas de leitura (migration 20261229_equipe); aqui a guarda
// abaixo recusa qualquer gravação antes de sair do navegador. Tela nova para colaborador = política de leitura no
// banco + EQ_PAGINAS aqui + PAGINAS na função "equipe" (+ RPC/função de borda que a tela usar, nas listas abaixo).
// Carregado logo depois de demo.js: a guarda precisa envolver o fetch antes de o cliente do Supabase ser criado.
    var EQUIPE = null;   // { dono_id, paginas, nome, membro, email } quando quem entrou é colaborador
    const EQ_PAGINAS = [['pedidos', 'Pedidos', 'Pedidos do galpão até o envio e o detalhe de cada venda (com valores).'],
      ['estoque', 'Estoque', 'Estoque do galpão: físico, a caminho, ocupado, disponível e movimentações.']];
    // perfil Logística (padrão ao criar): Pedidos + Estoque
    const EQ_LOGISTICA = ['pedidos', 'estoque'];
    const EQ_RPC = ['sku_fotos', 'vendas_ml_sku_dia', 'vendas_full_sku', 'equipe_nomes'];
    // colaborador com "visualizar e alterar": tabelas que cada tela grava (o banco confere de novo: migration 20261231)
    const EQ_ESCRITA = { pedidos: ['vendas_conferir', 'vendas_notas'], estoque: ['estoque_mov', 'estoque_contagens', 'estoque_envios_full', 'sku_fotos_manual'] };            // funções do banco que o colaborador pode chamar (só leitura)
    const EQ_FUNCOES = ['ml-venda'];          // funções de borda (a ml-venda só consulta para colaborador)

    (function(){
      const orig = window.fetch.bind(window);
      window.fetch = function(input, init){
        if(window.EQUIPE){
          const url = String(typeof input === 'string' ? input : (input && input.url) || ''), metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          if(url.includes('.supabase.co/')){
            const leitura = metodo === 'GET' || metodo === 'HEAD';
            const bloq = /\/rest\/v1\/rpc\//.test(url) ? !EQ_RPC.some(f => new RegExp('/rpc/' + f + '(\\?|$)').test(url))
              : /\/rest\/v1\//.test(url) ? !leitura && !(window.EQUIPE.alterar && (window.EQUIPE.paginas || []).some(p => (EQ_ESCRITA[p] || []).includes((url.match(/\/rest\/v1\/([\w-]+)/) || [])[1])))
              : /\/functions\/v1\//.test(url) ? !EQ_FUNCOES.some(f => new RegExp('/functions/v1/' + f + '(\\?|/|$)').test(url))
              : /\/storage\/v1\//.test(url) ? !leitura : false;
            if(bloq) return Promise.resolve(new Response(JSON.stringify({ message: 'Acesso de colaborador: só consulta.', code: 'equipe' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
          }
        }
        return orig(input, init);
      };
    })();

    const eqEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

    // ---------- entrada do colaborador (chamada no começo de entrarNoApp) ----------
    // devolve true quando tratou o login (colaborador ou colaborador bloqueado)
    async function equipeEntrar(user){
      if(typeof MODO_DEMO !== 'undefined' && MODO_DEMO) return false;
      const r = await supa.from('equipe').select('dono_id,paginas,ativo,nome,alterar').eq('membro_id', user.id).maybeSingle();
      if(r.error || !r.data) return false;
      const m = r.data;
      if(!m.ativo || !(m.paginas || []).length){
        await supa.auth.signOut();
        const msg = document.getElementById('login-msg'); if(msg){ msg.className = 'login-msg erro'; msg.textContent = 'Seu acesso foi bloqueado pelo dono da conta.'; }
        const ls = document.getElementById('login-sync'); if(ls) ls.style.display = 'none';
        const lf = document.querySelector('.login-form'); if(lf) lf.style.display = 'flex';
        const lt = document.querySelector('.login-tabs'); if(lt) lt.style.display = 'flex';
        return true;
      }
      window.EQUIPE = { ...m, membro: user.id, email: user.email };
      usuarioAtual = { ...user, id: m.dono_id };   // as telas leem a conta do dono (o banco só deixa ler o que foi liberado)
      document.body.classList.add('modo-equipe');
      const ls = document.getElementById('login-sync'); if(ls) ls.style.display = 'none';
      document.getElementById('tela-login').classList.remove('ativo');
      document.getElementById('user-bar').style.display = 'block';
      document.getElementById('user-bar-email').textContent = user.email + ' (colaborador)';
      // menu: só as telas liberadas, sem os grupos
      const pags = m.paginas;
      document.querySelectorAll('.nav-sec').forEach(s => { s.style.display = 'none'; });
      document.querySelectorAll('.nav-item').forEach(li => {
        const p = ((li.getAttribute('onclick') || '').match(/nav\('([\w-]+)'\)/) || [])[1];
        if(p && pags.includes(p)){ li.classList.remove('sec-oculta'); li.removeAttribute('data-sec'); li.style.display = ''; } else li.style.display = 'none';
      });
      ['conta-ml-box', 'adm-botao'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
      // trocar de tela só entre as liberadas
      const navOrig = window.nav;
      window.nav = function(p, fromPop){ return navOrig(pags.includes(p) ? p : pags[0], fromPop); };
      const main = document.querySelector('.main');
      if(main && !document.getElementById('eq-faixa')) main.insertAdjacentHTML('afterbegin', '<div id="eq-faixa" class="alert alert-info" style="margin-bottom:12px;">Acesso de colaborador' + (m.nome ? ' · ' + eqEsc(m.nome) : '') + (m.alterar ? ': pode alterar estas telas; cada alteração fica registrada com o seu nome.' : ': só consulta.') + '</div>');
      if(pags.includes('estoque')) await equipeCarregarEstoque(m.dono_id).catch(() => {});
      window._navPronto = true;
      window.nav(pags.includes((location.hash || '').slice(1)) ? location.hash.slice(1) : pags[0]);
      return true;
    }

    // cadastro, kits e espelho do galpão do dono (o login normal carrega isso em carregarDoSupabase, que o colaborador não roda)
    async function equipeCarregarEstoque(uid){
      const [s, c, k, e] = await Promise.all([supa.from('skus').select('*').eq('usuario_id', uid), supa.from('sku_componentes').select('*').eq('usuario_id', uid),
        supa.from('sku_composicao').select('*').eq('usuario_id', uid), supa.from('estoque_componentes').select('*').eq('usuario_id', uid)]);
      if(s.data) skus = s.data.map(x => ({ id: x.id, sku: x.sku, custo: x.custo, imposto: x.imposto, titulo: x.titulo || '', pai: x.pai || null, variacao: x.variacao || null }));
      if(c.data) componentes = c.data.map(x => ({ codigo: x.codigo, descricao: x.descricao, custo_unitario: x.custo_unitario, fornecedor: x.fornecedor, lead_time_dias: x.lead_time_dias }));
      if(k.data) composicaoKit = k.data.map(x => ({ sku_comercial: x.sku_comercial, titulo_comercial: x.titulo_comercial, sku_componente: x.sku_componente, qty: x.qty }));
      if(e.data) estoqueGalpao = e.data.map(x => ({ sku: x.sku, descricao: x.descricao, qtd_galpao: x.qtd_galpao, qtd_full: x.qtd_full, qtd_full_pendente: x.qtd_full_pendente || 0, em_transito: x.em_transito, custo_medio: x.custo_medio }));
    }

    // "feito por": nome de quem gravou (uid do login); vazio = rotina automática do sistema
    let eqNomes = null;
    async function equipeNomesCarregar(){
      if(eqNomes) return eqNomes;
      const r = await supa.rpc('equipe_nomes');
      eqNomes = new Map((r.data || []).map(x => [x.uid, x]));
      return eqNomes;
    }
    function equipeQuem(uid){
      if(!uid) return 'automático';
      const eu = window.EQUIPE ? window.EQUIPE.membro : (typeof usuarioAtual !== 'undefined' && usuarioAtual ? usuarioAtual.id : '');
      if(uid === eu) return 'você';
      const x = eqNomes && eqNomes.get(uid);
      return x ? (x.dono ? 'dono da conta' : x.nome + ' (colaborador)') : 'outro usuário';
    }

    // ---------- Configurações → Equipe (dono) ----------
    let eqLista = [];
    async function equipeRenderCard(){
      const view = document.getElementById('view-config'); if(!view || window.EQUIPE || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      let card = document.getElementById('cfg-equipe-card');
      if(!card){ card = document.createElement('div'); card.id = 'cfg-equipe-card'; card.className = 'card'; card.dataset.cfgAba = 'equipe'; view.appendChild(card); if(typeof cfgMontarAbas === 'function') cfgMontarAbas(); }
      const r = await supa.from('equipe').select('*').eq('dono_id', usuarioAtual.id).order('criado_em');
      eqLista = r.data || []; eqNomes = null;
      const nomeP = p => (EQ_PAGINAS.find(x => x[0] === p) || [p, p])[1];
      card.innerHTML = `
        <div class="card-header"><div class="card-title">Equipe (colaboradores)</div></div>
        <div class="card-body" style="line-height:1.6;">
          <div>Crie um acesso para quem trabalha com você. A pessoa entra em <b>${eqEsc(location.origin + location.pathname)}</b> com o e-mail e a senha que você definir e vê <b>só as telas marcadas</b>. Com <b>Só visualizar</b> não altera nada; com <b>Visualizar e alterar</b> pode lançar nessas telas (ex.: contagem e ajuste de estoque, conferência de pedido), e cada alteração fica registrada com o nome de quem fez.</div>
          ${r.error ? `<div class="alert alert-warning" style="margin-top:10px;">Não consegui ler a equipe: ${eqEsc(r.error.message)}</div>` : ''}
          <div style="overflow-x:auto;margin:12px 0;"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Telas</th><th>Acesso</th><th>Situação</th><th></th></tr></thead><tbody>
            ${eqLista.map(m => `<tr><td><b>${eqEsc(m.nome || '—')}</b></td><td>${eqEsc(m.email)}</td><td>${(m.paginas || []).map(nomeP).map(eqEsc).join(', ')}</td>
              <td><select onchange="equipeAlterar('${eqEsc(m.membro_id)}', this.value === '1')"><option value="0" ${m.alterar ? '' : 'selected'}>Só visualizar</option><option value="1" ${m.alterar ? 'selected' : ''}>Visualizar e alterar</option></select></td>
              <td>${m.ativo ? '<span class="badge badge-success">ativo</span>' : '<span class="badge badge-warning">bloqueado</span>'}</td>
              <td style="text-align:right;white-space:nowrap;"><button class="btn-out btn-sm" onclick="equipeSenha('${eqEsc(m.membro_id)}')">Trocar senha</button>
                <button class="btn-out btn-sm" onclick="equipeAtivo('${eqEsc(m.membro_id)}', ${m.ativo ? 'false' : 'true'})">${m.ativo ? 'Bloquear' : 'Liberar'}</button>
                <button class="btn-out btn-sm" style="color:var(--danger,#dc2626);" onclick="equipeRemover('${eqEsc(m.membro_id)}')">Remover</button></td></tr>`).join('') || '<tr><td colspan="6" class="text-muted" style="padding:12px;text-align:center;">Nenhum colaborador ainda.</td></tr>'}
          </tbody></table></div>
          <button class="btn btn-sm" onclick="equipeNovo()">+ Adicionar colaborador</button>
        </div>`;
    }
    function equipeNovo(){
      vmlModal('Novo colaborador', `
        <div class="text-muted" style="margin-bottom:12px;">Use um e-mail que ainda não tenha cadastro no Caixa 360. A senha você passa para a pessoa; dá para trocar depois.</div>
        <label class="pf-c"><span>Nome</span><input id="eq-nome" placeholder="Ex.: Willian (logística)"></label>
        <label class="pf-c"><span>E-mail</span><input id="eq-email" type="email" autocomplete="off"></label>
        <label class="pf-c"><span>Senha (mínimo 8 caracteres)</span><input id="eq-senha" type="password" autocomplete="new-password"></label>
        <div class="pf-c"><span>Telas que pode ver <small class="text-muted">(já vem no perfil Logística: Pedidos + Estoque)</small></span>${EQ_PAGINAS.map(([k, t, d]) => `<label style="display:flex;gap:8px;align-items:flex-start;margin-top:4px;"><input type="checkbox" class="eq-pag" value="${k}" ${EQ_LOGISTICA.includes(k) ? 'checked' : ''}> <span><b>${t}</b><br><small class="text-muted">${d}</small></span></label>`).join('')}</div>
        <label class="pf-c"><span>Acesso</span><select id="eq-alterar"><option value="0">Só visualizar</option><option value="1">Visualizar e alterar</option></select></label>
        <div id="eq-msg" style="font-size:13px;margin-top:8px;"></div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" id="eq-bt" onclick="equipeCriar()">Criar acesso</button>`);
    }
    async function equipeChamar(corpo){
      const r = await supa.functions.invoke('equipe', { body: corpo });
      return r.data || { error: (r.error && r.error.message) || 'Falha na chamada.' };
    }
    async function equipeCriar(){
      const v = id => (document.getElementById(id) || {}).value || '', msg = document.getElementById('eq-msg'), bt = document.getElementById('eq-bt');
      const paginas = [...document.querySelectorAll('.eq-pag:checked')].map(x => x.value);
      bt.disabled = true; bt.textContent = 'Criando…';
      const d = await equipeChamar({ acao: 'criar', nome: v('eq-nome'), email: v('eq-email'), senha: v('eq-senha'), paginas, alterar: v('eq-alterar') === '1' });
      if(d.error){ msg.className = 'text-danger'; msg.textContent = d.error; bt.disabled = false; bt.textContent = 'Criar acesso'; return; }
      fecharModal('modal-vml'); if(typeof toast === 'function') toast('Acesso criado. Passe o e-mail e a senha para a pessoa.'); equipeRenderCard();
    }
    async function equipeSenha(membro){
      const s = prompt('Nova senha do colaborador (mínimo 8 caracteres):'); if(s == null) return;
      const d = await equipeChamar({ acao: 'senha', membro, senha: s });
      alert(d.error ? d.error : 'Senha trocada.');
    }
    async function equipeAtivo(membro, ativo){
      const r = await supa.from('equipe').update({ ativo, atualizado_em: new Date().toISOString() }).eq('membro_id', membro).eq('dono_id', usuarioAtual.id);
      if(r.error) alert('Não consegui alterar: ' + r.error.message);
      if(!ativo && typeof toast === 'function') toast('Bloqueado. Se a pessoa estiver com o site aberto, perde o acesso aos dados na hora.');
      equipeRenderCard();
    }
    async function equipeAlterar(membro, alterar){
      const r = await supa.from('equipe').update({ alterar, atualizado_em: new Date().toISOString() }).eq('membro_id', membro).eq('dono_id', usuarioAtual.id);
      if(r.error) alert('Não consegui alterar: ' + r.error.message); else if(typeof toast === 'function') toast(alterar ? 'Pode alterar. Vale no próximo acesso dele (ou ao recarregar a página).' : 'Só visualizar: vale na hora.');
      equipeRenderCard();
    }
    async function equipeRemover(membro){
      const m = eqLista.find(x => x.membro_id === membro);
      if(!confirm('Remover o acesso de ' + (m ? (m.nome || m.email) : 'este colaborador') + '? O login dele é apagado.')) return;
      const d = await equipeChamar({ acao: 'remover', membro });
      if(d.error) alert(d.error); equipeRenderCard();
    }
