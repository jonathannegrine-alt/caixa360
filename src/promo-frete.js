// ===== CENTRAL DE PROMOÇÕES (página "promocoes") e CONFERÊNCIA DE FRETE (página "frete") =====
// Promoções: leitura das promoções do Mercado Livre (Edge Function ml-promos) com a margem antes e depois,
//   calculada com o custo, o imposto, a tarifa e o frete das vendas dos últimos 60 dias (RPC ml_itens_margem).
//   Participar/sair fica para a próxima etapa.
// Frete: RPC frete_conferencia — cobranças isoladas fora do padrão e mudanças de frete que ficaram;
//   RPC frete_por_sku — produtos da mesma família (mesma embalagem) com frete diferente.

    const pfE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pfN = (v, d) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
    async function pfFuncao(nome, corpo){
      const sd = await supa.auth.getSession(), tk = sd && sd.data && sd.data.session ? sd.data.session.access_token : '';
      const r = await fetch(SUPA_URL + '/functions/v1/' + nome, { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      return r.json().catch(() => ({ error: 'resposta inválida' }));
    }

    // ---------------------------------------------------------------- PROMOÇÕES
    const PM_TIPO = { DEAL: 'Campanha tradicional', MARKETPLACE_CAMPAIGN: 'Campanha com coparticipação', SMART: 'Campanha Smart', LIGHTNING: 'Oferta relâmpago', DOD: 'Oferta do dia', PRICE_DISCOUNT: 'Desconto individual', VOLUME: 'Desconto por volume', PRE_NEGOTIATED: 'Desconto pré-acordado', SELLER_CAMPAIGN: 'Campanha do vendedor', UNHEALTHY_STOCK: 'Liquidação de estoque Full', SELLER_COUPON_CAMPAIGN: 'Cupom do vendedor', PRICE_MATCHING: 'Preço competitivo', PRICE_MATCHING_MELI_ALL: 'Preço competitivo (100% ML)' };
    const PM_SIT = { candidate: 'Candidato', pending: 'Programado', started: 'Participando', finished: 'Encerrado' };
    let pm = { conta: '', promos: null, erro: '', sel: null, itens: [], total: 0, depois: null, sit: 'candidate', info: {}, carregando: false };

    function pmConta(){ return contaAtiva || pm.conta || (contasML[0] && contasML[0].id) || ''; }
    async function pmRender(){
      const v = document.getElementById('view-promocoes'); if(!v) return;
      const c = pmConta();
      if(pm._c !== c){ pm._c = c; pm.promos = null; pm.sel = null; pm.itens = []; pm.erro = ''; }
      pmDesenhar();
      if(!c || pm.promos) return;
      let d; try { d = await pfFuncao('ml-promos', { acao: 'lista', conta: c }); } catch(e){ d = { error: 'sem conexão com o servidor' }; }
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
      let d; try { d = await pfFuncao('ml-promos', { acao: 'itens', conta: c, id: sel.id, tipo: sel.tipo, situacao: pm.sit === 'todos' ? '' : pm.sit, depois: primeira ? null : pm.depois }); } catch(e){ d = { error: 'sem conexão' }; }
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
    }
    // margem de contribuição de um anúncio num preço (reb = parte do desconto paga pelo Mercado Livre)
    function pmMargem(inf, preco, reb){
      if(!inf || inf.vazio || !(Number(inf.custo) > 0)) return null;
      const t = Number(inf.tarifa_pct) || 0, i = (Number(inf.imposto_pct) || 0) / 100, f = Number(inf.frete_un) || 0;
      const mc = preco - preco * t - preco * i - f - Number(inf.custo) + (reb || 0);
      return { mc, pct: preco ? mc / preco * 100 : 0 };
    }
    function pmDesenhar(){
      const v = document.getElementById('view-promocoes'); if(!v || !v.classList.contains('active')) return;
      const c = pmConta(), hoje = getToday();
      const dm = s => s ? String(s).substring(8, 10) + '/' + String(s).substring(5, 7) : '';
      const lojas = contasML.length > 1 && !contaAtiva ? `<div class="seg">${contasML.map(x => `<button class="btn-toggle ${x.id === c ? 'active' : ''}" onclick="pmTrocarConta('${x.id}')">${pfE(x.apelido || x.id)}</button>`).join('')}</div>` : '';
      const cards = !c ? '<div class="vazio"><b>Conecte uma conta do Mercado Livre</b>As promoções são lidas direto da sua conta.</div>'
        : !pm.promos ? '<div class="vazio"><b>Lendo as promoções no Mercado Livre…</b></div>'
        : !pm.promos.length ? `<div class="vazio"><b>${pm.erro ? 'Não deu para ler as promoções' : 'Nenhuma promoção disponível agora'}</b>${pfE(pm.erro)}</div>`
        : `<div class="pm-cards">${pm.promos.map(p => { const fim = String(p.fim || '').substring(0, 10), resta = fim ? diasDif(hoje, fim) : null;
            return `<button class="pm-card ${pm.sel && pm.sel.id === p.id && pm.sel.tipo === p.tipo ? 'on' : ''}" onclick="pmAbrir('${pfE(p.id)}','${pfE(p.tipo)}')"><b>${pfE(p.nome || PM_TIPO[p.tipo] || p.tipo)}</b><span>${pfE(PM_TIPO[p.tipo] || p.tipo)}</span><small>${p.inicio ? dm(p.inicio) + ' a ' + dm(p.fim) : 'sem data de término'}${resta != null && resta >= 0 ? ' · <i class="' + (resta <= 3 ? 'pm-urg' : '') + '">' + (resta === 0 ? 'termina hoje' : resta + ' dia' + (resta === 1 ? '' : 's')) + '</i>' : ''}${p.situacao === 'pending' ? ' · ainda não começou' : ''}</small></button>`; }).join('')}</div>`;
      let tab = '';
      if(pm.sel){
        const linhas = pm.itens.map(x => {
          const inf = pm.info[x.item] || {}, orig = x.original || Number(inf.preco_medio) || 0, promo = x.preco || 0;
          const reb = orig * (x.ml_pct || 0) / 100, m0 = pmMargem(inf, orig, 0), m1 = promo ? pmMargem(inf, promo, reb) : null;
          const desc = orig && promo ? (1 - promo / orig) * 100 : (x.ml_pct + x.vendedor_pct);
          const mcTxt = m => m ? `<b class="${m.mc >= 0 ? (m.pct < 10 ? 'pm-baixa' : 'mc-pos') : 'mc-neg'}">R$ ${pfN(m.mc)}</b><small>${pfN(m.pct, 1)}%</small>` : '<small class="text-muted" title="Sem venda nos últimos 60 dias ou sem custo: não dá para calcular">sem base</small>';
          return `<tr>
            <td><div class="pm-an">${inf.thumbnail ? `<img src="${pfE(inf.thumbnail)}" loading="lazy" alt="">` : '<span class="pm-sem"></span>'}<div><b>${pfE(inf.titulo || x.item)}</b><small><a href="https://produto.mercadolivre.com.br/${pfE(String(x.item).replace(/^MLB/, 'MLB-'))}" target="_blank" rel="noopener">${pfE(x.item)}</a>${inf.sku ? ' · ' + pfE(inf.sku) : ''}${inf.vendas ? ' · ' + inf.vendas + ' vendas em 60 dias' : ''}</small></div></div></td>
            <td><span class="v-tag">${PM_SIT[x.situacao] || pfE(x.situacao)}</span></td>
            <td class="num">${x.ml_pct ? pfN(x.ml_pct, 1) + '%<small>R$ ' + pfN(reb) + '</small>' : '–'}</td>
            <td class="num">${x.vendedor_pct ? pfN(x.vendedor_pct, 1) + '%<small>R$ ' + pfN(orig * x.vendedor_pct / 100) + '</small>' : '–'}</td>
            <td class="num"><b>${desc ? pfN(desc, 1) + '%' : '–'}</b></td>
            <td class="num">${orig ? 'R$ ' + pfN(orig) : '–'}</td><td class="num pm-mc">${mcTxt(m0)}</td>
            <td class="num pm-promo">${promo ? 'R$ ' + pfN(promo) : '–'}</td><td class="num pm-mc pm-promo">${m1 ? mcTxt(m1) : (promo ? mcTxt(null) : '–')}</td>
          </tr>`; }).join('');
        tab = `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div><div class="card-title">${pfE(pm.sel.nome || PM_TIPO[pm.sel.tipo] || pm.sel.tipo)}</div><div class="pg-sub">${pm.itens.length} de ${pm.total} anúncio${pm.total === 1 ? '' : 's'} · margem calculada com o custo, o imposto, a tarifa e o frete das suas vendas dos últimos 60 dias ${typeof dica === 'function' ? dica('Margem = preço − tarifa − imposto − frete − custo do produto, mais a parte do desconto que o Mercado Livre paga. Abaixo de R$ 79 o frete pode mudar de faixa: confira quando o preço da promoção cruzar esse valor.', true) : ''}</div></div>
            <div class="chips">${[['candidate', 'Candidatos'], ['pending', 'Programados'], ['started', 'Participando'], ['todos', 'Todos']].map(([k, t]) => `<button class="chip ${pm.sit === k ? 'active' : ''}" onclick="pmSit('${k}')">${t}</button>`).join('')}</div></div>
          ${pm.erroItens ? `<div class="alert alert-warning" style="margin:14px;">${pfE(pm.erroItens)}</div>` : ''}
          <div style="overflow-x:auto;"><table class="cp-tab pm-tab"><thead><tr><th>Anúncio</th><th>Situação</th><th class="num" title="Parte do desconto paga pelo Mercado Livre">ML paga</th><th class="num" title="Parte do desconto paga por você">Você paga</th><th class="num">Desconto</th><th class="num">Preço hoje</th><th class="num">Margem hoje</th><th class="num pm-promo">Preço na promoção</th><th class="num pm-promo">Margem na promoção</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="9" class="text-muted" style="text-align:center;padding:26px;">${pm.carregando ? 'Lendo os anúncios…' : 'Nenhum anúncio nesta situação.'}</td></tr>`}</tbody></table></div>
          ${pm.depois && pm.itens.length < pm.total ? `<div style="padding:14px;text-align:center;"><button class="btn-out btn btn-sm" onclick="pmMais()" ${pm.carregando ? 'disabled' : ''}>${pm.carregando ? 'Carregando…' : 'Carregar mais anúncios'}</button></div>` : ''}</div>`;
      }
      v.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Central de promoções</div><div class="pg-sub">Promoções do Mercado Livre para os seus anúncios, com a margem antes de participar. Por enquanto é só consulta: para entrar ou sair de uma promoção, use o Mercado Livre.</div></div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">${lojas}<button class="btn-out btn btn-sm" onclick="pm.promos=null;pm.sel=null;pmRender()">↻ Atualizar</button></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Promoções disponíveis</div><span class="text-muted" style="font-size:12px;">${c ? pfE(contaNome(c) || c) : ''} · clique numa promoção para ver os anúncios</span></div><div class="card-body">${cards}</div></div>
        ${tab}`;
    }

    // ---------------------------------------------------------------- CONFERÊNCIA DE FRETE
    let fr = { dias: 90, dados: null, fam: null, vistos: null, erro: '', chave: '', mostra: 'abertas' };
    const FR_LOG = { fulfillment: 'Full', cross_docking: 'Coleta', xd_drop_off: 'Agência', drop_off: 'Correios' };
    async function frRender(){
      const v = document.getElementById('view-frete'); if(!v) return;
      const conta = contaParam(), chave = (conta || '') + '|' + fr.dias;
      if(fr.chave !== chave){ fr.chave = chave; fr.dados = null; fr.fam = null; fr.erro = ''; }
      frDesenhar();
      if(fr.dados || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const ate = getToday(), de = addDias(ate, -(fr.dias - 1));
      const [a, b, c] = await Promise.all([
        supa.rpc('frete_conferencia', { p_de: de, p_ate: ate, p_conta: conta }),
        supa.rpc('frete_por_sku', { p_conta: conta }),
        supa.from('frete_conferidos').select('order_id').eq('usuario_id', usuarioAtual.id).limit(5000)
      ]);
      if(fr.chave !== chave) return;
      if(a.error){ fr.erro = a.error.message; fr.dados = { isoladas: [], mudancas: [], conferidas: 0, anuncios: 0 }; }
      else fr.dados = a.data || { isoladas: [], mudancas: [] };
      fr.fam = b.data || [];
      fr.vistos = new Set((c.data || []).map(x => String(x.order_id)));
      frDesenhar();
    }
    function frDias(d){ fr.dias = d; frRender(); }
    async function frVisto(order, marcar){
      if(marcar){ fr.vistos.add(String(order)); await supa.from('frete_conferidos').upsert({ usuario_id: usuarioAtual.id, order_id: order }); }
      else { fr.vistos.delete(String(order)); await supa.from('frete_conferidos').delete().eq('usuario_id', usuarioAtual.id).eq('order_id', order); }
      frDesenhar();
    }
    async function frVistoTodos(){
      const l = (fr.dados.isoladas || []).filter(x => !fr.vistos.has(String(x.order_id)));
      if(!l.length) return;
      l.forEach(x => fr.vistos.add(String(x.order_id)));
      frDesenhar();
      await supa.from('frete_conferidos').upsert(l.map(x => ({ usuario_id: usuarioAtual.id, order_id: x.order_id })));
    }
    // pacote que o Mercado Livre registrou naquele envio (medidas e peso)
    async function frPacote(order){
      if(typeof vmlModal !== 'function') return;
      vmlModal('Pacote da venda #' + order, '<div class="vazio">Lendo o envio no Mercado Livre…</div>');
      let d; try { d = await pfFuncao('ml-venda', { acao: 'detalhe', pedido: order }); } catch(e){ d = null; }
      const e = d && d.entrega;
      if(!e){ vmlModal('Pacote da venda #' + order, '<div class="alert alert-warning">Não consegui ler o envio desta venda agora.</div>'); return; }
      const l = (a, b) => `<div class="vd-l"><span class="text-muted">${a}</span><b>${b}</b></div>`;
      const cub = e.altura * e.largura * e.comprimento / 6000;
      vmlModal('Pacote da venda #' + order, `<div class="vd-cols">${l('Medidas', e.altura + ' × ' + e.largura + ' × ' + e.comprimento + ' cm')}${l('Peso', pfN(e.peso, 0) + ' g')}${l('Peso cubado', pfN(cub, 2) + ' kg')}${l('Valor declarado', 'R$ ' + pfN(e.valor_declarado))}${l('Envio', '#' + pfE(e.envio))}${l('Tipo', FR_LOG[e.tipo] || pfE(e.tipo))}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:12px;line-height:1.5;">O Mercado Livre cobra o frete pelo maior entre o peso e o peso cubado (altura × largura × comprimento ÷ 6.000). Compare com as medidas reais da embalagem: se estiverem maiores aqui, vale abrir um chamado pedindo a revisão.</div>`);
    }
    function frDesenhar(){
      const v = document.getElementById('view-frete'); if(!v || !v.classList.contains('active')) return;
      const cab = `<div class="pg-head"><div><div class="pg-title">Conferência de frete</div><div class="pg-sub">O sistema compara o frete de cada venda com as outras vendas do mesmo anúncio e aponta o que saiu do padrão. O Flex fica de fora (o frete é do transportador).</div></div>
        <div class="seg">${[30, 60, 90].map(d => `<button class="btn-toggle ${fr.dias === d ? 'active' : ''}" onclick="frDias(${d})">${d} dias</button>`).join('')}</div></div>`;
      if(!fr.dados){ v.innerHTML = cab + '<div class="card"><div class="vazio"><b>Conferindo o frete das vendas…</b></div></div>'; return; }
      const d = fr.dados, dh = s => { const x = typeof vmlDataBRT === 'function' ? vmlDataBRT(s) : { dia: String(s).substring(0, 10), hora: '' }; return ptDate(x.dia).substring(0, 5) + ' ' + x.hora; };
      const iso = d.isoladas || [], mud = d.mudancas || [];
      const abertas = iso.filter(x => !fr.vistos.has(String(x.order_id)));
      const aMais = abertas.filter(x => x.dif > 0).reduce((s, x) => s + Number(x.dif), 0), aMenos = abertas.filter(x => x.dif < 0).reduce((s, x) => s - Number(x.dif), 0);
      const lista = fr.mostra === 'abertas' ? abertas : iso;
      const prod = x => `<div class="cp-prod" style="max-width:320px;"><b>${pfE(x.sku || x.item_id)}</b><span>${pfE(x.titulo || '')}</span></div>`;
      const loja = x => contasML.length > 1 && !contaAtiva ? `<span class="v-tag conta">${pfE(contaNome(x.ml_user_id) || '')}</span> ` : '';
      // famílias: produtos com o mesmo começo de SKU (ex.: J-2020-…) deveriam pagar o mesmo frete quando a embalagem é a mesma
      const fam = {}; (fr.fam || []).forEach(x => { const k = String(x.sku).split('-').slice(0, 2).join('-') + '|' + x.ml_user_id + '|' + x.logistic_type; (fam[k] = fam[k] || []).push(x); });
      const famDif = Object.entries(fam).map(([k, l]) => { const vals = {}; l.forEach(x => { const f = Number(x.frete).toFixed(2); vals[f] = (vals[f] || 0) + 1; }); const moda = Object.entries(vals).sort((a, b) => b[1] - a[1])[0][0]; return { k, l, moda: Number(moda), n: Object.keys(vals).length }; }).filter(g => g.l.length > 1 && g.n > 1);
      v.innerHTML = cab + `
        ${fr.erro ? `<div class="alert alert-danger">Não consegui conferir: ${pfE(fr.erro)}</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Vendas conferidas</div><div class="kpi-value">${pfN(d.conferidas, 0)}</div><div class="kpi-sub"><span>${pfN(d.anuncios, 0)} anúncios em ${fr.dias} dias</span></div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Cobrado a mais ${typeof dica === 'function' ? dica('Soma das cobranças isoladas acima do padrão que você ainda não marcou como conferidas. Uma cobrança é "isolada" quando a venda de antes e a de depois, do mesmo anúncio, pagaram outro valor igual entre si.') : ''}</div><div class="kpi-value" style="color:var(--danger);">R$ ${pfN(aMais)}</div><div class="kpi-sub"><span>${abertas.filter(x => x.dif > 0).length} cobranças fora do padrão</span></div></div>
          <div class="kpi k-mc"><div class="kpi-label">Cobrado a menos</div><div class="kpi-value">R$ ${pfN(aMenos)}</div><div class="kpi-sub"><span>${abertas.filter(x => x.dif < 0).length} cobranças abaixo do padrão</span></div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Mudanças de frete ${typeof dica === 'function' ? dica('Vezes em que o frete de um anúncio mudou e continuou no valor novo. Quando muitos anúncios mudam no mesmo dia é reajuste da tabela; quando muda um só, costuma ser alteração de peso ou medida no cadastro do Mercado Livre.') : ''}</div><div class="kpi-value">${mud.length}</div><div class="kpi-sub"><span>${mud.filter(x => !x.geral).length} só de um produto · ${mud.filter(x => x.geral).length} reajuste geral</span></div></div>
        </div>

        <div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div><div class="card-title">Cobranças fora do padrão</div><div class="pg-sub">A venda pagou um frete diferente das vendas vizinhas do mesmo anúncio, com a mesma quantidade e na mesma faixa de preço.</div></div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;"><div class="chips"><button class="chip ${fr.mostra === 'abertas' ? 'active' : ''}" onclick="fr.mostra='abertas';frDesenhar()">Aguardando conferência<span class="n">${abertas.length}</span></button><button class="chip ${fr.mostra === 'todas' ? 'active' : ''}" onclick="fr.mostra='todas';frDesenhar()">Todas<span class="n">${iso.length}</span></button></div>
          ${abertas.length ? '<button class="btn-out btn btn-sm" onclick="frVistoTodos()">Marcar todas como conferidas</button>' : ''}</div></div>
          <div style="overflow-x:auto;max-height:560px;overflow-y:auto;"><table class="cp-tab"><thead><tr><th>Venda</th><th>Produto</th><th class="num">Qtd.</th><th class="num">Preço</th><th class="num">Frete padrão</th><th class="num">Cobrado</th><th class="num">Diferença</th><th></th></tr></thead><tbody>
          ${lista.length ? lista.map(x => { const visto = fr.vistos.has(String(x.order_id)); return `<tr class="${visto ? 'fr-visto' : ''}">
            <td>${loja(x)}<a href="https://www.mercadolivre.com.br/vendas/${x.order_id}/detalhe" target="_blank" rel="noopener" title="Abrir a venda no Mercado Livre">#${x.order_id}</a><br><small class="text-muted">${dh(x.data_venda)} · ${FR_LOG[x.logistic_type] || ''}</small></td>
            <td>${prod(x)}</td><td class="num">${x.qtd}</td><td class="num">R$ ${pfN(x.preco_unit)}</td><td class="num">R$ ${pfN(x.esperado)}</td><td class="num"><b>R$ ${pfN(x.frete)}</b></td>
            <td class="num"><b class="${x.dif > 0 ? 'text-danger' : 'text-success'}">${x.dif > 0 ? '+' : '−'}R$ ${pfN(Math.abs(x.dif))}</b><br><small class="text-muted">${x.esperado ? (x.dif > 0 ? '+' : '−') + pfN(Math.abs(x.dif) / x.esperado * 100, 0) + '%' : ''}</small></td>
            <td style="white-space:nowrap;"><button class="btn-out btn btn-sm" onclick="frPacote('${x.order_id}')" title="Ver as medidas e o peso que o Mercado Livre registrou neste envio">Pacote</button> <button class="btn-out btn btn-sm" onclick="frVisto('${x.order_id}', ${!visto})">${visto ? 'Desfazer' : 'Já conferi'}</button></td></tr>`; }).join('')
            : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:26px;">${iso.length ? 'Tudo conferido. 👍' : 'Nenhuma cobrança fora do padrão no período.'}</td></tr>`}
          </tbody></table></div></div>

        <div class="card"><div class="card-header"><div><div class="card-title">Mudanças de frete que ficaram</div><div class="pg-sub">O frete mudou e as vendas seguintes continuaram no valor novo.</div></div></div>
          <div style="overflow-x:auto;max-height:460px;overflow-y:auto;"><table class="cp-tab"><thead><tr><th>Desde</th><th>Produto</th><th class="num">Qtd.</th><th class="num">Antes</th><th class="num">Agora</th><th class="num">Diferença</th><th>O que parece ser</th><th></th></tr></thead><tbody>
          ${mud.length ? mud.map(x => `<tr>
            <td>${loja(x)}${dh(x.data_venda)}<br><small class="text-muted">${FR_LOG[x.logistic_type] || ''}</small></td><td>${prod(x)}</td><td class="num">${x.qtd}</td>
            <td class="num">R$ ${pfN(x.de)}</td><td class="num"><b>R$ ${pfN(x.para)}</b></td><td class="num"><b class="${x.dif > 0 ? 'text-danger' : 'text-success'}">${x.dif > 0 ? '+' : '−'}R$ ${pfN(Math.abs(x.dif))}</b></td>
            <td>${x.geral ? `<span class="v-tag">Reajuste geral</span><br><small class="text-muted">${x.itens_no_dia} anúncios mudaram no mesmo dia</small>` : `<span class="v-tag fr-so">Só este produto</span><br><small class="text-muted">confira peso e medidas</small>`}</td>
            <td><button class="btn-out btn btn-sm" onclick="frPacote('${x.order_id}')">Pacote</button></td></tr>`).join('')
            : '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:26px;">Nenhuma mudança de frete no período.</td></tr>'}
          </tbody></table></div></div>

        <div class="card"><div class="card-header"><div><div class="card-title">Produtos da mesma família com frete diferente</div><div class="pg-sub">Produtos com o mesmo começo de SKU, que em geral usam a mesma embalagem. Frete de 1 unidade, vendas a partir de R$ 79, últimos 45 dias.</div></div></div>
          <div class="card-body">${famDif.length ? famDif.map(g => `<div class="fr-fam"><b>${pfE(g.k.split('|')[0])}</b> <span class="text-muted">· ${FR_LOG[g.k.split('|')[2]] || ''}${contasML.length > 1 ? ' · ' + pfE(contaNome(g.k.split('|')[1]) || '') : ''} · frete mais comum R$ ${pfN(g.moda)}</span>
            <div class="fr-fam-l">${g.l.sort((a, b) => Number(b.frete) - Number(a.frete)).map(x => `<span class="${Number(x.frete) !== g.moda ? 'dif' : ''}" title="${pfE(x.titulo || '')} · ${x.vendas} vendas"><b>${pfE(x.sku)}</b> R$ ${pfN(x.frete)}</span>`).join('')}</div></div>`).join('')
            : '<div class="text-muted">Nenhuma família com frete diferente entre os produtos.</div>'}</div></div>`;
    }
