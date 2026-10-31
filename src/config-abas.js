// ===== CONFIGURAÇÕES EM ABAS =====
// A página tinha dez blocos empilhados. Aqui cada bloco (.card) é colocado numa aba conforme o título,
// sem mexer no HTML nem na lógica de cada bloco.

    const CFG_ABAS = [
      ['ml',     'Mercado Livre',  ['mercado livre', 'pipeline']],
      ['fin',    'Financeiro',     ['parâmetros financeiros', 'categorias de despesa', 'olist']],
      ['estoque','Estoque',        ['motor de reposição', 'reposição']],
      ['dados',  'Dados',          ['backup', 'importar xls', 'tiny']],
      ['nfe',    'Notas fiscais',  ['notas fiscais']],
      ['ia',     'IA',             ['conectar sua ia']],
      ['sons',   'Sons',           ['sons e avisos']],
      ['equipe', 'Equipe',         ['equipe']],
      ['conta',  'Conta',          ['minha conta', 'feedbacks', 'zona de perigo']],
    ];
    let cfgAbaAtiva = sessionStorage.getItem('mk_cfg_aba') || 'ml';

    function cfgMontarAbas(){
      const view = document.getElementById('view-config');
      if(!view) return;
      // só os blocos de primeiro nível (um card pode conter outros)
      const cards = [...view.querySelectorAll('.card')].filter(c => !c.parentElement.closest('#view-config .card'));
      cards.forEach(c => {
        if(c.dataset.cfgAba) return;
        const titulo = (c.querySelector('.card-title')?.textContent || '').toLowerCase();
        const aba = CFG_ABAS.find(([, , chaves]) => chaves.some(k => titulo.includes(k)));
        c.dataset.cfgAba = aba ? aba[0] : 'conta';
      });
      let barra = document.getElementById('cfg-abas');
      if(!barra){
        barra = document.createElement('div');
        barra.id = 'cfg-abas'; barra.className = 'chips cfg-abas';
        const h1 = view.querySelector('h1');
        if(h1) h1.insertAdjacentElement('afterend', barra); else view.prepend(barra);
      }
      const usadas = CFG_ABAS.filter(([id]) => cards.some(c => c.dataset.cfgAba === id));
      if(!usadas.some(([id]) => id === cfgAbaAtiva)) cfgAbaAtiva = usadas[0] ? usadas[0][0] : 'ml';
      barra.innerHTML = usadas.map(([id, nome]) => `<button class="chip ${id === cfgAbaAtiva ? 'active' : ''}" onclick="cfgAba('${id}')">${nome}</button>`).join('');
      cards.forEach(c => { c.style.display = c.dataset.cfgAba === cfgAbaAtiva ? '' : 'none'; });
    }

    function cfgAba(id){
      cfgAbaAtiva = id;
      sessionStorage.setItem('mk_cfg_aba', id);
      cfgMontarAbas();
    }
