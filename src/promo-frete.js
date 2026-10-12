// ===== CENTRAL DE PROMOÇÕES (página "promocoes") e CONFERÊNCIA DE FRETE (página "frete") =====
// Promoções: leitura das promoções do Mercado Livre (Edge Function ml-promos) com a margem antes e depois.
//   Custo, imposto e tarifa: das vendas dos últimos 60 dias (RPC ml_itens_margem); sem venda recente, do cadastro
//   do produto e do próprio anúncio (ml-promos, ação base). Frete: tabela de frete para o preço e o peso tarifável.
//   Participar/sair fica para a próxima etapa.
// Frete: cada venda contra a tabela de custos de envio (RPC frete_conferencia_tab, tabela em frete_tabela).

    const pqE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pqN = (v, d) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
    async function pqFuncao(nome, corpo){
      const sd = await supa.auth.getSession(), tk = sd && sd.data && sd.data.session ? sd.data.session.access_token : '';
      const r = await fetch(SUPA_URL + '/functions/v1/' + nome, { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      return r.json().catch(() => ({ error: 'resposta inválida' }));
    }

    // ---------------------------------------------------------------- PROMOÇÕES
    const PM_TIPO = { DEAL: 'Campanha tradicional', MARKETPLACE_CAMPAIGN: 'Campanha com coparticipação', SMART: 'Campanha Smart', LIGHTNING: 'Oferta relâmpago', DOD: 'Oferta do dia', PRICE_DISCOUNT: 'Desconto individual', VOLUME: 'Desconto por volume', PRE_NEGOTIATED: 'Desconto pré-acordado', SELLER_CAMPAIGN: 'Campanha do vendedor', UNHEALTHY_STOCK: 'Liquidação de estoque Full', SELLER_COUPON_CAMPAIGN: 'Cupom do vendedor', PRICE_MATCHING: 'Preço competitivo', PRICE_MATCHING_MELI_ALL: 'Preço competitivo (100% ML)' };
    const PM_SIT = { candidate: 'Candidato', pending: 'Programado', started: 'Participando', finished: 'Encerrado' };
    let pm = { conta: '', promos: null, erro: '', sel: null, itens: [], total: 0, depois: null, sit: 'candidate', info: {}, base: {}, carregando: false };

    function pmConta(){ return contaAtiva || pm.conta || (contasML[0] && contasML[0].id) || ''; }
    async function pmRender(){
      const v = document.getElementById('view-promocoes'); if(!v) return;
      const c = pmConta();
      if(pm._c !== c){ pm._c = c; pm.promos = null; pm.sel = null; pm.itens = []; pm.erro = ''; }
      pmDesenhar();
      if(!c || pm.promos) return;
      let d; try { d = await pqFuncao('ml-promos', { acao: 'lista', conta: c }); } catch(e){ d = { error: 'sem conexão com o servidor' }; }
      if(pm._c !== c) return;
      if(d && d.demo){ pm.promos = []; pm.erro = 'Na demonstração a central de promoções fica desligada: ela lê as promoções direto da conta do Mercado Livre.'; }
      else if(!d || !d.ok){ pm.promos = []; pm.erro = (d && (d.motivo || d.error)) || 'não foi possível ler as promoções'; }
      else pm.promos = d.promos.filter(p => p.situacao !== 'finished');
      pmDesenhar();
    }
    function pmTrocarConta(id){ pm.conta = id; pmRender(); }
    async function pmAbrir(id, tipo){
      pm.sel = (pm.promos || []).find(p => p.id === id && p.tipo === tipo) || null; pm.itens = []; pm.depois = null; pm.total = 0;
      await pmMais(true);
    }
    function pmSit(s){ pm.sit = s; pm.itens = []; pm.depois = null; pm.total = 0; pmMais(true); }
    async function pmMais(primeira){
      if(!pm.sel || pm.carregando) return;
      pm.carregando = true; pmDesenhar();
      const c = pmConta(), sel = pm.sel;
      let d; try { d = await pqFuncao('ml-promos', { acao: 'itens', conta: c, id: sel.id, tipo: sel.tipo, situacao: pm.sit === 'todos' ? '' : pm.sit, depois: primeira ? null : pm.depois }); } catch(e){ d = { error: 'sem conexão' }; }
      pm.carregando = false;
      if(pm.sel !== sel) return;
      if(!d || !d.ok){ pm.erroItens = (d && (d.motivo || d.error)) || 'não foi possível ler os anúncios'; pmDesenhar(); return; }
      pm.erroItens = '';
      pm.itens = pm.itens.concat(d.itens); pm.total = d.total; pm.depois = d.depois;
      const faltam = d.itens.map(x => x.item).filter(i => !pm.info[i]);
      if(faltam.length){
        const r = await supa.rpc('ml_itens_margem', { p_itens: faltam, p_conta: c });
        (r.data || []).forEach(x => { pm.info[x.item_id] = x; });
        faltam.forEach(i => { if(!pm.info[i]) pm.info[i] = { vazio: true }; });
      }
      pmDesenhar();
      // dados do próprio anúncio (peso tarifável, tarifa, SKU, título): dão a margem mesmo sem venda recente
      const semBase = d.itens.map(x => x.item).filter(i => !pm.base[i]);
      if(semBase.length){
        try { await frTabela(); } catch(e){}
        for(let i = 0; i < semBase.length; i += 25){
          let b; try { b = await pqFuncao('ml-promos', { acao: 'base', conta: c, itens: semBase.slice(i, i + 25) }); } catch(e){ b = null; }
          ((b && b.itens) || []).forEach(x => { pm.base[x.item_id] = x; });
          if(pm.sel !== sel) return;
          pmDesenhar();
        }
        semBase.forEach(i => { if(!pm.base[i]) pm.base[i] = { vazio: true }; });
      }
    }
    // custo e imposto do cadastro de produtos, pelo SKU
    function pmCadastro(sku){
      const k = String(sku || '').trim().toUpperCase(); if(!k || typeof skus === 'undefined') return null;
      return skus.find(s => String(s.sku || '').trim().toUpperCase() === k) || null;
    }
    // margem de contribuição de um anúncio num preço (reb = parte do desconto paga pelo Mercado Livre)
    // Custo, imposto e tarifa: das vendas recentes; sem elas, do cadastro do produto e do anúncio.
    // Frete: o da tabela para ESTE preço (muda de faixa quando o preço cruza R$ 19, 49, 79...); sem peso lido, o das vendas.
    function pmMargem(item, preco, reb){
      const inf = pm.info[item] || {}, b = pm.base[item] || {}, cad = pmCadastro(inf.sku || b.sku);
      const custo = Number(inf.custo) > 0 ? Number(inf.custo) : (cad && Number(cad.custo) > 0 ? Number(cad.custo) : 0);
      if(!(custo > 0) || !(preco > 0)) return null;
      const t = inf.tarifa_pct != null ? Number(inf.tarifa_pct) : (b.tarifa_pct != null ? Number(b.tarifa_pct) : null);
      if(t == null) return null;
      const i = (inf.imposto_pct != null ? Number(inf.imposto_pct) : (cad ? Number(cad.imposto) || 0 : 0)) / 100;
      const ft = b.peso_g && typeof frFreteTabela === 'function' ? frFreteTabela(Number(b.peso_g), preco) : null;
      const f = ft != null ? ft : (inf.frete_un != null ? Number(inf.frete_un) : Number(b.frete_lista) || 0);
      const mc = preco - preco * t - preco * i - f - custo + (reb || 0);
      return { mc, pct: mc / preco * 100, frete: f, estimada: !(Number(inf.custo) > 0) };
    }
    function pmDesenhar(){
      const v = document.getElementById('view-promocoes'); if(!v || !v.classList.contains('active')) return;
      const c = pmConta(), hoje = getToday();
      const dm = s => s ? String(s).substring(8, 10) + '/' + String(s).substring(5, 7) : '';
      const lojas = contasML.length > 1 && !contaAtiva ? `<div class="seg">${contasML.map(x => `<button class="btn-toggle ${x.id === c ? 'active' : ''}" onclick="pmTrocarConta('${x.id}')">${pqE(x.apelido || x.id)}</button>`).join('')}</div>` : '';
      const cards = !c ? '<div class="vazio"><b>Conecte uma conta do Mercado Livre</b>As promoções são lidas direto da sua conta.</div>'
        : !pm.promos ? '<div class="vazio"><b>Lendo as promoções no Mercado Livre…</b></div>'
        : !pm.promos.length ? `<div class="vazio"><b>${pm.erro ? 'Não deu para ler as promoções' : 'Nenhuma promoção disponível agora'}</b>${pqE(pm.erro)}</div>`
        : `<div class="pm-cards">${pm.promos.map(p => { const fim = String(p.fim || '').substring(0, 10), resta = fim ? diasDif(hoje, fim) : null;
            return `<button class="pm-card ${pm.sel && pm.sel.id === p.id && pm.sel.tipo === p.tipo ? 'on' : ''}" onclick="pmAbrir('${pqE(p.id)}','${pqE(p.tipo)}')"><b>${pqE(p.nome || PM_TIPO[p.tipo] || p.tipo)}</b><span>${pqE(PM_TIPO[p.tipo] || p.tipo)}</span><small>${p.inicio ? dm(p.inicio) + ' a ' + dm(p.fim) : 'sem data de término'}${resta != null && resta >= 0 ? ' · <i class="' + (resta <= 3 ? 'pm-urg' : '') + '">' + (resta === 0 ? 'termina hoje' : resta + ' dia' + (resta === 1 ? '' : 's')) + '</i>' : ''}${p.situacao === 'pending' ? ' · ainda não começou' : ''}</small></button>`; }).join('')}</div>`;
      let tab = '';
      if(pm.sel){
        const linhas = pm.itens.map(x => {
          const b0 = pm.base[x.item] || {}, i0 = pm.info[x.item] || {}, inf = { ...i0, titulo: i0.titulo || b0.titulo, thumbnail: i0.thumbnail || b0.thumbnail, sku: i0.sku || b0.sku };
          const orig = x.original || Number(inf.preco_medio) || Number(b0.preco) || 0, promo = x.preco || 0;
          const reb = orig * (x.ml_pct || 0) / 100, m0 = pmMargem(x.item, orig, 0), m1 = promo ? pmMargem(x.item, promo, reb) : null;
          const desc = orig && promo ? (1 - promo / orig) * 100 : (x.ml_pct + x.vendedor_pct);
          const mcTxt = m => m ? `<b class="${m.mc >= 0 ? (m.pct < 10 ? 'pm-baixa' : 'mc-pos') : 'mc-neg'}">R$ ${pqN(m.mc)}</b><small title="Frete considerado: R$ ${pqN(m.frete)}${m.estimada ? '. Sem venda recente: custo e imposto vêm do cadastro do produto; tarifa e peso, do anúncio.' : ''}">${pqN(m.pct, 1)}%${m.estimada ? ' · pelo cadastro' : ''}</small>` : (!pm.base[x.item] ? '<small class="text-muted">lendo o anúncio…</small>' : '<small class="text-muted" title="Este produto está sem custo no cadastro (página Produtos). Com o custo preenchido, a margem aparece aqui.">sem custo no cadastro</small>');
          return `<tr>
            <td><div class="pm-an">${inf.thumbnail ? `<img src="${pqE(inf.thumbnail)}" loading="lazy" alt="">` : '<span class="pm-sem"></span>'}<div><b>${pqE(inf.titulo || x.item)}</b><small><a href="https://produto.mercadolivre.com.br/${pqE(String(x.item).replace(/^MLB/, 'MLB-'))}" target="_blank" rel="noopener">${pqE(x.item)}</a>${inf.sku ? ' · ' + pqE(inf.sku) : ''}${inf.vendas ? ' · ' + inf.vendas + ' vendas em 60 dias' : ''}</small></div></div></td>
            <td><span class="v-tag">${PM_SIT[x.situacao] || pqE(x.situacao)}</span></td>
            <td class="num">${x.ml_pct ? pqN(x.ml_pct, 1) + '%<small>R$ ' + pqN(reb) + '</small>' : '–'}</td>
            <td class="num">${x.vendedor_pct ? pqN(x.vendedor_pct, 1) + '%<small>R$ ' + pqN(orig * x.vendedor_pct / 100) + '</small>' : '–'}</td>
            <td class="num"><b>${desc ? pqN(desc, 1) + '%' : '–'}</b></td>
            <td class="num">${orig ? 'R$ ' + pqN(orig) : '–'}</td><td class="num pm-mc">${mcTxt(m0)}</td>
            <td class="num pm-promo">${promo ? 'R$ ' + pqN(promo) : '–'}</td><td class="num pm-mc pm-promo">${m1 ? mcTxt(m1) : (promo ? mcTxt(null) : '–')}</td>
          </tr>`; }).join('');
        tab = `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div><div class="card-title">${pqE(pm.sel.nome || PM_TIPO[pm.sel.tipo] || pm.sel.tipo)}</div><div class="pg-sub">${pm.itens.length} de ${pm.total} anúncio${pm.total === 1 ? '' : 's'} · custo, imposto e tarifa das suas vendas dos últimos 60 dias; sem venda recente, do cadastro do produto e do anúncio ${typeof dica === 'function' ? dica('Margem = preço − tarifa − imposto − frete − custo do produto, mais a parte do desconto que o Mercado Livre paga. O frete é o da tabela do Mercado Livre para o preço de cada coluna: quando a promoção leva o preço para outra faixa (R$ 49, R$ 79, R$ 100...), o frete muda junto.', true) : ''}</div></div>
            <div class="chips">${[['candidate', 'Candidatos'], ['pending', 'Programados'], ['started', 'Participando'], ['todos', 'Todos']].map(([k, t]) => `<button class="chip ${pm.sit === k ? 'active' : ''}" onclick="pmSit('${k}')">${t}</button>`).join('')}</div></div>
          ${pm.erroItens ? `<div class="alert alert-warning" style="margin:14px;">${pqE(pm.erroItens)}</div>` : ''}
          <div style="overflow-x:auto;"><table class="cp-tab pm-tab"><thead><tr><th>Anúncio</th><th>Situação</th><th class="num" title="Parte do desconto paga pelo Mercado Livre">ML paga</th><th class="num" title="Parte do desconto paga por você">Você paga</th><th class="num">Desconto</th><th class="num">Preço hoje</th><th class="num">Margem hoje</th><th class="num pm-promo">Preço na promoção</th><th class="num pm-promo">Margem na promoção</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="9" class="text-muted" style="text-align:center;padding:26px;">${pm.carregando ? 'Lendo os anúncios…' : 'Nenhum anúncio nesta situação.'}</td></tr>`}</tbody></table></div>
          ${pm.depois && pm.itens.length < pm.total ? `<div style="padding:14px;text-align:center;"><button class="btn-out btn btn-sm" onclick="pmMais()" ${pm.carregando ? 'disabled' : ''}>${pm.carregando ? 'Carregando…' : 'Carregar mais anúncios'}</button></div>` : ''}</div>`;
      }
      v.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Central de promoções</div><div class="pg-sub">Promoções do Mercado Livre para os seus anúncios, com a margem antes de participar. Por enquanto é só consulta: para entrar ou sair de uma promoção, use o Mercado Livre.</div></div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">${lojas}<button class="btn-out btn btn-sm" onclick="pm.promos=null;pm.sel=null;pmRender()">↻ Atualizar</button></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Promoções disponíveis</div><span class="text-muted" style="font-size:12px;">${c ? pqE(contaNome(c) || c) : ''} · clique numa promoção para ver os anúncios</span></div><div class="card-body">${cards}</div></div>
        ${tab}`;
    }

    // ---------------------------------------------------------------- CONFERÊNCIA DE FRETE
    // Cada venda (envio com um item só, sem Flex) é comparada com a tabela de custos de envio do Mercado Livre:
    //   frete devido = tabela[faixa de peso do anúncio][faixa do PREÇO DE VENDA] x quantidade
    // Faixa de peso = a em que o anúncio foi cobrado naquele dia/semana (o ML remede os produtos e o peso muda de um
    // dia para o outro; o "peso tarifável" lido no ML é o de hoje e serve de referência). RPC: frete_conferencia_tab.
    let fr = { dias: 30, de: '', ate: '', dados: null, vistos: null, erro: '', chave: '', ver: 'mais', motivo: 'todos', lendo: '', tab: null, medidas: null, todas: false, marc: new Set() };
    const FR_LOG = { fulfillment: 'Full', cross_docking: 'Coleta', xd_drop_off: 'Agência', drop_off: 'Correios' };
    const FR_FAIXA = ['até R$ 18,99', 'R$ 19 a R$ 48,99', 'R$ 49 a R$ 78,99', 'R$ 79 a R$ 99,99', 'R$ 100 a R$ 119,99', 'R$ 120 a R$ 149,99', 'R$ 150 a R$ 199,99', 'a partir de R$ 200'];
    const FR_MOTIVO = { preco: 'Faixa de preço errada', peso: 'Faixa de peso acima', multiplo: 'Cobrado em dobro ou triplo', outro: 'Outro valor' };
    const FR_MOTIVO_D = {
      preco: 'O frete cobrado é o de uma faixa de preço acima da do preço de venda. Pela regra do Mercado Livre, a faixa é definida pelo preço de venda do produto.',
      peso: 'A faixa de preço está certa, mas o frete cobrado é o de uma faixa de peso acima da que o anúncio vinha pagando naquele dia.',
      multiplo: 'O frete cobrado é exatamente duas, três ou quatro vezes o devido. Costuma acontecer quando o carrinho foi dividido ou cancelado em parte.',
      outro: 'O valor cobrado não é o devido e não se encaixa nos outros motivos. Vale olhar caso a caso.',
    };
    const FR_MENOS = { peso_menos: 'Faixa de peso abaixo', preco_menos: 'Faixa de preço abaixo', total: 'Várias unidades cobradas uma vez só', outro: 'Valor fora da tabela' };
    // tabela de frete por vigência: fr.tab[desde] = { rot: [rótulo da faixa de peso], v: [linha][faixa], ate: [peso máximo em g] }
    async function frTabela(){
      if(fr.tab) return fr.tab;
      const r = await supa.from('frete_tabela').select('desde,linha,rotulo,faixa,valor,peso_ate_g').limit(2000);
      const t = {}; (r.data || []).forEach(x => { const o = t[x.desde] || (t[x.desde] = { rot: [], v: [], ate: [] }); o.rot[x.linha] = x.rotulo; o.ate[x.linha] = Number(x.peso_ate_g); (o.v[x.linha] = o.v[x.linha] || [])[x.faixa] = Number(x.valor); });
      fr.tab = t; return t;
    }
    function frVersaoHoje(){ const ks = Object.keys(fr.tab || {}).sort(); return ks[ks.length - 1]; }
    function frLinhaDoPeso(g, versao){ const t = (fr.tab || {})[versao || frVersaoHoje()]; if(!t || !(g > 0)) return null; const i = t.ate.findIndex(x => g <= x); return i < 0 ? null : i; }
    function frFaixaDoPreco(p){ return [19, 49, 79, 100, 120, 150, 200].filter(x => p >= x).length; }
    // frete de tabela para um anúncio com esse peso tarifável vendido a esse preço (tabela de hoje)
    function frFreteTabela(pesoG, preco){ const t = (fr.tab || {})[frVersaoHoje()], l = frLinhaDoPeso(pesoG); return t && l != null && t.v[l] ? t.v[l][frFaixaDoPreco(preco)] : null; }
    function frPeriodo(){ if(fr.de && fr.ate) return { de: fr.de, ate: fr.ate }; const ate = getToday(); return { de: addDias(ate, -(fr.dias - 1)), ate }; }

    async function frRender(){
      const v = document.getElementById('view-frete'); if(!v) return;
      const conta = contaParam(), P = frPeriodo(), chave = (conta || '') + '|' + P.de + '|' + P.ate;
      if(fr.chave !== chave){ fr.chave = chave; fr.dados = null; fr.erro = ''; fr.lendo = ''; fr.todas = false; fr.marc = new Set(); }
      frDesenhar();
      if(fr.dados || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const de = P.de, ate = P.ate, vazio = { lista: [], menos: [], itens: [], resumo: {}, conferidas: 0, anuncios: 0 };
      try {
        await frTabela();
        // peso tarifável dos anúncios que ainda não foram lidos (na demonstração não há conta para consultar)
        if(!(typeof MODO_DEMO !== 'undefined' && MODO_DEMO)){
          const falta = await supa.rpc('frete_itens_sem_base', { p_de: de, p_ate: ate, p_conta: conta });
          const porConta = {}; (falta.data || []).forEach(x => (porConta[x.ml_user_id] = porConta[x.ml_user_id] || []).push(x.item_id));
          const total = (falta.data || []).length; let feitos = 0;
          for(const c of Object.keys(porConta)){
            for(let i = 0; i < porConta[c].length; i += 20){
              if(fr.chave !== chave) return;
              fr.lendo = 'Lendo no Mercado Livre o peso tarifável de ' + total + ' anúncio' + (total === 1 ? '' : 's') + '… ' + feitos + ' de ' + total; frDesenhar();
              try { await pqFuncao('ml-promos', { acao: 'base', conta: c, itens: porConta[c].slice(i, i + 20) }); } catch(e){}
              feitos += Math.min(20, porConta[c].length - i);
            }
          }
        }
        fr.lendo = 'Conferindo cada venda contra a tabela de frete…'; frDesenhar();
        const [a, c, m, bs] = await Promise.all([
          supa.rpc('frete_conferencia_tab', { p_de: de, p_ate: ate, p_conta: conta }),
          supa.from('frete_conferidos').select('order_id').eq('usuario_id', usuarioAtual.id).limit(20000),
          supa.from('frete_medidas').select('item_id,altura,largura,comprimento,peso_g').eq('usuario_id', usuarioAtual.id).limit(5000),
          supa.from('ml_itens_base').select('item_id,preco,decl_a,decl_l,decl_c,decl_g,ml_a,ml_l,ml_c,ml_g').eq('usuario_id', usuarioAtual.id).limit(5000)
        ]);
        fr.base = {}; ((bs && bs.data) || []).forEach(x => { fr.base[x.item_id] = x; });
        if(fr.chave !== chave) return;
        if(a.error){ fr.erro = a.error.message; fr.dados = vazio; } else fr.dados = a.data || vazio;
        fr.vistos = new Set((c.data || []).map(x => String(x.order_id)));
        fr.medidas = {}; (m.data || []).forEach(x => { fr.medidas[x.item_id] = x; });
      } catch(e){ fr.erro = (e && e.message) || String(e); fr.dados = vazio; fr.vistos = fr.vistos || new Set(); fr.medidas = fr.medidas || {}; }
      fr.lendo = ''; frDesenhar();
    }
    function frDias(d){ fr.dias = d; fr.de = ''; fr.ate = ''; frRender(); }
    function frDatas(){
      const a = (document.getElementById('fr-de') || {}).value, b = (document.getElementById('fr-ate') || {}).value;
      if(!a || !b || a > b){ if(typeof toast === 'function') toast('Escolha a data inicial e a final (a inicial não pode ser depois da final).'); return; }
      if(diasDif(a, b) > 120){ if(typeof toast === 'function') toast('O período máximo é de 120 dias.'); return; }
      fr.de = a; fr.ate = b; frRender();
    }
    async function frVisto(order, marcar){
      if(marcar){ fr.vistos.add(String(order)); fr.marc.delete(String(order)); await supa.from('frete_conferidos').upsert({ usuario_id: usuarioAtual.id, order_id: order }); }
      else { fr.vistos.delete(String(order)); await supa.from('frete_conferidos').delete().eq('usuario_id', usuarioAtual.id).eq('order_id', order); }
      frDesenhar();
    }
    function frClasse(x){ return x.classe === 'total' ? 'outro' : x.classe; }
    // vendas cobradas a mais, pelo motivo escolhido e por "aguardando" ou "todas"
    function frLista(){ const l = ((fr.dados && fr.dados.lista) || []).filter(x => fr.motivo === 'todos' || frClasse(x) === fr.motivo); return fr.todas ? l : l.filter(x => !fr.vistos.has(String(x.order_id))); }
    function frEscolhidas(){ const l = frLista(), m = l.filter(x => fr.marc.has(String(x.order_id))); return m.length ? m : l; }
    function frMarcar(order, on){ if(on) fr.marc.add(String(order)); else fr.marc.delete(String(order)); frDesenhar(); }
    function frMarcarTodas(on){ frLista().forEach(x => { if(on) fr.marc.add(String(x.order_id)); else fr.marc.delete(String(x.order_id)); }); frDesenhar(); }
    async function frVistoMarcadas(){
      const l = frEscolhidas().filter(x => !fr.vistos.has(String(x.order_id))); if(!l.length) return;
      l.forEach(x => { fr.vistos.add(String(x.order_id)); fr.marc.delete(String(x.order_id)); }); frDesenhar();
      for(let i = 0; i < l.length; i += 500) await supa.from('frete_conferidos').upsert(l.slice(i, i + 500).map(x => ({ usuario_id: usuarioAtual.id, order_id: x.order_id })));
    }
    // rótulos de uma venda: faixa de peso devida/cobrada e faixa de preço devida/cobrada
    function frRot(x){
      const t = (fr.tab || {})[x.versao] || { rot: [] };
      return { peso: x.ld != null ? t.rot[x.ld] || '' : '', pesoCob: x.linha_acima != null ? t.rot[x.linha_acima] || '' : '', faixa: FR_FAIXA[x.bv] || '', faixaCob: x.faixa_acima != null ? FR_FAIXA[x.faixa_acima] || '' : '',
        // o peso tarifável de hoje só é citado quando cai na mesma faixa em que o anúncio era cobrado no dia da venda
        pesoTxt: (x.peso_g && x.lp === x.ld ? pqN(x.peso_g, 0) + ' g · ' : '') + (x.ld != null ? t.rot[x.ld] || '' : '') };
    }
    function frDia(x){ return ptDate(typeof vmlDataBRT === 'function' ? vmlDataBRT(x.data_venda).dia : String(x.data_venda).substring(0, 10)); }
    // texto de contestação de uma venda: curto e com todos os números
    function frTexto(x){
      const r = frRot(x), q = Number(x.qtd) || 1, dev = Number(x.devido_un) * q;
      const un = q > 1 ? ' por unidade (' + q + ' unidades)' : '', devTxt = 'R$ ' + pqN(dev) + (q > 1 ? ' (' + q + ' x R$ ' + pqN(x.devido_un) + ')' : '');
      const peso = x.peso_g && x.lp === x.ld ? 'Peso tarifável do anúncio: ' + pqN(x.peso_g, 0) + ' g (faixa de peso ' + r.peso + ').' : 'Faixa de peso do anúncio: ' + r.peso + '.';
      const ini = 'Venda ' + x.order_id + ' (' + frDia(x) + '). Preço de venda: R$ ' + pqN(x.preco_unit) + un + ', faixa de preço ' + r.faixa + '. ' + peso + ' Pela tabela de custos de envio, o custo devido é ' + devTxt + '. ';
      const fim = ' Solicito o ressarcimento de R$ ' + pqN(x.dif) + '.', c = frClasse(x);
      if(c === 'preco') return ini + 'Foi cobrado R$ ' + pqN(x.frete) + ', que é o valor da faixa de preço ' + r.faixaCob + '. O preço de venda não está nessa faixa.' + fim;
      if(c === 'peso') return ini + 'Foi cobrado R$ ' + pqN(x.frete) + ', que é o valor da faixa de peso ' + r.pesoCob + ', acima da faixa do anúncio.' + fim;
      if(c === 'multiplo') return ini + 'Foi cobrado R$ ' + pqN(x.frete) + ', ' + Math.round(Number(x.frete) / dev) + ' vezes o valor devido, numa venda de ' + q + ' unidade' + (q > 1 ? 's' : '') + '.' + fim;
      return ini + 'Foi cobrado R$ ' + pqN(x.frete) + ', valor que não corresponde à tabela.' + fim;
    }
    function frCopiar(order, bt){
      const x = ((fr.dados && fr.dados.lista) || []).find(y => String(y.order_id) === String(order)); if(!x) return;
      const t = frTexto(x), ok = () => { if(bt){ const a = bt.textContent; bt.textContent = 'Copiado'; setTimeout(() => { bt.textContent = a; }, 1400); } };
      const janela = () => vmlModal('Texto da contestação', '<textarea style="width:100%;height:180px;">' + pqE(t) + '</textarea>');
      if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, janela); else janela();
    }
    // linhas do documento de contestação (uma por venda), na ordem: motivo, depois data
    function frDocLinhas(){
      const ord = { preco: 0, peso: 1, multiplo: 2, outro: 3 };
      return frEscolhidas().slice().sort((a, b) => ord[frClasse(a)] - ord[frClasse(b)] || String(a.data_venda).localeCompare(String(b.data_venda))).map(x => { const r = frRot(x), q = Number(x.qtd) || 1;
        return { x, venda: String(x.order_id), data: frDia(x), q, preco: Number(x.preco_unit), faixa: r.faixa, peso: r.pesoTxt, devido: Math.round(Number(x.devido_un) * q * 100) / 100, cobrado: Number(x.frete), dif: Number(x.dif), motivo: FR_MOTIVO[frClasse(x)], cobradoComo: frClasse(x) === 'preco' ? 'faixa de preço ' + r.faixaCob : frClasse(x) === 'peso' ? 'faixa de peso ' + r.pesoCob : frClasse(x) === 'multiplo' ? Math.round(Number(x.frete) / (Number(x.devido_un) * q)) + ' vezes o devido' : 'valor fora da tabela' }; });
    }
    function frDocTitulo(){ const P = frPeriodo(), c = contaParam(); return { loja: c ? ((typeof contaNome === 'function' && contaNome(c)) || c) : (contasML.length === 1 ? (contasML[0].apelido || contasML[0].id) : 'Todas as lojas'), periodo: ptDate(P.de) + ' a ' + ptDate(P.ate) }; }
    // Excel: uma aba só, uma linha por venda, com título, total e a coluna do texto de contestação
    function frExcel(){
      if(!fr.dados || typeof XLSX === 'undefined') return;
      const L = frDocLinhas(); if(!L.length){ if(typeof toast === 'function') toast('Não há vendas na lista para gerar o arquivo.'); return; }
      const T = frDocTitulo(), total = L.reduce((s, l) => s + l.dif, 0);
      const cab = ['Venda', 'Data', 'Qtd.', 'Preço de venda', 'Faixa de preço', 'Peso tarifado / faixa de peso', 'Frete devido', 'Frete cobrado', 'Diferença', 'Motivo', 'Cobrado como', 'Contestação'];
      const aoa = [['CONTESTAÇÃO DE CUSTO DE ENVIO'], [T.loja + ' · vendas de ' + T.periodo], [L.length + ' venda' + (L.length === 1 ? '' : 's') + ' · total a ressarcir: R$ ' + pqN(total)], [], cab]
        .concat(L.map(l => [l.venda, l.data, l.q, l.preco, l.faixa, l.peso, l.devido, l.cobrado, l.dif, l.motivo, l.cobradoComo, frTexto(l.x)]))
        .concat([['Total', '', '', '', '', '', Math.round(L.reduce((s, l) => s + l.devido, 0) * 100) / 100, Math.round(L.reduce((s, l) => s + l.cobrado, 0) * 100) / 100, Math.round(total * 100) / 100]]);
      const ws = XLSX.utils.aoa_to_sheet(aoa), fim = aoa.length;
      ws['!cols'] = [{ wch: 19 }, { wch: 11 }, { wch: 6 }, { wch: 15 }, { wch: 20 }, { wch: 27 }, { wch: 13 }, { wch: 14 }, { wch: 11 }, { wch: 26 }, { wch: 30 }, { wch: 110 }];
      ws['!merges'] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: 11 } }));
      ws['!autofilter'] = { ref: 'A5:L' + (fim - 1) };
      for(let r = 6; r <= fim; r++) ['D', 'G', 'H', 'I'].forEach(c => { const k = c + r; if(ws[k] && ws[k].t === 'n') ws[k].z = '"R$" #,##0.00'; });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Contestação de frete');
      XLSX.writeFile(wb, 'contestacao_frete_' + getToday() + '.xlsx');
    }
    // PDF: uma linha por venda, com cabeçalho, total e a regra aplicada no rodapé
    async function frPdf(bt){
      const L = frDocLinhas(); if(!L.length){ if(typeof toast === 'function') toast('Não há vendas na lista para gerar o arquivo.'); return; }
      const rot = bt ? bt.textContent : ''; if(bt){ bt.disabled = true; bt.textContent = 'Gerando…'; }
      try {
        const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem conexão')); document.head.appendChild(s); });
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        const T = frDocTitulo(), total = L.reduce((s, l) => s + l.dif, 0), n2 = v => 'R$ ' + pqN(v);
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20); doc.text('Contestação de custo de envio', 40, 46);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(95); doc.text(T.loja + '  ·  vendas de ' + T.periodo + '  ·  gerado em ' + ptDate(getToday()), 40, 63);
        const cx = [['Vendas contestadas', String(L.length)], ['Frete devido', n2(L.reduce((s, l) => s + l.devido, 0))], ['Frete cobrado', n2(L.reduce((s, l) => s + l.cobrado, 0))], ['Total a ressarcir', n2(total)]], w = (W - 80 - 30) / 4;
        cx.forEach((c, i) => { const x = 40 + i * (w + 10); doc.setDrawColor(225); doc.setFillColor(248, 249, 252); doc.roundedRect(x, 76, w, 44, 6, 6, 'FD'); doc.setFillColor(...(i === 3 ? [220, 38, 38] : [79, 70, 229])); doc.rect(x, 76, 4, 44, 'F');
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110); doc.text(c[0].toUpperCase(), x + 14, 92); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(20); doc.text(c[1], x + 14, 110); });
        doc.autoTable({ startY: 134, margin: { left: 40, right: 40, bottom: 46 },
          head: [['Venda', 'Data', 'Qtd.', 'Preço de venda', 'Faixa de preço', 'Peso tarifado / faixa de peso', 'Frete devido', 'Frete cobrado', 'Diferença', 'Motivo']],
          // embaixo de cada venda vai o texto da contestação: o Mercado Livre lê venda a venda
          body: L.flatMap(l => [[l.venda, l.data, l.q, n2(l.preco), l.faixa, l.peso, n2(l.devido), n2(l.cobrado), n2(l.dif), l.motivo],
            [{ content: 'Contestação: ' + frTexto(l.x), colSpan: 10, styles: { fontSize: 8, textColor: [70, 72, 85], fillColor: [247, 247, 252], cellPadding: { top: 3, right: 6, bottom: 7, left: 6 } } }]]),
          foot: [['Total', '', '', '', '', '', n2(L.reduce((s, l) => s + l.devido, 0)), n2(L.reduce((s, l) => s + l.cobrado, 0)), n2(total), '']],
          styles: { fontSize: 8.5, cellPadding: 5, valign: 'middle', lineColor: [232, 233, 240], lineWidth: 0.5 }, headStyles: { fillColor: [79, 70, 229], textColor: 255, fontSize: 8.5 }, footStyles: { fillColor: [240, 241, 246], textColor: 20, fontStyle: 'bold' },
          showFoot: 'lastPage', rowPageBreak: 'avoid',
          columnStyles: { 0: { cellWidth: 92 }, 1: { cellWidth: 54 }, 2: { halign: 'center', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 62 }, 6: { halign: 'right', cellWidth: 58 }, 7: { halign: 'right', cellWidth: 60 }, 8: { halign: 'right', cellWidth: 56, fontStyle: 'bold', textColor: [200, 30, 30] }, 9: { cellWidth: 150 } },
          didDrawPage: () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(125);
            doc.text('Frete devido = tabela de custos de envio do Mercado Livre, na faixa do preço de venda e na faixa de peso do anúncio, vezes a quantidade vendida.', 40, H - 26);
            doc.text('Página ' + doc.internal.getNumberOfPages(), W - 40, H - 26, { align: 'right' }); } });
        doc.save('contestacao_frete_' + getToday() + '.pdf');
      } catch(e){ if(typeof toast === 'function') toast('Não consegui gerar o PDF: ' + ((e && e.message) || e)); }
      if(bt){ bt.disabled = false; bt.textContent = rot; }
    }
    // pacote que o Mercado Livre registrou naquele envio: medidas do produto, do pacote e quanto do pacote é desta venda
    async function frPacote(order){
      if(typeof vmlModal !== 'function') return;
      vmlModal('Pacote da venda #' + order, '<div class="vazio">Lendo o envio no Mercado Livre…</div>');
      let d; try { d = await pqFuncao('ml-venda', { acao: 'detalhe', pedido: order }); } catch(e){ d = null; }
      const e = d && d.entrega;
      if(!e){ vmlModal('Pacote da venda #' + order, '<div class="alert alert-warning">Não consegui ler o envio desta venda agora.</div>'); return; }
      const l = (a, b) => `<div class="vd-l"><span class="text-muted">${a}</span><b>${b}</b></div>`;
      const cub = (a, b, c) => a * b * c / 6000, it = e.item, div = it && it.parte != null && it.parte < 99.5;
      const med = o => o.altura + ' × ' + o.largura + ' × ' + o.comprimento + ' cm · ' + pqN(o.peso, 0) + ' g · peso cúbico ' + pqN(cub(o.altura, o.largura, o.comprimento), 2) + ' kg';
      vmlModal('Pacote da venda #' + order, `${div ? `<div class="alert alert-info">Este pacote foi dividido com outra venda: a sua parte é <b>${pqN(it.parte, 1)}%</b> do valor do pacote. Pela regra do Mercado Livre o custo de envio é por venda, não por pacote, então isso não deveria mudar o que você paga.</div>` : ''}
        <div class="vd-cols">${it ? l('Seu produto neste envio', med(it)) : ''}${l('Pacote que saiu', med(e))}${l('Valor do pacote inteiro', 'R$ ' + pqN(e.valor_declarado))}${l('Envio', '#' + pqE(e.envio))}${l('Tipo', FR_LOG[e.tipo] || pqE(e.tipo))}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:12px;line-height:1.5;">São as medidas que o Mercado Livre registrou neste envio. O peso que ele usa para cobrar (peso tarifável) é por anúncio, não por envio, e aparece na lista "Por anúncio".</div>`);
    }
    // janela de peso e medidas conferidos na expedição (opcional)
    function frMedidas(item){
      const it = ((fr.dados && fr.dados.itens) || []).find(x => x.item_id === item) || {}, m = (fr.medidas || {})[item] || {};
      const campo = (id, rot, v, un) => `<div class="form-group" style="margin:0;"><label for="fr-m-${id}">${rot}</label><input type="number" min="0" step="0.1" id="fr-m-${id}" value="${v == null ? '' : v}" placeholder="${un}" oninput="frMedidasConta('${pqE(item)}')"></div>`;
      vmlModal('Peso e medidas conferidos · ' + pqE(it.sku || item), `<div class="text-muted" style="font-size:13px;line-height:1.5;margin-bottom:14px;">Opcional. Informe o pacote pronto para envio, como sai da sua expedição. Serve para comparar com o peso tarifável do Mercado Livre${it.peso_g ? ' (<b>' + pqN(it.peso_g, 0) + ' g</b> hoje)' : ''} e ver se vale pedir uma nova medição.</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">${campo('a', 'Altura (cm)', m.altura, 'cm')}${campo('l', 'Largura (cm)', m.largura, 'cm')}${campo('c', 'Comprimento (cm)', m.comprimento, 'cm')}${campo('p', 'Peso (g)', m.peso_g, 'g')}</div>
        <div id="fr-m-res" style="margin-top:14px;font-size:13.5px;line-height:1.55;"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button>${m.item_id ? `<button class="btn-out btn" onclick="frMedidasSalvar('${pqE(item)}', true)">Apagar</button>` : ''}<button class="btn" onclick="frMedidasSalvar('${pqE(item)}')">Guardar</button>`);
      frMedidasConta(item);
    }
    function frMedidasLer(){ const n = id => { const e = document.getElementById('fr-m-' + id); return e && e.value !== '' ? Number(e.value) : null; }; return { altura: n('a'), largura: n('l'), comprimento: n('c'), peso_g: n('p') }; }
    function frPesoMeu(m){ if(!m) return null; const cub = m.altura > 0 && m.largura > 0 && m.comprimento > 0 ? m.altura * m.largura * m.comprimento / 6 : 0; const g = Math.max(cub, Number(m.peso_g) || 0); return g > 0 ? g : null; }
    function frMedidasConta(item){
      const el = document.getElementById('fr-m-res'); if(!el) return;
      const it = ((fr.dados && fr.dados.itens) || []).find(x => x.item_id === item) || {}, m = frMedidasLer(), g = frPesoMeu(m), t = (fr.tab || {})[frVersaoHoje()] || { rot: [] };
      if(!g){ el.innerHTML = '<span class="text-muted">Preencha as três medidas ou o peso para ver a faixa da tabela.</span>'; return; }
      const lm = frLinhaDoPeso(g), lml = frLinhaDoPeso(Number(it.peso_g) || 0);
      el.innerHTML = `Peso que conta para o frete (o maior entre o peso e o peso cúbico): <b>${pqN(g, 0)} g</b>, faixa <b>${pqE(t.rot[lm] || '')}</b>.` + (lml != null ? `<br>Peso tarifável no Mercado Livre: <b>${pqN(it.peso_g, 0)} g</b>, faixa <b>${pqE(t.rot[lml] || '')}</b>. ` + (lm < lml ? '<b class="text-danger">A sua medida cai numa faixa menor: vale pedir ao Mercado Livre uma nova medição deste produto.</b>' : lm > lml ? '<b class="text-success">O Mercado Livre está cobrando numa faixa menor que a da sua medida.</b>' : 'As duas caem na mesma faixa.') : '');
    }
    async function frMedidasSalvar(item, apagar){
      if(apagar){ await supa.from('frete_medidas').delete().eq('usuario_id', usuarioAtual.id).eq('item_id', item); delete fr.medidas[item]; }
      else { const m = frMedidasLer(); if(!frPesoMeu(m)){ if(typeof toast === 'function') toast('Preencha as três medidas ou o peso.'); return; }
        const r = await supa.from('frete_medidas').upsert({ usuario_id: usuarioAtual.id, item_id: item, ...m, atualizado: new Date().toISOString() });
        if(r.error){ if(typeof toast === 'function') toast('Não consegui guardar: ' + r.error.message); return; } fr.medidas[item] = { item_id: item, ...m }; }
      fecharModal('modal-vml'); frDesenhar();
    }
    function frDesenhar(){
      const v = document.getElementById('view-frete'); if(!v || !v.classList.contains('active')) return;
      const P = frPeriodo(), perso = !!(fr.de && fr.ate);
      const cab = `<div class="pg-head"><div><div class="pg-title">Conferência de frete</div><div class="pg-sub">Cada venda é comparada com a tabela de custos de envio do Mercado Livre: faixa do preço de venda e faixa de peso do anúncio. O Flex e os envios com mais de um produto ficam de fora.</div></div>
        <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;"><div class="seg">${[30, 60, 90].map(d => `<button class="btn-toggle ${!perso && fr.dias === d ? 'active' : ''}" onclick="frDias(${d})">${d} dias</button>`).join('')}</div>
        <div class="fr-datas ${perso ? 'on' : ''}" title="Escolha um período (até 120 dias)"><input type="date" id="fr-de" aria-label="Data inicial" value="${P.de}" max="${getToday()}"><span>a</span><input type="date" id="fr-ate" aria-label="Data final" value="${P.ate}" max="${getToday()}"><button class="btn-out btn btn-sm" onclick="frDatas()">Aplicar</button></div></div></div>`;
      if(!fr.dados){ v.innerHTML = cab + `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>${pqE(fr.lendo || 'Conferindo o frete das vendas…')}</b></div></div>`; return; }
      const d = fr.dados, R = d.resumo || {}, cl = k => R[k] || { n: 0, mais: 0, menos: 0, n_mais: 0, n_menos: 0 };
      const dh = s => { const x = typeof vmlDataBRT === 'function' ? vmlDataBRT(s) : { dia: String(s).substring(0, 10), hora: '' }; return ptDate(x.dia).substring(0, 5) + ' ' + x.hora; };
      const loja = x => contasML.length > 1 && !contaAtiva ? `<span class="v-tag conta">${pqE(contaNome(x.ml_user_id) || '')}</span> ` : '';
      const tudoMais = d.lista || [], abertas = tudoMais.filter(x => !fr.vistos.has(String(x.order_id))), soma = l => l.reduce((s, x) => s + Number(x.dif), 0);
      const ks = Object.keys(R), favor = ks.reduce((s, k) => s + (Number(R[k].menos) || 0), 0), nFavor = ks.reduce((s, k) => s + (Number(R[k].n_menos) || 0), 0), totMais = ks.reduce((s, k) => s + (Number(R[k].mais) || 0), 0);
      const pctCerto = d.conferidas ? cl('certo').n / d.conferidas * 100 : 0, t0 = (fr.tab || {})[frVersaoHoje()] || { rot: [] };
      let corpo = '', sub = '';
      if(fr.ver === 'menos'){
        const l = d.menos || [];
        sub = 'Vendas em que o Mercado Livre cobrou menos que a tabela. Não entram na contestação; estão aqui para você ter o quadro completo.';
        corpo = `<div style="overflow-x:auto;max-height:560px;overflow-y:auto;"><table class="cp-tab"><thead><tr><th>Venda</th><th>Produto</th><th class="num">Qtd.</th><th class="num">Preço de venda</th><th class="num">Frete devido</th><th class="num">Cobrado</th><th class="num">A seu favor</th><th>O que houve</th></tr></thead><tbody>
          ${l.length ? l.map(x => `<tr><td>${loja(x)}<a href="https://www.mercadolivre.com.br/vendas/${x.order_id}/detalhe" target="_blank" rel="noopener">#${x.order_id}</a><br><small class="text-muted">${dh(x.data_venda)} · ${FR_LOG[x.logistic_type] || ''}</small></td><td><b>${pqE(x.sku || x.item_id)}</b></td><td class="num">${x.qtd}</td><td class="num">R$ ${pqN(x.preco_unit)}</td><td class="num">R$ ${pqN(Number(x.devido_un) * x.qtd)}</td><td class="num"><b>R$ ${pqN(x.frete)}</b></td><td class="num"><b class="text-success">R$ ${pqN(-x.dif)}</b></td><td>${FR_MENOS[x.classe] || ''}</td></tr>`).join('') : '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:26px;">Nenhuma venda cobrada a menos no período.</td></tr>'}
          </tbody></table></div>${l.length >= 300 ? '<div class="text-muted" style="font-size:12px;padding:10px 18px;">Mostrando as 300 maiores diferenças.</div>' : ''}`;
      } else if(fr.ver === 'anuncios'){
        // peso que conta para o frete: o maior entre o peso e o peso cúbico (altura x largura x comprimento / 6, em gramas)
        const conta = (a, l, c, g) => { const cub = a > 0 && l > 0 && c > 0 ? a * l * c / 6 : 0, t = Math.max(cub, Number(g) || 0); return t > 0 ? { g: t, cub, linha: frLinhaDoPeso(t) } : null; };
        const cel = (a, l, c, g, k) => k ? `${pqN(a, 1)} × ${pqN(l, 1)} × ${pqN(c, 1)} cm · ${pqN(g, 0)} g<br><small class="text-muted">conta ${pqN(k.g / 1000, 2)} kg · faixa ${pqE(t0.rot[k.linha] || '')}</small>` : '<small class="text-muted">não informado</small>';
        const l = (d.itens || []).map(x => { const b = (fr.base || {})[x.item_id] || {}, dc = conta(b.decl_a, b.decl_l, b.decl_c, b.decl_g), ml = conta(b.ml_a, b.ml_l, b.ml_c, b.ml_g), m = (fr.medidas || {})[x.item_id], eu = m ? conta(m.altura, m.largura, m.comprimento, m.peso_g) : null;
          // a referência para "o que deveria ser" é a sua medida conferida; sem ela, a medida do próprio ML
          const ref = eu || ml, fx = frFaixaDoPreco(Number(b.preco) || 0), tv = (fr.tab || {})[frVersaoHoje()];
          const eco = dc && ref && tv && ref.linha < dc.linha && tv.v[dc.linha] && tv.v[ref.linha] ? tv.v[dc.linha][fx] - tv.v[ref.linha][fx] : 0;
          return { x, b, dc, ml, eu, eco, ecoTot: eco * (Number(x.vendas) || 0) }; }).sort((a, b) => b.ecoTot - a.ecoTot || b.x.vendas - a.x.vendas);
        const ecoSoma = l.reduce((s, y) => s + y.ecoTot, 0), nEco = l.filter(y => y.eco > 0).length;
        sub = 'O frete é cobrado pelo maior entre o peso e o peso cúbico (altura × largura × comprimento ÷ 6.000). O Mercado Livre usa as medidas que estão declaradas no anúncio. Quando a medida declarada é maior que a que o próprio Mercado Livre mediu, corrigir o anúncio baixa o frete de todas as vendas seguintes.';
        corpo = (nEco ? `<div class="alert alert-warning" style="margin:0 18px 14px;"><b>${nEco} anúncio${nEco > 1 ? 's estão' : ' está'} com a medida declarada maior que a medida real.</b> Com as vendas deste período, corrigir essas medidas economizaria cerca de <b>R$ ${pqN(ecoSoma)}</b>. Os anúncios estão no topo da lista.</div>` : '') +
          `<div style="overflow-x:auto;max-height:620px;overflow-y:auto;"><table class="cp-tab"><thead><tr><th>Anúncio</th><th title="Medidas da embalagem informadas no anúncio. É com elas que o frete é calculado.">Declarado no anúncio</th><th title="Medidas que o Mercado Livre registrou ao medir o produto">Medido pelo Mercado Livre</th><th>Sua conferência</th><th class="num">Vendas</th><th class="num">Frete certo</th><th class="num" title="Diferença de frete por venda entre a faixa da medida declarada e a da medida real, no preço atual do anúncio">Economia por venda</th><th class="num">No período</th><th></th></tr></thead><tbody>
          ${l.length ? l.map(({ x, b, dc, ml, eu, eco, ecoTot }) => `<tr><td>${loja(x)}<b>${pqE(x.sku || x.item_id)}</b><br><small class="text-muted"><a href="https://produto.mercadolivre.com.br/${pqE(String(x.item_id).replace(/^MLB/, 'MLB-'))}" target="_blank" rel="noopener">${pqE(x.item_id)}</a>${x.faixas_no_periodo > 1 ? ' · mudou de faixa no período' : ''}</small></td>
              <td>${cel(b.decl_a, b.decl_l, b.decl_c, b.decl_g, dc)}</td><td>${cel(b.ml_a, b.ml_l, b.ml_c, b.ml_g, ml)}</td>
              <td>${eu ? `${pqN(eu.g / 1000, 2)} kg<br><small class="text-muted">faixa ${pqE(t0.rot[eu.linha] || '')}</small>` : '<small class="text-muted">não informada</small>'}</td>
              <td class="num">${pqN(x.vendas, 0)}</td><td class="num">${x.vendas ? pqN(x.certas / x.vendas * 100, 0) + '%' : '—'}</td>
              <td class="num">${eco > 0 ? `<b class="text-danger">R$ ${pqN(eco)}</b>` : '—'}</td><td class="num">${ecoTot > 0 ? `<b class="text-danger">R$ ${pqN(ecoTot)}</b>` : '—'}</td>
              <td><button class="btn-out btn btn-sm" onclick="frMedidas('${pqE(x.item_id)}')" title="Informe o peso e as medidas da embalagem conferidos na sua expedição">${eu ? 'Editar conferência' : 'Informar conferência'}</button></td></tr>`).join('') : '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:26px;">Nenhum anúncio com venda no período.</td></tr>'}
          </tbody></table></div>`;
      } else {
        const lista = frLista(), mostra = lista.slice(0, 300), esc = frEscolhidas(), nMarc = lista.filter(x => fr.marc.has(String(x.order_id))).length, todasMarc = lista.length > 0 && nMarc === lista.length;
        const base = fr.todas ? tudoMais : abertas, cont = k => base.filter(x => k === 'todos' || frClasse(x) === k);
        sub = fr.motivo === 'todos' ? 'Vendas em que o frete cobrado ficou acima da tabela. Marque as que quer contestar e gere o PDF ou o Excel; sem nenhuma marcada, o arquivo leva todas as da lista.' : FR_MOTIVO_D[fr.motivo];
        corpo = `<div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;padding:0 18px 12px;justify-content:space-between;">
            <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
              <select aria-label="Motivo" onchange="fr.motivo=this.value;frDesenhar()" style="width:auto;">${[['todos', 'Todos os motivos']].concat(Object.entries(FR_MOTIVO)).map(([k, t]) => `<option value="${k}" ${fr.motivo === k ? 'selected' : ''}>${t} (${cont(k).length})</option>`).join('')}</select>
              <div class="chips"><button class="chip ${!fr.todas ? 'active' : ''}" onclick="fr.todas=false;frDesenhar()" title="Vendas que você ainda não marcou como conferidas">Aguardando<span class="n">${abertas.length}</span></button><button class="chip ${fr.todas ? 'active' : ''}" onclick="fr.todas=true;frDesenhar()">Todas<span class="n">${tudoMais.length}</span></button></div></div>
            <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;"><span class="text-muted" style="font-size:12.5px;">${nMarc ? nMarc + ' marcada' + (nMarc > 1 ? 's' : '') : 'nenhuma marcada: vale a lista toda'} · <b>R$ ${pqN(soma(esc))}</b></span>
              <button class="btn btn-sm" onclick="frPdf(this)" ${esc.length ? '' : 'disabled'} title="PDF com uma linha por venda, para enviar ao Mercado Livre">Gerar PDF (${esc.length})</button>
              <button class="btn-out btn btn-sm" onclick="frExcel()" ${esc.length ? '' : 'disabled'} title="Planilha com uma linha por venda e o texto de contestação">Gerar Excel (${esc.length})</button>
              <button class="btn-out btn btn-sm" onclick="frVistoMarcadas()" ${esc.some(x => !fr.vistos.has(String(x.order_id))) ? '' : 'disabled'} title="Tira da lista de aguardando as vendas marcadas (ou todas da lista)">Marcar como conferidas</button></div></div>
          <div style="overflow-x:auto;max-height:580px;overflow-y:auto;"><table class="cp-tab"><thead><tr><th style="width:34px;"><input type="checkbox" style="width:auto;" aria-label="Marcar todas" ${todasMarc ? 'checked' : ''} onchange="frMarcarTodas(this.checked)"></th><th>Venda</th><th>Produto</th><th class="num">Qtd.</th><th class="num">Preço de venda</th><th>Faixa de preço</th><th>Faixa de peso</th><th class="num">Frete devido</th><th class="num">Cobrado</th><th class="num">Diferença</th><th>Motivo</th><th></th></tr></thead><tbody>
          ${mostra.length ? mostra.map(x => { const visto = fr.vistos.has(String(x.order_id)), r = frRot(x), q = Number(x.qtd) || 1;
            return `<tr class="${visto ? 'fr-visto' : ''}"><td><input type="checkbox" style="width:auto;" aria-label="Marcar a venda ${x.order_id}" ${fr.marc.has(String(x.order_id)) ? 'checked' : ''} onchange="frMarcar('${x.order_id}', this.checked)"></td>
              <td>${loja(x)}<a href="https://www.mercadolivre.com.br/vendas/${x.order_id}/detalhe" target="_blank" rel="noopener" title="Abrir a venda no Mercado Livre">#${x.order_id}</a><br><small class="text-muted">${dh(x.data_venda)} · ${FR_LOG[x.logistic_type] || ''}</small></td>
              <td><b>${pqE(x.sku || x.item_id)}</b></td><td class="num">${q}</td><td class="num">R$ ${pqN(x.preco_unit)}</td>
              <td>${pqE(r.faixa)}${r.faixaCob ? `<br><small class="text-danger">cobrado: ${pqE(r.faixaCob)}</small>` : ''}</td>
              <td>${pqE(r.pesoTxt)}${r.pesoCob ? `<br><small class="text-danger">cobrado: ${pqE(r.pesoCob)}</small>` : ''}</td>
              <td class="num">R$ ${pqN(Number(x.devido_un) * q)}</td><td class="num"><b>R$ ${pqN(x.frete)}</b></td><td class="num"><b class="text-danger">+R$ ${pqN(x.dif)}</b></td>
              <td><span class="v-tag">${FR_MOTIVO[frClasse(x)]}</span></td>
              <td style="white-space:nowrap;"><button class="btn-out btn btn-sm" onclick="frCopiar('${x.order_id}', this)" title="Copia o texto de contestação desta venda, para colar no chat do Mercado Livre">Copiar texto</button> <button class="btn-out btn btn-sm" onclick="frPacote('${x.order_id}')" title="Medidas que o Mercado Livre registrou neste envio">Pacote</button> <button class="btn-out btn btn-sm" onclick="frVisto('${x.order_id}', ${!visto})">${visto ? 'Desfazer' : 'Já conferi'}</button></td></tr>`; }).join('')
            : `<tr><td colspan="12" class="text-muted" style="text-align:center;padding:26px;">${tudoMais.length ? 'Nada aguardando neste filtro.' : 'Nenhuma venda cobrada acima da tabela no período.'}</td></tr>`}
          </tbody></table></div>${lista.length > mostra.length ? `<div class="text-muted" style="font-size:12px;padding:10px 18px;">Mostrando ${mostra.length} de ${lista.length}. O PDF e o Excel levam todas.</div>` : ''}`;
      }
      const chip = (k, t, n, rs) => `<button class="chip ${fr.ver === k ? 'active' : ''}" onclick="fr.ver='${k}';frDesenhar()">${t}<span class="n">${n}</span>${rs != null ? ' · R$ ' + pqN(rs) : ''}</button>`;
      v.innerHTML = cab + `
        ${fr.erro ? `<div class="alert alert-danger">Não consegui conferir: ${pqE(fr.erro)}</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Vendas conferidas</div><div class="kpi-value">${pqN(d.conferidas, 0)}</div><div class="kpi-sub"><span><b>${pqN(pctCerto, 0)}%</b> com o frete certo</span><span>${pqN(d.fora, 0)} com mais de um produto, de fora</span></div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Cobrado a mais ${typeof dica === 'function' ? dica('Soma do que foi cobrado acima da tabela no período. "Aguardando" é o que você ainda não marcou como conferido.') : ''}</div><div class="kpi-value" style="color:var(--danger);">R$ ${pqN(totMais)}</div><div class="kpi-sub"><span>${pqN(tudoMais.length, 0)} vendas</span><span>aguardando <b>R$ ${pqN(soma(abertas))}</b></span></div></div>
          <div class="kpi k-mc"><div class="kpi-label">Cobrado a menos ${typeof dica === 'function' ? dica('Soma do que foi cobrado abaixo da tabela no período: faixa de peso ou de preço abaixo, e várias unidades cobradas uma vez só.') : ''}</div><div class="kpi-value">R$ ${pqN(favor)}</div><div class="kpi-sub"><span>${pqN(nFavor, 0)} vendas a seu favor</span></div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Saldo do período</div><div class="kpi-value" style="color:${totMais - favor > 0 ? 'var(--danger)' : 'var(--success,#16a34a)'}">${totMais - favor > 0 ? '−' : '+'}R$ ${pqN(Math.abs(totMais - favor))}</div><div class="kpi-sub"><span>${totMais - favor > 0 ? 'o Mercado Livre cobrou mais do que a tabela' : 'o Mercado Livre cobrou menos do que a tabela'}</span></div></div>
        </div>
        <div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div class="chips">${chip('mais', 'Cobrado a mais', tudoMais.length, totMais)}${chip('menos', 'Cobrado a menos', nFavor, favor)}${chip('anuncios', 'Por anúncio', (d.itens || []).length, null)}</div></div>
          <div class="card-body" style="padding-top:0;padding-bottom:10px;"><div class="pg-sub" style="max-width:900px;">${sub}</div></div>
          ${corpo}</div>`;
    }
