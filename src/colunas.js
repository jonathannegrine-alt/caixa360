// ===== COLUNAS AJUSTÁVEIS =====
// Em qualquer tabela do sistema dá para arrastar a borda direita do título da coluna para aumentar ou diminuir.
// Dois cliques na borda voltam a coluna ao tamanho automático. A largura fica guardada neste navegador, por tabela
// (a tabela é reconhecida pela página e pelos títulos das colunas, porque as telas são redesenhadas o tempo todo).

    (function(){
      const CHAVE = 'mk_colunas', BORDA = 7, MIN = 40;
      let larguras = {}; try { larguras = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch(e){ larguras = {}; }
      let css = null, arrasto = null, ignorarClique = false;
      const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(larguras)); } catch(e){} };
      // identifica a tabela: página + títulos (sem números, setas e dicas)
      function chave(tab){
        if(tab.dataset.colk) return tab.dataset.colk;
        const ths = tab.querySelectorAll('thead tr:last-child th'); if(!ths.length) return '';
        const pag = (tab.closest('.view') || tab.closest('.modal') || document.body).id || 'geral';
        const tit = [...ths].map(th => (th.childNodes[0] && th.childNodes[0].nodeType === 3 ? th.childNodes[0].textContent : th.textContent).replace(/[\d⇅▲▼?↑↓]/g, '').trim().slice(0, 14)).join('|');
        let h = 0; const s = pag + '#' + tit; for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        tab.dataset.colk = pag + '_' + (h >>> 0).toString(36);
        return tab.dataset.colk;
      }
      function aplicar(){
        if(!css){ css = document.createElement('style'); css.id = 'colunas-css'; document.head.appendChild(css); }
        css.textContent = Object.keys(larguras).map(k => Object.keys(larguras[k]).map(i => { const w = larguras[k][i], n = Number(i) + 1, t = `table[data-colk="${k}"]`;
          return `${t} thead tr:last-child th:nth-child(${n}),${t} tbody td:nth-child(${n}):not([colspan]),${t} tfoot td:nth-child(${n}):not([colspan]){width:${w}px;min-width:${w}px;max-width:${w}px;overflow:hidden;text-overflow:ellipsis;}`; }).join('')).join('');
      }
      function marcar(raiz){ (raiz.querySelectorAll ? raiz.querySelectorAll('table') : []).forEach(t => { if(!t.dataset.colk) chave(t); }); }
      const naBorda = (th, e) => { const r = th.getBoundingClientRect(); return r.right - e.clientX <= BORDA && r.right - e.clientX >= -2; };
      const thDe = e => { const th = e.target.closest && e.target.closest('thead th'); return th && th.closest('table') && !th.hasAttribute('colspan') ? th : null; };

      document.addEventListener('mousemove', e => {
        if(arrasto){ const w = Math.max(MIN, Math.round(arrasto.w0 + e.clientX - arrasto.x0)); (larguras[arrasto.k] = larguras[arrasto.k] || {})[arrasto.i] = w; aplicar(); e.preventDefault(); return; }
        const th = thDe(e); if(!th) return;
        th.style.cursor = naBorda(th, e) ? 'col-resize' : '';
      });
      document.addEventListener('mousedown', e => {
        const th = thDe(e); if(!th || e.button !== 0 || !naBorda(th, e)) return;
        const tab = th.closest('table'), k = chave(tab); if(!k) return;
        arrasto = { k, i: [...th.parentNode.children].indexOf(th), x0: e.clientX, w0: th.getBoundingClientRect().width };
        document.body.classList.add('col-arrastando'); e.preventDefault(); e.stopPropagation();
      }, true);
      document.addEventListener('mouseup', () => { if(!arrasto) return; arrasto = null; document.body.classList.remove('col-arrastando'); gravar(); ignorarClique = true; setTimeout(() => { ignorarClique = false; }, 80); });
      // o clique que termina o arrasto não deve ordenar a tabela
      document.addEventListener('click', e => { if(ignorarClique && thDe(e)){ e.stopPropagation(); e.preventDefault(); } }, true);
      document.addEventListener('dblclick', e => {
        const th = thDe(e); if(!th || !naBorda(th, e)) return;
        const k = chave(th.closest('table')), i = [...th.parentNode.children].indexOf(th);
        if(larguras[k]){ delete larguras[k][i]; if(!Object.keys(larguras[k]).length) delete larguras[k]; gravar(); aplicar(); }
        e.stopPropagation(); e.preventDefault();
      }, true);

      // as telas redesenham as tabelas: toda tabela nova recebe a sua chave para as larguras guardadas valerem
      const obs = new MutationObserver(ms => { for(const m of ms) for(const n of m.addedNodes){ if(n.nodeType !== 1) continue; if(n.tagName === 'TABLE') chave(n); else if(n.tagName === 'THEAD' || n.tagName === 'TR' || n.tagName === 'TBODY'){ const t = n.closest('table'); if(t && !t.dataset.colk) chave(t); } else marcar(n); } });
      const iniciar = () => { marcar(document); aplicar(); obs.observe(document.body, { childList: true, subtree: true }); };
      if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
      window.colunasRestaurar = () => { larguras = {}; gravar(); aplicar(); };
    })();
