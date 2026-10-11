// ===== INDICADOR DE CARREGAMENTO =====
// Barra fina no topo enquanto há pedido ao servidor em andamento (aparece depois de 250 ms, para não piscar).
// Serve para qualquer página: o usuário vê que o sistema está trabalhando e não travou.
// carregandoMsg(el, texto) põe um aviso com animação dentro de uma área que ainda vai ser preenchida.

    (function(){
      let emCurso = 0, timer = null;
      const barra = () => {
        let b = document.getElementById('carregando-barra');
        if(!b && document.body){ b = document.createElement('div'); b.id = 'carregando-barra'; b.innerHTML = '<i></i><span>Carregando…</span>'; document.body.appendChild(b); }
        return b;
      };
      const atualizar = () => {
        clearTimeout(timer);
        if(emCurso > 0) timer = setTimeout(() => { const b = barra(); if(b && emCurso > 0) b.classList.add('on'); }, 250);
        else timer = setTimeout(() => { const b = barra(); if(b) b.classList.remove('on'); }, 150);
      };
      const original = window.fetch;
      if(!original) return;
      window.fetch = function(url){
        const u = String(url && url.url ? url.url : url || '');
        const conta = /supabase\.co\/(rest|functions|storage)\//.test(u);
        if(!conta) return original.apply(this, arguments);
        emCurso++; atualizar();
        const fim = () => { emCurso = Math.max(0, emCurso - 1); atualizar(); };
        return original.apply(this, arguments).then(r => { fim(); return r; }, e => { fim(); throw e; });
      };
    })();

    function carregandoMsg(el, texto){
      if(typeof el === 'string') el = document.getElementById(el);
      if(el) el.innerHTML = `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>${texto || 'Carregando…'}</b></div></div>`;
    }
