// ===== OPINIÕES DOS COMPRADORES (aba da Análise de vendas) =====
// Nota média e textos das opiniões dos anúncios que mais vendem (função ml-opinioes, só leitura), com um botão que
// copia as opiniões junto de um pedido pronto para colar em qualquer IA. Nada aqui gasta crédito de IA do sistema.
// Usa os auxiliares de src/analise.js (an, anN, anE, anKpi, anTabela, anVazio) e gsAnuncio de src/gestao.js.
    let op = { chave: '', itens: null, erro: '', det: {}, lendo: '' };
    const OP_PEDIDO = `Você é especialista em anúncios de marketplace. Abaixo estão opiniões reais de compradores sobre o meu produto.
Use somente o que está nas opiniões e responda em português, de forma direta:
1) Os 5 principais problemas, com quantas vezes cada um aparece e um exemplo de frase do comprador.
2) Os 5 principais elogios, com quantas vezes cada um aparece.
3) O que mudar nas fotos, no título e na descrição do anúncio para evitar essas reclamações.
4) O que mudar no produto ou na embalagem.
5) Perguntas que a descrição deveria responder e hoje não responde.`;

    async function opCarregar(chave, conta){
      if(op.chave === chave && op.itens) return;
      op = { chave, itens: null, erro: '', det: {}, lendo: '' };
      const hoje = getToday();
      const r = await supa.rpc('vendas_ml_lucro_mlb', { p_de: addDias(hoje, -90), p_ate: hoje, p_conta: conta });
      if(op.chave !== chave) return;
      if(r.error){ op.erro = r.error.message; op.itens = []; return; }
      const top = (r.data || []).filter(x => /^MLB\d+$/.test(x.item_id || '') && Number(x.un) > 0).sort((a, b) => Number(b.un) - Number(a.un)).slice(0, 30);
      const porConta = {}; top.forEach(x => (porConta[x.ml_user_id] = porConta[x.ml_user_id] || []).push(x.item_id));
      const lidos = new Map();
      await Promise.all(Object.keys(porConta).map(async c => {
        try { const x = await supa.functions.invoke('ml-opinioes', { body: { conta: c, itens: porConta[c] } }); ((x.data && x.data.itens) || []).forEach(i => lidos.set(i.item_id, i)); if(x.data && x.data.error) op.erro = x.data.error; }
        catch(e){ op.erro = 'sem conexão com o Mercado Livre'; }
      }));
      if(op.chave !== chave) return;
      // anúncios do mesmo produto dividem as mesmas opiniões no Mercado Livre: viram uma linha só
      const juntos = new Map();
      top.map(x => { const o = lidos.get(x.item_id) || {}, n = o.niveis || [0, 0, 0, 0, 0], tot = n.reduce((s, v) => s + v, 0);
        return { ...x, un: Number(x.un), media: o.media || 0, total: o.total || tot, niveis: n, ruins: n[0] + n[1], neutras: n[2], pctRuim: tot ? (n[0] + n[1]) / tot * 100 : 0, opinioes: o.opinioes || [], semLeitura: !!o.erro || !lidos.has(x.item_id), anuncios: 1 }; })
        .forEach(i => { const k = i.total ? i.total + '|' + i.niveis.join(',') : i.item_id, j = juntos.get(k); if(j){ j.un += i.un; j.anuncios++; } else juntos.set(k, i); });
      op.itens = [...juntos.values()];
    }

    const opEstrelas = n => '★'.repeat(n) + '☆'.repeat(5 - n);
    function opTexto(it, lista){
      const L = lista.filter(o => (o.texto || o.titulo || '').trim());
      return 'PRODUTO: ' + (it.titulo || it.item_id) + (it.sku ? ' (SKU ' + it.sku + ')' : '') + '\nNota média ' + String(it.media).replace('.', ',') + ' em ' + it.total + ' opiniões. Por nota: 5★ ' + it.niveis[4] + ', 4★ ' + it.niveis[3] + ', 3★ ' + it.niveis[2] + ', 2★ ' + it.niveis[1] + ', 1★ ' + it.niveis[0] + '.\n'
        + L.map(o => '[' + o.nota + '★ ' + (o.data || '') + '] ' + [o.titulo, o.texto].filter(Boolean).join(' — ').replace(/\s+/g, ' ')).join('\n');
    }
    async function opCopiar(texto, bt){
      try { await navigator.clipboard.writeText(texto); if(bt){ const t = bt.textContent; bt.textContent = 'Copiado ✓'; setTimeout(() => { bt.textContent = t; }, 1800); } }
      catch(e){ if(typeof toast === 'function') toast('Não consegui copiar: selecione o texto e copie manualmente.'); }
    }
    function opCopiarTodos(bt){
      const L = (op.itens || []).filter(i => i.opinioes.length);
      opCopiar(OP_PEDIDO + '\nSão vários produtos: responda produto por produto e, no fim, o que se repete em todos.\n\n' + L.map(i => opTexto(i, i.opinioes.filter(o => o.nota <= 3).concat(i.opinioes.filter(o => o.nota > 3).slice(0, 15)))).join('\n\n'), bt);
    }
    // um anúncio: lê as opiniões de nota 1, 2 e 3 (as mais relevantes vêm quase todas com nota 5) e abre o detalhe
    async function opAbrir(id){
      const it = (op.itens || []).find(x => x.item_id === id); if(!it) return;
      if(!op.det[id]){
        op.lendo = id; anDesenhar();
        try { const x = await supa.functions.invoke('ml-opinioes', { body: { conta: it.ml_user_id, itens: [id], detalhe: true } }); const o = x.data && x.data.itens && x.data.itens[0]; op.det[id] = (o && o.opinioes) || it.opinioes; }
        catch(e){ op.det[id] = it.opinioes; }
        op.lendo = ''; anDesenhar();
      }
      const todas = op.det[id], comTexto = todas.filter(o => (o.texto || o.titulo || '').trim());
      const ruins = comTexto.filter(o => o.nota <= 2), neutras = comTexto.filter(o => o.nota === 3), boas = comTexto.filter(o => o.nota >= 4);
      const bloco = (titulo, L, max) => L.length ? `<div class="op-sec">${titulo} (${L.length})</div>` + L.slice(0, max).map(o => `<div class="op-it"><span class="op-est n${o.nota}">${opEstrelas(o.nota)}</span><small>${anE(o.data ? o.data.slice(8, 10) + '/' + o.data.slice(5, 7) + '/' + o.data.slice(0, 4) : '')}</small><div>${o.titulo ? '<b>' + anE(o.titulo) + '</b> ' : ''}${anE(o.texto)}</div></div>`).join('') + (L.length > max ? `<div class="text-muted" style="font-size:12px;">e mais ${L.length - max}. Todas vão no texto copiado.</div>` : '') : '';
      const maxN = Math.max(1, ...it.niveis);
      window._opTexto = OP_PEDIDO + '\n\n' + opTexto(it, ruins.concat(neutras, boas.slice(0, 60)));
      vmlModal('Opiniões: ' + anE(it.titulo || id), `
        <div class="op-topo"><div class="op-media"><b>${String(it.media).replace('.', ',')}</b><span>${it.total.toLocaleString('pt-BR')} opiniões</span></div>
          <div class="op-barras">${[5, 4, 3, 2, 1].map(n => `<div><span>${n}★</span><i><em style="width:${it.niveis[n - 1] / maxN * 100}%" class="n${n}"></em></i><small>${it.niveis[n - 1].toLocaleString('pt-BR')}</small></div>`).join('')}</div></div>
        <div class="text-muted" style="font-size:12.5px;margin:10px 0;line-height:1.5;">Li ${todas.length} das ${it.total} opiniões: as de nota 1, 2 e 3 e as 50 mais relevantes de nota alta; ${comTexto.length} têm texto. O botão copia as opiniões com um pedido pronto: é só colar no ChatGPT, no Claude ou na IA que você usa.</div>
        <div style="max-height:46vh;overflow:auto;">${bloco('Notas 1 e 2', ruins, 40)}${bloco('Nota 3', neutras, 20)}${bloco('Notas 4 e 5', boas, 12) || ''}${comTexto.length ? '' : '<div class="text-muted">Nenhuma opinião com texto.</div>'}</div>`,
        `<a class="btn-out btn" style="margin-right:auto;text-decoration:none;" href="https://produto.mercadolivre.com.br/MLB-${anE(String(id).replace(/D/g, ''))}-_JM" target="_blank" rel="noopener">Ver no Mercado Livre</a><button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="opCopiar(window._opTexto, this)">Copiar opiniões + pedido para a IA</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '820px';
    }

    function opCorpo(){
      if(!op.itens) return anVazio('Lendo as opiniões dos compradores no Mercado Livre…');
      const L = op.itens;
      if(!L.length) return anVazio(op.erro ? 'Não consegui ler: ' + anE(op.erro) : 'Nenhum anúncio com venda nos últimos 90 dias.');
      const T = L.reduce((s, i) => { s.t += i.total; s.r += i.ruins; s.n += i.neutras; s.soma += i.media * i.total; return s; }, { t: 0, r: 0, n: 0, soma: 0 });
      const olhar = L.filter(i => i.total >= 10 && (i.media < 4.5 || i.pctRuim >= 5));
      const corM = m => m >= 4.6 ? 'var(--success,#16a34a)' : m >= 4.3 ? 'var(--warning,#d97706)' : 'var(--danger)';
      return `
        <div class="kpi-grid k4i">
          ${anKpi('k-venda', 'Nota média', T.t ? anN(T.soma / T.t, 2) : '–', 'em ' + L.length + ' produtos que mais vendem')}
          ${anKpi('k-hoje', 'Opiniões', anN(T.t), 'somando todos')}
          ${anKpi('k-atraso', 'Notas 1 e 2', anN(T.r), anP(T.r, T.t, 1) + ' das opiniões · ' + anN(T.n) + ' com nota 3')}
          ${anKpi('k-mc', 'Anúncios para olhar', anN(olhar.length), 'média abaixo de 4,5 ou 5% de notas ruins')}
        </div>
        ${op.erro ? `<div class="alert alert-warning">Parte das opiniões não pôde ser lida (${anE(op.erro)}).</div>` : ''}
        <div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div class="card-title">O que os compradores dizem</div>
          <button class="btn-out btn btn-sm" onclick="opCopiarTodos(this)" title="Copia as opiniões de todos os anúncios da lista (todas as de nota até 3 e uma amostra das boas) com um pedido pronto para colar numa IA">Copiar tudo + pedido para a IA</button></div>
        ${anTabela(L, [
          { k: 'titulo', t: 'Anúncio', fmt: l => gsAnuncio(l, (l.anuncios > 1 ? ' e mais ' + (l.anuncios - 1) + ' anúncio' + (l.anuncios > 2 ? 's' : '') : '') + (l.semLeitura ? ' · <span class="text-muted">sem leitura</span>' : '')) },
          { k: 'un', t: 'Un. em 90 dias', num: 1, fmt: l => anN(l.un) },
          { k: 'media', t: 'Nota', num: 1, fmt: l => l.total ? `<b style="color:${corM(l.media)}">${anN(l.media, 1)}</b>` : '–' },
          { k: 'total', t: 'Opiniões', num: 1, fmt: l => anN(l.total) },
          { k: 'ruins', t: 'Notas 1 e 2', num: 1, fmt: l => l.ruins ? `<span style="color:var(--danger);font-weight:700;">${anN(l.ruins)}</span> <small class="text-muted">${anN(l.pctRuim, 1)}%</small>` : '–' },
          { k: 'neutras', t: 'Nota 3', num: 1, fmt: l => l.neutras ? anN(l.neutras) : '–' },
          { k: 'item_id', t: '', fmt: l => l.total ? `<button class="btn-out btn-sm" onclick="opAbrir('${anE(l.item_id)}')" ${op.lendo === l.item_id ? 'disabled' : ''}>${op.lendo === l.item_id ? 'Lendo…' : 'Ver e copiar'}</button>` : '' }
        ], 'ruins')}
        <div class="text-muted gs-nota" style="padding:12px 18px;font-size:12px;line-height:1.6;">Os 30 anúncios com mais unidades vendidas em 90 dias; anúncios do mesmo produto, que dividem as mesmas opiniões, aparecem numa linha só. As opiniões são do anúncio inteiro, desde que ele existe, não só do período. Em “Ver e copiar” o sistema lê as opiniões de nota 1, 2 e 3 do anúncio, que são as que mostram o que melhorar em foto, descrição, produto e embalagem.</div></div>`;
    }
