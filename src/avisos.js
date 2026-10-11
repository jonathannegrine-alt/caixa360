// ===== AVISOS NO MENU =====
// Perguntas e mensagens do Mercado Livre: o ML avisa o servidor (ml-webhook grava em ml_avisos) e, a cada minuto,
// esta rotina conta o que chegou desde a última vez que a página foi aberta e põe o número no menu.
// Sugestões ("Ajuda e sugestões"): para quem administra o sistema, mostra quantas ainda não foram lidas.

    let avisos = { perguntas: 0, mensagens: 0, sugestoes: 0, admin: null };
    const AV_TOP = { perguntas: 'questions', mensagens: 'messages' };
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
      avSelo('config', avisos.sugestoes, avisos.sugestoes + ' sugestão(ões) de usuários ainda não lida(s): Configurações → Conta');
    }
    async function avConferir(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || document.hidden || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      try {
        for(const p of ['perguntas', 'mensagens']){
          const aberta = (document.getElementById('view-' + p) || {}).classList && document.getElementById('view-' + p).classList.contains('active');
          const r = await supa.from('ml_avisos').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioAtual.id).eq('topico', AV_TOP[p]).gt('em', avVisto(p));
          const n = r.count || 0;
          if(aberta){ if(n){ avMarcar(p); if(p === 'perguntas' && typeof renderPerguntas === 'function') renderPerguntas(); if(p === 'mensagens' && typeof renderMensagens === 'function') renderMensagens(); } continue; }
          if(n > avisos[p] && typeof toast === 'function') toast(p === 'perguntas' ? 'Pergunta nova no Mercado Livre.' : 'Mensagem nova de comprador no Mercado Livre.');
          avisos[p] = n;
        }
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
    // abrir a página zera o selo dela
    document.addEventListener('click', e => { const li = e.target.closest && e.target.closest('.nav-item'); if(!li) return; const m = (li.getAttribute('onclick') || '').match(/nav\('(perguntas|mensagens)'\)/); if(m) avMarcar(m[1]); });
    setTimeout(avConferir, 9000);
    setInterval(avConferir, 60000);
