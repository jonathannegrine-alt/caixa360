// ===== ROLAGEM NO LUGAR =====
// Editar um campo numa tabela costuma redesenhar a tela (ou recarregar os dados depois de salvar), e a página voltava
// para o começo. Aqui: a cada alteração num campo (ou clique num botão dentro de uma tabela) guarda a rolagem da janela
// e das áreas roláveis da tela ou da janela aberta e, por 2,5 s, devolve a posição se ela cair sem a pessoa ter rolado.
// Rolar com o mouse, o dedo ou o teclado, ou trocar de página, cancela.
(function(){
  let alvo = null;
  const ESPERA = 2500;
  const raizDe = el => el.closest('.modal') || el.closest('.view') || document.body;
  const seletor = e => e.id ? '#' + CSS.escape(e.id) : e.tagName.toLowerCase() + [...e.classList].map(c => '.' + CSS.escape(c)).join('');
  const telaAtiva = () => { const v = document.querySelector('.view.active'); return v ? v.id : ''; };

  function guardar(ev){
    const t = ev.target;
    if(!t || !t.closest) return;
    const el = ev.type === 'click' ? t.closest('table button, table a, table input[type=checkbox]') : t.closest('input, select, textarea');
    if(!el) return;
    const raiz = raizDe(el);
    const caixas = [];
    raiz.querySelectorAll('*').forEach(e => {
      if(caixas.length >= 20 || !(e.scrollTop > 0 || e.scrollLeft > 0)) return;
      const s = seletor(e);
      caixas.push({ s, i: [...raiz.querySelectorAll(s)].indexOf(e), t: e.scrollTop, l: e.scrollLeft });
    });
    const novo = !alvo;
    alvo = { ate: Date.now() + ESPERA, x: window.scrollX, y: window.scrollY, raiz: raiz.id ? '#' + CSS.escape(raiz.id) : null, caixas, tela: telaAtiva() };
    if(novo) requestAnimationFrame(vigiar);
  }

  function vigiar(){
    if(!alvo) return;
    if(Date.now() > alvo.ate || telaAtiva() !== alvo.tela){ alvo = null; return; }
    const doc = document.scrollingElement || document.documentElement;
    // só devolve quando a página já tem altura para isso (enquanto recarrega, espera)
    if(window.scrollY < alvo.y - 40 && doc.scrollHeight - window.innerHeight >= alvo.y - 40) window.scrollTo(alvo.x, alvo.y);
    const raiz = alvo.raiz ? document.querySelector(alvo.raiz) : null;
    if(raiz) alvo.caixas.forEach(c => {
      const e = raiz.querySelectorAll(c.s)[c.i];
      if(!e) return;
      if(e.scrollTop < c.t - 20 && e.scrollHeight - e.clientHeight >= c.t - 20) e.scrollTop = c.t;
      if(e.scrollLeft < c.l - 20 && e.scrollWidth - e.clientWidth >= c.l - 20) e.scrollLeft = c.l;
    });
    requestAnimationFrame(vigiar);
  }

  const cancelar = () => { alvo = null; };
  const TECLAS = ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '];
  document.addEventListener('change', guardar, true);
  document.addEventListener('click', guardar, true);
  window.addEventListener('wheel', cancelar, { passive: true });
  window.addEventListener('touchmove', cancelar, { passive: true });
  document.addEventListener('keydown', e => { if(TECLAS.includes(e.key) && !(e.target && e.target.closest && e.target.closest('input, textarea, select'))) cancelar(); }, true);
  // clique na barra de rolagem da página
  document.addEventListener('mousedown', e => { if(e.target === document.documentElement) cancelar(); }, true);
})();
