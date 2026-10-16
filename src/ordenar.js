// ===== ORDENAR E MUDAR COLUNAS DE LUGAR, EM QUALQUER TABELA =====
// Clicar no título de uma coluna ordena a tabela (▲ / ▼); arrastar o título para o lado muda a coluna de lugar;
// dois cliques no título voltam as colunas daquela tabela à ordem original. Vale em qualquer tela.
// Ordenar fica de fora quando o título já tem ordenação própria (onclick, como Sugestão de compras e Previsão de Full,
// que ordenam pelos dados) e em tabelas com data-sem-ordem ou .dre-tab (estrutura fixa). Mudar de lugar fica de fora
// também nas tabelas de makeSortable (a ordenação delas guarda a posição da coluna).
// Tabela reconhecida pela tela + títulos das colunas: a ordem e o lugar das colunas voltam sozinhos quando a tela redesenha.
// O lugar das colunas fica guardado neste navegador (mk_col_ordem); a largura vai junto (colunasMover, em colunas.js).
// Valor de ordenação: data-ord da célula, se houver; senão o texto (R$, números pt-BR, %, datas dd/mm[/aaaa]).
(function(){
  const SEM = 'table.dre-tab, table[data-sem-ordem], [data-sem-ordem] table';
  const LS = 'mk_col_ordem';
  const ordem = new Map();                 // chave → { titulo, dir }   (ordenação, só nesta sessão)
  let lugares = {}; try { lugares = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch(e){ lugares = {}; }
  const gravar = () => { try { localStorage.setItem(LS, JSON.stringify(lugares)); } catch(e){} };

  const raizDe = t => t.closest('.modal') || t.closest('.view') || document.body;
  const tit = c => (c.firstChild && c.firstChild.nodeType === 3 ? c.firstChild.textContent : c.textContent || '').replace(/[▲▼⇅?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const titulos = t => [...t.tHead.rows[0].cells].map(tit);
  // a chave não depende da ordem das colunas (para valer antes e depois de mudar de lugar)
  const chaveDe = t => (raizDe(t).id || '') + '§' + titulos(t).slice().sort().join('|');
  const cab = t => t && t.tHead && t.tHead.rows.length === 1 && t.tBodies[0] ? t.tHead.rows[0].cells : null;
  // linhas que acompanham o cabeçalho (as de uma célula só, tipo "nada encontrado", são ignoradas)
  function linhasOk(t){
    const n = cab(t).length, L = [...t.tBodies[0].rows];
    return L.every(r => r.cells.length === n || r.cells.length === 1) ? L.filter(r => r.cells.length === n) : null;
  }
  function apta(t, mover){
    const c = cab(t);
    if(!c || t.matches(SEM) || [...c].some(x => x.colSpan > 1)) return false;
    if(mover && [...c].some(x => x.onclick && !x.getAttribute('onclick'))) return false;   // makeSortable
    const L = linhasOk(t);
    return !!L && (mover || L.length > 1);
  }

  // ---------- ordenar ----------
  function valor(cel){
    if(!cel) return null;
    const o = cel.dataset && cel.dataset.ord;
    if(o != null && o !== '') return isNaN(Number(o)) ? String(o).toLowerCase() : Number(o);
    const inp = cel.querySelector('input:not([type=checkbox]), select');
    const t = (inp ? inp.value : cel.textContent || '').replace(/\s+/g, ' ').trim();
    if(!t || /^[—–-]$/.test(t)) return null;
    const d = t.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?(?!\d)/);
    if(d) return Number(d[3] || new Date().getFullYear()) * 10000 + Number(d[2]) * 100 + Number(d[1]);
    const n = t.match(/^([-−+]?)\s*(?:R\$\s*)?([-−]?)\s*(\d[\d.]*(?:,\d+)?)/);
    if(n){ const v = Number(n[3].replace(/\./g, '').replace(',', '.')); if(!isNaN(v)) return (n[1] === '-' || n[1] === '−' || n[2]) ? -v : v; }
    return t.toLowerCase();
  }
  function compara(a, b){
    if(a === null && b === null) return 0;
    if(a === null) return 1; if(b === null) return -1;          // vazio sempre no fim
    if(typeof a === 'number' && typeof b === 'number') return a - b;
    if(typeof a === 'number') return -1; if(typeof b === 'number') return 1;
    return String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
  }
  function seta(t, col, dir){
    [...cab(t)].forEach((c, i) => {
      let s = c.querySelector(':scope > .ord-seta');
      if(i !== col){ if(s) s.remove(); return; }
      if(!s){ s = document.createElement('span'); s.className = 'ord-seta'; s.style.cssText = 'font-size:10px;margin-left:3px;'; c.appendChild(s); }
      s.textContent = dir > 0 ? '▲' : '▼';
    });
  }
  function ordenar(t, col, dir){
    const tb = t.tBodies[0], L = [...tb.rows];
    const v = L.map((r, i) => ({ r, v: r.cells.length === 1 ? undefined : valor(r.cells[col]), i }));
    const ord = v.filter(x => x.v !== undefined).sort((a, b) => { const c = compara(a.v, b.v); return (a.v === null || b.v === null ? c : c * dir) || a.i - b.i; });
    const fixas = v.filter(x => x.v === undefined), nova = ord.concat(fixas);
    if(nova.some((x, i) => x !== v[i])) nova.forEach(x => tb.appendChild(x.r));   // só mexe no DOM se a ordem mudou
    seta(t, col, dir);
  }

  // ---------- mudar coluna de lugar ----------
  function moverDom(t, de, para){
    if(de === para) return;
    const mv = r => { const c = r.cells; if(c.length !== cab(t).length) return; const x = c[de]; r.insertBefore(x, para > de ? c[para].nextSibling : c[para]); };
    [...t.tHead.rows, ...t.tBodies[0].rows, ...(t.tFoot ? t.tFoot.rows : [])].forEach(mv);
  }
  // põe as colunas no lugar guardado (pelo título)
  function arrumar(t){
    const k = chaveDe(t), alvo = lugares[k]; if(!alvo) return;
    const at = titulos(t);
    if(at.join('|') === alvo.join('|') || at.slice().sort().join('|') !== alvo.slice().sort().join('|')) return;
    alvo.forEach((ti, pos) => { const cur = titulos(t).indexOf(ti); if(cur >= 0 && cur !== pos) moverDom(t, cur, pos); });
  }

  // ---------- eventos ----------
  let arr = null, ignorarClique = false, linha = null;
  const thDe = e => { const th = e.target && e.target.closest ? e.target.closest('thead th') : null; return th && !e.target.closest('input, button, a, select, label, .tip, [onclick]:not(th)') ? th : null; };
  document.addEventListener('mousedown', e => {
    const th = thDe(e); if(!th || e.button !== 0) return;
    const t = th.closest('table'); if(!apta(t, true)) return;
    arr = { th, t, x0: e.clientX, de: th.cellIndex, ativo: false };
  });
  document.addEventListener('mousemove', e => {
    if(!arr) return;
    if(!arr.ativo){ if(Math.abs(e.clientX - arr.x0) < 10) return; arr.ativo = true; document.body.style.cursor = 'grabbing'; arr.th.style.opacity = '0.5';
      linha = document.createElement('div'); linha.style.cssText = 'position:fixed;width:3px;background:var(--primary,#6d28d9);z-index:9999;pointer-events:none;border-radius:2px;'; document.body.appendChild(linha); }
    // ponto de inserção: antes da primeira coluna cujo meio está à direita do mouse (ou depois da última)
    const C = [...cab(arr.t)]; let p = C.length;
    for(let i = 0; i < C.length; i++){ const r = C[i].getBoundingClientRect(); if(e.clientX < r.left + r.width / 2){ p = i; break; } }
    const x = p < C.length ? C[p].getBoundingClientRect().left : C[C.length - 1].getBoundingClientRect().right, tr = arr.t.getBoundingClientRect();
    linha.style.left = (x - 1) + 'px'; linha.style.top = Math.max(0, tr.top) + 'px'; linha.style.height = Math.min(window.innerHeight, tr.bottom) - Math.max(0, tr.top) + 'px';
    arr.para = p > arr.de ? p - 1 : p;
    e.preventDefault();
  });
  document.addEventListener('mouseup', () => {
    if(!arr) return;
    const a = arr; arr = null;
    if(!a.ativo) return;
    document.body.style.cursor = ''; a.th.style.opacity = ''; if(linha){ linha.remove(); linha = null; }
    ignorarClique = true; setTimeout(() => { ignorarClique = false; }, 80);
    const para = Math.max(0, Math.min(cab(a.t).length - 1, a.para == null ? a.de : a.para));
    if(para === a.de) return;
    moverDom(a.t, a.de, para);
    if(typeof window.colunasMover === 'function') window.colunasMover(a.t, a.de, para);
    lugares[chaveDe(a.t)] = titulos(a.t); gravar();
  });
  document.addEventListener('click', e => {
    const th = thDe(e); if(!th) return;
    if(ignorarClique){ e.stopPropagation(); e.preventDefault(); return; }
    if(th.getAttribute('onclick') || th.onclick) return;          // título com ordenação própria
    const t = th.closest('table'); if(!apta(t, false)) return;
    const k = chaveDe(t), ti = tit(th), o = ordem.get(k);
    const dir = o && o.titulo === ti ? -o.dir : 1;
    ordem.set(k, { titulo: ti, dir });
    ordenar(t, th.cellIndex, dir);
  }, true);
  // dois cliques no título: colunas daquela tabela voltam à ordem original (vale a partir do próximo desenho da tela)
  document.addEventListener('dblclick', e => {
    const th = thDe(e); if(!th) return;
    const t = th.closest('table'), k = t && cab(t) ? chaveDe(t) : null;
    if(k && lugares[k]){ delete lugares[k]; gravar(); if(typeof toast === 'function') toast('As colunas desta tabela voltam à ordem original na próxima vez que a tela for aberta.'); }
  });

  // a tela redesenhou a tabela: devolve o lugar das colunas e a ordenação escolhida
  let agendado = false;
  function reaplicar(){
    agendado = false;
    document.querySelectorAll('.view.active table, .modal.open table').forEach(t => {
      if(!cab(t)) return;
      const k = chaveDe(t);
      if(lugares[k] && apta(t, true)) arrumar(t);
      const o = ordem.get(k);
      if(o && apta(t, false)){ const col = titulos(t).indexOf(o.titulo); if(col >= 0) ordenar(t, col, o.dir); }
    });
  }
  new MutationObserver(() => { if(!agendado && (ordem.size || Object.keys(lugares).length)){ agendado = true; requestAnimationFrame(reaplicar); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  const css = document.createElement('style');
  css.textContent = 'table:not(.dre-tab):not([data-sem-ordem]) > thead > tr:only-child > th{cursor:pointer;user-select:none;}';
  document.head.appendChild(css);
})();
