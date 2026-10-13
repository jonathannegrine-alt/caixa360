// ===== AVISOS NO MENU =====
// Perguntas e mensagens do Mercado Livre: o ML avisa o servidor (ml-webhook grava em ml_avisos) e, a cada minuto,
// esta rotina conta o que chegou desde a última vez que a página foi aberta e põe o número no menu.
// Sugestões ("Ajuda e sugestões"): para quem administra o sistema, mostra quantas ainda não foram lidas.

    let avisos = { perguntas: 0, mensagens: 0, posvenda: 0, promocoes: 0, sugestoes: 0, admin: null };
    const AV_TOP = { perguntas: 'questions', mensagens: 'messages', posvenda: 'claims', promocoes: 'promos' };
    const AV_MSG = { perguntas: 'Pergunta nova no Mercado Livre.', mensagens: 'Mensagem nova de comprador no Mercado Livre.', posvenda: 'Reclamação ou devolução com novidade no Mercado Livre.', promocoes: 'O Mercado Livre tem promoção nova ou alterada para os seus anúncios.' };
    function avVisto(p){ try { return localStorage.getItem('mk_av_' + p) || new Date(Date.now() - 86400000).toISOString(); } catch(e){ return new Date(Date.now() - 86400000).toISOString(); } }
    function avMarcar(p){ try { localStorage.setItem('mk_av_' + p, new Date().toISOString()); } catch(e){} avisos[p] = 0; avDesenhar(); }
    function avSelo(pagina, n, titulo){
      const li = document.querySelector('.nav-item[onclick="nav(\'' + pagina + '\')"]'); if(!li) return;
      let s = li.querySelector('.nav-selo');
      if(!n){ if(s) s.remove(); return; }
      if(!s){ s = document.createElement('span'); s.className = 'nav-selo'; li.appendChild(s); }
      s.textContent = n > 99 ? '99+' : n; s.title = titulo;
    }
    function avDesenhar(){
      avSelo('perguntas', avisos.perguntas, avisos.perguntas + ' pergunta(s) nova(s) desde a última vez que você abriu');
      avSelo('mensagens', avisos.mensagens, avisos.mensagens + ' mensagem(ns) nova(s) desde a última vez que você abriu');
      avSelo('posvenda', avisos.posvenda, avisos.posvenda + ' novidade(s) em reclamações ou devoluções desde a última vez que você abriu');
      avSelo('promocoes', avisos.promocoes, 'Há promoções novas ou alteradas desde a última vez que você abriu');
      avSelo('config', avisos.sugestoes, avisos.sugestoes + ' sugestão(ões) de usuários ainda não lida(s): Configurações → Conta');
    }
    async function avConferir(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || document.hidden || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      try {
        for(const p of ['perguntas', 'mensagens', 'posvenda', 'promocoes']){
          const aberta = (document.getElementById('view-' + p) || {}).classList && document.getElementById('view-' + p).classList.contains('active');
          const r = await supa.from('ml_avisos').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioAtual.id).eq('topico', AV_TOP[p]).gt('em', avVisto(p));
          const n = r.count || 0;
          if(aberta){ if(n){ avMarcar(p); if(p === 'perguntas' && typeof renderPerguntas === 'function') renderPerguntas(); if(p === 'mensagens' && typeof renderMensagens === 'function') renderMensagens(); if(p === 'posvenda' && typeof renderPosVenda === 'function') try { renderPosVenda(); } catch(e){} } continue; }
          if(p === 'promocoes' && n > 1) { avisos[p] = 1; continue; }   // promoções: o selo é só um ponto de atenção, não uma contagem
          if(n > avisos[p] && typeof toast === 'function') toast(AV_MSG[p]);
          if(n > avisos[p]) avSino.em = 0;
          avisos[p] = n;
        }
        await avExtras();
        avSinoCarregar();
        if(avisos.admin === null){ const a = await supa.rpc('eh_admin'); avisos.admin = !!a.data; }
        if(avisos.admin){
          const f = await supa.rpc('feedbacks_todos');
          const n = (f.data || []).filter(x => !x.lido).length;
          if(n > avisos.sugestoes && typeof toast === 'function') toast(n === 1 ? 'Chegou uma sugestão de usuário (Configurações → Conta).' : 'Há ' + n + ' sugestões de usuários não lidas (Configurações → Conta).');
          avisos.sugestoes = n;
        }
        avDesenhar();
      } catch(e){}
    }
    // avaliações ruins e disputa de catálogo (aparecem no sininho) + estoque do Full que mexeu (a tela relê sozinha)
    let avExt = { aval: [], cat: 0, fullEm: 0 };
    async function avExtras(){
      const r = await supa.from('ml_avisos').select('topico,recurso,em,ml_user_id').eq('usuario_id', usuarioAtual.id).in('topico', ['avaliacao', 'catalogo']).gt('em', avVisto('extras')).order('em', { ascending: false }).limit(60);
      const L = r.data || [], vistos = new Set();
      avExt.aval = L.filter(x => x.topico === 'avaliacao').filter(x => { const k = String(x.recurso).split('|')[0]; if(vistos.has(k)) return false; vistos.add(k); return true; });
      avExt.cat = new Set(L.filter(x => x.topico === 'catalogo').map(x => x.recurso)).size;
      // estoque do Full: se chegou aviso depois da última leitura, relê (no máximo a cada 5 minutos)
      if(typeof comprasFullAPI === 'function' && typeof estoqueFullML !== 'undefined' && Date.now() - avExt.fullEm > 300000){
        const desde = (estoqueFullML && estoqueFullML._syncAt) || new Date(Date.now() - 3600000).toISOString();
        const f = await supa.from('ml_avisos').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioAtual.id).eq('topico', 'full').gt('em', desde);
        if(f.count){ avExt.fullEm = Date.now(); const ok = await comprasFullAPI(); const v = document.getElementById('view-estoque'); if(ok && v && v.classList.contains('active') && typeof estRender === 'function') try { estRender(); } catch(e){} }
      }
    }
    // ----- sininho do Início: o que está esperando resposta, com o texto do cliente -----
    let avSino = { perg: [], totalPerg: 0, conv: [], em: 0, lendo: false, erro: '' };
    const avE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // o sininho conta só o que espera resposta: perguntas e mensagens (pós-venda e promoções têm o selo no menu)
    function avSinoN(){ return (avSino.totalPerg || 0) + avSino.conv.length + (typeof tfSinoN === 'function' ? tfSinoN() : 0); }
    function avSinoHtml(){
      const n = avSinoN();
      return `<button class="ini-sino ${n ? 'tem' : ''}" id="ini-sino" onclick="avSinoAbrir()" title="${n ? n + ' pendência(s) de atendimento: clique para ver' : 'Nenhuma pergunta ou mensagem esperando resposta'}" aria-label="Notificações de atendimento"><svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${n ? '<span class="n">' + (n > 99 ? '99+' : n) + '</span>' : ''}<span>${n ? (n === 1 ? 'esperando resposta' : 'esperando resposta') : 'Tudo respondido'}</span></button>`;
    }
    function avSinoPintar(){ const b = document.getElementById('ini-sino'); if(b) b.outerHTML = avSinoHtml(); }
    async function avSinoCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || typeof atdChamar !== 'function' || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      if(avSino.lendo || (!forcar && Date.now() - avSino.em < 90000)) return;
      avSino.lendo = true;
      try {
        const [p, m] = await Promise.all([atdChamar({ acao: 'perguntas', status: 'UNANSWERED', item_id: '', offset: 0, limit: 15, conta: '' }), atdChamar({ acao: 'nao_lidas', conta: '' })]);
        avSino.erro = (p.error && m.error) ? (p.error || m.error) : '';
        if(!p.error){ avSino.perg = p.perguntas || []; avSino.totalPerg = p.total || avSino.perg.length; }
        if(!m.error){
          let cv = m.conversas || [];
          if(cv.length){
            const ids = cv.map(c => c.pack_id), col = 'order_id,pack_id,titulo,comprador_nome,comprador_apelido';
            const [x, y] = await Promise.all([supa.from('vendas_ml').select(col).eq('usuario_id', usuarioAtual.id).in('pack_id', ids), supa.from('vendas_ml').select(col).eq('usuario_id', usuarioAtual.id).in('order_id', ids)]);
            const por = {}; (x.data || []).forEach(v => { por[v.pack_id] = v; }); (y.data || []).forEach(v => { if(!por[v.order_id]) por[v.order_id] = v; });
            cv = cv.map(c => ({ ...c, venda: por[c.pack_id] || null }));
          }
          avSino.conv = cv;
        }
        avSino.em = Date.now();
      } catch(e){ avSino.erro = (e && e.message) || String(e); }
      avSino.lendo = false; avSinoPintar();
    }
    function avSinoAbrir(){
      if(typeof vmlModal !== 'function') return;
      if(typeof tfMarcarVistas === 'function') setTimeout(tfMarcarVistas, 1500);
      const P = avSino.perg, C = avSino.conv, quando = d => typeof atdQuando === 'function' ? atdQuando(d) : '';
      const perg = P.length ? P.map(q => `<button class="sino-it" onclick="fecharModal('modal-vml');nav('perguntas')"><small>${avE((q.item && q.item.titulo) || q.item_id || '')} · ${avE(quando(q.data))}</small><b>${avE(q.texto)}</b></button>`).join('') + (avSino.totalPerg > P.length ? `<div class="text-muted" style="font-size:12.5px;">e mais ${avSino.totalPerg - P.length} na página Perguntas.</div>` : '') : '<div class="text-muted" style="font-size:13px;">Nenhuma pergunta sem resposta.</div>';
      const conv = C.length ? C.map(c => { const v = c.venda || {}; return `<button class="sino-it" onclick="fecharModal('modal-vml');nav('mensagens');abrirMensagensVenda('${avE(c.pack_id)}','${avE(v.order_id || c.pack_id)}','${avE(c.conta || '')}')"><small>${avE(v.titulo || 'Venda #' + c.pack_id)}</small><b>${avE(v.comprador_nome || v.comprador_apelido || 'Comprador')} · ${c.nao_lidas} mensagem${c.nao_lidas > 1 ? 's' : ''} nova${c.nao_lidas > 1 ? 's' : ''}</b></button>`; }).join('') : '<div class="text-muted" style="font-size:13px;">Nenhuma mensagem sem ler.</div>';
      vmlModal('Atendimento esperando resposta', (avSino.erro ? `<div class="alert alert-warning">Não consegui consultar o Mercado Livre agora: ${avE(avSino.erro)}</div>` : '') +
        `${typeof tfSinoHtml === 'function' ? tfSinoHtml() : ''}<div class="sino-sec">Perguntas sem resposta (${avSino.totalPerg || 0})</div>${perg}<div class="sino-sec">Mensagens de compradores sem ler (${C.length})</div>${conv}
        <div class="text-muted" style="font-size:12px;margin-top:14px;">Clique numa pergunta para responder; clique numa mensagem para abrir a conversa. O que foi respondido pelo celular some daqui em até dois minutos.</div>`,
        `<button class="btn-out btn" onclick="avSinoCarregar(true).then(avSinoAbrir)">Atualizar</button><button class="btn" onclick="fecharModal('modal-vml')">Fechar</button>`);
    }

    // abrir a página zera o selo dela
    document.addEventListener('click', e => { const li = e.target.closest && e.target.closest('.nav-item'); if(!li) return; const m = (li.getAttribute('onclick') || '').match(/nav\('(perguntas|mensagens|posvenda|promocoes)'\)/); if(m) avMarcar(m[1]); });
    setTimeout(avConferir, 9000);
    setInterval(avConferir, 60000);
