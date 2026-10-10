// ===== ATENDIMENTO — perguntas (pré-venda) e mensagens (pós-venda) do Mercado Livre =====
// Tudo passa pela Edge Function ml-atendimento. Respostas prontas ficam em localStorage (mk_respostas_prontas).
// Também cuida do pop-up que pede a reconexão da conta quando o token não tem os escopos novos.

    let atdPerg = { status:'UNANSWERED', mlb:'', lista:[], total:0, offset:0, carregando:false, erro:null, semPermissao:false };
    let atdMsg = { conversas:[], carregando:false, erro:null, semPermissao:false };
    let atdConversa = null;   // { pack, order, buyer, mensagens, bloqueio }
    const ATD_MAX_MSG = 350;

    function atdEsc(s){
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function atdQuando(iso){
      if(!iso) return '';
      const d = new Date(iso), min = Math.round((Date.now() - d.getTime()) / 60000);
      if(min < 1) return 'agora';
      if(min < 60) return 'há ' + min + ' min';
      if(min < 60 * 24) return 'há ' + Math.round(min / 60) + ' h';
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
    }
    async function atdChamar(body){
      const { data: sessao } = await supa.auth.getSession();
      const jwt = sessao?.session?.access_token;
      const { data, error } = await supa.functions.invoke('ml-atendimento', { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}, body });
      if(error) return { error: error.message };
      return data || { error: 'Sem resposta' };
    }
    function atdAvisoPermissao(){
      return `<div class="alert alert-warning" style="justify-content:space-between;flex-wrap:wrap;">
        <span>Para usar perguntas e mensagens é preciso <b>reconectar sua conta do Mercado Livre</b> com a permissão de comunicação.</span>
        <button class="btn btn-sm" onclick="conectarML()">Reconectar agora</button></div>`;
    }

    // ----- respostas prontas -----
    function atdProntas(){ try { return JSON.parse(localStorage.getItem('mk_respostas_prontas') || '[]'); } catch(e){ return []; } }
    function atdSalvarProntas(l){ localStorage.setItem('mk_respostas_prontas', JSON.stringify(l)); }
    function atdSelectProntas(alvoId){
      const l = atdProntas();
      return `<select style="width:auto;max-width:220px;" onchange="atdInserirPronta(this,'${alvoId}')">
        <option value="">Respostas prontas…</option>
        ${l.map((r,i) => `<option value="${i}">${atdEsc(r.titulo)}</option>`).join('')}
        <option value="gerenciar">⚙ Gerenciar respostas…</option></select>`;
    }
    function atdInserirPronta(sel, alvoId){
      const v = sel.value; sel.value = '';
      if(v === 'gerenciar'){ atdGerenciarProntas(); return; }
      const r = atdProntas()[Number(v)], t = document.getElementById(alvoId);
      if(!r || !t) return;
      t.value = (t.value ? t.value.trimEnd() + ' ' : '') + r.texto;
      t.dispatchEvent(new Event('input')); t.focus();
    }
    function atdGerenciarProntas(){
      const l = atdProntas();
      vmlModal('Respostas prontas', `
        <div class="text-muted" style="margin-bottom:12px;">Textos que você usa com frequência. Aparecem no seletor ao responder perguntas e mensagens.</div>
        ${l.length ? l.map((r,i) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;"><b>${atdEsc(r.titulo)}</b><div class="text-muted" style="white-space:pre-wrap;">${atdEsc(r.texto)}</div></div>
            <button class="ico-btn" title="Excluir" onclick="atdExcluirPronta(${i})">✕</button></div>`).join('') : '<div class="vazio" style="padding:18px 0;">Nenhuma resposta pronta ainda.</div>'}
        <div class="form-group" style="margin-top:16px;"><label class="form-label">Título</label><input type="text" id="atd-pr-titulo" placeholder="Ex.: Prazo de envio"></div>
        <div class="form-group"><label class="form-label">Texto</label><textarea id="atd-pr-texto" rows="3" placeholder="Olá! Enviamos em até 1 dia útil após a compra."></textarea></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="atdAdicionarPronta()">Adicionar</button>`);
    }
    function atdAdicionarPronta(){
      const titulo = document.getElementById('atd-pr-titulo').value.trim(), texto = document.getElementById('atd-pr-texto').value.trim();
      if(!titulo || !texto) return;
      const l = atdProntas(); l.push({ titulo, texto }); atdSalvarProntas(l); atdGerenciarProntas();
    }
    function atdExcluirPronta(i){ const l = atdProntas(); l.splice(i, 1); atdSalvarProntas(l); atdGerenciarProntas(); }

    // ===================================================================
    // PERGUNTAS
    // ===================================================================
    async function renderPerguntas(){
      const el = document.getElementById('view-perguntas');
      if(!el) return;
      atdPergDesenhar();
      await atdPergCarregar(0);
    }

    async function atdPergCarregar(offset){
      atdPerg.carregando = true; atdPerg.offset = offset || 0; atdPergDesenhar();
      const r = await atdChamar({ acao:'perguntas', status: atdPerg.status, item_id: atdPerg.mlb.trim().replace(/^MLB-?/i, 'MLB'), offset: atdPerg.offset, limit: 30 });
      atdPerg.carregando = false;
      atdPerg.erro = r.error || null; atdPerg.semPermissao = !!r.sem_permissao;
      atdPerg.lista = r.perguntas || []; atdPerg.total = r.total || 0;
      atdPergDesenhar();
      if(atdPerg.status === 'UNANSWERED' && !r.error) atdBadge('perguntas', atdPerg.total);
    }

    function atdPergDesenhar(){
      const el = document.getElementById('view-perguntas');
      if(!el || !el.classList.contains('active')) return;
      const p = atdPerg, pagAtual = Math.floor(p.offset / 30) + 1, paginas = Math.max(1, Math.ceil(p.total / 30));
      el.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Perguntas</div><div class="pg-sub">Perguntas feitas nos seus anúncios do Mercado Livre. Responder rápido melhora a conversão.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;">
            <button class="btn-out btn btn-sm" onclick="atdPergCarregar(0)">↻ Atualizar</button>
            <button class="btn-out btn btn-sm" onclick="atdGerenciarProntas()">⚙ Respostas prontas</button>
            <button class="btn-out btn btn-sm" onclick="atdConfigSaudacao()">✍ Saudação e assinatura</button>
          </div>
        </div>
        ${p.semPermissao ? atdAvisoPermissao() : (p.erro ? `<div class="alert alert-danger">${atdEsc(p.erro)}</div>` : '')}
        <div class="chips" style="margin-bottom:14px;">
          <button class="chip ${p.status === 'UNANSWERED' ? 'active' : ''}" onclick="atdPergStatus('UNANSWERED')">Sem resposta${p.status === 'UNANSWERED' && !p.carregando ? `<span class="n">${p.total}</span>` : ''}</button>
          <button class="chip ${p.status === 'ANSWERED' ? 'active' : ''}" onclick="atdPergStatus('ANSWERED')">Respondidas</button>
          <span style="display:inline-flex;gap:6px;align-items:center;margin-left:8px;">
            <input type="text" id="atd-mlb" placeholder="Filtrar por anúncio (MLB…)" value="${atdEsc(p.mlb)}" style="width:210px;" onkeydown="if(event.key==='Enter'){atdPerg.mlb=this.value;atdPergCarregar(0);}">
            <button class="btn-out btn btn-sm" onclick="atdPerg.mlb=document.getElementById('atd-mlb').value;atdPergCarregar(0);">Filtrar</button>
          </span>
          ${p.status === 'ANSWERED' && !p.carregando && atdTempoMedio(p.lista) ? `<span class="text-muted" style="margin-left:auto;align-self:center;">Tempo médio de resposta nesta página: <b style="color:var(--text)">${atdTempoMedio(p.lista)}</b></span>` : ''}
        </div>
        <div class="card">
          ${p.carregando ? '<div class="vazio"><b>Carregando perguntas…</b></div>'
            : (p.lista.length ? p.lista.map(q => atdPergCard(q)).join('')
              : (p.erro ? '<div class="vazio">Não foi possível carregar as perguntas.</div>' : `<div class="vazio"><b>${p.status === 'UNANSWERED' ? 'Nenhuma pergunta aguardando resposta 🎉' : 'Nenhuma pergunta respondida encontrada'}</b></div>`))}
          ${paginas > 1 ? `<div class="card-header" style="border-bottom:none;border-top:1px solid var(--border);"><span class="text-muted">Página ${pagAtual} de ${paginas}</span>
            <div class="pag"><button ${pagAtual === 1 ? 'disabled' : ''} onclick="atdPergCarregar(${p.offset - 30})">‹ Anterior</button><button ${pagAtual >= paginas ? 'disabled' : ''} onclick="atdPergCarregar(${p.offset + 30})">Próxima ›</button></div></div>` : ''}
        </div>`;
    }

    function atdPergCard(q){
      const it = q.item || {}, idTxt = 'atd-resp-' + q.id;
      return `<div class="atd-perg" id="atd-perg-${q.id}">
        <div class="atd-item">
          ${it.foto ? `<img class="v-thumb" src="${atdEsc(it.foto)}" loading="lazy" alt="">` : '<div class="v-thumb"></div>'}
          <div style="min-width:0;">
            <a class="v-tit" style="text-decoration:none;display:block;" href="${atdEsc(it.link || '#')}" target="_blank" rel="noopener">${atdEsc(it.titulo || q.item_id)}</a>
            <div class="v-meta"><span>${atdEsc(q.item_id)}</span>${it.preco != null ? `<span class="v-preco">R$ ${vmlNum(it.preco)}</span>` : ''}${it.estoque != null ? `<span>${it.estoque} em estoque</span>` : ''}</div>
          </div>
        </div>
        <div class="atd-corpo">
          <div class="atd-balao"><div class="atd-quem">${atdEsc(q.comprador || 'Comprador')} · ${atdQuando(q.data)}</div>${atdEsc(q.texto)}</div>
          ${q.resposta ? `<div class="atd-balao minha"><div class="atd-quem">Sua resposta · ${atdQuando(q.resposta.data)}${atdDuracao(q.data, q.resposta.data) ? ' · respondida em ' + atdDuracao(q.data, q.resposta.data) : ''}</div>${atdEsc(q.resposta.texto)}</div>` : `
            <textarea id="${idTxt}" rows="2" maxlength="2000" placeholder="Escreva a resposta…" oninput="atdContar(this, 2000)"></textarea>
            <div class="atd-acoes">
              ${atdSelectProntas(idTxt)}
              <span class="text-muted atd-cont" data-de="${idTxt}">0/2000</span>
              <span style="flex:1;"></span>
              <button class="btn-out btn btn-sm" onclick="atdExcluirPergunta('${q.id}')">Excluir</button>
              <button class="btn btn-sm" onclick="atdResponder('${q.id}', this)">Responder</button>
            </div>`}
        </div>
      </div>`;
    }

    function atdContar(t, max){
      const c = document.querySelector(`.atd-cont[data-de="${t.id}"]`);
      if(c){ c.textContent = t.value.length + '/' + max; c.style.color = t.value.length > max ? 'var(--danger)' : ''; }
    }
    function atdPergStatus(s){ atdPerg.status = s; atdPergCarregar(0); }

    // tempo entre a pergunta e a resposta
    function atdMinutos(a, b){ const m = (new Date(b).getTime() - new Date(a).getTime()) / 60000; return isFinite(m) && m >= 0 ? m : null; }
    function atdFmtMin(m){
      if(m == null) return '';
      if(m < 60) return Math.max(1, Math.round(m)) + ' min';
      if(m < 60 * 24) return Math.floor(m / 60) + 'h ' + String(Math.round(m % 60)).padStart(2, '0') + 'min';
      return Math.round(m / 60 / 24) + ' dia(s)';
    }
    function atdDuracao(a, b){ return atdFmtMin(atdMinutos(a, b)); }
    function atdTempoMedio(lista){
      const t = lista.filter(q => q.resposta).map(q => atdMinutos(q.data, q.resposta.data)).filter(m => m != null);
      return t.length ? atdFmtMin(t.reduce((s,m) => s + m, 0) / t.length) : '';
    }

    // saudação e assinatura acrescentadas automaticamente às respostas de perguntas
    function atdSaudacao(){ try { return JSON.parse(localStorage.getItem('mk_atd_saudacao') || '{}'); } catch(e){ return {}; } }
    function atdMontarResposta(texto){
      const s = atdSaudacao();
      return [s.saudacao, texto, s.assinatura].map(x => String(x || '').trim()).filter(Boolean).join(' ');
    }
    function atdConfigSaudacao(){
      const s = atdSaudacao();
      vmlModal('Saudação e assinatura', `
        <div class="text-muted" style="margin-bottom:14px;">Colocadas automaticamente no começo e no fim de cada resposta de pergunta. Deixe em branco para não usar.</div>
        <div class="form-group"><label class="form-label">Saudação (início da resposta)</label><input type="text" id="atd-saud" maxlength="200" placeholder="Olá, tudo bem?" value="${atdEsc(s.saudacao || '')}"></div>
        <div class="form-group"><label class="form-label">Assinatura (fim da resposta)</label><input type="text" id="atd-assin" maxlength="200" placeholder="Qualquer dúvida estamos à disposição. Equipe MK Store" value="${atdEsc(s.assinatura || '')}"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="localStorage.setItem('mk_atd_saudacao', JSON.stringify({saudacao:document.getElementById('atd-saud').value, assinatura:document.getElementById('atd-assin').value}));fecharModal('modal-vml');">Salvar</button>`);
    }

    async function atdResponder(id, btn){
      const t = document.getElementById('atd-resp-' + id), texto = (t?.value || '').trim();
      if(!texto){ t?.focus(); return; }
      btn.disabled = true; btn.textContent = 'Enviando…';
      const r = await atdChamar({ acao:'responder', question_id: id, text: atdMontarResposta(texto) });
      if(r.error){ btn.disabled = false; btn.textContent = 'Responder'; alert(r.error + (r.detail ? '\n' + r.detail : '')); return; }
      const card = document.getElementById('atd-perg-' + id); if(card) card.remove();
      atdPerg.lista = atdPerg.lista.filter(q => String(q.id) !== String(id));
      atdPerg.total = Math.max(0, atdPerg.total - 1);
      atdBadge('perguntas', atdPerg.total);
      if(!atdPerg.lista.length) atdPergCarregar(0);
    }

    async function atdExcluirPergunta(id){
      if(!confirm('Excluir esta pergunta? O comprador não será avisado e ela some do anúncio.')) return;
      const r = await atdChamar({ acao:'excluir_pergunta', question_id: id });
      if(r.error){ alert(r.error + (r.detail ? '\n' + r.detail : '')); return; }
      atdPergCarregar(atdPerg.offset);
    }

    // ===================================================================
    // MENSAGENS PÓS-VENDA
    // ===================================================================
    async function renderMensagens(){
      const el = document.getElementById('view-mensagens');
      if(!el) return;
      atdMsg.carregando = true; atdMsgDesenhar();
      const r = await atdChamar({ acao:'nao_lidas' });
      atdMsg.carregando = false; atdMsg.erro = r.error || null; atdMsg.semPermissao = !!r.sem_permissao;
      let conversas = r.conversas || [];
      // dados da venda de cada conversa (o pack_id de uma venda sem carrinho é o próprio nº da venda)
      if(conversas.length && usuarioAtual){
        const ids = conversas.map(c => c.pack_id);
        const [a, b] = await Promise.all([
          supa.from('vendas_ml').select('order_id,pack_id,titulo,comprador_nome,comprador_apelido,comprador_id,thumbnail').eq('usuario_id', usuarioAtual.id).in('pack_id', ids),
          supa.from('vendas_ml').select('order_id,pack_id,titulo,comprador_nome,comprador_apelido,comprador_id,thumbnail').eq('usuario_id', usuarioAtual.id).in('order_id', ids)
        ]);
        const porId = {};
        (a.data || []).forEach(v => { porId[v.pack_id] = v; });
        (b.data || []).forEach(v => { if(!porId[v.order_id]) porId[v.order_id] = v; });
        conversas = conversas.map(c => ({ ...c, venda: porId[c.pack_id] || null }));
      }
      atdMsg.conversas = conversas;
      if(!r.error) atdBadge('mensagens', conversas.length);
      atdMsgDesenhar();
    }

    function atdMsgDesenhar(){
      const el = document.getElementById('view-mensagens');
      if(!el || !el.classList.contains('active')) return;
      const m = atdMsg;
      el.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Mensagens</div><div class="pg-sub">Conversas pós-venda com mensagens não lidas. Para abrir a conversa de qualquer venda, use o botão Mensagens na página Vendas.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;">
            <button class="btn-out btn btn-sm" onclick="renderMensagens()">↻ Atualizar</button>
            <button class="btn-out btn btn-sm" onclick="atdGerenciarProntas()">⚙ Respostas prontas</button>
          </div>
        </div>
        ${m.semPermissao ? atdAvisoPermissao() : (m.erro ? `<div class="alert alert-danger">${atdEsc(m.erro)}</div>` : '')}
        <div class="card">
          <div class="card-header"><div class="card-title">${m.carregando ? 'Carregando…' : m.conversas.length + ' conversa' + (m.conversas.length === 1 ? '' : 's') + ' com mensagens não lidas'}</div></div>
          ${m.carregando ? '<div class="vazio"><b>Buscando conversas…</b></div>'
            : (m.conversas.length ? m.conversas.map(c => {
                const v = c.venda || {};
                return `<div class="ini-venc" style="padding:12px 20px;" onclick="abrirMensagensVenda('${c.pack_id}','${v.order_id || c.pack_id}')">
                  ${v.thumbnail ? `<img class="v-thumb" style="width:46px;height:46px;" src="${atdEsc(v.thumbnail)}" alt="">` : '<div class="dt"><b>💬</b></div>'}
                  <div class="ds"><b>${atdEsc(v.comprador_nome || v.comprador_apelido || 'Venda #' + c.pack_id)}</b><small>${atdEsc(v.titulo || 'Venda #' + c.pack_id)}</small></div>
                  <span class="badge badge-danger">${c.nao_lidas} nova${c.nao_lidas > 1 ? 's' : ''}</span>
                </div>`;
              }).join('') : (m.erro ? '<div class="vazio">Não foi possível carregar as mensagens.</div>' : '<div class="vazio"><b>Nenhuma mensagem não lida 🎉</b>As conversas com mensagens novas aparecem aqui.</div>'))}
        </div>`;
    }

    // Conversa de uma venda (aberta pela página Vendas ou pela lista de não lidas)
    async function abrirMensagensVenda(packId, orderId){
      atdConversa = { pack: packId, order: orderId, buyer: null, mensagens: [], carregando: true };
      atdConversaDesenhar();
      const r = await atdChamar({ acao:'mensagens', pack_id: packId });
      if(!atdConversa || atdConversa.pack !== packId) return;
      atdConversa.carregando = false;
      atdConversa.erro = r.error || null; atdConversa.semPermissao = !!r.sem_permissao;
      atdConversa.mensagens = r.mensagens || [];
      atdConversa.bloqueio = r.bloqueio || null;
      const v = (typeof vdAchar === 'function') ? vdAchar(orderId) : null;
      atdConversa.buyer = (v && v.comprador_id) || r.comprador_id || null;
      atdConversa.nome = v ? (v.comprador_nome || v.comprador_apelido) : null;
      atdConversaDesenhar();
    }

    function atdConversaDesenhar(){
      const c = atdConversa; if(!c) return;
      const corpo = c.carregando ? '<div class="vazio">Carregando conversa…</div>'
        : (c.semPermissao ? atdAvisoPermissao()
          : (c.erro ? `<div class="alert alert-danger">${atdEsc(c.erro)}</div>`
            : `<div class="atd-thread" id="atd-thread">
                ${c.mensagens.length ? c.mensagens.map(m => `<div class="atd-balao ${m.minha ? 'minha' : ''}"><div class="atd-quem">${m.minha ? 'Você' : atdEsc(c.nome || 'Comprador')} · ${atdQuando(m.data)}${m.anexos ? ' · 📎 ' + m.anexos + ' anexo(s)' : ''}</div>${atdEsc(m.texto || '')}${m.moderada ? `<div class="atd-quem" style="color:var(--danger);">moderada pelo ML (${atdEsc(m.moderada)})</div>` : ''}</div>`).join('')
                  : '<div class="vazio" style="padding:20px 0;">Ainda não há mensagens nesta venda.</div>'}
              </div>
              ${c.bloqueio ? `<div class="alert alert-warning">O Mercado Livre bloqueou o envio de mensagens nesta conversa (${atdEsc(c.bloqueio)}).</div>` : ''}
              <textarea id="atd-msg-txt" rows="3" maxlength="${ATD_MAX_MSG}" placeholder="Escreva sua mensagem (até ${ATD_MAX_MSG} caracteres)…" oninput="atdContar(this, ${ATD_MAX_MSG})"></textarea>
              <div class="atd-acoes">${atdSelectProntas('atd-msg-txt')}<span class="text-muted atd-cont" data-de="atd-msg-txt">0/${ATD_MAX_MSG}</span></div>`));
      vmlModal('Mensagens da venda #' + c.order, corpo,
        `<a class="btn-out btn" style="text-decoration:none;" href="https://www.mercadolivre.com.br/vendas/${c.order}/detalhe" target="_blank" rel="noopener">Abrir no ML ↗</a>
         <button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>
         ${c.carregando || c.erro ? '' : `<button class="btn" id="atd-msg-enviar" onclick="atdEnviarMensagem()">Enviar</button>`}`);
      const th = document.getElementById('atd-thread'); if(th) th.scrollTop = th.scrollHeight;
    }

    async function atdEnviarMensagem(){
      const c = atdConversa, t = document.getElementById('atd-msg-txt'), texto = (t?.value || '').trim();
      if(!c || !texto){ t?.focus(); return; }
      if(!c.buyer){ alert('Não foi possível identificar o comprador desta venda. Abra a conversa pelo Mercado Livre.'); return; }
      const b = document.getElementById('atd-msg-enviar'); b.disabled = true; b.textContent = 'Enviando…';
      const r = await atdChamar({ acao:'enviar_mensagem', pack_id: c.pack, buyer_id: c.buyer, text: texto });
      if(r.error){ b.disabled = false; b.textContent = 'Enviar'; alert(r.error + (r.detail ? '\n' + r.detail : '')); return; }
      abrirMensagensVenda(c.pack, c.order);
    }

    // Contador no menu lateral
    function atdBadge(pagina, n){
      const li = document.querySelector(`.nav-item[onclick="nav('${pagina}')"]`);
      if(!li) return;
      let b = li.querySelector('.nav-cont');
      if(!n){ if(b) b.remove(); return; }
      if(!b){ b = document.createElement('span'); b.className = 'nav-cont'; li.appendChild(b); }
      b.textContent = n > 99 ? '99+' : n;
    }

    // ===================================================================
    // POP-UP DE RECONEXÃO — token sem os escopos de vendas/comunicação
    // ===================================================================
    async function verificarPermissoesML(){
      if(!usuarioAtual) return;
      try {
        // já conferido e OK nesta sessão do navegador
        if(sessionStorage.getItem('mk_ml_perm_ok') === usuarioAtual.id) return;
        const { data: tk } = await supa.from('ml_tokens').select('usuario_id').eq('usuario_id', usuarioAtual.id).maybeSingle();
        if(!tk) return;   // ML não conectado: o fluxo normal de conexão já cuida disso
        const { data: sessao } = await supa.auth.getSession();
        const jwt = sessao?.session?.access_token;
        const { data } = await supa.functions.invoke('ml-vendas', { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}, body: { checar: true } });
        if(!data || !data.conectado) return;
        if(data.tem_vendas && data.tem_comunicacao){
          sessionStorage.setItem('mk_ml_perm_ok', usuarioAtual.id);
          if(typeof vmlSemPermissao !== 'undefined') vmlSemPermissao = false;
          return;
        }
        if(typeof vmlSemPermissao !== 'undefined' && !data.tem_vendas) vmlSemPermissao = true;
        const adiado = parseInt(localStorage.getItem('mk_ml_reconectar_adiado') || '0');
        if(Date.now() - adiado < 24 * 3600000) return;
        const falta = [!data.tem_vendas ? 'Vendas e Resumo Financeiro' : null, !data.tem_comunicacao ? 'Perguntas e Mensagens' : null].filter(Boolean).join(' e ');
        vmlModal('Reconecte sua conta do Mercado Livre', `
          <div style="display:flex;gap:16px;align-items:flex-start;">
            <div class="logo-mark" style="width:46px;height:46px;border-radius:14px;"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg></div>
            <div style="line-height:1.6;">
              <div>O Caixa 360 ganhou novas funções — <b>${falta}</b> — que precisam de novas permissões na sua conta do Mercado Livre.</div>
              <div class="text-muted" style="margin-top:8px;">A reconexão leva alguns segundos: você confirma o acesso na tela do Mercado Livre e volta para cá. Seus dados e lançamentos não mudam.</div>
            </div>
          </div>`,
          `<button class="btn-out btn" onclick="localStorage.setItem('mk_ml_reconectar_adiado', Date.now());fecharModal('modal-vml')">Agora não</button>
           <button class="btn" onclick="conectarML()">Reconectar agora</button>`);
      } catch(e){ /* verificação é só um aviso: nunca atrapalha o uso do app */ }
    }
