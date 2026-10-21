// ===== PRODUTO PAI, VARIAÇÕES E MAPEAMENTO DE ANÚNCIOS (aba Produtos) =====
// PAI: só agrupa. Venda, custo, imposto, estoque e compra continuam pela variação (o SKU de sempre).
//   skus[].pai = código do pai, skus[].variacao = o que diferencia (Bege, 110v...). Nome do pai em sku_pais.
//   Kit continua kit (composição); pode ficar no mesmo pai.
// MAPEAMENTO (como o "Mapeado SKU do Anúncio" do UpSeller): dentro do produto, "Mapear anúncio" liga um anúncio do ML
//   (ml_anuncios, lista trazida pela função ml-anuncios) ao SKU do produto (sku_mapa). Daí em diante as vendas e o
//   estoque Full desse anúncio usam o SKU do produto, qualquer que seja o SKU escrito no anúncio (ml-vendas e
//   ml-inventory aplicam o mapa); as vendas já gravadas mudam na hora (RPC sku_mapa_aplicar). Desfazer: sku_mapa_desfazer.
// O código do SKU não muda depois de criado (trava em editarSKU): para trocar, crie outro e mapeie os anúncios.

    let skuPais = [], skuMapa = [], mlAnuncios = null, ppCarregado = false, ppAbertos = new Set(), ppAgrupado = true, skuTipo = '';
    const ppEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const ppQ = s => ppEsc(JSON.stringify(String(s == null ? '' : s)));          // valor dentro de onclick="..."
    const ppN = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const ppSemAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const ppCmp = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });

    async function ppCarregar(forcar){
      if((ppCarregado && !forcar) || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      ppCarregado = true;
      const [p, m] = await Promise.all([
        supa.from('sku_pais').select('codigo,nome').eq('usuario_id', usuarioAtual.id),
        supa.from('sku_mapa').select('item_id,variation_id,sku,ml_user_id,sku_anuncio,criado_em').eq('usuario_id', usuarioAtual.id) ]);
      if(!p.error) skuPais = p.data || [];
      if(!m.error) skuMapa = m.data || [];
      const v = document.getElementById('view-skus'); if(v && v.classList.contains('active')) renderSKUs();
    }
    function ppNomePai(cod){ const p = skuPais.find(x => ppN(x.codigo) === ppN(cod)); return p ? (p.nome || '') : ''; }
    function ppFilhos(cod){ return skus.filter(s => s.pai && ppN(s.pai) === ppN(cod)); }

    // ---------- lista agrupada ----------
    // filtros extras da lista (tipo e busca pelo pai) — chamado por renderSKUs
    function ppFiltrar(s, busca){
      if(skuTipo === 'unico' && s.pai) return false;
      if(skuTipo === 'var' && !s.pai) return false;
      if(!busca) return true;
      return !!(s.pai && (s.pai.toLowerCase().includes(busca) || ppNomePai(s.pai).toLowerCase().includes(busca) || String(s.variacao || '').toLowerCase().includes(busca)));
    }
    function ppChips(produtos){
      const nVar = produtos.filter(s => s.pai).length, nPais = new Set(produtos.filter(s => s.pai).map(s => ppN(s.pai))).size;
      return '<span style="width:1px;background:var(--border);margin:0 6px;align-self:stretch;"></span>'
        + [['', 'Todos os tipos', produtos.length], ['unico', 'Únicos', produtos.length - nVar], ['var', 'Com variações', nVar]]
          .map(([v, n, q]) => `<button class="chip ${v === skuTipo ? 'active' : ''}" onclick="skuTipo='${v}';renderSKUs()">${n}<span class="n">${q}</span></button>`).join('')
        + `<button class="chip ${ppAgrupado ? 'active' : ''}" onclick="ppAgrupado=!ppAgrupado;renderSKUs()" title="Mostrar as variações dentro do produto pai (${nPais} pais)">Agrupar por pai</button>`;
    }
    // monta as linhas: pai (clique abre/fecha) e as variações embaixo; linha(s, filho) desenha um SKU
    function ppAgrupar(lista, linha, busca){
      const grupos = new Map(), itens = [];
      lista.forEach(s => {
        if(!s.pai){ itens.push({ k: s.sku, s }); return; }
        const k = ppN(s.pai);
        if(!grupos.has(k)){ grupos.set(k, { cod: s.pai, filhos: [] }); itens.push({ k: s.pai, g: grupos.get(k) }); }
        grupos.get(k).filhos.push(s);
      });
      itens.sort((a, b) => ppCmp(a.k, b.k));
      return itens.map(x => {
        if(x.s) return linha(x.s, false);
        const g = x.g, todos = ppFiltrarKits(ppFilhos(g.cod)), aberto = !!busca || ppAbertos.has(ppN(g.cod));
        const custos = todos.map(s => Number(s.custo) || 0).filter(c => c > 0), imp = [...new Set(todos.map(s => Number(s.imposto) || 0))];
        const faixa = !custos.length ? '<span class="badge badge-danger">Sem custo</span>' : Math.min(...custos) === Math.max(...custos) ? '<b>' + fmt(custos[0]) + '</b>' : '<b>' + fmt(Math.min(...custos)) + ' a ' + fmt(Math.max(...custos)) + '</b>';
        const semC = todos.filter(s => !(Number(s.custo) > 0)).length;
        g.filhos.sort((a, b) => ppCmp(a.sku, b.sku));
        return `<tr class="pp-pai" onclick="ppAlternar(${ppQ(g.cod)})" style="cursor:pointer;background:var(--surface-2,#f6f7f9);" title="Clique para ${aberto ? 'fechar' : 'ver'} as variações">
            <td style="text-align:center;" onclick="event.stopPropagation()"><input type="checkbox" title="Marcar todas as variações" onchange="ppMarcarFilhos(${ppQ(g.cod)}, this.checked)"></td>
            <td style="padding:4px 6px;">${typeof fotoCel === 'function' && g.filhos[0] ? fotoCel(g.filhos[0].sku) : ''}</td>
            <td class="sku-cod"><span style="display:inline-block;width:14px;color:var(--text-muted);">${aberto ? '▾' : '▸'}</span><b>${ppEsc(g.cod)}</b><div style="font-size:11.5px;color:var(--text-muted);margin-left:14px;">${todos.length} variaç${todos.length === 1 ? 'ão' : 'ões'}${semC ? ' · <span style="color:var(--danger);">' + semC + ' sem custo</span>' : ''}</div></td>
            <td class="sku-tit"><b>${ppEsc(ppNomePai(g.cod)) || '<span class="text-muted">sem nome</span>'}</b></td>
            <td style="text-align:right;white-space:nowrap;">${faixa}</td>
            <td style="text-align:right;white-space:nowrap;">${imp.length === 1 && imp[0] > 0 ? imp[0].toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : imp.length > 1 ? '<span class="text-muted">vários</span>' : '<span class="text-muted">—</span>'}</td>
            <td style="text-align:center;"><button class="btn-out btn-sm" onclick="event.stopPropagation();ppEditarPai(${ppQ(g.cod)})">Editar</button></td>
          </tr>` + (aberto ? g.filhos.map(s => linha(s, true)).join('') : '');
      }).join('');
    }
    // na lista de produtos os kits ficam na aba Kits
    function ppFiltrarKits(L){ const kits = new Set(composicaoKit.map(c => c.sku_comercial)); return L.filter(s => !kits.has(s.sku)); }
    function ppAlternar(cod){ const k = ppN(cod); if(ppAbertos.has(k)) ppAbertos.delete(k); else ppAbertos.add(k); renderSKUs(); }
    function ppMarcarFilhos(cod, v){
      if(!ppAbertos.has(ppN(cod))){ ppAbertos.add(ppN(cod)); renderSKUs(); }
      const idx = new Set(ppFilhos(cod).map(s => String(skus.indexOf(s))));
      document.querySelectorAll('.sku-cb').forEach(c => { if(idx.has(c.dataset.idx)) c.checked = v; });
      if(typeof atualizarContSKUSel === 'function') atualizarContSKUSel();
    }

    // ---------- janela do produto pai ----------
    let ppEd = null;
    function ppNovoPai(){ ppEd = { novo: true, codigo: '', nome: '', filhos: [] }; ppDesenharPai(); }
    function ppEditarPai(cod){
      ppEd = { novo: false, codigo: cod, nome: ppNomePai(cod), filhos: ppFilhos(cod).sort((a, b) => ppCmp(a.sku, b.sku)).map(s => ({ sku: s.sku, variacao: s.variacao || '' })) };
      ppDesenharPai();
    }
    function ppLerPai(){
      const c = document.getElementById('pp-cod'), n = document.getElementById('pp-nome');
      if(c) ppEd.codigo = ppSemAcento(c.value).trim(); if(n) ppEd.nome = n.value.trim();
      document.querySelectorAll('.pp-var').forEach(i => { const f = ppEd.filhos[Number(i.dataset.k)]; if(f) f.variacao = i.value.trim(); });
    }
    function ppDesenharPai(){
      const e = ppEd, livres = skus.filter(s => !s.pai && !e.filhos.some(f => ppN(f.sku) === ppN(s.sku))).map(s => s.sku).sort(ppCmp);
      const kits = new Set(composicaoKit.map(c => c.sku_comercial));
      vmlModal(e.novo ? 'Novo produto pai' : 'Produto pai ' + ppEsc(e.codigo), `
        <div class="text-muted" style="font-size:12.5px;margin-bottom:12px;">O pai só agrupa as variações. Venda, custo, estoque e compra continuam em cada variação (o SKU de sempre).</div>
        <div class="pf-grid" style="grid-template-columns:1fr 2fr;">
          <label class="pf-c"><span>Código do pai</span><input id="pp-cod" value="${ppEsc(e.codigo)}" placeholder="Ex.: J-2010" ${e.novo ? '' : 'readonly title="O código não muda depois de criado"'}></label>
          <label class="pf-c"><span>Nome do produto</span><input id="pp-nome" value="${ppEsc(e.nome)}" placeholder="Ex.: Buquê de Rosas 24 rosas 40 cm"></label>
        </div>
        <div class="form-label" style="margin-top:16px;">Variações (${e.filhos.length})</div>
        <div class="pf-tab" style="margin-top:4px;"><table><thead><tr><th style="width:52px;"></th><th>SKU</th><th>Variação</th><th>Título</th><th style="text-align:right;">Custo</th><th></th></tr></thead><tbody>
          ${e.filhos.length ? e.filhos.map((f, k) => { const s = skus.find(x => ppN(x.sku) === ppN(f.sku)) || {};
            return `<tr><td>${typeof fotoCel === 'function' ? fotoCel(f.sku) : ''}</td><td><b>${ppEsc(f.sku)}</b>${kits.has(f.sku) ? ' <span class="badge">kit</span>' : ''}</td>
              <td><input class="pp-var" data-k="${k}" value="${ppEsc(f.variacao)}" placeholder="Ex.: Bege" style="width:150px;"></td>
              <td class="text-muted" style="font-size:12.5px;">${ppEsc(s.titulo || '')}</td><td style="text-align:right;">${Number(s.custo) > 0 ? fmt(Number(s.custo)) : '<span class="badge badge-danger">Sem custo</span>'}</td>
              <td><button class="ico-btn" title="Tirar desta família (o SKU continua cadastrado)" onclick="ppLerPai();ppEd.filhos.splice(${k},1);ppDesenharPai()">✕</button></td></tr>`; }).join('')
            : '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:14px;">Nenhuma variação ainda. Adicione abaixo.</td></tr>'}
        </tbody></table></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
          <input id="pp-add" list="pp-livres" placeholder="SKU para incluir (ex.: J-2010-Azul)" style="flex:1;min-width:220px;" onkeydown="if(event.key==='Enter'){event.preventDefault();ppIncluir();}">
          <datalist id="pp-livres">${livres.map(s => `<option value="${ppEsc(s)}">`).join('')}</datalist>
          <button class="btn-out btn-sm" onclick="ppIncluir()">+ Incluir variação</button>
          ${e.codigo ? `<button class="btn-out btn-sm" onclick="ppIncluirPrefixo()" title="Inclui os SKUs que começam com ${ppEsc(e.codigo)}-">Incluir todos ${ppEsc(e.codigo)}-…</button>` : ''}
        </div>`,
        `${e.novo ? '' : `<button class="btn-out" style="color:var(--danger);margin-right:auto;" onclick="ppExcluirPai(this)" title="As variações continuam cadastradas, só deixam de ficar agrupadas">Desfazer agrupamento</button>`}<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="ppSalvarPai(this)">Salvar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '820px';
    }
    // sufixo do SKU depois do código do pai vira a variação sugerida (J-2010-Azul → Azul)
    function ppSufixo(sku, cod){ const a = ppN(sku), b = ppN(cod); return a.startsWith(b + '-') ? String(sku).slice(String(cod).length + 1) : ''; }
    function ppIncluir(){
      ppLerPai();
      const v = (document.getElementById('pp-add') || {}).value || '', s = skus.find(x => ppN(x.sku) === ppN(v));
      if(!s){ toast('SKU não encontrado no cadastro: ' + v); return; }
      if(s.pai && ppN(s.pai) !== ppN(ppEd.codigo)){ toast(s.sku + ' já está no produto pai ' + s.pai + '. Tire de lá antes.'); return; }
      if(!ppEd.filhos.some(f => ppN(f.sku) === ppN(s.sku))) ppEd.filhos.push({ sku: s.sku, variacao: s.variacao || ppSufixo(s.sku, ppEd.codigo) });
      ppDesenharPai();
    }
    function ppIncluirPrefixo(){
      ppLerPai();
      const n = skus.filter(s => !s.pai && ppSufixo(s.sku, ppEd.codigo) && !ppEd.filhos.some(f => ppN(f.sku) === ppN(s.sku)));
      n.forEach(s => ppEd.filhos.push({ sku: s.sku, variacao: ppSufixo(s.sku, ppEd.codigo) }));
      if(!n.length) toast('Nenhum SKU livre começa com ' + ppEd.codigo + '-');
      ppDesenharPai();
    }
    async function ppGravarPais(lista){       // [{ codigo, nome }]
      if(!lista.length) return null;
      const r = await supa.from('sku_pais').upsert(lista.map(p => ({ usuario_id: usuarioAtual.id, codigo: p.codigo, nome: p.nome || null })), { onConflict: 'usuario_id,codigo' });
      if(r.error) return r.error.message;
      lista.forEach(p => { const i = skuPais.findIndex(x => ppN(x.codigo) === ppN(p.codigo)); if(i >= 0) skuPais[i] = { codigo: skuPais[i].codigo, nome: p.nome || null }; else skuPais.push({ codigo: p.codigo, nome: p.nome || null }); });
      return null;
    }
    async function ppSalvarPai(btn){
      ppLerPai();
      const e = ppEd;
      if(!e.codigo){ toast('Informe o código do pai.'); return; }
      if(e.novo && skuPais.some(p => ppN(p.codigo) === ppN(e.codigo))){ toast('Já existe um produto pai ' + e.codigo + '.'); return; }
      if(!e.filhos.length){ toast('Inclua pelo menos uma variação.'); return; }
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      const erro = await ppGravarPais([{ codigo: e.codigo, nome: e.nome }]);
      if(erro){ toast('Não consegui salvar o produto pai: ' + erro); if(btn){ btn.disabled = false; btn.textContent = 'Salvar'; } return; }
      const dentro = new Set(e.filhos.map(f => ppN(f.sku)));
      skus.forEach(s => {
        if(s.pai && ppN(s.pai) === ppN(e.codigo) && !dentro.has(ppN(s.sku))){ s.pai = null; s.variacao = null; }
        const f = e.filhos.find(x => ppN(x.sku) === ppN(s.sku)); if(f){ s.pai = e.codigo; s.variacao = f.variacao || null; }
      });
      salvar(); ppAbertos.add(ppN(e.codigo));
      fecharModal('modal-vml'); renderSKUs(); toast('Produto pai ' + e.codigo + ' salvo com ' + e.filhos.length + ' variaç' + (e.filhos.length === 1 ? 'ão.' : 'ões.'));
    }
    async function ppExcluirPai(btn){
      if(btn && btn.dataset.conf !== '1'){ btn.dataset.conf = '1'; btn.textContent = 'Confirmar: desfazer agrupamento'; return; }
      const cod = ppEd.codigo;
      const r = await supa.from('sku_pais').delete().eq('usuario_id', usuarioAtual.id).eq('codigo', cod);
      if(r.error){ toast('Não consegui excluir: ' + r.error.message); return; }
      skuPais = skuPais.filter(p => ppN(p.codigo) !== ppN(cod));
      skus.forEach(s => { if(s.pai && ppN(s.pai) === ppN(cod)){ s.pai = null; s.variacao = null; } });
      salvar(); fecharModal('modal-vml'); renderSKUs();
    }

    // ---------- sugestão automática de grupos pelo código (J-2010-Azul, J-2010-Rosa → pai J-2010) ----------
    function ppSugerir(){
      const kits = new Set(composicaoKit.map(c => c.sku_comercial)), g = new Map();
      skus.filter(s => !s.pai).forEach(s => {
        // sufixo só com número (J-2014-2, J-2016-12) é quantidade/kit do SKU base, que pode ser outro produto: fica de fora
        const m = String(s.sku).match(/^([A-Za-z]+-\d+)-(.+)$/); if(!m || /^\d+$/.test(m[2])) return;
        const k = ppN(m[1]); if(!g.has(k)) g.set(k, { codigo: m[1].toUpperCase(), filhos: [] });
        g.get(k).filhos.push({ sku: s.sku, variacao: m[2], kit: kits.has(s.sku), titulo: s.titulo || '' });
      });
      // título mais comum entre as variações que não são kit vira o nome do pai
      const lista = [...g.values()].filter(x => x.filhos.length >= 2 || skuPais.some(p => ppN(p.codigo) === ppN(x.codigo))).sort((a, b) => ppCmp(a.codigo, b.codigo));
      lista.forEach(x => {
        const ex = skuPais.find(p => ppN(p.codigo) === ppN(x.codigo));
        const cont = {}; x.filhos.filter(f => !f.kit && f.titulo).forEach(f => { cont[f.titulo] = (cont[f.titulo] || 0) + 1; });
        x.nome = (ex && ex.nome) || Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0] || (x.filhos.find(f => f.titulo) || {}).titulo || '';
        x.filhos.sort((a, b) => ppCmp(a.sku, b.sku));
      });
      window._ppSug = lista;
      vmlModal('Agrupar variações automaticamente', lista.length ? `
        <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">Encontrei estes grupos pelo começo do código (ex.: <b>J-2010</b>-Azul e <b>J-2010</b>-Rosa ficam no pai <b>J-2010</b>). Nenhum código muda. Confira o nome, desmarque o que não for da mesma família e clique em Agrupar. SKUs que terminam só em número (ex.: J-2014-2) ficam de fora, porque costumam ser quantidade de outro produto: inclua à mão em "Editar" do pai, se for o caso.</div>
        <div style="margin-bottom:8px;font-size:12.5px;"><a href="#" onclick="document.querySelectorAll('.pp-sg').forEach(c=>c.checked=true);return false;">marcar todos</a> · <a href="#" onclick="document.querySelectorAll('.pp-sg').forEach(c=>c.checked=false);return false;">desmarcar todos</a></div>
        ${lista.map((x, k) => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
          <label style="display:flex;gap:10px;align-items:center;margin:0;"><input type="checkbox" class="pp-sg" data-k="${k}" checked style="width:auto;">
            <b style="min-width:70px;">${ppEsc(x.codigo)}</b><input class="pp-sg-nome" data-k="${k}" value="${ppEsc(x.nome)}" placeholder="Nome do produto" style="flex:1;" onclick="event.stopPropagation()"></label>
          <div style="font-size:12px;color:var(--text-muted);margin:6px 0 0 28px;line-height:1.6;">${x.filhos.map(f => ppEsc(f.sku) + (f.kit ? ' <i>(kit)</i>' : '')).join(' · ')}</div></div>`).join('')}`
        : '<div class="vazio"><b>Nada para agrupar</b>Não achei SKUs sem pai com o mesmo começo de código.</div>',
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button>${lista.length ? '<button class="btn" onclick="ppSugerirGravar(this)">Agrupar marcados</button>' : ''}`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '820px';
    }
    async function ppSugerirGravar(btn){
      const L = window._ppSug || [], nomes = {};
      document.querySelectorAll('.pp-sg-nome').forEach(i => { nomes[i.dataset.k] = i.value.trim(); });
      const esc = [...document.querySelectorAll('.pp-sg')].filter(c => c.checked).map(c => ({ ...L[Number(c.dataset.k)], nome: nomes[c.dataset.k] }));
      if(!esc.length){ toast('Marque pelo menos um grupo.'); return; }
      if(btn){ btn.disabled = true; btn.textContent = 'Agrupando…'; }
      const erro = await ppGravarPais(esc.map(x => ({ codigo: x.codigo, nome: x.nome })));
      if(erro){ toast('Não consegui agrupar: ' + erro); if(btn){ btn.disabled = false; btn.textContent = 'Agrupar marcados'; } return; }
      let n = 0;
      esc.forEach(x => x.filhos.forEach(f => { const s = skus.find(y => y.sku === f.sku); if(s && !s.pai){ s.pai = x.codigo; s.variacao = f.variacao; n++; } }));
      salvar(); fecharModal('modal-vml'); renderSKUs();
      toast(esc.length + ' produto' + (esc.length === 1 ? ' pai criado' : 's pai criados') + ' com ' + n + ' variações.');
    }

    // ---------- campos do pai na janela do SKU (modal-sku) ----------
    function ppModalSku(s){
      const pai = document.getElementById('sku-pai'), va = document.getElementById('sku-variacao'), dl = document.getElementById('sku-pais-lista');
      if(dl) dl.innerHTML = skuPais.slice().sort((a, b) => ppCmp(a.codigo, b.codigo)).map(p => `<option value="${ppEsc(p.codigo)}" label="${ppEsc(p.nome || '')}">`).join('');
      if(pai) pai.value = s ? (s.pai || '') : '';
      if(va) va.value = s ? (s.variacao || '') : '';
      ppMapeadosDesenhar(s ? s.sku : null);
    }
    // lido por salvarSKU; pai digitado que ainda não existe é criado com o título do SKU como nome
    async function ppLerModalSku(sku){
      const pai = document.getElementById('sku-pai'), va = document.getElementById('sku-variacao');
      if(!pai) return;
      let cod = ppSemAcento(pai.value).trim();
      const ex = cod && skuPais.find(p => ppN(p.codigo) === ppN(cod));
      if(ex) cod = ex.codigo;
      else if(cod){ const erro = await ppGravarPais([{ codigo: cod, nome: sku.titulo || '' }]); if(erro) toast('Não consegui criar o produto pai: ' + erro); }
      sku.pai = cod || null; sku.variacao = cod ? ((va && va.value.trim()) || ppSufixo(sku.sku, cod) || null) : null;
    }

    // ---------- anúncios mapeados (dentro do produto) ----------
    function ppAnuncio(item, vari){ return (mlAnuncios || []).find(a => a.item_id === item && Number(a.variation_id) === Number(vari || 0)); }
    async function ppAnunciosCarregar(forcar){
      if(mlAnuncios && !forcar) return mlAnuncios;
      const r = await supa.from('ml_anuncios').select('ml_user_id,item_id,variation_id,titulo,variacao,sku_anuncio,thumbnail,status,logistic_type,atualizado_em').eq('usuario_id', usuarioAtual.id).limit(5000);
      mlAnuncios = r.data || [];
      // lista vazia ou com mais de 1 dia: busca no Mercado Livre
      const velho = !mlAnuncios.length || mlAnuncios.every(a => Date.now() - new Date(a.atualizado_em).getTime() > 86400000);
      if(velho && !forcar) await ppAnunciosAtualizar(null, true);
      return mlAnuncios;
    }
    async function ppAnunciosAtualizar(btn, quieto){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando no Mercado Livre…'; }
      try {
        const sd = await supa.auth.getSession(), tk = sd.data.session.access_token;
        const r = await fetch(SUPA_URL + '/functions/v1/ml-anuncios', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json());
        if(r.error) toast('Não consegui buscar os anúncios: ' + r.error);
        else if(!quieto) toast(r.total + ' anúncios atualizados' + ((r.contas || []).some(c => c.erro) ? ' (' + r.contas.filter(c => c.erro).map(c => c.apelido + ': ' + c.erro).join('; ') + ')' : '.'));
      } catch(e){ toast('Não consegui buscar os anúncios: sem conexão'); }
      await ppAnunciosCarregar(true);
      if(btn){ btn.disabled = false; btn.textContent = 'Atualizar anúncios'; }
    }
    const ppConta = c => (typeof contaNome === 'function' && contaNome(c)) || c || '';
    function ppAnuncioHtml(a, item, vari){
      return `<div style="display:flex;gap:9px;align-items:center;min-width:0;">${a && a.thumbnail ? `<img src="${ppEsc(a.thumbnail)}" alt="" loading="lazy" style="width:38px;height:38px;object-fit:cover;border-radius:6px;flex:none;">` : '<span class="foto-mini vazia" style="flex:none;"></span>'}
        <div style="min-width:0;"><div style="font-weight:600;font-size:12.5px;line-height:1.3;">${ppEsc(a ? a.titulo : 'Anúncio ' + item)}</div>
        <div style="font-size:11.5px;color:var(--text-muted);"><a href="https://produto.mercadolivre.com.br/${String(item).replace(/^MLB/, 'MLB-')}" target="_blank" rel="noopener" style="color:inherit;">${ppEsc(item)}</a>${a && a.variacao ? ' · ' + ppEsc(a.variacao) : vari ? ' · variação ' + vari : ''}${a ? ' · ' + ppEsc(ppConta(a.ml_user_id)) + (a.logistic_type === 'fulfillment' ? ' · Full' : '') + (a.status === 'paused' ? ' · pausado' : '') : ''}${a ? ' · SKU no anúncio: <b>' + ppEsc(a.sku_anuncio || 'vazio') + '</b>' : ''}</div></div></div>`;
    }
    async function ppMapeadosDesenhar(sku){
      const el = document.getElementById('sku-mapeados'); if(!el) return;
      if(!sku){ el.innerHTML = '<div class="text-muted" style="font-size:12px;margin-top:10px;">Depois de salvar o produto você pode mapear os anúncios dele.</div>'; return; }
      el.innerHTML = '<div class="text-muted" style="font-size:12px;margin-top:10px;">Carregando anúncios…</div>';
      await ppAnunciosCarregar(false);
      const meus = skuMapa.filter(m => ppN(m.sku) === ppN(sku));
      const pelo = (mlAnuncios || []).filter(a => ppN(a.sku_anuncio) === ppN(sku) && !skuMapa.some(m => m.item_id === a.item_id && (Number(m.variation_id) === Number(a.variation_id) || Number(m.variation_id) === 0)));
      el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;"><span class="form-label" style="margin:0;">Anúncios deste produto</span><button class="btn-out btn-sm" onclick="ppMapearAbrir(${ppQ(sku)})">+ Mapear anúncio</button></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          ${meus.map(m => { const a = ppAnuncio(m.item_id, m.variation_id), vale = !m.sku_anuncio || !a || ppN(a.sku_anuncio) === ppN(m.sku_anuncio);
            return `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;">${ppAnuncioHtml(a, m.item_id, m.variation_id)}<span style="display:flex;gap:6px;align-items:center;flex:none;">${vale ? '<span class="badge badge-success"' + (m.sku_anuncio ? ' title="Vale para as vendas com o SKU ' + ppEsc(m.sku_anuncio) + ' no anúncio"' : '') + '>mapeado</span>' : '<span class="badge badge-warning" title="O SKU do anúncio mudou para ' + ppEsc(a.sku_anuncio || 'vazio') + ': as vendas novas usam o SKU do anúncio">SKU do anúncio mudou</span>'}<button class="btn-out btn-sm" onclick="ppDesmapear(${ppQ(m.item_id)}, ${Number(m.variation_id) || 0}, ${ppQ(sku)}, this)">Desfazer</button></span></div>`; }).join('')}
          ${pelo.map(a => `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;">${ppAnuncioHtml(a, a.item_id, a.variation_id)}<span class="badge" style="flex:none;" title="O anúncio já traz este SKU escrito nele: não precisa mapear">pelo SKU do anúncio</span></div>`).join('')}
          ${!meus.length && !pelo.length ? '<div class="text-muted" style="font-size:12px;">Nenhum anúncio traz este SKU. Use "Mapear anúncio" para ligar um anúncio a este produto.</div>' : ''}
        </div>`;
    }
    // escolher o anúncio (janela por cima da do produto)
    let ppMapSku = '';
    async function ppMapearAbrir(sku){
      ppMapSku = sku;
      vmlModal('Mapear anúncio para ' + ppEsc(sku), '<div class="vazio">Carregando os anúncios…</div>');
      await ppAnunciosCarregar(false);
      ppMapearDesenhar();
    }
    function ppMapearDesenhar(){
      const busca = ((document.getElementById('pp-busca') || {}).value || '').trim();
      const termos = ppN(busca).split(/\s+/).filter(Boolean);
      const L = (mlAnuncios || []).filter(a => !termos.length || termos.every(t => ppN([a.titulo, a.item_id, a.sku_anuncio, a.variacao].join(' ')).includes(t)))
        .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || ppCmp(a.titulo, b.titulo)).slice(0, 80);
      const atual = a => skuMapa.find(m => m.item_id === a.item_id && Number(m.variation_id) === Number(a.variation_id)) || skuMapa.find(m => m.item_id === a.item_id && Number(m.variation_id) === 0);
      const corpo = `<div style="display:flex;gap:8px;margin-bottom:10px;"><input id="pp-busca" type="search" placeholder="Buscar por título, MLB ou SKU do anúncio" value="${ppEsc(busca)}" oninput="ppMapearFiltrar()" style="flex:1;"><button class="btn-out btn-sm" onclick="ppAnunciosAtualizar(this).then(ppMapearDesenhar)" title="Busca de novo no Mercado Livre a lista de anúncios">Atualizar anúncios</button></div>
        <div class="text-muted" style="font-size:12px;margin-bottom:8px;">${(mlAnuncios || []).length} anúncios${L.length === 80 ? ' · mostrando os 80 primeiros, refine a busca' : ''}. Mapear faz as vendas desse anúncio (as novas e as já gravadas) usarem o produto <b>${ppEsc(ppMapSku)}</b>.</div>
        <div id="pp-map-lista" style="display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;">
          ${L.length ? L.map(a => { const m = atual(a), meu = m && ppN(m.sku) === ppN(ppMapSku), igual = !m && ppN(a.sku_anuncio) === ppN(ppMapSku);
            return `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:8px;">${ppAnuncioHtml(a, a.item_id, a.variation_id)}
              <span style="flex:none;text-align:right;">${meu ? '<span class="badge badge-success">já mapeado aqui</span>' : igual ? '<span class="badge" title="O SKU escrito no anúncio já é este">já é deste produto</span>'
                : `${m ? `<div style="font-size:11px;color:var(--warning,#b7791f);margin-bottom:3px;">mapeado para ${ppEsc(m.sku)}</div>` : ''}<button class="btn btn-sm" onclick="ppMapear(${ppQ(a.item_id)}, ${Number(a.variation_id) || 0}, ${ppQ(a.ml_user_id)}, this)">${m ? 'Trocar para este' : 'Mapear'}</button>`}</span></div>`; }).join('')
            : '<div class="vazio"><b>Nenhum anúncio encontrado</b>Mude a busca ou clique em "Atualizar anúncios".</div>'}
        </div>`;
      const lista = document.getElementById('pp-map-lista');
      if(lista && document.getElementById('pp-busca')){   // só a lista muda: o campo de busca não perde o cursor
        const tmp = document.createElement('div'); tmp.innerHTML = corpo; lista.replaceWith(tmp.querySelector('#pp-map-lista'));
        return;
      }
      vmlModal('Mapear anúncio para ' + ppEsc(ppMapSku), corpo, `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
      const b = document.getElementById('pp-busca'); if(b) b.focus();
    }
    let ppTimer = null;
    function ppMapearFiltrar(){ clearTimeout(ppTimer); ppTimer = setTimeout(ppMapearDesenhar, 150); }
    async function ppMapear(item, vari, conta, btn, sku){
      sku = sku || ppMapSku;
      if(btn){ btn.disabled = true; btn.textContent = 'Mapeando…'; }
      const an = ppAnuncio(item, vari);   // o mapeamento vale para o anúncio com o SKU que ele tem agora
      const r = await supa.from('sku_mapa').upsert({ usuario_id: usuarioAtual.id, item_id: item, variation_id: vari || 0, sku, ml_user_id: conta || null, sku_anuncio: an && an.sku_anuncio ? an.sku_anuncio : null }, { onConflict: 'usuario_id,item_id,variation_id' });
      if(r.error){ toast('Não consegui mapear: ' + r.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Mapear'; } return false; }
      skuMapa = skuMapa.filter(m => !(m.item_id === item && Number(m.variation_id) === Number(vari || 0))).concat([{ item_id: item, variation_id: vari || 0, sku, ml_user_id: conta || null, criado_em: new Date().toISOString() }]);
      const ap = await supa.rpc('sku_mapa_aplicar', { p_item: item, p_variation: vari || 0 });
      toast('Anúncio ' + item + ' mapeado para ' + sku + (ap.error ? '. As vendas antigas não foram atualizadas: ' + ap.error.message : ap.data ? '. ' + ap.data + ' venda' + (ap.data === 1 ? '' : 's') + ' já gravada' + (ap.data === 1 ? '' : 's') + ' passaram a usar este produto.' : '.'));
      if(document.getElementById('pp-map-lista')) ppMapearDesenhar();
      if(document.getElementById('modal-sku') && document.getElementById('modal-sku').classList.contains('open')) ppMapeadosDesenhar(sku);
      if(typeof vmlRecarregar === 'function') try { vmlRecarregar(); } catch(e){}
      return true;
    }
    async function ppDesmapear(item, vari, sku, btn){
      if(btn && btn.dataset.conf !== '1'){ btn.dataset.conf = '1'; btn.textContent = 'Confirmar'; return; }
      const r = await supa.rpc('sku_mapa_desfazer', { p_item: item, p_variation: vari || 0 });
      if(r.error){ toast('Não consegui desfazer: ' + r.error.message); return; }
      skuMapa = skuMapa.filter(m => !(m.item_id === item && Number(m.variation_id) === Number(vari || 0)));
      toast('Mapeamento desfeito' + (r.data ? '. ' + r.data + ' venda(s) voltaram ao SKU do anúncio.' : '.'));
      ppMapeadosDesenhar(sku);
    }

    // ---------- anúncios sem cadastro (SKU do anúncio não existe nos produtos e não há mapeamento) ----------
    async function ppSemCadastro(){
      vmlModal('Anúncios sem cadastro', '<div class="vazio">Carregando os anúncios…</div>');
      await ppAnunciosCarregar(false);
      ppSemCadastroDesenhar();
    }
    function ppSemCadastroDesenhar(){
      const cad = new Set(skus.map(s => ppN(s.sku)));
      const L = (mlAnuncios || []).filter(a => !skuMapa.some(m => m.item_id === a.item_id && (Number(m.variation_id) === Number(a.variation_id) || Number(m.variation_id) === 0)) && !cad.has(ppN(a.sku_anuncio)))
        .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || ppCmp(a.titulo, b.titulo));
      window._ppSem = L;
      vmlModal('Anúncios sem cadastro (' + L.length + ')', `
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;"><span class="text-muted" style="font-size:12.5px;">O SKU escrito nestes anúncios não existe nos seus produtos, então as vendas deles ficam sem custo. Escolha o produto de cada um e clique em Mapear, ou corrija o SKU no Mercado Livre.</span><button class="btn-out btn-sm" onclick="ppAnunciosAtualizar(this).then(ppSemCadastroDesenhar)">Atualizar anúncios</button></div>
        <datalist id="pp-skus-todos">${skus.map(s => `<option value="${ppEsc(s.sku)}" label="${ppEsc(s.titulo || '')}">`).join('')}</datalist>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:56vh;overflow:auto;">
          ${L.length ? L.map((a, k) => `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:8px;flex-wrap:wrap;">${ppAnuncioHtml(a, a.item_id, a.variation_id)}
            <span style="display:flex;gap:6px;flex:none;"><input class="pp-sem-sku" data-k="${k}" list="pp-skus-todos" placeholder="SKU do produto" style="width:170px;"><button class="btn btn-sm" onclick="ppSemMapear(${k}, this)">Mapear</button></span></div>`).join('')
            : '<div class="vazio"><b>Tudo certo</b>Todos os anúncios têm o SKU cadastrado ou mapeado.</div>'}
        </div>`, `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }
    async function ppSemMapear(k, btn){
      const a = (window._ppSem || [])[k], inp = document.querySelector('.pp-sem-sku[data-k="' + k + '"]');
      const s = inp && skus.find(x => ppN(x.sku) === ppN(inp.value));
      if(!a) return;
      if(!s){ toast('Escolha um SKU que exista nos produtos.'); return; }
      if(await ppMapear(a.item_id, Number(a.variation_id) || 0, a.ml_user_id, btn, s.sku)) ppSemCadastroDesenhar();
    }
