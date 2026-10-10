// ===== TEMA CLARO / ESCURO =====
// O tema inicial é aplicado por um script inline no <head> (evita piscar).
    function temaAtual(){
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function aplicarTema(tema){
      document.documentElement.setAttribute('data-theme', tema);
      try { localStorage.setItem('mk_tema', tema); } catch(e){}
      const lbl = document.getElementById('tema-label');
      if(lbl) lbl.textContent = tema === 'dark' ? 'Tema claro' : 'Tema escuro';
      const meta = document.querySelector('meta[name="theme-color"]');
      if(meta) meta.setAttribute('content', tema === 'dark' ? '#0d1124' : '#151a33');
    }

    function alternarTema(){
      aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');
    }

    document.addEventListener('DOMContentLoaded', () => aplicarTema(temaAtual()));
