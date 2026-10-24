// ===== PROMOÇÕES: "Por anúncio" e "Minhas promoções" (campanhas do vendedor) =====
// Complementa promo-frete.js (aba "Do Mercado Livre"). Edge Function ml-promos:
//   do_anuncio        promoções de um anúncio
//   campanha_itens    anúncios de uma campanha (participantes e candidatos); guarda cópia em promo_campanhas
//   campanha_criar / campanha_editar / campanha_excluir / campanha_gravar   gravam na conta do Mercado Livre
// As campanhas encerradas vêm da cópia guardada (o Mercado Livre só devolve as ativas): é dela que sai o "Copiar".

    let pc = { conta: '', anuncios: null, busca: '', aberto: {}, camps: null, sit: 'started', ed: null, lendo: '', base: {}, ord: 'sku', vend: {}, promo: {}, lido: {}, filtro: '' };   // lido: anúncios já verificados { reb, reb_oferta }; filtro: '' | 'rebate' | 'sem'
    const PC_ORD = [['sku', 'SKU (A a Z)'], ['nome', 'Nome (A a Z)'], ['mais', 'Mais vendidos (30 dias)'], ['menos', 'Menos vendidos (30 dias)'], ['ativa', 'Com promoção ativa primeiro'], ['caro', 'Maior preço'], ['barato', 'Menor preço']];
    function pcOrdenar(L){
      const o = pc.ord, v = x => pc.vend[x.item_id] || 0, a = x => pc.promo[x.item_id] ? 0 : 1, s = (x, y) => String(x.sku || 'zzz').localeCompare(String(y.sku || 'zzz'));
      const f = o === 'nome' ? (x, y) => String(x.titulo || 'zzz').localeCompare(String(y.titulo || 'zzz')) : o === 'mais' ? (x, y) => v(y) - v(x) : o === 'menos' ? (x, y) => v(x) - v(y)
        : o === 'ativa' ? (x, y) => a(x) - a(y) : o === 'caro' ? (x, y) => (Number(y.preco) || 0) - (Number(x.preco) || 0) : o === 'barato' ? (x, y) => (Number(x.preco) || 0) - (Number(y.preco) || 0) : s;
      return L.slice().sort((x, y) => (x.pausado - y.pausado) || f(x, y) || s(x, y));
    }
    // vendas de 30 dias por anúncio e selo de promoção ativa (promoções em andamento de cada anúncio): chegam depois da lista, sem travar a tela
    async function pcExtras(){
      const c = pmConta(), ids = (pc.anuncios || []).map(x => x.item_id);
      try { const r = await supa.rpc('vendas_por_anuncio', { p_conta: c, p_dias: 30 }); pc.vend = {}; (r.data || []).forEach(x => { pc.vend[x.item_id] = Number(x.qtd) || 0; }); } catch(e){}
      if(pmConta() === c) pcDesenhar();
      // primeiro os que mais vendem; a tela é redesenhada a cada lote
      const fila = ids.slice().sort((a, b) => (pc.vend[b] || 0) - (pc.vend[a] || 0));
      for(let i = 0; i < fila.length; i += 40){
        let d; try { d = await pqFuncao('ml-promos', { acao: 'ativas', conta: c, itens: fila.slice(i, i + 40) }); } catch(e){ d = null; }
        if(pmConta() !== c) return;
        ((d && d.ativas) || []).forEach(x => { pc.lido[x.item] = { reb: Number(x.reb) || 0, reb_oferta: Number(x.reb_oferta) || 0 }; if(x.n > 0) pc.promo[x.item] = { n: x.n, nome: x.nome, menor: Number(x.menor) || 0, cheio: Number(x.cheio) || 0 }; else delete pc.promo[x.item]; });
        if(!document.activeElement || document.activeElement.id !== 'pc-busca') pcDesenhar();
      }
    }
    const PC_SIT = { pending: 'Para começar', started: 'Em andamento', finished: 'Encerrada', deleted: 'Excluída' };
    const PC_SUB = { FLEXIBLE_PERCENTAGE: 'Porcentagem flexível', FIXED_PERCENTAGE: 'Porcentagem fixa' };
    // datas do Mercado Livre vêm em horário universal (…Z): 23:59 de Brasília aparece como 02:59 do dia seguinte
    const pcISO = s => { if(!s) return ''; const t = String(s); if(!/Z$|[+-]\d{2}:?\d{2}$/.test(t)) return t.substring(0, 10); const d = new Date(new Date(t).getTime() - 3 * 3600000); return isNaN(d) ? t.substring(0, 10) : d.toISOString().substring(0, 10); };
    const pcDia = s => s ? ptDate(pcISO(s)) : '';
    const pcR = v => Math.round(Number(v) * 100) / 100;
    // tipo de anúncio: Clássico (gold_special) ou Premium (gold_pro)
    const PC_TIPO_AN = { gold_special: 'Clássico', gold_pro: 'Premium' };
    function pcTipoTag(item){ const t = (pc.base[item] || {}).tipo_anuncio, n = PC_TIPO_AN[t]; return n ? `<span class="pc-tipo ${t === 'gold_pro' ? 'premium' : 'classico'}">${n}</span>` : ''; }
    function pcTipoChips(atual, fn){ return `<div class="chips">${[['', 'Todos'], ['gold_special', 'Clássico'], ['gold_pro', 'Premium']].map(([k, t]) => `<button class="chip ${(atual || '') === k ? 'active' : ''}" onclick="${fn}('${k}')">${t}</button>`).join('')}</div>`; }
    function pcTipoBate(item, filtro){ return !filtro || (pc.base[item] || {}).tipo_anuncio === filtro; }
    function pcFiltroTipo(k){ pc.tipo = k; pcDesenhar(); }
    function pcEdFiltroTipo(k){ if(pc.ed){ pc.ed.tipo = k; pcDesenhar(); } }
    // filtros de promoção da aba "Por anúncio": com rebate do Mercado Livre (ativo ou disponível) e sem nenhuma promoção ativa.
    // Dependem da verificação de cada anúncio (pcExtras), que chega aos poucos: anúncio ainda não verificado não entra nos dois filtros.
    const pcTemReb = i => { const r = pc.lido[i]; return !!r && (r.reb > 0 || r.reb_oferta > 0); };
    const pcSemPromo = i => !!pc.lido[i] && !pc.promo[i];
    function pcFiltroBate(i){ return pc.filtro === 'rebate' ? pcTemReb(i) : pc.filtro === 'sem' ? pcSemPromo(i) : true; }
    function pcFiltroPromo(k){ pc.filtro = pc.filtro === k ? '' : k; pcDesenhar(); }
    function pcPromoChips(){
      const L = (pc.anuncios || []).filter(x => pcTipoBate(x.item_id, pc.tipo)), ver = L.filter(x => pc.lido[x.item_id]).length;
      const chip = (k, t, n, dica) => `<button class="chip ${pc.filtro === k ? 'active' : ''}" title="${dica}" onclick="pcFiltroPromo('${k}')">${t}<span class="n">${n}</span></button>`;
      return `<div class="chips">${chip('', 'Todas', L.length, 'Todos os anúncios')}${chip('rebate', 'Com rebate', L.filter(x => pcTemReb(x.item_id)).length, 'Anúncios com rebate do Mercado Livre numa promoção ativa ou disponível para entrar')}${chip('sem', 'Sem promoção', L.filter(x => pcSemPromo(x.item_id)).length, 'Anúncios sem nenhuma promoção ativa')}</div>`
        + (ver < L.length ? `<span class="text-muted" style="font-size:12px;">Verificando promoções: ${ver} de ${L.length}</span>` : '');
    }
    function pcRebTag(i){
      const r = pc.lido[i]; if(!r) return '';
      if(r.reb > 0) return `<span class="v-tag" style="flex:none;background:rgba(22,163,74,.12);color:var(--success,#16a34a);" title="O Mercado Livre paga parte do desconto numa promoção ativa deste anúncio">Rebate ${pqN(r.reb, 1)}%</span>`;
      if(r.reb_oferta > 0) return `<span class="v-tag" style="flex:none;" title="Há promoção com rebate do Mercado Livre disponível para este anúncio entrar">Rebate disponível ${pqN(r.reb_oferta, 1)}%</span>`;
      return '';
    }
    // com promoção ativa: o menor preço em promoção em cima e o preço cheio riscado embaixo
    function pcPrecoCel(x){
      const p = pc.promo[x.item_id], cheio = (p && p.cheio) || Number(x.preco) || 0;
      if(!p || !(p.menor > 0) || p.menor >= cheio - 0.005) return `<span class="pc-an-p">R$ ${pqN(x.preco)}</span>`;
      return `<span class="pc-an-p" style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.2;" title="Menor preço entre as promoções ativas; embaixo, o preço sem promoção"><span style="color:var(--success,#16a34a);">R$ ${pqN(p.menor)}</span><small style="font-weight:500;color:var(--text-muted);text-decoration:line-through;font-size:12px;">R$ ${pqN(cheio)}</small></span>`;
    }
    function pcAbas(){
      const a = pm.aba || 'ml';
      return `<div class="seg" style="margin-bottom:14px;">${[['ml', 'Do Mercado Livre'], ['anuncios', 'Por anúncio'], ['minhas', 'Minhas promoções']].map(([k, t]) => `<button class="btn-toggle ${a === k ? 'active' : ''}" onclick="pcAba('${k}')">${t}</button>`).join('')}</div>`;
    }
    function pcAba(k){ pm.aba = k; pc.ed = null; pmRender(); }
    function pcLojas(c){ return contasML.length > 1 && !contaAtiva ? `<div class="seg">${contasML.map(x => `<button class="btn-toggle ${x.id === c ? 'active' : ''}" onclick="pmTrocarConta('${x.id}')">${pqE(x.apelido || x.id)}</button>`).join('')}</div>` : ''; }
    function pcCab(sub, botoes){ const c = pmConta(); return `<div class="pg-head"><div><div class="pg-title">Central de promoções</div><div class="pg-sub">${sub}</div></div><div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">${pcLojas(c)}${botoes || ''}</div></div>${pcAbas()}`; }

    async function pcRender(){
      const v = document.getElementById('view-promocoes'); if(!v) return;
      const c = pmConta();
      if(pc.conta !== c){ pc.conta = c; pc.anuncios = null; pc.aberto = {}; pc.camps = null; pc.ed = null; }
      pcDesenhar();
      if(!c || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      try { if(typeof frTabela === 'function') await frTabela(); } catch(e){}
      if(pm.aba === 'anuncios' && !pc.anuncios) await pcCarregarAnuncios();
      if(pm.aba === 'minhas' && !pc.camps) await pcCarregarCampanhas();
      pcDesenhar();
    }
    // dados de exibição dos anúncios (título, foto, SKU, preço): o que faltar é lido no Mercado Livre
    async function pcBase(ids){
      const c = pmConta(), falta = [...new Set(ids)].filter(i => i && !pc.base[i]);
      if(!falta.length) return;
      for(let i = 0; i < falta.length; i += 150){
        const r = await supa.from('ml_itens_base').select('item_id,titulo,thumbnail,sku,preco,tarifa_pct,peso_g,tipo_anuncio').eq('usuario_id', usuarioAtual.id).in('item_id', falta.slice(i, i + 150));
        (r.data || []).forEach(x => { pc.base[x.item_id] = x; if(typeof pm !== 'undefined' && (!pm.base[x.item_id] || pm.base[x.item_id].vazio)) pm.base[x.item_id] = x; });
      }
      const ainda = falta.filter(i => !pc.base[i]);
      for(let i = 0; i < ainda.length; i += 20){
        let b; try { b = await pqFuncao('ml-promos', { acao: 'base', conta: c, itens: ainda.slice(i, i + 20) }); } catch(e){ b = null; }
        ((b && b.itens) || []).forEach(x => { pc.base[x.item_id] = x; if(!pm.base[x.item_id] || pm.base[x.item_id].vazio) pm.base[x.item_id] = x; });
      }
      ainda.forEach(i => { if(!pc.base[i]) pc.base[i] = { item_id: i }; });
    }

    // ------------------------------------------------------------- POR ANÚNCIO
    async function pcCarregarAnuncios(){
      const c = pmConta();
      pc.lendo = 'Lendo a lista de anúncios da conta…'; pcDesenhar();
      let d; try { d = await pqFuncao('ml-promos', { acao: 'anuncios', conta: c }); } catch(e){ d = null; }
      let lista = (d && d.anuncios) || [];
      if(!lista.length){   // sem resposta do Mercado Livre: fica com os anúncios que o sistema já conhece
        const r = await supa.from('ml_itens_base').select('item_id').eq('usuario_id', usuarioAtual.id).eq('ml_user_id', c).limit(2000);
        lista = (r.data || []).map(x => ({ item: x.item_id, pausado: false }));
      }
      pc.lendo = 'Lendo os dados de ' + lista.length + ' anúncios (na primeira vez demora um pouco)…'; pcDesenhar();
      await pcBase(lista.map(x => x.item));
      await pcCustoVendas(lista.map(x => x.item));
      pc.lendo = ''; pc.promo = {}; pc.lido = {};
      setTimeout(pcExtras, 50);
      pc.anuncios = lista.map(x => Object.assign({ item_id: x.item }, pc.base[x.item] || {}, { pausado: !!x.pausado }))
        .sort((a, b) => (a.pausado - b.pausado) || String(a.sku || 'zzz').localeCompare(String(b.sku || 'zzz')));
    }
    // custo, imposto, tarifa e frete das vendas recentes de cada anúncio (é de onde vem o custo dos kits, que no cadastro ficam zerados)
    async function pcCustoVendas(ids){
      await pmLotesCarregar(); if(typeof vrCarregar === 'function' && typeof vr !== 'undefined' && !vr.carregado) try { await vrCarregar(); } catch(e){}
      return;   // a margem usa o custo do sistema (cadastro ou lote de compra), não o das vendas

      const falta = [...new Set(ids)].filter(i => i && !pm.info[i]);
      // em lotes pequenos (a consulta de muitos anúncios de uma vez passa do tempo limite); lote que falhar é tentado de novo depois
      for(let i = 0; i < falta.length; i += 25){ const lote = falta.slice(i, i + 25), r = await supa.rpc('ml_itens_margem', { p_itens: lote, p_conta: pmConta() }); if(r.error) continue; (r.data || []).forEach(x => { pm.info[x.item_id] = x; }); lote.forEach(k => { if(!pm.info[k]) pm.info[k] = { vazio: true }; }); }
    }
    // busca: digitou o código do anúncio (com ou sem MLB) e deu Enter → abre direto as promoções dele
    async function pcBuscaEnter(){
      const m = pc.busca.trim().toUpperCase().match(/^(?:MLB)?-?(\d{8,14})$/); if(!m) return;
      const item = 'MLB' + m[1];
      if(!(pc.anuncios || []).some(x => x.item_id === item)){ await pcBase([item]); const b = pc.base[item]; if(b && (b.titulo || b.sku)) pc.anuncios.unshift(Object.assign({ item_id: item }, b)); else { if(typeof toast === 'function') toast('Não achei o anúncio ' + item + ' nesta loja.'); return; } }
      pc.busca = item; if(!pc.aberto[item]) pcAbrirAnuncio(item); else pcDesenhar();
    }
    async function pcAbrirAnuncio(item){
      if(pc.aberto[item]){ delete pc.aberto[item]; pcDesenhar(); return; }
      pc.aberto[item] = { lendo: true }; pcDesenhar();
      let d; try { d = await pqFuncao('ml-promos', { acao: 'do_anuncio', conta: pmConta(), item }); } catch(e){ d = { error: 'sem conexão' }; }
      pc.aberto[item] = d && d.ok ? { promos: d.promos } : { erro: (d && (d.motivo || d.error)) || 'não foi possível ler' };
      if(d && d.ok){ const at = d.promos.filter(p => p.situacao === 'started'), mx = l => l.reduce((m, p) => Math.max(m, Number(p.ml_pct) || 0), 0); pc.lido[item] = { reb: mx(at), reb_oferta: mx(d.promos.filter(p => p.situacao === 'candidate' || p.situacao === 'pending')) }; if(at.length) pc.promo[item] = Object.assign(pc.promo[item] || {}, { n: at.length, nome: at.map(p => p.nome || PM_TIPO[p.tipo] || p.tipo).join(', ') }); else delete pc.promo[item]; }
      pcDesenhar();
    }
    function pcCartoesAnuncio(item){
      const a = pc.aberto[item]; if(!a) return '';
      if(a.lendo) return '<div class="pc-promos"><span class="text-muted">Lendo as promoções deste anúncio no Mercado Livre…</span></div>';
      if(a.erro) return `<div class="pc-promos"><span class="text-danger">${pqE(a.erro)}</span></div>`;
      if(!a.promos.length) return '<div class="pc-promos"><span class="text-muted">Nenhuma promoção disponível para este anúncio agora.</span></div>';
      const ord = { started: 0, pending: 1, candidate: 2 };
      return `<div class="pc-promos">${a.promos.slice().sort((x, y) => (ord[x.situacao] ?? 3) - (ord[y.situacao] ?? 3)).map(p => {
        const dentro = p.situacao === 'started' || p.situacao === 'pending', preco = p.preco || p.sugerido || 0, desc = p.original && preco ? (1 - preco / p.original) * 100 : (p.ml_pct + p.vendedor_pct);
        const m = preco && typeof pmMargem === 'function' ? pmMargem(item, preco, p.original * (p.ml_pct || 0) / 100) : null;
        return `<div class="pc-promo ${dentro ? 'dentro' : ''}"><div><b>${pqE(p.nome || PM_TIPO[p.tipo] || p.tipo)}</b> <span class="v-tag ${dentro ? 'conta' : ''}">${p.situacao === 'started' ? 'Participando' : p.situacao === 'pending' ? 'Programado' : 'Pode participar'}</span>
            <small>${pqE(PM_TIPO[p.tipo] || p.tipo)}</small>${pcPeriodo(p)}</div>
          <div class="pc-num">${desc ? `<b>${pqN(desc, 1)}%</b>` : ''}${p.vendedor_pct || p.ml_pct ? `<small>você ${pqN(p.vendedor_pct, 1)}% · Mercado Livre ${pqN(p.ml_pct, 1)}%</small>` : ''}${p.ml_pct && p.original ? `<small title="Parte do desconto que o Mercado Livre devolve a você em cada venda nesta promoção."><b style="font-size:inherit;color:var(--success,#16a34a);">Rebate: R$ ${pqN(p.original * p.ml_pct / 100)}</b> por venda</small>` : ''}</div>
          <div class="pc-num">${preco ? `<b>R$ ${pqN(preco)}</b><small>${dentro ? 'preço na promoção' : 'preço sugerido'}</small>` : '<small>defina o preço ao participar</small>'}</div>
          <div class="pc-num">${m ? `<b class="${m.mc >= 0 ? (m.pct < 10 ? 'pm-baixa' : 'mc-pos') : 'mc-neg'}">R$ ${pqN(m.mc)}</b><small>margem ${pqN(m.pct, 1)}%</small>` : '<small>sem custo no cadastro</small>'}</div>
          <div class="pc-acao">${dentro ? `${PC_EDITA.includes(p.tipo) ? `<button class="btn-out btn btn-sm" onclick="pcParticipar('${item}','${pqE(p.id || '')}','${pqE(p.tipo)}',true)">Editar</button> ` : ''}<button class="btn-out btn btn-sm" style="color:var(--danger);" onclick="pcSair('${item}','${pqE(p.id || '')}','${pqE(p.tipo)}')">Sair</button>` : (PC_PARTICIPA.includes(p.tipo) ? `<button class="btn btn-sm" onclick="pcParticipar('${item}','${pqE(p.id || '')}','${pqE(p.tipo)}')">Participar</button>` : '<small class="text-muted" title="Este tipo de promoção ainda só entra pelo Mercado Livre">pelo Mercado Livre</small>')}</div></div>`; }).join('')}</div>`;
    }
    // tipos em que dá para entrar por aqui. Com preço livre: você escolhe o preço; os demais usam o preço que o Mercado Livre oferece.
    // Desconto direto (PRICE_DISCOUNT) não tem id de promoção e pede as datas; o relâmpago automático (SMART_LIGHTNING) entra pela oferta, como o SMART.
    // PC_EDITA: promoções em que o Mercado Livre deixa mudar o preço depois de entrar.
    const PC_PRECO_LIVRE = ['SELLER_CAMPAIGN', 'DEAL', 'DOD', 'LIGHTNING', 'PRICE_DISCOUNT'], PC_PARTICIPA = PC_PRECO_LIVRE.concat(['SMART', 'SMART_LIGHTNING', 'MARKETPLACE_CAMPAIGN', 'PRICE_MATCHING', 'PRICE_MATCHING_MELI_ALL', 'UNHEALTHY_STOCK', 'PRE_NEGOTIATED']);
    const PC_EDITA = ['SELLER_CAMPAIGN', 'DEAL', 'PRICE_DISCOUNT'];
    // período da promoção: início e fim (e o prazo para entrar, quando o Mercado Livre informa)
    function pcPeriodo(p){
      if(!p.inicio && !p.fim) return '<small class="text-muted">' + (p.tipo === 'PRICE_DISCOUNT' ? 'você escolhe o início e o fim ao participar' : p.tipo === 'LIGHTNING' ? 'o Mercado Livre marca o dia e a hora da oferta' : 'sem data informada pelo Mercado Livre') + '</small>';
      return `<small>📅 Início <b>${pcDia(p.inicio) || '—'}</b> · termina <b>${pcDia(p.fim) || '—'}</b>${p.prazo && p.situacao === 'candidate' ? ' · entrar até ' + pcDia(p.prazo) : ''}</small>`;
    }
    function pcPromoDe(item, id, tipo){ return (((pc.aberto[item] || {}).promos) || []).find(p => (p.id || '') === id && p.tipo === tipo); }
    function pcParticipar(item, id, tipo, editar){
      const p = pcPromoDe(item, id, tipo); if(!p) return;
      const i = pc.base[item] || {}, livre = editar || PC_PRECO_LIVRE.includes(tipo), preco0 = editar ? (p.preco || 0) : (p.sugerido || p.preco || 0);
      const h = getToday(), fim0 = dateStr(new Date(new Date(h + 'T12:00:00').getTime() + 13 * 86400000));
      pc._part = { item, id, tipo, editar: !!editar };
      vmlModal((editar ? 'Editar preço: ' : 'Participar: ') + pqE(p.nome || PM_TIPO[tipo] || tipo), `<div class="pm-an" style="margin-bottom:14px;">${i.thumbnail ? `<img src="${pqE(i.thumbnail)}" alt="">` : '<span class="pm-sem"></span>'}<div><b>${pqE(i.titulo || item)}</b><small>${pcTipoTag(item)}${pqE(i.sku || '')} · ${pqE(item)} · preço de hoje R$ ${pqN(p.original || i.preco)}</small></div></div>
        ${tipo === 'PRICE_DISCOUNT' && !editar ? '' : `<div style="margin:-4px 0 12px;font-size:13px;">${pcPeriodo(p)}</div>`}
        ${livre ? `<div class="form-row"><div class="form-group"><label class="form-label" for="pc-p-preco">Preço na promoção (R$)</label><div style="display:flex;gap:8px;align-items:center;"><input type="text" inputmode="decimal" id="pc-p-preco" value="${preco0 ? pqN(preco0) : ''}" oninput="pcParticiparConta('preco')" style="flex:1;"><span>ou</span><input type="text" inputmode="decimal" id="pc-p-pct" aria-label="Desconto em %" style="width:74px;" oninput="pcParticiparConta('pct')"><span>%</span></div>${p.minimo || p.maximo ? `<div class="text-muted" style="font-size:12px;margin-top:5px;">O Mercado Livre aceita de R$ ${pqN(p.minimo)} a R$ ${pqN(p.maximo)}${p.sugerido ? ' · sugerido R$ ' + pqN(p.sugerido) : ''}.</div>` : ''}</div>
            ${tipo === 'PRICE_DISCOUNT' && !editar ? `<div class="form-group"><label class="form-label" for="pc-p-ini">Período do desconto</label><div style="display:flex;gap:8px;align-items:center;"><input type="date" id="pc-p-ini" value="${h}" min="${h}"><span>a</span><input type="date" id="pc-p-fim" aria-label="Fim do desconto" value="${fim0}" min="${h}"></div><div class="text-muted" style="font-size:12px;margin-top:5px;">O Mercado Livre aceita até 14 dias.</div></div>` : ''}
            ${tipo === 'LIGHTNING' && !editar ? `<div class="form-group"><label class="form-label" for="pc-p-est">Estoque reservado</label><input type="number" id="pc-p-est" min="${p.estoque_min || 1}" max="${p.estoque_max || ''}" value="${p.estoque_min || ''}"><div class="text-muted" style="font-size:12px;margin-top:5px;">de ${p.estoque_min} a ${p.estoque_max} unidades</div></div>` : ''}</div>`
          : `<div class="alert alert-info">Nesta promoção o preço é definido pelo Mercado Livre e não dá para alterar: <b>R$ ${pqN(p.preco)}</b>${p.vendedor_pct || p.ml_pct ? ' (você paga ' + pqN(p.vendedor_pct, 1) + '% do desconto e o Mercado Livre ' + pqN(p.ml_pct, 1) + '%)' : ''}.</div>`}
        <div id="pc-p-margem" style="font-size:13.5px;line-height:1.6;margin-top:6px;"></div>
        ${['SELLER_CAMPAIGN', 'DEAL', 'PRICE_DISCOUNT'].includes(tipo) ? `<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:12px;"><label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:13.5px;margin:0;"><input type="checkbox" id="pc-p-meli-on" style="width:auto;" onchange="pcParticiparConta()"> Preço exclusivo para clientes Meli+ (opcional)</label>
            <div id="pc-p-meli-box" style="display:none;margin-top:10px;"><div style="display:flex;gap:8px;align-items:center;"><input type="text" inputmode="decimal" id="pc-p-meli" aria-label="Preço exclusivo Meli+" placeholder="menor que o preço da promoção" oninput="pcParticiparConta('meli')" style="flex:1;"><span>ou</span><input type="text" inputmode="decimal" id="pc-p-meli-pct" aria-label="Desconto Meli+ em %" style="width:74px;" oninput="pcParticiparConta('melipct')"><span>%</span></div><div id="pc-p-meli-m" style="font-size:13px;margin-top:6px;"></div></div></div>` : ''}
        <div id="pc-p-msg" class="alert alert-danger" style="display:none;margin-top:12px;"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" id="pc-p-ok" onclick="pcParticiparOk(this)">${editar ? 'Salvar preço' : 'Participar'}</button>`);
      pcParticiparConta();
    }
    function pcNumCampo(id){ const el = document.getElementById(id); if(!el) return 0; const s = String(el.value).replace(/[^\d,.]/g, ''); return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; }
    function pcParticiparPreco(p){ return document.getElementById('pc-p-preco') ? pcNumCampo('pc-p-preco') : (p.preco || 0); }
    // mantém preço e porcentagem em sincronia e mostra a margem (normal e Meli+)
    function pcParticiparConta(origem){
      const a = pc._part, el = document.getElementById('pc-p-margem'); if(!a || !el) return;
      const p = pcPromoDe(a.item, a.id, a.tipo), orig = p.original || Number((pc.base[a.item] || {}).preco) || 0, set = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; };
      if(origem === 'pct' && orig) set('pc-p-preco', pqN(pcR(orig * (1 - pcNumCampo('pc-p-pct') / 100))));
      const preco = pcParticiparPreco(p);
      if(origem !== 'pct' && orig && preco) set('pc-p-pct', String(pcR((1 - preco / orig) * 100)).replace('.', ','));
      const on = document.getElementById('pc-p-meli-on'), box = document.getElementById('pc-p-meli-box'); if(box) box.style.display = on && on.checked ? 'block' : 'none';
      const tx = m => m ? `<b class="${m.mc >= 0 ? (m.pct < 10 ? 'pm-baixa' : 'mc-pos') : 'mc-neg'}">R$ ${pqN(m.mc)} (${pqN(m.pct, 1)}%)</b>` : '<span class="text-muted">sem custo no cadastro</span>';
      // valores usados na simulação (custo do cadastro do SKU, imposto, tarifa e frete), visíveis antes mesmo de digitar o preço
      const sku = (pc.base[a.item] || {}).sku || ((typeof pm !== 'undefined' && pm.info[a.item]) || {}).sku || '';
      const usa = m => `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2,transparent);"><b>Custo do produto: ${m && m.custo > 0 ? 'R$ ' + pqN(m.custo) : (typeof pmCustoSku === 'function' && pmCustoSku(sku) > 0 ? 'R$ ' + pqN(pmCustoSku(sku)) : '<span class="mc-neg">sem custo no cadastro</span>')}</b>${sku ? ' <span class="text-muted">(SKU ' + pqE(sku) + ')</span>' : ''}${m ? `<div class="text-muted" style="font-size:12.5px;">Imposto ${pqN(m.imposto, 1)}% · tarifa ${pqN(m.tarifa, 1)}% · frete R$ ${pqN(m.frete)}</div>` : ''}</div>`;
      if(!(preco > 0)){ el.innerHTML = '<span class="text-muted">Informe o preço ou a porcentagem para ver a margem.</span>' + usa(pmMargem(a.item, orig, 0)); return; }
      const reb = orig * (p.ml_pct || 0) / 100, m0 = pmMargem(a.item, orig, 0), m1 = pmMargem(a.item, preco, reb), desc = orig ? (1 - preco / orig) * 100 : 0;
      el.innerHTML = `Desconto de <b>${pqN(desc, 1)}%</b>. Margem hoje: ${tx(m0)} → na promoção: ${tx(m1)}` + usa(m1);
      if(on && on.checked){
        if(origem === 'melipct' && orig) set('pc-p-meli', pqN(pcR(orig * (1 - pcNumCampo('pc-p-meli-pct') / 100))));
        const pmeli = pcNumCampo('pc-p-meli'); if(origem !== 'melipct' && orig && pmeli) set('pc-p-meli-pct', String(pcR((1 - pmeli / orig) * 100)).replace('.', ','));
        const mm = document.getElementById('pc-p-meli-m'); if(mm) mm.innerHTML = pmeli > 0 ? 'Margem no preço Meli+: ' + tx(pmMargem(a.item, pmeli, reb)) : '<span class="text-muted">Informe o preço exclusivo.</span>';
      }
    }
    async function pcParticiparOk(bt){
      const a = pc._part, p = pcPromoDe(a.item, a.id, a.tipo), msg = document.getElementById('pc-p-msg'), rot = a.editar ? 'Salvar preço' : 'Participar', erro = t => { msg.textContent = t; msg.style.display = 'block'; if(bt){ bt.disabled = false; bt.textContent = rot; } };
      const corpo = { acao: a.editar ? 'editar' : 'participar', conta: pmConta(), item: a.item, id: a.id, tipo: a.tipo, ref: p.ref || '' };
      if(a.tipo === 'PRICE_DISCOUNT' && !a.editar){ corpo.inicio = (document.getElementById('pc-p-ini') || {}).value || ''; corpo.fim = (document.getElementById('pc-p-fim') || {}).value || ''; if(!corpo.inicio || !corpo.fim || corpo.fim < corpo.inicio) return erro('Confira as datas do desconto.'); if((new Date(corpo.fim) - new Date(corpo.inicio)) / 86400000 > 13) return erro('O desconto direto vale por até 14 dias.'); }
      if(a.editar || PC_PRECO_LIVRE.includes(a.tipo)){ corpo.preco = pcParticiparPreco(p); if(!(corpo.preco > 0)) return erro('Informe o preço na promoção.'); if(p.maximo && corpo.preco > p.maximo + 0.005) return erro('O preço máximo aceito é R$ ' + pqN(p.maximo) + '.'); if(p.minimo && corpo.preco < p.minimo - 0.005) return erro('O preço mínimo aceito é R$ ' + pqN(p.minimo) + '.'); }
      if(a.tipo === 'LIGHTNING' && !a.editar) corpo.estoque = Number((document.getElementById('pc-p-est') || {}).value) || 0;
      { const on = document.getElementById('pc-p-meli-on'); if(on && on.checked){ corpo.preco_meli = pcNumCampo('pc-p-meli'); if(!(corpo.preco_meli > 0) || corpo.preco_meli >= corpo.preco) return erro('O preço exclusivo Meli+ precisa ser menor que o preço da promoção.'); } }
      if(bt){ bt.disabled = true; bt.textContent = 'Enviando…'; }
      const r = await pqFuncao('ml-promos', corpo).catch(() => null);
      if(!r || !r.ok) return erro('O Mercado Livre não aceitou: ' + ((r && (r.motivo || r.error)) || 'sem resposta'));
      fecharModal('modal-vml'); if(typeof toast === 'function') toast(a.editar ? 'Preço da promoção alterado.' : 'Anúncio incluído na promoção.');
      delete pc.aberto[a.item]; pcAbrirAnuncio(a.item);
    }
    function pcSair(item, id, tipo){
      const p = pcPromoDe(item, id, tipo); if(!p) return; pc._part = { item, id, tipo };
      vmlModal('Sair da promoção', `<div style="line-height:1.6;">Tirar <b>${pqE((pc.base[item] || {}).sku || item)}</b> da promoção <b>${pqE(p.nome || PM_TIPO[tipo] || tipo)}</b>? O anúncio volta ao preço sem este desconto.</div><div id="pc-p-msg" class="alert alert-danger" style="display:none;margin-top:12px;"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" style="background:var(--danger);border-color:var(--danger);" onclick="pcSairOk(this)">Sair da promoção</button>`);
    }
    async function pcSairOk(bt){
      const a = pc._part, p = pcPromoDe(a.item, a.id, a.tipo), msg = document.getElementById('pc-p-msg');
      if(bt){ bt.disabled = true; bt.textContent = 'Enviando…'; }
      const r = await pqFuncao('ml-promos', { acao: 'sair', conta: pmConta(), item: a.item, id: a.id, tipo: a.tipo, ref: (p && p.ref) || '' }).catch(() => null);
      if(!r || !r.ok){ msg.textContent = 'O Mercado Livre não aceitou: ' + ((r && (r.motivo || r.error)) || 'sem resposta'); msg.style.display = 'block'; if(bt){ bt.disabled = false; bt.textContent = 'Sair da promoção'; } return; }
      fecharModal('modal-vml'); if(typeof toast === 'function') toast('Anúncio retirado da promoção.');
      delete pc.aberto[a.item]; pcAbrirAnuncio(a.item);
    }

    // ------------------------------------------------------------- MINHAS PROMOÇÕES
    async function pcCarregarCampanhas(sincronizar){
      const c = pmConta();
      let d; try { d = await pqFuncao('ml-promos', { acao: 'lista', conta: c }); } catch(e){ d = null; }
      const ativas = ((d && d.promos) || []).filter(p => p.tipo === 'SELLER_CAMPAIGN');
      let g = await supa.from('promo_campanhas').select('id,nome,sub_tipo,situacao,inicio,fim,pct_fixa,itens,atualizado').eq('usuario_id', usuarioAtual.id).eq('ml_user_id', c);
      let guard = g.data || [];
      // campanha ativa ainda sem cópia guardada (ou a pedido): lê os anúncios e guarda
      const semCopia = ativas.filter(a => sincronizar || !guard.some(x => x.id === a.id));
      for(let i = 0; i < semCopia.length; i++){
        pc.lendo = 'Lendo a campanha "' + (semCopia[i].nome || semCopia[i].id) + '"… ' + (i + 1) + ' de ' + semCopia.length; pcDesenhar();
        try { await pqFuncao('ml-promos', { acao: 'campanha_itens', conta: c, id: semCopia[i].id }); } catch(e){}
      }
      if(semCopia.length){ g = await supa.from('promo_campanhas').select('id,nome,sub_tipo,situacao,inicio,fim,pct_fixa,itens,atualizado').eq('usuario_id', usuarioAtual.id).eq('ml_user_id', c); guard = g.data || []; }
      pc.lendo = '';
      pc.camps = guard.map(x => { const a = ativas.find(y => y.id === x.id);
        // sem estar entre as ativas do Mercado Livre e com a data vencida = encerrada
        const sit = x.situacao === 'deleted' ? 'deleted' : a ? a.situacao : 'finished';
        return { id: x.id, nome: x.nome || (a && a.nome) || x.id, sub: x.sub_tipo || '', situacao: sit, inicio: x.inicio, fim: x.fim, pct_fixa: x.pct_fixa, itens: x.itens || [] }; })
        .filter(x => x.situacao !== 'deleted').sort((a, b) => String(b.inicio || '').localeCompare(String(a.inicio || '')));
      pc.erroCamps = d && d.ok === false ? (d.motivo || '') : '';
    }
    function pcSit(s){ pc.sit = s; pcDesenhar(); }

    // ------- editor de campanha (criar, editar e copiar) -------
    // pc.ed = { id (null = nova), nome, inicio, fim, sub, pct_fixa, situacao, linhas: [{ item, original, preco, pct, minimo, maximo, sel }], antes: { item: preco }, candidatos: [...], busca }
    function pcLinha(item, original, preco, extra){ const o = Number(original) || 0, p = Number(preco) || 0; return Object.assign({ item, original: o, preco: p, pct: o && p ? pcR((1 - p / o) * 100) : 0, sel: false }, extra || {}); }
    async function pcNova(){
      const h = getToday(), ini = h, fim = dateStr(new Date(Number(h.substring(0, 4)), Number(h.substring(5, 7)), 0));
      pc.ed = { id: null, nome: '', inicio: ini, fim: fim < ini ? ini : fim, sub: 'FLEXIBLE_PERCENTAGE', pct_fixa: '', situacao: '', linhas: [], antes: {}, candidatos: null, busca: '' };
      pcDesenhar();
    }
    async function pcEditar(id){
      pc.lendo = 'Lendo os anúncios da campanha no Mercado Livre…'; pcDesenhar();
      let d; try { d = await pqFuncao('ml-promos', { acao: 'campanha_itens', conta: pmConta(), id }); } catch(e){ d = null; }
      pc.lendo = '';
      if(!d || !d.ok){ if(typeof toast === 'function') toast('Não consegui abrir a campanha: ' + ((d && (d.motivo || d.error)) || 'sem resposta')); pcDesenhar(); return; }
      const dentro = d.itens.filter(x => x.situacao === 'started' || x.situacao === 'pending'), cand = d.itens.filter(x => x.situacao === 'candidate');
      await pcBase(d.itens.map(x => x.item));
      await pcCustoVendas(d.itens.map(x => x.item));
      const antes = {}; dentro.forEach(x => { antes[x.item] = x.preco; });
      pc.ed = { id, nome: d.campanha.nome, inicio: pcISO(d.campanha.inicio), fim: pcISO(d.campanha.fim), sub: d.campanha.sub || 'FLEXIBLE_PERCENTAGE', pct_fixa: d.campanha.pct_fixa || '', situacao: d.campanha.situacao,
        linhas: dentro.map(x => pcLinha(x.item, x.original, x.preco, { pausado: !!x.pausado })), antes, candidatos: cand.map(x => ({ item: x.item, original: x.original, minimo: x.minimo, maximo: x.maximo, sugerido: x.sugerido })), busca: '' };
      pcDesenhar();
    }
    // copiar: mesma lista de anúncios e a mesma porcentagem de cada um, aplicada ao preço de hoje; datas no mês seguinte
    async function pcCopiar(id){
      const o = (pc.camps || []).find(x => x.id === id); if(!o) return;
      pc.lendo = 'Preparando a cópia…'; pcDesenhar();
      await pcBase((o.itens || []).map(x => x.item));
      await pcCustoVendas((o.itens || []).map(x => x.item));
      const ini0 = new Date(pcISO(o.inicio) + 'T12:00:00'), ini = new Date(ini0.getFullYear(), ini0.getMonth() + 1, 1), fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 0), hoje = getToday();
      const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'], nomeMes = meses.findIndex(m => m.toLowerCase() === String(o.nome).trim().toLowerCase());
      pc.lendo = '';
      pc.ed = { id: null, copiaDe: o.nome, nome: nomeMes >= 0 ? meses[ini.getMonth()] : (String(o.nome) + ' (cópia)').slice(0, 25), inicio: dateStr(ini) < hoje ? hoje : dateStr(ini), fim: dateStr(fim), sub: o.sub || 'FLEXIBLE_PERCENTAGE', pct_fixa: o.pct_fixa || '', situacao: '', antes: {}, candidatos: null, busca: '',
        linhas: (o.itens || []).map(x => { const b = pc.base[x.item] || {}, orig = Number(b.preco) || Number(x.original) || 0, pct = x.original ? pcR((1 - x.preco / x.original) * 100) : 0; return pcLinha(x.item, orig, pcR(orig * (1 - pct / 100)), { pct, pausado: !!x.pausado }); }) };
      pcDesenhar();
    }
    function pcEdCampo(k, v){ if(!pc.ed) return; pc.ed[k] = v; if(k === 'sub' || k === 'pct_fixa'){ if(pc.ed.sub === 'FIXED_PERCENTAGE' && Number(pc.ed.pct_fixa) > 0) pc.ed.linhas.forEach(l => { l.pct = Number(pc.ed.pct_fixa); l.preco = pcR(l.original * (1 - l.pct / 100)); }); pcDesenhar(); } else if(k === 'nome'){ const c = document.getElementById('pc-conta-nome'); if(c) c.textContent = String(v).length + '/25'; } }
    function pcEdPreco(item, v){ const l = pc.ed.linhas.find(x => x.item === item); if(!l) return; const s = String(v).replace(/[^\d,.]/g, ''); l.preco = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; l.pct = l.original && l.preco ? pcR((1 - l.preco / l.original) * 100) : 0; pcDesenhar(); }
    function pcEdPct(item, v){ const l = pc.ed.linhas.find(x => x.item === item); if(!l) return; l.pct = Number(String(v).replace(',', '.')) || 0; l.preco = pcR(l.original * (1 - l.pct / 100)); pcDesenhar(); }
    function pcEdSel(item, on){ if(item === '*') pcEdVisiveis().forEach(l => { l.sel = on; }); else { const l = pc.ed.linhas.find(x => x.item === item); if(l) l.sel = on; } pcDesenhar(); }
    function pcEdVisiveis(){ const b = String(pc.ed.busca || '').trim().toLowerCase(); return pc.ed.linhas.filter(l => pcTipoBate(l.item, pc.ed.tipo)).filter(l => { if(!b) return true; const i = pc.base[l.item] || {}; return (String(i.titulo || '') + ' ' + String(i.sku || '') + ' ' + l.item).toLowerCase().includes(b); }); }
    function pcEdRemover(item){
      const alvo = item ? pc.ed.linhas.filter(l => l.item === item) : pc.ed.linhas.filter(l => l.sel); if(!alvo.length) return;
      const ids = new Set(alvo.map(l => l.item)); pc.ed.linhas = pc.ed.linhas.filter(l => !ids.has(l.item));
      if(pc.ed.candidatos) alvo.forEach(l => { if(!pc.ed.candidatos.some(c => c.item === l.item)) pc.ed.candidatos.push({ item: l.item, original: l.original }); });
      pcDesenhar();
    }
    // editar em massa: preço com desconto ou porcentagem, nos marcados (ou em todos, se nenhum estiver marcado)
    function pcEdMassa(){
      const n = pc.ed.linhas.filter(l => l.sel).length;
      vmlModal('Editar em massa', `<div class="text-muted" style="font-size:13px;margin-bottom:12px;">Vale para ${n ? '<b>' + n + ' anúncio' + (n > 1 ? 's marcados' : ' marcado') + '</b>' : '<b>todos os ' + pc.ed.linhas.length + ' anúncios</b> da promoção (nenhum está marcado)'}.</div>
        <div class="form-row"><div class="form-group"><label class="form-label" for="pc-m-pct">Desconto (%)</label><input type="text" inputmode="decimal" id="pc-m-pct" placeholder="Ex.: 20"></div>
        <div class="form-group"><label class="form-label" for="pc-m-preco">ou preço com desconto (R$)</label><input type="text" inputmode="decimal" id="pc-m-preco" placeholder="mesmo preço para todos"></div></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="pcEdMassaAplicar()">Aplicar</button>`);
    }
    function pcEdMassaAplicar(){
      const num = id => { const s = String((document.getElementById(id) || {}).value || '').replace(/[^\d,.]/g, ''); return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; };
      const pct = num('pc-m-pct'), preco = num('pc-m-preco'); if(!pct && !preco){ if(typeof toast === 'function') toast('Informe a porcentagem ou o preço.'); return; }
      const alvo = pc.ed.linhas.some(l => l.sel) ? pc.ed.linhas.filter(l => l.sel) : pc.ed.linhas;
      alvo.forEach(l => { if(pct){ l.pct = pct; l.preco = pcR(l.original * (1 - pct / 100)); } else { l.preco = preco; l.pct = l.original ? pcR((1 - preco / l.original) * 100) : 0; } });
      fecharModal('modal-vml'); pcDesenhar();
    }
    // janela "Adicionar anúncios": os que ainda não estão na promoção
    async function pcEdAdicionar(){
      let cand = pc.ed.candidatos;
      if(!cand){ if(!pc.anuncios) await pcCarregarAnuncios(); cand = pc.anuncios.map(x => ({ item: x.item_id, original: Number(x.preco) || 0 })); pc.ed.candidatos = cand; }
      const dentro = new Set(pc.ed.linhas.map(l => l.item)); pc.ed._add = { busca: '', sel: new Set() };
      await pcBase(cand.map(x => x.item));
      pcEdAdicionarDesenhar(dentro);
    }
    function pcEdAdicionarDesenhar(){
      const dentro = new Set(pc.ed.linhas.map(l => l.item)), a = pc.ed._add, b = a.busca.trim().toLowerCase();
      const l = pc.ed.candidatos.filter(x => !dentro.has(x.item)).filter(x => { if(!b) return true; const i = pc.base[x.item] || {}; return (String(i.titulo || '') + ' ' + String(i.sku || '') + ' ' + x.item).toLowerCase().includes(b); });
      vmlModal('Adicionar anúncios', `<div class="d-flex gap-1" style="align-items:center;margin-bottom:10px;"><input type="search" id="pc-add-busca" placeholder="Buscar por nome, SKU ou código do anúncio" value="${pqE(a.busca)}" style="flex:1;" oninput="pc.ed._add.busca=this.value;pcEdAdicionarDesenhar();document.getElementById('pc-add-busca').focus();"><span class="text-muted" style="font-size:12.5px;white-space:nowrap;">Selecionado <b>${a.sel.size}</b> · total ${l.length}</span></div>
        <div style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;"><table class="cp-tab"><thead><tr><th style="width:34px;"><input type="checkbox" style="width:auto;" aria-label="Marcar todos" ${l.length && l.every(x => a.sel.has(x.item)) ? 'checked' : ''} onchange="pcEdAddSel('*', this.checked)"></th><th>Produto</th><th>SKU / anúncio</th><th class="num">Preço</th></tr></thead><tbody>
        ${l.length ? l.slice(0, 300).map(x => { const i = pc.base[x.item] || {}; return `<tr><td><input type="checkbox" style="width:auto;" aria-label="Marcar ${pqE(x.item)}" ${a.sel.has(x.item) ? 'checked' : ''} onchange="pcEdAddSel('${x.item}', this.checked)"></td><td><div class="pm-an">${i.thumbnail ? `<img src="${pqE(i.thumbnail)}" loading="lazy" alt="">` : '<span class="pm-sem"></span>'}<div><b>${pqE(i.titulo || x.item)}</b></div></div></td><td>${pqE(i.sku || '—')} ${pcTipoTag(x.item)}<br><small class="text-muted">${pqE(x.item)}</small></td><td class="num">R$ ${pqN(x.original || i.preco)}</td></tr>`; }).join('') : '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:22px;">Nenhum anúncio disponível para adicionar.</td></tr>'}
        </tbody></table></div>${pc.ed.id ? '' : '<div class="text-muted" style="font-size:12px;margin-top:8px;">A lista traz os anúncios com venda recente. O Mercado Livre confirma, ao salvar, quais podem entrar.</div>'}`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="pcEdAddConfirmar()" ${a.sel.size ? '' : 'disabled'}>Confirmar (${a.sel.size})</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
    }
    function pcEdAddSel(item, on){ const a = pc.ed._add, dentro = new Set(pc.ed.linhas.map(l => l.item)), b = a.busca.trim().toLowerCase();
      if(item === '*') pc.ed.candidatos.filter(x => !dentro.has(x.item)).filter(x => { if(!b) return true; const i = pc.base[x.item] || {}; return (String(i.titulo || '') + ' ' + String(i.sku || '') + ' ' + x.item).toLowerCase().includes(b); }).forEach(x => { if(on) a.sel.add(x.item); else a.sel.delete(x.item); });
      else if(on) a.sel.add(item); else a.sel.delete(item);
      pcEdAdicionarDesenhar(); }
    function pcEdAddConfirmar(){
      const a = pc.ed._add, fixo = pc.ed.sub === 'FIXED_PERCENTAGE' ? Number(pc.ed.pct_fixa) || 0 : 0;
      pc.ed.candidatos.filter(x => a.sel.has(x.item)).forEach(x => { const orig = Number(x.original) || Number((pc.base[x.item] || {}).preco) || 0, pct = fixo || (x.sugerido && orig ? pcR((1 - x.sugerido / orig) * 100) : 0);
        pc.ed.linhas.push(pcLinha(x.item, orig, pct ? pcR(orig * (1 - pct / 100)) : 0, { pct, minimo: x.minimo, maximo: x.maximo })); });
      fecharModal('modal-vml'); pcDesenhar();
    }
    // salvar: cria a campanha (se for nova) e grava os anúncios em lotes
    async function pcEdSalvar(bt){
      const e = pc.ed, c = pmConta(), avisa = t => { if(typeof toast === 'function') toast(t); };
      const nome = String(e.nome || '').trim();
      if(!nome){ avisa('Dê um nome à campanha.'); return; }
      if(!e.inicio || !e.fim || e.fim < e.inicio){ avisa('Confira as datas de início e de fim.'); return; }
      if(e.sub === 'FIXED_PERCENTAGE' && !e.id && !(Number(e.pct_fixa) >= 5 && Number(e.pct_fixa) <= 80)){ avisa('Na porcentagem fixa, informe um desconto entre 5% e 80%.'); return; }
      const semPreco = e.linhas.filter(l => !(l.preco > 0) || !(l.pct >= 5) || l.pct > 80);
      if(semPreco.length){ avisa(semPreco.length + ' anúncio' + (semPreco.length > 1 ? 's estão' : ' está') + ' sem desconto válido (o Mercado Livre aceita de 5% a 80%). Ajuste ou remova antes de salvar.'); return; }
      const por = e.linhas.filter(l => e.antes[l.item] == null || Math.abs(e.antes[l.item] - l.preco) > 0.005).map(l => ({ item: l.item, preco: l.preco, ja: e.antes[l.item] != null }));
      const agora = new Set(e.linhas.map(l => l.item)), tirar = Object.keys(e.antes).filter(i => !agora.has(i));
      if(tirar.length && !confirm(tirar.length + ' anúncio' + (tirar.length > 1 ? 's serão retirados' : ' será retirado') + ' desta campanha no Mercado Livre. Continuar?')) return;
      const rot = bt ? bt.textContent : ''; if(bt){ bt.disabled = true; }
      const prog = t => { if(bt) bt.textContent = t; };
      let id = e.id;
      if(!id){
        prog('Criando a campanha…');
        const r = await pqFuncao('ml-promos', { acao: 'campanha_criar', conta: c, nome, sub: e.sub, inicio: e.inicio, fim: e.fim, pct_fixa: Number(e.pct_fixa) || null }).catch(() => null);
        if(!r || !r.ok){ avisa('O Mercado Livre não criou a campanha: ' + ((r && (r.motivo || r.error)) || 'sem resposta')); if(bt){ bt.disabled = false; bt.textContent = rot; } return; }
        id = r.campanha.id; e.id = id;
      } else if(nome !== e._nome0 || e.fim !== e._fim0 || e.inicio !== e._ini0){
        prog('Atualizando os dados…');
        const r = await pqFuncao('ml-promos', { acao: 'campanha_editar', conta: c, id, nome, fim: e.fim, inicio: e.situacao === 'pending' ? e.inicio : undefined }).catch(() => null);
        if(!r || !r.ok) avisa('Os anúncios serão gravados, mas o Mercado Livre não aceitou mudar nome ou datas: ' + ((r && (r.motivo || r.error)) || 'sem resposta'));
      }
      const res = [];
      for(let i = 0; i < Math.max(por.length, 1); i += 40){
        const lote = por.slice(i, i + 40), tl = i === 0 ? tirar.slice(0, 40) : []; if(!lote.length && !tl.length) break;
        prog('Gravando anúncios… ' + Math.min(i + 40, por.length) + ' de ' + por.length);
        const r = await pqFuncao('ml-promos', { acao: 'campanha_gravar', conta: c, id, por: lote, tirar: tl }).catch(() => null);
        if(r && r.ok) res.push(...r.resultados); else lote.forEach(x => res.push({ item: x.item, acao: 'por', ok: false, motivo: (r && (r.motivo || r.error)) || 'sem resposta' }));
      }
      for(let i = 40; i < tirar.length; i += 40){ const r = await pqFuncao('ml-promos', { acao: 'campanha_gravar', conta: c, id, por: [], tirar: tirar.slice(i, i + 40) }).catch(() => null); if(r && r.ok) res.push(...r.resultados); }
      prog('Conferindo…');
      try { await pqFuncao('ml-promos', { acao: 'campanha_itens', conta: c, id }); } catch(x){}
      const falhas = res.filter(x => !x.ok), ok = res.filter(x => x.ok).length;
      pc.camps = null; pm.promos = null; pc.ed = null;
      await pcCarregarCampanhas(); pcDesenhar();
      vmlModal(falhas.length ? 'Campanha gravada com pendências' : 'Campanha gravada', `<div style="line-height:1.6;">Campanha <b>${pqE(nome)}</b> (${pqE(id)}): <b>${ok}</b> alteraç${ok === 1 ? 'ão gravada' : 'ões gravadas'} no Mercado Livre${falhas.length ? ', <b class="text-danger">' + falhas.length + ' recusada' + (falhas.length > 1 ? 's' : '') + '</b>' : ''}.</div>
        ${falhas.length ? `<div style="max-height:300px;overflow-y:auto;margin-top:12px;"><table class="cp-tab"><thead><tr><th>Anúncio</th><th>O que o Mercado Livre respondeu</th></tr></thead><tbody>${falhas.map(x => `<tr><td>${pqE((pc.base[x.item] || {}).sku || x.item)}<br><small class="text-muted">${pqE(x.item)}</small></td><td style="white-space:normal;">${pqE(x.motivo || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}`);
    }
    function pcExcluir(id){
      const o = (pc.camps || []).find(x => x.id === id); if(!o) return;
      const ativa = o.situacao === 'started' || o.situacao === 'pending';
      vmlModal('Excluir a campanha "' + pqE(o.nome) + '"', ativa ? `<div style="line-height:1.6;">A campanha está <b>${PC_SIT[o.situacao].toLowerCase()}</b> no Mercado Livre, com <b>${o.itens.length} anúncio${o.itens.length === 1 ? '' : 's'}</b>. Excluir tira o desconto de todos eles na hora e <b>não dá para desfazer</b>.<br><br>Para confirmar, digite o nome da campanha:</div><input type="text" id="pc-exc-nome" style="width:100%;margin-top:8px;" placeholder="${pqE(o.nome)}">`
        : `<div style="line-height:1.6;">Esta campanha já terminou. Excluir tira ela só desta lista (a cópia guardada no sistema); no Mercado Livre nada muda.</div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" style="background:var(--danger);border-color:var(--danger);" onclick="pcExcluirConfirmar('${pqE(id)}', this)">Excluir</button>`);
    }
    async function pcExcluirConfirmar(id, bt){
      const o = (pc.camps || []).find(x => x.id === id); if(!o) return;
      const ativa = o.situacao === 'started' || o.situacao === 'pending';
      if(ativa){
        if(String((document.getElementById('pc-exc-nome') || {}).value || '').trim() !== String(o.nome).trim()){ if(typeof toast === 'function') toast('O nome digitado não confere.'); return; }
        if(bt){ bt.disabled = true; bt.textContent = 'Excluindo…'; }
        const r = await pqFuncao('ml-promos', { acao: 'campanha_excluir', conta: pmConta(), id }).catch(() => null);
        if(!r || !r.ok){ if(typeof toast === 'function') toast('O Mercado Livre não excluiu: ' + ((r && (r.motivo || r.error)) || 'sem resposta')); if(bt){ bt.disabled = false; bt.textContent = 'Excluir'; } return; }
      }
      await supa.rpc('promo_campanha_ocultar', { p_conta: pmConta(), p_id: id });
      fecharModal('modal-vml'); pc.camps = null; pm.promos = null; await pcCarregarCampanhas(); pcDesenhar();
    }

    // ------------------------------------------------------------- DESENHO
    function pcDesenhar(){
      const v = document.getElementById('view-promocoes'); if(!v || !v.classList.contains('active')) return;
      const c = pmConta();
      if(!c){ v.innerHTML = pcCab('Promoções do Mercado Livre para os seus anúncios.') + '<div class="card"><div class="vazio"><b>Conecte uma conta do Mercado Livre</b>As promoções são lidas direto da sua conta.</div></div>'; return; }
      if(pm.aba === 'anuncios'){ v.innerHTML = pcDesenharAnuncios(); return; }
      if(pc.ed){ v.innerHTML = pcDesenharEditor(); return; }
      v.innerHTML = pcDesenharMinhas();
    }
    function pcDesenharAnuncios(){
      const cab = pcCab('Cada anúncio com todas as promoções em que ele está ou pode entrar. Clique num anúncio para ver.', `<button class="btn-out btn btn-sm" onclick="pc.anuncios=null;pc.aberto={};pcRender()">↻ Atualizar</button>`);
      if(!pc.anuncios) return cab + `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>${pqE(pc.lendo || 'Lendo os anúncios…')}</b></div></div>`;
      const b = pc.busca.trim().toLowerCase().replace(/^mlb-/, 'mlb'), l = pcOrdenar(pc.anuncios.filter(x => pcTipoBate(x.item_id, pc.tipo)).filter(x => pcFiltroBate(x.item_id)).filter(x => !b || (String(x.titulo || '') + ' ' + String(x.sku || '') + ' ' + x.item_id).toLowerCase().includes(b)));
      return cab + `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div><div class="card-title">${l.length} anúncio${l.length === 1 ? '' : 's'}</div><div class="pg-sub">Todos os anúncios da loja, ativos e pausados. Busque por nome, SKU ou código; com o código do anúncio, Enter abre direto.</div></div>
          ${pcTipoChips(pc.tipo, 'pcFiltroTipo')}${pcPromoChips()}
          <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;margin:0;">Ordenar por <select style="width:auto;" onchange="pc.ord=this.value;pcDesenhar()">${PC_ORD.map(o => `<option value="${o[0]}" ${pc.ord === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>
          <input type="search" id="pc-busca" placeholder="Buscar por nome, SKU ou código do anúncio" value="${pqE(pc.busca)}" style="max-width:340px;" oninput="pc.busca=this.value;pcDesenhar();const i=document.getElementById('pc-busca');i.focus();i.setSelectionRange(i.value.length,i.value.length);" onkeydown="if(event.key==='Enter')pcBuscaEnter()"></div>
        <div>${l.length ? l.slice(0, 200).map(x => `<div class="pc-an ${pc.aberto[x.item_id] ? 'aberto' : ''}"><button class="pc-an-cab" onclick="pcAbrirAnuncio('${x.item_id}')" aria-expanded="${pc.aberto[x.item_id] ? 'true' : 'false'}">
              ${x.thumbnail ? `<img src="${pqE(x.thumbnail)}" loading="lazy" alt="">` : '<span class="pm-sem"></span>'}<span class="pc-an-t"><b>${pqE(x.titulo || x.item_id)}</b><small>${pcTipoTag(x.item_id)}${pqE(x.sku || 'sem SKU')} · ${pqE(x.item_id)}${x.pausado ? ' · <i style="font-style:normal;color:var(--warning,#d97706);">pausado</i>' : ''}${pc.vend[x.item_id] ? ' · ' + pc.vend[x.item_id].toLocaleString('pt-BR') + ' vendidos em 30 dias' : ''}</small></span>
              <span class="pc-an-tags">${pc.promo[x.item_id] ? `<span class="v-tag conta" style="flex:none;" title="${pqE(pc.promo[x.item_id].nome ? 'Participando de: ' + pc.promo[x.item_id].nome : 'Este anúncio está em promoção. Clique para ver a campanha.')}">Promoção ativa${pc.promo[x.item_id].n > 1 ? ' (' + pc.promo[x.item_id].n + ')' : ''}</span>` : ''}${pcRebTag(x.item_id)}</span>
              ${pcPrecoCel(x)}<span class="pc-seta">${pc.aberto[x.item_id] ? '▾' : '▸'}</span></button>${pcCartoesAnuncio(x.item_id)}</div>`).join('') : '<div class="vazio"><b>Nenhum anúncio encontrado</b></div>'}</div>
        ${l.length > 200 ? '<div class="text-muted" style="font-size:12px;padding:10px 18px;">Mostrando 200. Use a busca para achar os outros.</div>' : ''}</div>`;
    }
    function pcDesenharMinhas(){
      const cab = pcCab('As suas campanhas no Mercado Livre: crie, edite e copie de um mês para o outro.', `<button class="btn-out btn btn-sm" onclick="pc.camps=null;pcDesenhar();pcCarregarCampanhas(true).then(pcDesenhar)" title="Lê de novo as campanhas ativas e os anúncios de cada uma">Sincronizar promoções</button><button class="btn btn-sm" onclick="pcNova()">+ Criar promoção</button>`);
      if(pc.lendo || !pc.camps) return cab + `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>${pqE(pc.lendo || 'Lendo as suas campanhas…')}</b></div></div>`;
      const c = pmConta(), por = s => pc.camps.filter(x => x.situacao === s), l = por(pc.sit);
      const chip = (k, t) => `<button class="chip ${pc.sit === k ? 'active' : ''}" onclick="pcSit('${k}')">${t}<span class="n">${por(k).length}</span></button>`;
      return cab + `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div class="chips">${chip('pending', 'Para começar')}${chip('started', 'Em andamento')}${chip('finished', 'Encerradas')}</div></div>
        ${pc.erroCamps ? `<div class="alert alert-warning" style="margin:0 18px 12px;">${pqE(pc.erroCamps)}</div>` : ''}
        <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Nome da campanha</th><th>Tipo da porcentagem</th><th>Loja</th><th class="num">Anúncios</th><th>Validade</th><th style="text-align:right;">Ações</th></tr></thead><tbody>
        ${l.length ? l.map(x => `<tr><td><b>${pqE(x.nome)}</b><br><small class="text-muted">${pqE(x.id)}</small></td><td>${PC_SUB[x.sub] || pqE(x.sub || '—')}${x.pct_fixa ? '<br><small class="text-muted">' + pqN(x.pct_fixa, 0) + '% em todos</small>' : ''}</td><td>${pqE(contaNome(c) || c)}</td><td class="num">${x.itens.length}</td><td>${pcDia(x.inicio)} a ${pcDia(x.fim)}</td>
            <td style="text-align:right;white-space:nowrap;">${x.situacao !== 'finished' ? `<button class="btn-out btn btn-sm" onclick="pcEditar('${pqE(x.id)}')">Editar</button> ` : ''}<button class="btn-out btn btn-sm" onclick="pcCopiar('${pqE(x.id)}')" title="Cria uma campanha nova com os mesmos anúncios e os mesmos descontos">Copiar</button> <button class="btn-out btn btn-sm" style="color:var(--danger);" onclick="pcExcluir('${pqE(x.id)}')">Excluir</button></td></tr>`).join('')
          : `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:26px;">Nenhuma campanha ${pc.sit === 'pending' ? 'para começar' : pc.sit === 'started' ? 'em andamento' : 'encerrada guardada'}.${pc.sit === 'finished' ? ' As campanhas passam a aparecer aqui depois que o sistema as vê ativas uma vez.' : ''}</td></tr>`}
        </tbody></table></div></div>`;
    }
    function pcDesenharEditor(){
      const e = pc.ed, nova = !e.id, comecou = e.situacao === 'started', l = pcEdVisiveis(), nSel = e.linhas.filter(x => x.sel).length, fixa = e.sub === 'FIXED_PERCENTAGE';
      if(e._nome0 === undefined){ e._nome0 = e.nome; e._fim0 = e.fim; e._ini0 = e.inicio; }
      const rd = (k, val, t, travado) => `<label class="pc-radio ${travado ? 'travado' : ''}"><input type="radio" name="pc-${k}" value="${val}" ${e[k] === val ? 'checked' : ''} ${travado ? 'disabled' : ''} onchange="pcEdCampo('${k}', this.value)"> ${t}</label>`;
      return `<div class="pg-head"><div><div class="pg-title">${nova ? (e.copiaDe ? 'Copiar promoção' : 'Criar promoção') : 'Editar promoção'}</div><div class="pg-sub">${nova ? (e.copiaDe ? 'Cópia de "' + pqE(e.copiaDe) + '": mesmos anúncios e mesmas porcentagens, aplicadas ao preço de hoje. Confira e salve.' : 'A campanha é criada no Mercado Livre ao salvar.') : 'As mudanças vão para o Mercado Livre ao clicar em Atualizar.'}</div></div>
          <div class="d-flex gap-1"><button class="btn-out btn" onclick="pc.ed=null;pcDesenhar()">Fechar</button><button class="btn" onclick="pcEdSalvar(this)">${nova ? 'Salvar' : 'Atualizar'}</button></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Informação básica</div></div><div class="card-body pc-form">
          <div class="pc-campo"><label>Loja</label><input type="text" value="${pqE(contaNome(pmConta()) || pmConta())}" disabled></div>
          <div class="pc-campo"><label for="pc-nome">Nome da campanha</label><div style="display:flex;gap:10px;align-items:center;"><input type="text" id="pc-nome" maxlength="25" value="${pqE(e.nome)}" placeholder="Ex.: Novembro" oninput="pcEdCampo('nome', this.value)"><small class="text-muted" id="pc-conta-nome">${String(e.nome).length}/25</small></div></div>
          <div class="pc-campo"><label for="pc-ini">Validade</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><input type="date" id="pc-ini" aria-label="Data de início" value="${e.inicio}" ${comecou ? 'disabled title="A campanha já começou: a data de início não muda"' : ''} onchange="pcEdCampo('inicio', this.value)"><span>a</span><input type="date" aria-label="Data de término" value="${e.fim}" onchange="pcEdCampo('fim', this.value)"></div></div>
          <div class="pc-campo"><label>Tipo de promoção</label><div class="pc-radios"><label class="pc-radio travado"><input type="radio" checked disabled> Promoções do vendedor</label><label class="pc-radio travado" title="Ainda não disponível no sistema"><input type="radio" disabled> Campanha de cupons do vendedor</label></div></div>
          <div class="pc-campo"><label>Aplicar desconto</label><div class="pc-radios" style="flex-direction:column;">${rd('sub', 'FIXED_PERCENTAGE', 'Porcentagem fixa: a mesma porcentagem de desconto para todos os anúncios' + (fixa ? ` <input type="text" inputmode="decimal" aria-label="Porcentagem fixa" style="width:70px;margin-left:8px;" value="${pqE(e.pct_fixa)}" ${nova ? '' : 'disabled'} onchange="pcEdCampo('pct_fixa', this.value.replace(',', '.'))"> %` : ''), !nova)}${rd('sub', 'FLEXIBLE_PERCENTAGE', 'Porcentagem flexível: porcentagem de desconto diferente por anúncio', !nova)}</div></div>
        </div></div>
        <div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div class="card-title">Anúncios da promoção <span class="v-tag conta">${e.linhas.length}</span></div>
            <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">${pcTipoChips(e.tipo, 'pcEdFiltroTipo')}<input type="search" id="pc-ed-busca" placeholder="Buscar por nome, SKU ou código" value="${pqE(e.busca)}" style="width:260px;" oninput="pc.ed.busca=this.value;pcDesenhar();const i=document.getElementById('pc-ed-busca');i.focus();i.setSelectionRange(i.value.length,i.value.length);"><button class="btn btn-sm" onclick="pcEdAdicionar()">Adicionar anúncios</button></div></div>
          <div class="d-flex gap-1" style="align-items:center;padding:0 18px 12px;flex-wrap:wrap;"><span class="text-muted" style="font-size:12.5px;">Selecionado <b>${nSel}</b></span><button class="btn-out btn btn-sm" onclick="pcEdRemover()" ${nSel ? '' : 'disabled'}>Remover</button><button class="btn-out btn btn-sm" onclick="pcEdMassa()" ${e.linhas.length && !fixa ? '' : 'disabled'} title="Aplica a mesma porcentagem ou o mesmo preço a vários anúncios">Editar em massa</button></div>
          <div style="overflow-x:auto;max-height:640px;overflow-y:auto;"><table class="cp-tab pm-tab"><thead><tr><th style="width:34px;"><input type="checkbox" style="width:auto;" aria-label="Marcar todos" ${l.length && l.every(x => x.sel) ? 'checked' : ''} onchange="pcEdSel('*', this.checked)"></th><th>Produto</th><th>SKU / anúncio</th><th class="num">Preço</th><th class="num">Preço com desconto</th><th class="num">Desconto</th><th class="num" title="Margem de contribuição no preço com desconto">Margem</th><th></th></tr></thead><tbody>
          ${l.length ? l.map(x => { const i = pc.base[x.item] || {}, m = x.preco > 0 && typeof pmMargem === 'function' ? pmMargem(x.item, x.preco, 0) : null, ruim = !(x.pct >= 5) || x.pct > 80;
            return `<tr><td><input type="checkbox" style="width:auto;" aria-label="Marcar ${pqE(x.item)}" ${x.sel ? 'checked' : ''} onchange="pcEdSel('${x.item}', this.checked)"></td>
              <td><div class="pm-an">${i.thumbnail ? `<img src="${pqE(i.thumbnail)}" loading="lazy" alt="">` : '<span class="pm-sem"></span>'}<div><b>${pqE(i.titulo || x.item)}</b></div></div></td>
              <td>${pqE(i.sku || '—')} ${pcTipoTag(x.item)}<br><small class="text-muted"><a href="https://produto.mercadolivre.com.br/${pqE(String(x.item).replace(/^MLB/, 'MLB-'))}" target="_blank" rel="noopener">${pqE(x.item)}</a>${x.pausado ? ' · <i style="font-style:normal;color:var(--warning,#d97706);">anúncio pausado</i>' : ''}</small></td>
              <td class="num">R$ ${pqN(x.original)}</td>
              <td class="num"><input type="text" inputmode="decimal" aria-label="Preço com desconto de ${pqE(x.item)}" class="pc-in ${ruim ? 'ruim' : ''}" value="${x.preco ? pqN(x.preco) : ''}" ${fixa ? 'disabled' : ''} onchange="pcEdPreco('${x.item}', this.value)"></td>
              <td class="num"><input type="text" inputmode="decimal" aria-label="Desconto em % de ${pqE(x.item)}" class="pc-in pc-in-p ${ruim ? 'ruim' : ''}" value="${x.pct ? String(x.pct).replace('.', ',') : ''}" ${fixa ? 'disabled' : ''} onchange="pcEdPct('${x.item}', this.value)"> %</td>
              <td class="num pm-mc">${m ? `<b class="${m.mc >= 0 ? (m.pct < 10 ? 'pm-baixa' : 'mc-pos') : 'mc-neg'}">R$ ${pqN(m.mc)}</b><small>${pqN(m.pct, 1)}%</small>` : '<small class="text-muted">—</small>'}</td>
              <td><button class="btn-out btn btn-sm" onclick="pcEdRemover('${x.item}')">Remover</button></td></tr>`; }).join('')
            : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:26px;">${e.linhas.length ? 'Nenhum anúncio com essa busca.' : 'Nenhum anúncio ainda. Clique em "Adicionar anúncios".'}</td></tr>`}
          </tbody></table></div>
          <div class="text-muted" style="font-size:12px;padding:12px 18px;line-height:1.5;">O Mercado Livre aceita descontos de 5% a 80%. A margem usa o custo, o imposto, a tarifa e o frete de cada anúncio; "—" quer dizer produto sem custo no cadastro.</div></div>`;
    }
