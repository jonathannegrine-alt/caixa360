// ===== CONTROLE DE ESTOQUE (modelo inspirado na UpSeller) =====
// Depósitos do usuário (ex.: Galpão e Full). O saldo físico de um produto num depósito é a soma das
// movimentações (tabela estoque_mov): toda entrada, saída ou ajuste deixa uma linha com motivo e referência.
//   a caminho  = comprado e ainda não conferido (ordens de compra)
//   ocupado    = vendido e ainda não enviado + envio ao Full em preparação
//   disponível = físico − ocupado
// O depósito do tipo "full" não tem movimentações: mostra o estoque buscado no Mercado Livre.
// Compatibilidade: estoqueGalpao[] (usado pela Sugestão de compras) passa a ser um ESPELHO do saldo do
// primeiro depósito próprio; quem manda é o registro de movimentações.
// Banco: supabase/migrations/20261011_estoque.sql

    let est = { depositos: [], saldo: [], carregadoEm: 0, carregando: false, erro: '', dep: null, busca: '', so: '', loja: '' };
    const esN = s => String(s == null ? '' : s).trim().toLowerCase();
    const esEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const esInt = n => Math.round(Number(n) || 0).toLocaleString('pt-BR');
    const ES_MOTIVO = { carga_inicial: 'Carga inicial', compra: 'Chegada de compra', venda: 'Venda enviada', envio_full: 'Envio ao Full', contagem: 'Contagem de estoque', ajuste: 'Ajuste manual', transferencia: 'Transferência', devolucao: 'Devolução' };

    function estDepProprio(){ return estVisiveis().find(d => d.tipo === 'proprio') || est.depositos.find(d => d.tipo === 'proprio' && d.ativo) || null; }
    // depósitos da tela: os marcados para mostrar e, com uma loja escolhida no seletor, só os dela
    function estDaLoja(d, loja){ if(!loja) return true; if(d.tipo === 'full') return !d.ml_user_id || String(d.ml_user_id) === loja; return !Array.isArray(d.lojas) || !d.lojas.length || d.lojas.map(String).includes(loja); }
    function estVisiveis(){ const loja = typeof lojaAtiva === 'function' ? lojaAtiva() : ''; return est.depositos.filter(d => d.ativo && estDaLoja(d, loja)); }
    function estSaldoDe(depId, sku){ const r = est.saldo.find(s => Number(s.deposito_id) === Number(depId) && s.sku_norm === esN(sku)); return r ? Number(r.fisico) || 0 : 0; }

    async function estCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return false;
      if(est.carregando) return true;
      if(!forcar && est.carregadoEm && Date.now() - est.carregadoEm < 2 * 60 * 1000) return true;
      est.carregando = true; est.erro = '';
      try {
        let d = await supa.from('estoque_depositos').select('*').eq('usuario_id', usuarioAtual.id).order('id');
        if(d.error){ est.erro = d.error.message; return false; }
        if(!d.data.length){
          // primeiro uso: cria Galpão e Full
          await supa.from('estoque_depositos').insert([{ usuario_id: usuarioAtual.id, nome: 'Galpão', tipo: 'proprio' }, { usuario_id: usuarioAtual.id, nome: 'Full', tipo: 'full' }]);
          d = await supa.from('estoque_depositos').select('*').eq('usuario_id', usuarioAtual.id).order('id');
        }
        est.depositos = d.data || [];
        // Full separado por loja: garante um depósito do tipo full para cada conta conectada
        const contas = typeof contasML !== 'undefined' ? contasML : [];
        if(contas.length){
          let mexeu = false;
          for(const c of contas){
            if(est.depositos.some(x => x.tipo === 'full' && String(x.ml_user_id || '') === String(c.id))) continue;
            const nome = 'Full ' + (c.apelido || c.id), livre = est.depositos.find(x => x.tipo === 'full' && !x.ml_user_id);
            const r = livre ? await supa.from('estoque_depositos').update({ ml_user_id: String(c.id), nome }).eq('id', livre.id)
                            : await supa.from('estoque_depositos').insert({ usuario_id: usuarioAtual.id, nome, tipo: 'full', ml_user_id: String(c.id) });
            if(livre && !r.error){ livre.ml_user_id = String(c.id); livre.nome = nome; }
            if(!r.error) mexeu = true;
          }
          if(mexeu){ const d2 = await supa.from('estoque_depositos').select('*').eq('usuario_id', usuarioAtual.id).order('id'); if(d2.data) est.depositos = d2.data; }
        }
        if(est.dep !== 'total' && (!est.dep || !est.depositos.some(x => x.id === est.dep))) est.dep = 'total';
        await estLerSaldo();
        // primeiro uso com estoque já importado da UpSeller: vira a carga inicial
        const g = estDepProprio();
        if(g && !est.saldo.some(s => Number(s.deposito_id) === g.id) && estoqueGalpao.length){
          const linhas = estoqueGalpao.filter(e => Number(e.qtd_galpao) > 0).map(e => ({ usuario_id: usuarioAtual.id, deposito_id: g.id, sku: e.sku, qtd: Number(e.qtd_galpao), motivo: 'carga_inicial', ref: 'carga-' + getToday(), obs: 'Estoque que já estava importado da UpSeller' }));
          if(linhas.length){ const r = await supa.from('estoque_mov').insert(linhas); if(r.error) est.erro = r.error.message; await estLerSaldo(); }
        }
        est.carregadoEm = Date.now();
        return true;
      } finally { est.carregando = false; }
    }
    async function estLerSaldo(){
      const s = await supa.from('estoque_saldo').select('*').eq('usuario_id', usuarioAtual.id).limit(5000);
      if(s.error){ est.erro = s.error.message; return; }
      est.saldo = s.data || [];
      estEspelhar();
    }

    // copia o saldo do depósito próprio para estoqueGalpao[] (lido pela Sugestão de compras e pelo patrimônio)
    function estEspelhar(){
      const g = estDepProprio(); if(!g) return;
      const meus = est.saldo.filter(s => Number(s.deposito_id) === g.id);
      if(!meus.length) return;
      const visto = new Set();
      meus.forEach(s => {
        visto.add(s.sku_norm);
        let e = estoqueGalpao.find(x => esN(x.sku) === s.sku_norm);
        if(!e){ e = { sku: s.sku, descricao: s.sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }; estoqueGalpao.push(e); }
        e.qtd_galpao = Number(s.fisico) || 0;
      });
      estoqueGalpao.forEach(e => { if(!visto.has(esN(e.sku))) e.qtd_galpao = 0; });
      try { localStorage.setItem('mk_estoque_galpao', JSON.stringify(estoqueGalpao)); } catch(e){}
    }

    // grava movimentações e atualiza o saldo. linhas: [{ sku, qtd, motivo, ref, obs, custo_unit }]
    async function estMovimentar(depId, linhas){
      const reg = linhas.filter(l => l.sku && Number(l.qtd)).map(l => ({ usuario_id: usuarioAtual.id, deposito_id: depId, sku: String(l.sku).trim(), qtd: Number(l.qtd), motivo: l.motivo, ref: l.ref || null, obs: l.obs || null, custo_unit: l.custo_unit == null ? null : Number(l.custo_unit) }));
      if(!reg.length) return { ok: true, n: 0 };
      // custo médio: a entrada de compra pondera o custo novo pelo saldo que havia
      reg.filter(l => l.motivo === 'compra' && l.qtd > 0 && l.custo_unit > 0).forEach(l => {
        const e = estoqueGalpao.find(x => esN(x.sku) === esN(l.sku)); if(!e) return;
        const antes = Math.max(0, estSaldoDe(depId, l.sku)), cAntes = Number(e.custo_medio) || 0;
        e.custo_medio = antes > 0 && cAntes > 0 ? (antes * cAntes + l.qtd * l.custo_unit) / (antes + l.qtd) : l.custo_unit;
      });
      const r = await supa.from('estoque_mov').insert(reg);
      if(r.error) return { ok: false, erro: r.error.message };
      await estLerSaldo();
      if(typeof salvar === 'function') salvar();
      return { ok: true, n: reg.length };
    }

    // ----- tela -----
    async function estRender(){
      const view = document.getElementById('view-estoque');
      if(!view) return;
      let host = document.getElementById('est-host');
      [...view.children].forEach(el => { if(el.id !== 'est-host') el.style.display = 'none'; });
      if(!host){ host = document.createElement('div'); host.id = 'est-host'; view.appendChild(host); }
      if(!est.carregadoEm || !host.innerHTML.trim()){ if(typeof carregandoMsg === 'function') carregandoMsg(host, 'Carregando o estoque…'); else host.innerHTML = '<div class="vazio"><b>Carregando o estoque…</b></div>'; }
      await estCarregar(false);
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      if(typeof esoSincronizar === 'function') try { await esoSincronizar(false); } catch(e){}
      estDesenhar();
      // em segundo plano: pergunta ao Mercado Livre o que já foi enviado, baixa do físico e redesenha
      if(typeof esoSincronizar === 'function') esoSincronizar(true).then(() => { const v = document.getElementById('view-estoque'); if(v && v.classList.contains('active')) estDesenhar(); }).catch(() => {});
    }

    function estLinhas(dep){
      const caminho = typeof ocTransitoPorSku === 'function' && typeof ocTemDados === 'function' && ocTemDados() ? ocTransitoPorSku() : new Map();
      const ocup = typeof estOcupadoPorSku === 'function' ? estOcupadoPorSku(dep.id) : new Map();
      const mapa = new Map();
      const pega = sku => { const k = esN(sku); if(!mapa.has(k)) mapa.set(k, { sku, k, nome: '', fisico: 0, caminho: 0, ocupado: 0, custo: 0 }); return mapa.get(k); };
      est.saldo.filter(s => Number(s.deposito_id) === dep.id).forEach(s => { pega(s.sku).fisico = Number(s.fisico) || 0; });
      caminho.forEach((q, k) => { const l = mapa.get(k) || pega(k.toUpperCase()); l.caminho = q; });
      ocup.forEach((q, k) => { const l = mapa.get(k) || pega(k.toUpperCase()); l.ocupado = q; });
      mapa.forEach(l => {
        const e = estoqueGalpao.find(x => esN(x.sku) === l.k), s = skus.find(x => esN(x.sku) === l.k);
        l.nome = (s && s.titulo) || (e && e.descricao !== e.sku && e.descricao) || '';
        if(e && esN(e.sku) === l.k) l.sku = e.sku;
        l.custo = (e && Number(e.custo_medio) > 0 ? Number(e.custo_medio) : 0) || (s && Number(s.custo)) || 0;
        l.disp = l.fisico - l.ocupado;
      });
      return [...mapa.values()];
    }

    // ----- foto do produto -----
    // A foto fica gravada (tabela sku_fotos_manual): ou é enviada pelo usuário (bucket "produtos"), ou é a do anúncio,
    // capturada uma vez e guardada. Não é buscada de novo a cada tela.
    let estFotos = new Map(), estFotosOk = false;
    async function estFotosCarregar(){
      if(estFotosOk || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      estFotosOk = true;
      const r = await supa.from('sku_fotos_manual').select('sku_norm,url').eq('usuario_id', usuarioAtual.id).limit(5000);
      (r.data || []).forEach(x => estFotos.set(x.sku_norm, x.url));
      // produto ainda sem foto: captura a do anúncio agora e deixa salva
      const todos = [...new Set(est.saldo.map(s => esN(s.sku)).concat(estoqueGalpao.map(g => esN(g.sku))))].filter(k => k && !estFotos.has(k));
      if(todos.length && !r.error){
        const a = await supa.rpc('sku_fotos', { p_skus: todos });
        const novas = (a.data || []).filter(x => x.foto && !estFotos.has(x.sku)).map(x => ({ usuario_id: usuarioAtual.id, sku_norm: x.sku, url: String(x.foto).replace('http://', 'https://') }));
        if(novas.length){ novas.forEach(n => estFotos.set(n.sku_norm, n.url)); await supa.from('sku_fotos_manual').upsert(novas); }
      }
      if(document.getElementById('view-estoque') && document.getElementById('view-estoque').classList.contains('active')) estDesenhar();
    }
    function estFotoTd(k){
      const u = estFotos.get(k);
      return `<td class="est-foto" onclick="estFotoAbrir('${esEsc(k)}')" title="${u ? 'Ver ou trocar a foto' : 'Colocar uma foto'}">${u ? `<img src="${esEsc(u)}" loading="lazy" alt="">` : '<span>+ foto</span>'}</td>`;
    }
    function estFotoAbrir(k){
      const u = estFotos.get(k), g = estoqueGalpao.find(x => esN(x.sku) === k), s = skus.find(x => esN(x.sku) === k);
      vmlModal('Foto — ' + esEsc((g && g.sku) || (s && s.sku) || k), `
        <div style="text-align:center;min-height:120px;">${u ? `<img src="${esEsc(u)}" alt="" style="max-width:100%;max-height:52vh;border-radius:10px;">` : '<div class="vazio"><b>Sem foto</b>Envie uma foto do produto ou use a do anúncio.</div>'}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:10px;line-height:1.5;">A foto aparece no estoque e na folha de contagem. A do anúncio é capturada uma vez e fica guardada; ela não muda se o anúncio mudar.</div>`,
        `${u ? `<button class="btn-out" style="color:var(--danger);margin-right:auto;" onclick="estFotoRemover('${esEsc(k)}')">Remover</button>` : '<span style="margin-right:auto;"></span>'}
         <button class="btn-out" onclick="estFotoDoAnuncio('${esEsc(k)}', this)">Usar a foto do anúncio</button>
         <label class="btn" style="cursor:pointer;margin:0;">Enviar foto<input type="file" accept="image/*" aria-label="Foto do produto" style="display:none" onchange="estFotoEnviar('${esEsc(k)}', this.files[0])"></label>`);
    }
    // reduz a imagem no navegador (lado maior 600 px, JPEG) antes de enviar
    function estFotoReduzir(file){
      return new Promise((ok, erro) => { const u = URL.createObjectURL(file), im = new Image();
        im.onload = () => { const r = Math.min(1, 600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? ok(b) : erro(new Error('não consegui converter a imagem')), 'image/jpeg', 0.85); };
        im.onerror = () => { URL.revokeObjectURL(u); erro(new Error('este arquivo não é uma imagem que eu consiga ler')); }; im.src = u; });
    }
    async function estFotoGravar(k, file){
      const blob = await estFotoReduzir(file), caminho = usuarioAtual.id + '/' + k.replace(/[^a-z0-9._-]+/g, '_') + '.jpg';
      const up = await supa.storage.from('produtos').upload(caminho, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
      if(up.error) throw up.error;
      const url = supa.storage.from('produtos').getPublicUrl(caminho).data.publicUrl + '?v=' + Date.now();
      const r = await supa.from('sku_fotos_manual').upsert({ usuario_id: usuarioAtual.id, sku_norm: k, url, atualizado_em: new Date().toISOString() });
      if(r.error) throw r.error;
      estFotos.set(k, url);
    }
    async function estFotoEnviar(k, file){
      if(!file) return;
      try { await estFotoGravar(k, file); fecharModal('modal-vml'); estDesenhar(); if(typeof toast === 'function') toast('Foto gravada.'); }
      catch(err){ if(typeof toast === 'function') toast('Não consegui gravar a foto: ' + err.message); }
    }
    async function estFotoDoAnuncio(k, btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      await supa.from('sku_fotos_manual').delete().eq('usuario_id', usuarioAtual.id).eq('sku_norm', k);
      const a = await supa.rpc('sku_fotos', { p_skus: [k] }), f = (a.data || [])[0];
      if(!f || !f.foto){ if(typeof toast === 'function') toast('Este produto não tem anúncio com foto. Envie uma foto.'); const u = estFotos.get(k); if(u) await supa.from('sku_fotos_manual').upsert({ usuario_id: usuarioAtual.id, sku_norm: k, url: u }); if(btn){ btn.disabled = false; btn.textContent = 'Usar a foto do anúncio'; } return; }
      const url = String(f.foto).replace('http://', 'https://');
      await supa.from('sku_fotos_manual').upsert({ usuario_id: usuarioAtual.id, sku_norm: k, url }); estFotos.set(k, url);
      fecharModal('modal-vml'); estDesenhar();
    }
    async function estFotoRemover(k){
      await supa.from('sku_fotos_manual').delete().eq('usuario_id', usuarioAtual.id).eq('sku_norm', k);
      estFotos.delete(k); fecharModal('modal-vml'); estDesenhar();
    }
    // várias fotos de uma vez: o nome de cada arquivo é o SKU (ex.: J-2010-Rosa.jpg)
    async function estFotosLote(inp){
      const arqs = [...(inp.files || [])]; inp.value = ''; if(!arqs.length) return;
      const conhecidos = new Set(est.saldo.map(s => esN(s.sku)).concat(estoqueGalpao.map(g => esN(g.sku)), skus.map(s => esN(s.sku))));
      let ok = 0; const fora = [];
      for(const f of arqs){ const k = esN(f.name.replace(/\.[^.]+$/, '')); if(!conhecidos.has(k)){ fora.push(f.name); continue; } try { await estFotoGravar(k, f); ok++; } catch(err){ fora.push(f.name); } }
      estDesenhar();
      if(typeof toast === 'function') toast(ok + ' foto(s) gravada(s).' + (fora.length ? ' Não reconheci: ' + fora.slice(0, 5).join(', ') + (fora.length > 5 ? '…' : '') + ' (o nome do arquivo precisa ser o SKU).' : ''));
      window._estLote = { ok, fora };
    }

    // ordenar pelas colunas (clique no título) e marcar produtos para a folha de contagem
    let estOrd = { col: '', dir: -1 }, estSel = new Set();
    function estOrdenar(col){ estOrd = { col, dir: estOrd.col === col ? -estOrd.dir : (col === 'sku' ? 1 : -1) }; estDesenhar(); }
    function estTh(col, rot, num, dica){ return `<th class="${num ? 'num ' : ''}an-th" ${dica ? 'title="' + dica + '"' : ''} onclick="estOrdenar('${col}')">${rot}${estOrd.col === col ? (estOrd.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`; }
    function estComparar(vals, padrao){
      const f = vals[estOrd.col]; if(!f) return padrao;
      return (a, b) => { const x = f(a), y = f(b); const r = typeof x === 'string' ? String(x).localeCompare(String(y)) : (Number(x) || 0) - (Number(y) || 0); return r * estOrd.dir || a.k.localeCompare(b.k); };
    }
    function estMarcar(k, v){ if(v) estSel.add(k); else estSel.delete(k); estBarraSel(); }
    function estMarcarTodos(v){ document.querySelectorAll('.est-flag').forEach(c => { c.checked = v; if(v) estSel.add(c.dataset.k); else estSel.delete(c.dataset.k); }); estBarraSel(); }
    function estBarraSel(){ const b = document.getElementById('est-sel-barra'); if(b) b.innerHTML = estSelHtml(); }
    function estSelHtml(){
      return estSel.size ? `<b>${estSel.size}</b> produto${estSel.size === 1 ? '' : 's'} marcado${estSel.size === 1 ? '' : 's'} <button class="btn btn-sm" onclick="estFolhaContagem()">Folha de contagem (PDF)</button><button class="btn-out btn-sm" onclick="estSel.clear();estDesenhar()">Desmarcar</button>`
        : '<span class="text-muted">Marque os produtos na primeira coluna para imprimir a folha de contagem.</span>';
    }
    function estLoteHtml(){
      return '<label class="btn-out btn-sm" style="cursor:pointer;margin:0 0 0 auto;" title="Escolha várias fotos de uma vez. O nome de cada arquivo precisa ser o SKU do produto.">Fotos em lote<input type="file" accept="image/*" multiple aria-label="Fotos dos produtos em lote" style="display:none" onchange="estFotosLote(this)"></label>';
    }

    // Folha para a equipe contar: produtos marcados, na ordem da tela, com o estoque do sistema e o espaço para anotar.
    async function estFolhaContagem(){
      const dep = (est.dep !== 'total' && est.depositos.find(d => d.id === est.dep && d.tipo !== 'full')) || estDepProprio();
      if(!dep){ if(typeof toast === 'function') toast('Não achei o depósito do galpão.'); return; }
      const ordem = [...document.querySelectorAll('.est-flag')].map(c => c.dataset.k);
      const linhas = estLinhas(dep).filter(l => estSel.has(l.k)).sort((a, b) => { const x = ordem.indexOf(a.k), y = ordem.indexOf(b.k); return (x < 0 ? 1e9 : x) - (y < 0 ? 1e9 : y); });
      // marcado na aba Total e ainda sem saldo no galpão entra com zero
      [...estSel].filter(k => !linhas.some(l => l.k === k)).forEach(k => { const g = estoqueGalpao.find(x => esN(x.sku) === k), s = skus.find(x => esN(x.sku) === k); linhas.push({ k, sku: (g && g.sku) || (s && s.sku) || k, nome: (s && s.titulo) || '', fisico: 0 }); });
      if(!linhas.length) return;
      try {
        const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem conexão')); document.head.appendChild(s); });
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        // foto do anúncio de cada produto (vem da venda mais recente; produto só de kit usa a foto do kit)
        const fotos = new Map();
        try {
          const rf = await supa.rpc('sku_fotos', { p_skus: linhas.map(l => l.sku) });
          await Promise.all((rf.data || []).map(x => new Promise(ok => {
            const im = new Image(); im.crossOrigin = 'anonymous';
            im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 120; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 120, 120);
              const r = Math.min(120 / im.width, 120 / im.height), w = im.width * r, h = im.height * r; g.drawImage(im, (120 - w) / 2, (120 - h) / 2, w, h); fotos.set(x.sku, c.toDataURL('image/jpeg', 0.8)); } catch(err){} ok(); };
            im.onerror = () => ok(); im.src = String(x.foto).replace('http://', 'https://'); setTimeout(ok, 6000);
          })));
        } catch(err){}
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), agora = new Date();
        doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.text('Lista de Estoque', 40, 50);
        doc.setFontSize(10); doc.setFont(undefined, 'normal');
        doc.text('Qtd. de SKU: ' + linhas.length, 300, 40); doc.text('Total de itens: ' + esInt(linhas.reduce((s, l) => s + Math.max(0, l.fisico), 0)), 430, 40);
        doc.text('Depósito: ' + dep.nome + '   ' + agora.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }), 300, 56);
        doc.autoTable({
          startY: 74, theme: 'grid', styles: { fontSize: 10, cellPadding: 7, valign: 'middle', lineColor: 120, lineWidth: 0.5, textColor: 20 },
          headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 26, halign: 'center' }, 1: { cellWidth: 50 }, 3: { cellWidth: 60, halign: 'center' }, 4: { cellWidth: 78 }, 5: { cellWidth: 110 } },
          head: [['#', 'Foto', 'SKU', 'Estoque atual', 'Contado', 'Observações']],
          body: linhas.map((l, i) => [i + 1, '', l.sku + (l.nome ? '\n' + l.nome : ''), esInt(l.fisico), '', '']),
          didParseCell: d => { if(d.section === 'body') d.cell.styles.minCellHeight = 46; },
          didDrawCell: d => { if(d.section === 'body' && d.column.index === 1){ const f = fotos.get(esN(linhas[d.row.index].sku)); if(f){ try { doc.addImage(f, 'JPEG', d.cell.x + 5, d.cell.y + 3, 40, 40); } catch(err){} } } }
        });
        const y = Math.min(doc.lastAutoTable.finalY + 30, 800);
        doc.text('Contado por: ______________________     Data: ____/____/______', 40, y);
        doc.text('Obs.:', 40, y + 24);
        doc.save('contagem_de_estoque_' + getToday() + '.pdf');
      } catch(err){ if(typeof toast === 'function') toast('Não consegui gerar o PDF: ' + err.message); }
    }

    function estDesenhar(){
      const host = document.getElementById('est-host'); if(!host) return;
      if(!estFotosOk && est.carregadoEm) estFotosCarregar();
      if(est.dep !== 'total' && est.depositos.length && !estVisiveis().some(d => d.id === est.dep)) est.dep = 'total';
      if(est.dep === 'total') return estDesenharTotal();
      const dep = est.depositos.find(d => d.id === est.dep) || est.depositos[0];
      if(!dep){ host.innerHTML = `<div class="alert alert-danger">${esEsc(est.erro || 'Não consegui carregar os depósitos.')}</div>`; return; }
      const abas = `<div class="chips" style="margin-bottom:14px;"><button class="chip" onclick="est.dep='total';estDesenhar();">Total</button>${estVisiveis().map(d => `<button class="chip ${d.id === dep.id ? 'active' : ''}" onclick="est.dep=${d.id};estDesenhar();">${esEsc(d.nome)}</button>`).join('')}<button class="chip" onclick="estGerenciarDepositos()" title="Depósitos, regras do ocupado e mapeamento dos anúncios">Configurar estoque</button></div>`;
      const cab = `<div class="pg-head"><div><div class="pg-title">Estoque</div><div class="pg-sub">Quanto existe em cada depósito, o que está a caminho e o que já está vendido e ainda não saiu.</div></div>
        <div class="d-flex gap-1" style="flex-wrap:wrap;">${dep.tipo === 'full' ? `<button class="btn-out btn-sm" onclick="estAtualizarFull(this)">Atualizar do Mercado Livre</button>` : `<button class="btn-out btn-sm" onclick="estAjuste()">Ajuste manual</button><button class="btn-out btn-sm" onclick="esoEnvios()">Envios ao Full</button><button class="btn btn-sm" onclick="esoContagens()">Contagem de estoque</button>`}</div></div>`;
      const erro = est.erro ? `<div class="alert alert-danger">${esEsc(est.erro)}</div>` : '';

      if(dep.tipo === 'full'){
        const lojas = [];   // cada loja tem o seu depósito Full
        const itens = (Array.isArray(estoqueFullML) ? estoqueFullML.slice() : []).filter(x => !dep.ml_user_id || String(x._conta || '') === String(dep.ml_user_id));
        const b = esN(est.busca), lista = itens.filter(x => !b || esN(x.sku).includes(b) || esN(x.titulo).includes(b)).sort((a, c) => (Number(c.total_geral) || 0) - (Number(a.total_geral) || 0));
        const tot = itens.reduce((s, x) => s + (Number(x.total_geral) || 0), 0), disp = itens.reduce((s, x) => s + (Number(x.aptos_venda) || 0), 0), transf = itens.reduce((s, x) => s + (Number(x.em_transito) || 0), 0);
        host.innerHTML = cab + erro + abas + `
          <div class="kpi-grid k4i">
            <div class="kpi k-venda"><div class="kpi-label">Unidades no Full</div><div class="kpi-value">${esInt(tot)}</div><div class="kpi-sub">${itens.length} anúncios (kits contam como anúncio)</div></div>
            <div class="kpi k-mc"><div class="kpi-label">Disponíveis para venda</div><div class="kpi-value">${esInt(disp)}</div><div class="kpi-sub">&nbsp;</div></div>
            <div class="kpi k-frete"><div class="kpi-label">Em transferência</div><div class="kpi-value">${esInt(transf)}</div><div class="kpi-sub">entre centros do Mercado Livre</div></div>
            <div class="kpi k-neutro"><div class="kpi-label">Atualizado</div><div class="kpi-value" style="font-size:18px;">${estoqueFullML && estoqueFullML._syncAt ? new Date(estoqueFullML._syncAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}</div><div class="kpi-sub">${estoqueFullML && estoqueFullML._fonte === 'xls' ? 'planilha importada' : 'direto do Mercado Livre'}</div></div>
          </div>
          <div class="card"><div class="sku-barra"><input type="text" id="est-busca" placeholder="Buscar por SKU ou título" value="${esEsc(est.busca)}" oninput="estBuscar(this.value)">
            ${lojas.length > 1 ? `<div class="chips">${[['', 'As duas lojas']].concat(lojas.map(l => [l, (typeof contaNome === 'function' && contaNome(l)) || l])).map(([k, t]) => `<button class="chip ${est.loja === k ? 'active' : ''}" onclick="est.loja='${k}';estDesenhar();">${esEsc(t)}</button>`).join('')}</div>` : ''}</div>
          <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Anúncio</th><th>Conta</th><th class="num">Disponível</th><th class="num">Em transferência</th><th class="num">Sem condição de venda</th><th class="num">Total</th></tr></thead><tbody>
            ${lista.length ? lista.map(x => `<tr><td class="cp-prod" style="max-width:520px;"><b>${esEsc(x.sku)}</b><span title="${esEsc(x.titulo)}">${esEsc(x.titulo || '')}</span></td><td class="cp-forn">${esEsc((typeof contaNome === 'function' && x._conta && contaNome(x._conta)) || '—')}</td><td class="num"><b>${esInt(x.aptos_venda)}</b></td><td class="num">${esInt(x.em_transito)}</td><td class="num" title="${esEsc(x.detalhe || '')}">${esInt(x.nao_aptos)}</td><td class="num"><b>${esInt(x.total_geral)}</b></td></tr>`).join('') : '<tr><td colspan="6"><div class="vazio"><b>Sem estoque do Full carregado</b>Clique em Atualizar do Mercado Livre.</div></td></tr>'}
          </tbody></table></div></div>`;
        return;
      }

      const todas = estLinhas(dep), b = esN(est.busca);
      const lista = todas.filter(l => (!b || l.k.includes(b) || esN(l.nome).includes(b)) && (est.so === '' || (est.so === 'zerado' ? l.fisico <= 0 : est.so === 'caminho' ? l.caminho > 0 : est.so === 'ocupado' ? l.ocupado > 0 : est.so === 'semcusto' ? !(l.custo > 0) && l.fisico > 0 : true)))
        .sort(estComparar({ sku: l => l.k, caminho: l => l.caminho, ocupado: l => l.ocupado, disp: l => l.disp, fisico: l => l.fisico, custo: l => l.custo, valor: l => Math.max(0, l.fisico) * l.custo },
          (a, c) => c.fisico * c.custo - a.fisico * a.custo || c.fisico - a.fisico || a.k.localeCompare(c.k)));
      const un = todas.reduce((s, l) => s + Math.max(0, l.fisico), 0), valor = todas.reduce((s, l) => s + Math.max(0, l.fisico) * l.custo, 0);
      const cam = todas.reduce((s, l) => s + l.caminho, 0), ocp = todas.reduce((s, l) => s + l.ocupado, 0);
      const semMov = !est.saldo.some(s => Number(s.deposito_id) === dep.id);
      host.innerHTML = cab + erro + abas + `
        ${semMov ? `<div class="alert alert-warning">Este depósito ainda não tem estoque lançado. Clique em <b>&nbsp;Contagem de estoque&nbsp;</b> e importe a Lista de Estoque (a de produtos, não a de kits).</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Estoque físico</div><div class="kpi-value">${esInt(un)} un.</div><div class="kpi-sub">${fmt(valor)} a custo médio</div></div>
          <div class="kpi k-frete"><div class="kpi-label">A caminho</div><div class="kpi-value">${esInt(cam)} un.</div><div class="kpi-sub">comprado e ainda não conferido</div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Ocupado</div><div class="kpi-value">${esInt(ocp)} un.</div><div class="kpi-sub">vendido ou separado, ainda não saiu</div></div>
          <div class="kpi k-mc"><div class="kpi-label">Disponível</div><div class="kpi-value">${esInt(un - ocp)} un.</div><div class="kpi-sub">físico menos ocupado</div></div>
        </div>
        <div class="card"><div class="sku-barra">
          <input type="text" id="est-busca" placeholder="Buscar por SKU ou nome" value="${esEsc(est.busca)}" oninput="estBuscar(this.value)">
          <div class="chips">${[['', 'Todos'], ['caminho', 'Com compra a caminho'], ['ocupado', 'Com ocupado'], ['zerado', 'Zerados'], ['semcusto', 'Sem custo']].map(([k, t]) => `<button class="chip ${est.so === k ? 'active' : ''}" onclick="est.so='${k}';estDesenhar();">${t}</button>`).join('')}</div>
        </div>
        <div class="est-sel-barra"><span id="est-sel-barra" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">${estSelHtml()}</span>${estLoteHtml()}</div>
        <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th style="width:34px;"><input type="checkbox" style="width:auto;" title="Marcar todos os que estão na tela" onchange="estMarcarTodos(this.checked)"></th><th style="width:48px;"></th>${estTh('sku', 'Produto')}${estTh('caminho', 'A caminho', 1, 'Comprado e ainda não conferido')}${estTh('ocupado', 'Ocupado', 1, 'Vendido ou separado, ainda não saiu')}${estTh('disp', 'Disponível', 1, 'Físico menos ocupado')}${estTh('fisico', 'Estoque físico', 1, 'O que está no depósito')}${estTh('custo', 'Custo médio', 1)}${estTh('valor', 'Valor', 1)}<th></th></tr></thead><tbody>
          ${lista.length ? lista.map(l => `<tr>
            <td><input type="checkbox" class="est-flag" data-k="${esEsc(l.k)}" style="width:auto;" ${estSel.has(l.k) ? 'checked' : ''} onchange="estMarcar(this.dataset.k, this.checked)"></td>
            ${estFotoTd(l.k)}
            <td class="cp-prod" style="max-width:440px;"><b>${esEsc(l.sku)}</b><span title="${esEsc(l.nome)}">${esEsc(l.nome || '')}</span></td>
            <td class="num">${l.caminho ? esInt(l.caminho) : '<span class="text-muted">—</span>'}</td>
            <td class="num">${l.ocupado ? esInt(l.ocupado) : '<span class="text-muted">—</span>'}</td>
            <td class="num ${l.disp < 0 ? 'text-danger' : ''}">${esInt(l.disp)}</td>
            <td class="num"><b class="${l.fisico < 0 ? 'text-danger' : ''}">${esInt(l.fisico)}</b></td>
            <td class="num">${l.custo ? fmt(l.custo) : '<span class="badge badge-warning">sem custo</span>'}</td>
            <td class="num">${l.custo ? fmt(Math.max(0, l.fisico) * l.custo) : '—'}</td>
            <td style="text-align:right;"><button class="btn-out btn-sm" onclick="estMovimentos('${esEsc(l.k)}')">Movimentações</button></td>
          </tr>`).join('') : '<tr><td colspan="10"><div class="vazio"><b>Nada nesta lista</b>Troque a busca ou o filtro.</div></td></tr>'}
        </tbody></table></div></div>`;
    }

    // Total: soma de todos os depósitos visíveis, produto a produto (o Full entra com os kits abertos nos componentes)
    function estDesenharTotal(){
      const host = document.getElementById('est-host'); if(!host) return;
      const deps = estVisiveis();
      const abrir = (sku, q) => typeof esoAbrir === 'function' ? esoAbrir(sku, q) : [{ sku, qtd: q }];
      const mapa = new Map(), pega = sku => { const k = esN(sku); if(!mapa.has(k)) mapa.set(k, { k, sku, nome: '', por: {}, caminho: 0, custo: 0 }); return mapa.get(k); };
      deps.forEach(d => {
        if(d.tipo === 'full') (Array.isArray(estoqueFullML) ? estoqueFullML : []).filter(x => !d.ml_user_id || String(x._conta || '') === String(d.ml_user_id)).forEach(x => abrir(x.sku, Number(x.total_geral) || 0).forEach(c => { if(!c.qtd) return; const l = pega(c.sku); l.por[d.id] = (l.por[d.id] || 0) + c.qtd; }));
        else est.saldo.filter(s => Number(s.deposito_id) === d.id).forEach(s => { const l = pega(s.sku); l.por[d.id] = (l.por[d.id] || 0) + (Number(s.fisico) || 0); });
      });
      if(typeof ocTransitoPorSku === 'function' && typeof ocTemDados === 'function' && ocTemDados()) ocTransitoPorSku().forEach((q, k) => { (mapa.get(k) || pega(k.toUpperCase())).caminho = q; });
      mapa.forEach(l => { const g = estoqueGalpao.find(x => esN(x.sku) === l.k), s = skus.find(x => esN(x.sku) === l.k);
        if(g) l.sku = g.sku; l.nome = (s && s.titulo) || (g && g.descricao !== g.sku && g.descricao) || '';
        l.custo = (g && Number(g.custo_medio) > 0 ? Number(g.custo_medio) : 0) || (s && Number(s.custo)) || 0;
        l.total = Object.values(l.por).reduce((a, v) => a + v, 0); });
      const b = esN(est.busca), todas = [...mapa.values()];
      const lista = todas.filter(l => !b || l.k.includes(b) || esN(l.nome).includes(b)).sort(estComparar(Object.assign({ sku: l => l.k, total: l => l.total, caminho: l => l.caminho, custo: l => l.custo, valor: l => Math.max(0, l.total) * l.custo }, Object.fromEntries(deps.map(d => ['d' + d.id, l => l.por[d.id] || 0]))),
        (a, c) => c.total * c.custo - a.total * a.custo || c.total - a.total));
      const un = todas.reduce((s, l) => s + Math.max(0, l.total), 0), valor = todas.reduce((s, l) => s + Math.max(0, l.total) * l.custo, 0), cam = todas.reduce((s, l) => s + l.caminho, 0);
      const somaDep = d => todas.reduce((s, l) => s + Math.max(0, l.por[d.id] || 0), 0);
      host.innerHTML = `<div class="pg-head"><div><div class="pg-title">Estoque</div><div class="pg-sub">Soma de todos os depósitos, produto a produto. O Full entra com os kits abertos nos componentes.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;"><button class="btn-out btn-sm" onclick="estAtualizarFull(this)">Atualizar o Full</button></div></div>
        ${est.erro ? `<div class="alert alert-danger">${esEsc(est.erro)}</div>` : ''}
        <div class="chips" style="margin-bottom:14px;"><button class="chip active">Total</button>${deps.map(d => `<button class="chip" onclick="est.dep=${d.id};estDesenhar();">${esEsc(d.nome)}</button>`).join('')}<button class="chip" onclick="estGerenciarDepositos()" title="Depósitos, regras e mapeamento dos anúncios">Configurar estoque</button></div>
        <div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Estoque total</div><div class="kpi-value">${esInt(un)} un.</div><div class="kpi-sub">${fmt(valor)} a custo médio</div></div>
          ${deps.map(d => `<div class="kpi ${d.tipo === 'full' ? 'k-frete' : 'k-mc'}" onclick="est.dep=${d.id};estDesenhar();" style="cursor:pointer;"><div class="kpi-label">${esEsc(d.nome)}</div><div class="kpi-value">${esInt(somaDep(d))} un.</div><div class="kpi-sub">${un ? Math.round(somaDep(d) / un * 100) : 0}% do total</div></div>`).join('')}
          <div class="kpi k-hoje"><div class="kpi-label">A caminho</div><div class="kpi-value">${esInt(cam)} un.</div><div class="kpi-sub">comprado e ainda não conferido</div></div>
        </div>
        <div class="card"><div class="sku-barra"><input type="text" id="est-busca" placeholder="Buscar por SKU ou nome" value="${esEsc(est.busca)}" oninput="estBuscar(this.value)"></div>
        <div class="est-sel-barra"><span id="est-sel-barra" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">${estSelHtml()}</span>${estLoteHtml()}</div>
        <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th style="width:34px;"><input type="checkbox" style="width:auto;" title="Marcar todos os que estão na tela" onchange="estMarcarTodos(this.checked)"></th><th style="width:48px;"></th>${estTh('sku', 'Produto')}${deps.map(d => estTh('d' + d.id, esEsc(d.nome), 1)).join('')}${estTh('total', 'Total', 1)}${estTh('caminho', 'A caminho', 1, 'Comprado e ainda não conferido')}${estTh('custo', 'Custo médio', 1)}${estTh('valor', 'Valor', 1)}</tr></thead><tbody>
          ${lista.length ? lista.map(l => `<tr><td><input type="checkbox" class="est-flag" data-k="${esEsc(l.k)}" style="width:auto;" ${estSel.has(l.k) ? 'checked' : ''} onchange="estMarcar(this.dataset.k, this.checked)"></td>${estFotoTd(l.k)}<td class="cp-prod" style="max-width:420px;"><b>${esEsc(l.sku)}</b><span title="${esEsc(l.nome)}">${esEsc(l.nome || '')}</span></td>
            ${deps.map(d => `<td class="num">${l.por[d.id] ? esInt(l.por[d.id]) : '<span class="text-muted">—</span>'}</td>`).join('')}
            <td class="num"><b>${esInt(l.total)}</b></td><td class="num">${l.caminho ? esInt(l.caminho) : '<span class="text-muted">—</span>'}</td>
            <td class="num">${l.custo ? fmt(l.custo) : '<span class="badge badge-warning">sem custo</span>'}</td><td class="num">${l.custo ? fmt(Math.max(0, l.total) * l.custo) : '—'}</td></tr>`).join('') : '<tr><td colspan="12"><div class="vazio"><b>Nada nesta lista</b>Troque a busca.</div></td></tr>'}
        </tbody></table></div></div>`;
    }

    let estBuscaT = null;
    function estBuscar(v){ est.busca = v; clearTimeout(estBuscaT); estBuscaT = setTimeout(() => { estDesenhar(); const i = document.getElementById('est-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }

    async function estAtualizarFull(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      if(typeof comprasFullAPI === 'function') await comprasFullAPI();
      estDesenhar();
    }

    // histórico de um produto no depósito aberto
    async function estMovimentos(k){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep) return;
      const r = await supa.from('estoque_mov').select('*').eq('usuario_id', usuarioAtual.id).eq('deposito_id', dep.id).eq('sku_norm', k).order('criado_em', { ascending: false }).limit(300);
      const mv = r.data || [];
      let saldo = estSaldoDe(dep.id, k);
      const dt = t => new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      const linhas = mv.map(m => { const depois = saldo; saldo -= Number(m.qtd); return `<tr><td>${dt(m.criado_em)}</td><td>${ES_MOTIVO[m.motivo] || m.motivo}${m.ref ? ` <span class="ap-parc">${esEsc(m.ref)}</span>` : ''}</td><td class="num ${Number(m.qtd) < 0 ? 'text-danger' : 'text-success'}"><b>${Number(m.qtd) > 0 ? '+' : ''}${esInt(m.qtd)}</b></td><td class="num">${esInt(depois)}</td><td class="text-muted" style="font-size:12px;white-space:normal;">${esEsc(m.obs || '')}</td></tr>`; }).join('');
      vmlModal(`${esEsc(k.toUpperCase())} — movimentações em ${esEsc(dep.nome)}`, mv.length ? `<div style="max-height:60vh;overflow:auto;"><table class="cp-tab"><thead><tr><th>Quando</th><th>Motivo</th><th class="num">Quantidade</th><th class="num">Saldo depois</th><th>Observação</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="vazio"><b>Sem movimentações</b>Este produto ainda não teve entrada nem saída neste depósito.</div>');
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }

    function estAjuste(){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep) return;
      vmlModal('Ajuste manual — ' + esEsc(dep.nome), `
        <div class="text-muted" style="margin-bottom:12px;">Use para corrigir um produto isolado. Para acertar vários de uma vez, faça uma contagem.</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">SKU</label><input type="text" id="est-aj-sku" list="est-aj-lista" placeholder="Ex.: J-2010-Branco"><datalist id="est-aj-lista">${estLinhas(dep).map(l => `<option value="${esEsc(l.sku)}">`).join('')}</datalist></div>
          <div class="form-group"><label class="form-label">Quantidade (use menos para tirar)</label><input type="number" id="est-aj-qtd" placeholder="Ex.: 10 ou -3"></div>
        </div>
        <div class="form-group"><label class="form-label">Motivo</label><input type="text" id="est-aj-obs" placeholder="Ex.: avaria, brinde, erro de lançamento"></div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="estAjusteSalvar()">Lançar ajuste</button>`);
    }
    async function estAjusteSalvar(){
      const sku = (document.getElementById('est-aj-sku').value || '').trim(), qtd = Number(document.getElementById('est-aj-qtd').value), obs = (document.getElementById('est-aj-obs').value || '').trim();
      if(!sku || !qtd){ alert('Informe o SKU e a quantidade.'); return; }
      if(!obs){ alert('Escreva o motivo do ajuste: ele fica no histórico do produto.'); return; }
      const r = await estMovimentar(est.dep, [{ sku, qtd, motivo: 'ajuste', obs }]);
      if(!r.ok){ alert('Não consegui lançar: ' + r.erro); return; }
      fecharModal('modal-vml'); estDesenhar();
    }

    // Carga pela Lista de Estoque da UpSeller: o físico de cada produto passa a ser o "Estoque Atual" da planilha.
    // Grava só a DIFERENÇA para o saldo atual (como uma contagem), e traz o custo médio.
    function estCargaPlanilha(){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep) return;
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls';
      inp.onchange = () => {
        const file = inp.files[0]; if(!file) return;
        const rd = new FileReader();
        rd.onload = async e => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
            if(!rows.length || !('SKU' in rows[0]) || !('Estoque Atual' in rows[0])){
              alert(rows.length && ('KIT SKU' in rows[0]) ? 'Esta é a lista de KITS. Preciso da Lista de Estoque de produtos: na UpSeller, Estoque → Lista de Estoque → aba SKU → Importar & Exportar.' : 'Este arquivo não parece ser a Lista de Estoque da UpSeller (faltam as colunas SKU e Estoque Atual).');
              return;
            }
            const armazens = [...new Set(rows.map(r => String(r['Armazém'] || '').trim()).filter(Boolean))];
            let armazem = '';
            if(armazens.length > 1){
              armazem = (prompt('A planilha tem mais de um armazém:\n' + armazens.join('\n') + '\n\nDigite o nome do armazém que corresponde a "' + dep.nome + '":', armazens[0]) || '').trim();
              if(!armazem) return;
            }
            const alvo = new Map();
            rows.forEach(r => { const sku = String(r.SKU || '').trim(); if(!sku) return; if(armazem && String(r['Armazém'] || '').trim() !== armazem) return;
              const k = esN(sku), a = alvo.get(k) || { sku, qtd: 0, custo: 0, titulo: String(r['Título'] || '').trim() };
              a.qtd += Number(r['Estoque Atual']) || 0; if(Number(r['Custo Médio']) > 0) a.custo = Number(r['Custo Médio']); alvo.set(k, a); });
            const mov = [], ref = 'planilha-' + new Date().toISOString().substring(0, 16);
            alvo.forEach((a, k) => { const dif = a.qtd - estSaldoDe(dep.id, k); if(dif) mov.push({ sku: a.sku, qtd: dif, motivo: est.saldo.some(s => Number(s.deposito_id) === dep.id) ? 'contagem' : 'carga_inicial', ref, obs: 'Lista de Estoque da UpSeller: ' + file.name }); });
            // produtos com saldo aqui e que não vieram na planilha ficam como estão (a planilha pode ser parcial)
            const maiores = mov.filter(m => Math.abs(m.qtd) > 0).length;
            if(!confirm('Planilha lida: ' + alvo.size + ' produtos.\n' + maiores + ' terão o estoque físico ajustado para o valor da planilha.\n\nAplicar em "' + dep.nome + '"?')) return;
            alvo.forEach((a, k) => { let g = estoqueGalpao.find(x => esN(x.sku) === k); if(!g){ g = { sku: a.sku, descricao: a.titulo || a.sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }; estoqueGalpao.push(g); } if(a.titulo) g.descricao = a.titulo; if(a.custo > 0) g.custo_medio = a.custo; g.data_atualizacao = getToday(); });
            const r = await estMovimentar(dep.id, mov);
            if(!r.ok){ alert('Não consegui gravar: ' + r.erro); return; }
            if(!mov.length && typeof salvar === 'function') salvar();
            estDesenhar();
            alert('Estoque de "' + dep.nome + '" atualizado: ' + r.n + ' produtos ajustados.');
          } catch(err){ alert('Não consegui ler o arquivo: ' + err.message); }
        };
        rd.readAsArrayBuffer(file);
      };
      inp.click();
    }
