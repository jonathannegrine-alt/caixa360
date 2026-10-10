// ===== VENDAS ML + RESUMO FINANCEIRO =====
// Dados: tabela vendas_ml (Supabase), alimentada pela Edge Function ml-vendas.
// Custo e imposto (%) vêm do cadastro de Produtos (skus[]).
// Margem de contribuição = valor dos produtos − custo − imposto − tarifa − frete do vendedor.

    let vmlDados = [];                 // vendas do período carregado
    let vmlPeriodo = null;             // { de, ate } carregado
    let vmlCarregando = false;
    let vmlSync = { rodando:false, msg:'' };
    let vmlFreteComprador = localStorage.getItem('mk_vml_frete_comp') === '1';

    // filtros — página Vendas
    let vdFiltro = { de:null, ate:null, atalho:'hoje', status:'todas', logistica:'todas', campo:'sku', termo:'', semCusto:false, pagina:1, porPagina:40 };
    // filtros — Resumo Financeiro
    let rfFiltro = { de:null, ate:null, pedido:'', titulo:'', sku:'', status:'aprovadas', modalidade:'todas', frete:'todos', custo:'todos', pagina:1, porPagina:50, ordem:'data', desc:true };

    const VML_LOGISTICA = { fulfillment:'Full', self_service:'Flex', cross_docking:'Coleta', drop_off:'Agência', xd_drop_off:'Places', default:'Outros' };
    const VML_MODALIDADE = { gold_pro:'Premium', gold_special:'Clássico', gold_premium:'Premium', free:'Grátis' };

    function vmlEsc(s){
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function vmlNum(n){ return (Number(n) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }
    function vmlPct(n){ return (isFinite(n) ? n : 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%'; }
    function vmlLogistica(v){ return VML_LOGISTICA[v.logistic_type] || 'Outros'; }
    function vmlModalidade(v){ return VML_MODALIDADE[v.listing_type] || (v.listing_type || '—'); }
    function vmlStatus(v){ return v.status === 'paid' ? 'aprovada' : (v.status === 'cancelled' ? 'cancelada' : 'pendente'); }
    function vmlDataBRT(iso){
      // data_venda é timestamptz — converte para data/hora de Brasília
      const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString();
      return { dia: d.substring(0,10), hora: d.substring(11,16) };
    }
    function vmlCopiar(txt, el){
      if(navigator.clipboard) navigator.clipboard.writeText(String(txt));
      if(el){ const o = el.textContent; el.textContent = '✓'; setTimeout(() => { el.textContent = o; }, 900); }
    }

    // Custo/imposto do SKU no cadastro de Produtos
    function vmlSkuInfo(sku){
      if(!sku) return null;
      const k = String(sku).trim().toUpperCase();
      return skus.find(s => String(s.sku || '').trim().toUpperCase() === k) || null;
    }

    // Números financeiros de uma venda
    function vmlCalc(v){
      const qtd = Number(v.qtd) || 1;
      const bruto = (Number(v.preco_unit) || 0) * qtd;
      const freteComp = Number(v.frete_comprador) || 0;
      const freteVend = Number(v.frete_vendedor) || 0;
      const tarifa = Number(v.tarifa) || 0;
      const info = vmlSkuInfo(v.sku);
      const temCusto = !!info && (Number(info.custo) || 0) > 0;
      const temImposto = !!info && (Number(info.imposto) || 0) > 0;
      const custo = temCusto ? Number(info.custo) * qtd : 0;
      const imposto = temImposto ? bruto * Number(info.imposto) / 100 : 0;
      const mc = bruto - custo - imposto - tarifa - freteVend;
      return {
        qtd, bruto, freteComp, freteVend, tarifa, custo, imposto, mc,
        faturamento: bruto + freteComp,
        liquidoML: bruto - tarifa - freteVend,
        mcPct: bruto > 0 ? mc / bruto * 100 : 0,
        temCusto, temImposto, fretePendente: v.frete_vendedor == null
      };
    }

    // ----- dados -----
    async function vmlCarregar(de, ate){
      if(!usuarioAtual) return;
      vmlCarregando = true;
      const rows = [];
      for(let from = 0; from < 60000; from += 1000){
        const { data, error } = await supa.from('vendas_ml').select('*')
          .eq('usuario_id', usuarioAtual.id)
          .gte('data_venda', de + 'T00:00:00-03:00')
          .lte('data_venda', ate + 'T23:59:59.999-03:00')
          .order('data_venda', {ascending:false})
          .range(from, from + 999);
        if(error || !data || data.length === 0) break;
        rows.push(...data);
        if(data.length < 1000) break;
      }
      vmlDados = rows;
      vmlPeriodo = { de, ate };
      vmlCarregando = false;
    }

    // Busca as vendas no ML (em blocos de até 7 dias) e recarrega do banco
    async function vmlSincronizar(de, ate, aoTerminar){
      if(vmlSync.rodando || !usuarioAtual) return;
      vmlSync = { rodando:true, msg:'Buscando vendas no Mercado Livre…' };
      vmlAtualizarSync();
      try {
        const { data: sessao } = await supa.auth.getSession();
        const jwt = sessao?.session?.access_token;
        let ini = de, erro = null, aviso = null;
        while(ini <= ate && !erro){
          const fim = addDias(ini, 6) < ate ? addDias(ini, 6) : ate;
          for(let tent = 0; tent < 8; tent++){
            vmlSync.msg = `Buscando vendas de ${ptDate(ini)}${fim !== ini ? ' a ' + ptDate(fim) : ''}…`;
            vmlAtualizarSync();
            const { data, error } = await supa.functions.invoke('ml-vendas', {
              headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}, body: { de: ini, ate: fim }
            });
            if(error || data?.error){ erro = data?.error || error?.message; if(data?.detail) erro += ' — ' + data.detail; break; }
            if(data.aviso) aviso = data.aviso;
            if(!data.pendentes) break;      // tudo gravado com frete
          }
          ini = addDias(fim, 1);
        }
        vmlSync = { rodando:false, msg: erro ? '❌ ' + erro : (aviso ? '⚠️ ' + aviso : 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})) };
        await vmlCarregar(de, ate);
      } catch(e){
        vmlSync = { rodando:false, msg:'❌ ' + e.message };
      }
      if(aoTerminar) aoTerminar();
    }

    function vmlAtualizarSync(){
      document.querySelectorAll('.vml-sync').forEach(el => {
        el.innerHTML = `<span class="sync-dot ${vmlSync.rodando ? 'run' : ''}"></span>${vmlEsc(vmlSync.msg || 'Dados do Mercado Livre')}`;
      });
    }

    function vmlAtalho(atalho){
      const h = getToday();
      if(atalho === 'ontem') return { de:addDias(h,-1), ate:addDias(h,-1) };
      if(atalho === '7d') return { de:addDias(h,-6), ate:h };
      if(atalho === '30d') return { de:addDias(h,-29), ate:h };
      if(atalho === 'mes') return { de:h.substring(0,8) + '01', ate:h };
      return { de:h, ate:h };
    }

    // Garante dados do período: carrega do banco e, se for a 1ª vez do período, busca no ML
    async function vmlGarantir(de, ate, render){
      if(vmlPeriodo && vmlPeriodo.de === de && vmlPeriodo.ate === ate) return;
      await vmlCarregar(de, ate);
      render();
      vmlSincronizar(de, ate, render);   // segundo plano
    }

    // ===================================================================
    // PÁGINA VENDAS
    // ===================================================================
    function vdFiltrar(){
      const t = vdFiltro.termo.trim().toLowerCase();
      return vmlDados.filter(v => {
        const st = vmlStatus(v);
        if(vdFiltro.status === 'aprovadas' && st !== 'aprovada') return false;
        if(vdFiltro.status === 'canceladas' && st !== 'cancelada') return false;
        if(vdFiltro.status === 'pendentes' && st !== 'pendente') return false;
        if(vdFiltro.logistica !== 'todas' && vmlLogistica(v) !== vdFiltro.logistica) return false;
        if(vdFiltro.semCusto){ const c = vmlCalc(v); if(c.temCusto && c.temImposto) return false; }
        if(t){
          const campos = {
            sku: v.sku, venda: v.order_id, carrinho: v.pack_id, mlb: v.item_id,
            apelido: v.comprador_apelido, nome: v.comprador_nome, titulo: v.titulo
          };
          if(!String(campos[vdFiltro.campo] == null ? '' : campos[vdFiltro.campo]).toLowerCase().includes(t)) return false;
        }
        return true;
      });
    }

    async function renderVendas(){
      const el = document.getElementById('view-vendas');
      if(!el) return;
      if(!vdFiltro.de){ const p = vmlAtalho('hoje'); vdFiltro.de = p.de; vdFiltro.ate = p.ate; }
      if(!vmlPeriodo || vmlPeriodo.de !== vdFiltro.de || vmlPeriodo.ate !== vdFiltro.ate){
        el.innerHTML = '<div class="vazio"><b>Carregando vendas…</b></div>';
        await vmlGarantir(vdFiltro.de, vdFiltro.ate, vdDesenhar);
      }
      vdDesenhar();
    }

    function vdDesenhar(){
      const el = document.getElementById('view-vendas');
      if(!el || !document.getElementById('view-vendas').classList.contains('active')) return;
      const lista = vdFiltrar();
      const aprov = vmlDados.filter(v => vmlStatus(v) === 'aprovada');
      const tot = aprov.reduce((a,v) => { const c = vmlCalc(v); a.bruto += c.bruto; a.mc += c.mc; a.un += c.qtd; return a; }, {bruto:0, mc:0, un:0});
      const canc = vmlDados.filter(v => vmlStatus(v) === 'cancelada').length;
      const cont = k => vmlDados.filter(v => vmlLogistica(v) === k).length;
      const paginas = Math.max(1, Math.ceil(lista.length / vdFiltro.porPagina));
      if(vdFiltro.pagina > paginas) vdFiltro.pagina = paginas;
      const pag = lista.slice((vdFiltro.pagina - 1) * vdFiltro.porPagina, vdFiltro.pagina * vdFiltro.porPagina);
      const porCarrinho = {};
      vmlDados.forEach(v => { if(v.pack_id) porCarrinho[v.pack_id] = (porCarrinho[v.pack_id] || 0) + 1; });
      const atalhos = [['hoje','Hoje'],['ontem','Ontem'],['7d','7 dias'],['30d','30 dias'],['mes','Mês atual']];
      const logs = ['Full','Flex','Coleta','Agência','Places','Outros'].filter(k => cont(k) > 0);

      el.innerHTML = `
        <div class="pg-head">
          <div>
            <div class="pg-title">Vendas</div>
            <div class="pg-sub">Suas vendas do Mercado Livre com custo, tarifa, frete e margem de cada pedido.</div>
          </div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
            <span class="sync-bar vml-sync"></span>
            <button class="btn-out btn btn-sm" onclick="vdAtualizar()">↻ Atualizar</button>
            <button class="btn-out btn btn-sm" onclick="vdExportar()">⬇ Exportar .xlsx</button>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi k-venda"><div class="kpi-label">Vendas aprovadas</div><div class="kpi-value">${aprov.length}</div><div class="kpi-sub"><span><b>${tot.un}</b> unidades</span><span><b>${canc}</b> canceladas</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Faturamento (produtos)</div><div class="kpi-value">R$ ${vmlNum(tot.bruto)}</div><div class="kpi-sub"><span>Ticket médio <b>R$ ${vmlNum(aprov.length ? tot.bruto / aprov.length : 0)}</b></span></div></div>
          <div class="kpi k-mc"><div class="kpi-label">Margem de contribuição</div><div class="kpi-value">R$ ${vmlNum(tot.mc)}</div><div class="kpi-sub"><span><b>${vmlPct(tot.bruto ? tot.mc / tot.bruto * 100 : 0)}</b> do faturamento</span></div></div>
        </div>

        <div class="card"><div class="card-body">
          <div class="chips" style="margin-bottom:14px;">
            ${atalhos.map(([k,l]) => `<button class="chip ${vdFiltro.atalho === k ? 'active' : ''}" onclick="vdSetAtalho('${k}')">${l}</button>`).join('')}
            <span style="display:inline-flex;gap:6px;align-items:center;margin-left:6px;">
              <input type="date" value="${vdFiltro.de}" onchange="vdSetData('de', this.value)" style="width:150px;">
              <span class="text-muted">até</span>
              <input type="date" value="${vdFiltro.ate}" onchange="vdSetData('ate', this.value)" style="width:150px;">
            </span>
          </div>
          <div class="filtros">
            <div><label>Buscar por</label>
              <select onchange="vdFiltro.campo=this.value">
                ${[['sku','SKU'],['venda','Nº da venda'],['carrinho','Nº do carrinho'],['mlb','ID do anúncio (MLB)'],['titulo','Título do anúncio'],['apelido','Apelido do comprador'],['nome','Nome do comprador']]
                  .map(([k,l]) => `<option value="${k}" ${vdFiltro.campo === k ? 'selected' : ''}>${l}</option>`).join('')}
              </select></div>
            <div style="grid-column:span 2;"><label>Termo de busca</label>
              <input type="text" id="vd-termo" placeholder="Digite e pressione Enter" value="${vmlEsc(vdFiltro.termo)}" onkeydown="if(event.key==='Enter'){vdFiltro.termo=this.value;vdFiltro.pagina=1;vdDesenhar();}"></div>
            <div><button class="btn btn-sm" style="width:100%;padding:9px;" onclick="vdFiltro.termo=document.getElementById('vd-termo').value;vdFiltro.pagina=1;vdDesenhar();">Filtrar</button></div>
          </div>
        </div></div>

        <div class="chips" style="margin:2px 0 14px;">
          ${[['todas','Todas',vmlDados.length],['aprovadas','Aprovadas',aprov.length],['pendentes','Pgto. pendente',vmlDados.filter(v => vmlStatus(v) === 'pendente').length],['canceladas','Canceladas',canc]]
            .map(([k,l,n]) => `<button class="chip ${vdFiltro.status === k ? 'active' : ''}" onclick="vdFiltro.status='${k}';vdFiltro.pagina=1;vdDesenhar();">${l}<span class="n">${n}</span></button>`).join('')}
          <span style="width:1px;background:var(--border);margin:0 6px;"></span>
          <button class="chip ${vdFiltro.logistica === 'todas' ? 'active' : ''}" onclick="vdFiltro.logistica='todas';vdFiltro.pagina=1;vdDesenhar();">Todos os envios</button>
          ${logs.map(k => `<button class="chip ${vdFiltro.logistica === k ? 'active' : ''}" onclick="vdFiltro.logistica='${k}';vdFiltro.pagina=1;vdDesenhar();">${k}<span class="n">${cont(k)}</span></button>`).join('')}
          <span style="width:1px;background:var(--border);margin:0 6px;"></span>
          <button class="chip ${vdFiltro.semCusto ? 'active' : ''}" onclick="vdFiltro.semCusto=!vdFiltro.semCusto;vdFiltro.pagina=1;vdDesenhar();">Sem custo ou imposto</button>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">${lista.length} venda${lista.length === 1 ? '' : 's'}</div>
            ${vmlPaginacao(vdFiltro.pagina, paginas, 'vdIr')}
          </div>
          <div>
            ${pag.length ? pag.map(v => vdCard(v, porCarrinho)).join('') : `<div class="vazio"><b>Nenhuma venda encontrada</b>${vmlSync.rodando ? 'Buscando no Mercado Livre…' : 'Ajuste o período ou os filtros.'}</div>`}
          </div>
          ${pag.length ? `<div class="card-header" style="border-bottom:none;border-top:1px solid var(--border);"><span class="text-muted">Página ${vdFiltro.pagina} de ${paginas}</span>${vmlPaginacao(vdFiltro.pagina, paginas, 'vdIr')}</div>` : ''}
        </div>`;
      vmlAtualizarSync();
    }

    function vdCard(v, porCarrinho){
      const c = vmlCalc(v);
      const st = vmlStatus(v);
      const dt = vmlDataBRT(v.data_venda);
      const log = vmlLogistica(v);
      const nCart = v.pack_id ? (porCarrinho[v.pack_id] || 1) : 1;
      const nota = vmlNotas()[v.order_id] || '';
      const cp = (txt) => `<button class="ico-btn" style="width:20px;height:20px;border:none;background:none;" title="Copiar" onclick="vmlCopiar('${vmlEsc(txt)}', this)">⧉</button>`;
      const linha = (rot, val, cls, tit) => `<div class="${cls || ''}" ${tit ? `title="${tit}"` : ''}><span>${rot}</span><span>${val}</span></div>`;
      return `
        <div class="venda ${st === 'cancelada' ? 'cancelada' : ''}">
          <div class="v-comp">
            <div class="nome">${vmlEsc(v.comprador_nome || v.comprador_apelido || 'Comprador')} ${v.comprador_nome ? cp(v.comprador_nome) : ''}</div>
            <div>${vmlEsc(v.comprador_apelido || '')} ${v.comprador_apelido ? cp(v.comprador_apelido) : ''}</div>
            <div><a class="v-id" href="https://www.mercadolivre.com.br/vendas/${v.order_id}/detalhe" target="_blank" rel="noopener" title="Ver os detalhes do pedido no ML">Venda: #${v.order_id}</a> ${cp(v.order_id)}</div>
            ${v.pack_id ? `<div><span class="v-id" onclick="vdCarrinho('${v.pack_id}')" title="Ver os itens do carrinho">Carrinho: #${v.pack_id}</span> ${cp(v.pack_id)}</div>` : ''}
            <div><b>Data:</b> ${ptDate(dt.dia)} - ${dt.hora}</div>
            <div style="margin-top:4px;"><button class="ico-btn" style="width:auto;padding:0 8px;gap:5px;" onclick="vdNota('${v.order_id}')" title="Anotação da venda">✎ ${nota ? vmlEsc(nota.length > 22 ? nota.slice(0,22) + '…' : nota) : 'Anotar'}</button></div>
          </div>

          <div class="v-prod">
            ${v.thumbnail ? `<img class="v-thumb" src="${vmlEsc(v.thumbnail)}" loading="lazy" alt="">` : '<div class="v-thumb"></div>'}
            <div style="min-width:0;">
              <div class="v-tit"><span class="v-qtd">${c.qtd}x</span>${vmlEsc(v.titulo || '—')}</div>
              <div class="v-meta">
                <span><b>SKU:</b> ${vmlEsc(v.sku || 'sem SKU')}</span>${v.sku ? cp(v.sku) : ''}
                <button class="ico-btn" title="Alterar custo e imposto deste SKU" onclick="vdEditarCusto('${v.order_id}')">⚖</button>
              </div>
              <div class="v-meta">
                <span class="v-tag">${vmlEsc(vmlModalidade(v))}</span>
                <span class="v-tag ${log === 'Full' ? 'full' : (log === 'Flex' ? 'flex' : '')}">${log === 'Full' ? '⚡ ' : ''}${log}</span>
                ${nCart > 1 ? `<span class="v-tag cart" onclick="vdCarrinho('${v.pack_id}')">🛒 +${nCart - 1} produto${nCart > 2 ? 's' : ''}</span>` : ''}
                ${v.item_id ? `<a href="https://produto.mercadolivre.com.br/${String(v.item_id).replace(/^MLB/, 'MLB-')}" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:none;" title="Ver o anúncio no ML">${vmlEsc(v.item_id)}</a>${cp(v.item_id)}` : ''}
              </div>
              <div class="v-meta"><span class="v-preco">R$ ${vmlNum(v.preco_unit)}</span>${v.variacao ? `<span>${vmlEsc(v.variacao)}</span>` : ''}</div>
            </div>
          </div>

          <div class="v-fin">
            ${linha('Recebido', 'R$ ' + vmlNum(c.faturamento), 'pos', 'Valor dos produtos + frete pago pelo comprador')}
            ${linha('Frete', c.fretePendente ? '…' : '-R$ ' + vmlNum(c.freteVend + c.freteComp), 'neg', 'Frete do comprador + frete do vendedor')}
            ${linha('Tarifa de venda', '-R$ ' + vmlNum(c.tarifa), 'neg')}
            ${linha('Líquido ML', 'R$ ' + vmlNum(c.liquidoML), 'sub')}
            ${linha('Custo', c.temCusto ? '-R$ ' + vmlNum(c.custo) : 'sem custo', c.temCusto ? 'neg' : 'neg sem-custo')}
            ${linha('Imposto', c.temImposto ? '-R$ ' + vmlNum(c.imposto) : 'sem imposto', c.temImposto ? 'neg' : 'neg sem-custo')}
            <div class="mc" ${c.temCusto && c.temImposto ? '' : 'title="Margem incompleta: falta custo ou imposto no cadastro do produto"'}><span>Margem${c.temCusto && c.temImposto ? '' : ' *'}</span><span class="${!(c.temCusto && c.temImposto) ? 'sem-custo' : (c.mc >= 0 ? 'mc-pos' : 'mc-neg')}">R$ ${vmlNum(c.mc)} <small>(${vmlPct(c.mcPct)})</small></span></div>
          </div>

          <div class="v-acoes">
            <div class="v-status ${st === 'aprovada' ? 'ok' : (st === 'cancelada' ? 'canc' : 'pend')}">${st === 'aprovada' ? 'Aprovada' : (st === 'cancelada' ? 'Cancelada' : 'Pagamento pendente')}</div>
            <a class="btn-out btn btn-sm" style="text-align:center;text-decoration:none;" href="https://www.mercadolivre.com.br/vendas/${v.order_id}/detalhe" target="_blank" rel="noopener">Abrir no ML ↗</a>
            <button class="btn-out btn btn-sm" onclick="vdPagamento('${v.order_id}')">Detalhes</button>
          </div>
        </div>`;
    }

    function vmlPaginacao(atual, total, fn){
      if(total <= 1) return '<div></div>';
      const nums = [];
      for(let p = Math.max(1, atual - 2); p <= Math.min(total, atual + 2); p++) nums.push(p);
      return `<div class="pag">
        <button ${atual === 1 ? 'disabled' : ''} onclick="${fn}(1)">«</button>
        <button ${atual === 1 ? 'disabled' : ''} onclick="${fn}(${atual - 1})">‹</button>
        ${nums.map(p => `<button class="${p === atual ? 'active' : ''}" onclick="${fn}(${p})">${p}</button>`).join('')}
        <button ${atual === total ? 'disabled' : ''} onclick="${fn}(${atual + 1})">›</button>
        <button ${atual === total ? 'disabled' : ''} onclick="${fn}(${total})">»</button>
      </div>`;
    }

    function vdIr(p){ vdFiltro.pagina = p; vdDesenhar(); document.querySelector('.main').scrollTo?.(0,0); window.scrollTo(0,0); }
    function vdSetAtalho(k){ const p = vmlAtalho(k); vdFiltro.atalho = k; vdFiltro.de = p.de; vdFiltro.ate = p.ate; vdFiltro.pagina = 1; renderVendas(); }
    function vdSetData(campo, val){
      if(!val) return;
      vdFiltro[campo] = val; vdFiltro.atalho = '';
      if(vdFiltro.ate < vdFiltro.de){ if(campo === 'de') vdFiltro.ate = val; else vdFiltro.de = val; }
      vdFiltro.pagina = 1; renderVendas();
    }
    function vdAtualizar(){ vmlSincronizar(vdFiltro.de, vdFiltro.ate, vdDesenhar); }

    // ----- janelas -----
    function vmlModal(titulo, corpo, rodape){
      let m = document.getElementById('modal-vml');
      if(!m){
        m = document.createElement('div'); m.id = 'modal-vml'; m.className = 'modal';
        m.addEventListener('click', e => { if(e.target === m) m.classList.remove('open'); });
        document.body.appendChild(m);
      }
      m.innerHTML = `<div class="modal-content" style="max-width:720px;">
        <div class="modal-header"><div class="modal-title">${titulo}</div><button class="ico-btn" onclick="fecharModal('modal-vml')">✕</button></div>
        <div class="modal-body">${corpo}</div>
        <div class="modal-footer">${rodape || `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>`}</div>
      </div>`;
      m.classList.add('open');
    }

    function vdAchar(orderId){ return vmlDados.find(v => String(v.order_id) === String(orderId)); }

    function vdCarrinho(packId){
      const itens = vmlDados.filter(v => String(v.pack_id) === String(packId));
      vmlModal('Carrinho: ' + packId, `
        <div class="alert alert-info">Os produtos abaixo foram vendidos no mesmo carrinho e seguem no mesmo frete (o custo do frete é dividido entre eles).</div>
        ${itens.map(v => `<div class="d-flex gap-2" style="align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
          ${v.thumbnail ? `<img class="v-thumb" src="${vmlEsc(v.thumbnail)}" alt="">` : '<div class="v-thumb"></div>'}
          <div><div class="text-muted">#${v.order_id}</div><div class="v-tit"><span class="v-qtd">${v.qtd}x</span>${vmlEsc(v.titulo)}</div><div class="text-muted">SKU: ${vmlEsc(v.sku || '—')} · R$ ${vmlNum(v.preco_unit)}</div></div>
        </div>`).join('')}`);
    }

    function vdPagamento(orderId){
      const v = vdAchar(orderId); if(!v) return;
      const c = vmlCalc(v), dt = vmlDataBRT(v.data_venda);
      const l = (a,b) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);"><span class="text-muted">${a}</span><b>${b}</b></div>`;
      vmlModal('Detalhes da venda #' + v.order_id, `
        <div class="v-tit" style="margin-bottom:10px;"><span class="v-qtd">${c.qtd}x</span>${vmlEsc(v.titulo)}</div>
        <div class="responsive-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:0 26px;">
          <div>
            ${l('Data da venda', ptDate(dt.dia) + ' ' + dt.hora)}
            ${l('Status', vmlStatus(v))}
            ${l('Comprador', vmlEsc(v.comprador_nome || v.comprador_apelido || '—'))}
            ${l('Anúncio', vmlEsc(v.item_id || '—') + ' · ' + vmlEsc(vmlModalidade(v)))}
            ${l('Envio', vmlLogistica(v) + (v.shipping_id ? ' · #' + v.shipping_id : ''))}
            ${l('Total pago pelo comprador', 'R$ ' + vmlNum(v.total_pago))}
          </div>
          <div>
            ${l('Valor dos produtos', 'R$ ' + vmlNum(c.bruto))}
            ${l('Frete pago pelo comprador', 'R$ ' + vmlNum(c.freteComp))}
            ${l('Frete pago pelo vendedor', c.fretePendente ? 'buscando…' : '-R$ ' + vmlNum(c.freteVend))}
            ${l('Tarifa de venda', '-R$ ' + vmlNum(c.tarifa))}
            ${l('Custo do produto', c.temCusto ? '-R$ ' + vmlNum(c.custo) : 'não cadastrado')}
            ${l('Imposto', c.temImposto ? '-R$ ' + vmlNum(c.imposto) : 'não cadastrado')}
            ${l('Margem de contribuição', `<span class="${c.mc >= 0 ? 'mc-pos' : 'mc-neg'}">R$ ${vmlNum(c.mc)} (${vmlPct(c.mcPct)})</span>`)}
          </div>
        </div>`);
    }

    function vdEditarCusto(orderId){
      const v = vdAchar(orderId); if(!v) return;
      if(!v.sku){ vmlModal('Custo & Imposto', '<div class="alert alert-warning">Este anúncio não tem SKU no Mercado Livre. Cadastre o SKU no anúncio para vincular custo e imposto.</div>'); return; }
      const info = vmlSkuInfo(v.sku) || {};
      vmlModal('Custo & Imposto do SKU', `
        <div class="v-tit" style="margin-bottom:4px;">${vmlEsc(v.titulo)}</div>
        <div class="text-muted" style="margin-bottom:16px;">SKU <b>${vmlEsc(v.sku)}</b> · Preço unitário R$ ${vmlNum(v.preco_unit)}</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Custo unitário (R$)</label><input type="number" step="0.01" min="0" id="vml-custo" value="${Number(info.custo) || ''}"></div>
          <div class="form-group"><label class="form-label">Imposto (% sobre a venda)</label><input type="number" step="0.01" min="0" id="vml-imposto" value="${Number(info.imposto) || ''}"></div>
        </div>
        <div class="alert alert-info">O valor fica salvo no cadastro de <b>Produtos</b> e vale para todas as vendas deste SKU.</div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="vdSalvarCusto('${vmlEsc(v.sku)}','${orderId}')">Salvar</button>`);
    }

    function vdSalvarCusto(sku, orderId){
      const custo = parseFloat(document.getElementById('vml-custo').value) || 0;
      const imposto = parseFloat(document.getElementById('vml-imposto').value) || 0;
      const info = vmlSkuInfo(sku);
      if(info){ info.custo = custo; info.imposto = imposto; }
      else {
        const v = vdAchar(orderId);
        skus.push({ sku: String(sku).trim().toUpperCase(), titulo: v ? v.titulo : '', custo, imposto, created_at: new Date().toISOString() });
      }
      salvar();
      fecharModal('modal-vml');
      vmlRedesenhar();
    }

    function vmlRedesenhar(){
      if(document.getElementById('view-vendas').classList.contains('active')) vdDesenhar();
      if(document.getElementById('view-resumo-fin').classList.contains('active')) rfDesenhar();
    }

    // Anotações por venda (ficam neste navegador)
    function vmlNotas(){ try { return JSON.parse(localStorage.getItem('mk_vml_notas') || '{}'); } catch(e){ return {}; } }
    function vdNota(orderId){
      const atual = vmlNotas()[orderId] || '';
      vmlModal('Anotação da venda #' + orderId,
        `<textarea id="vml-nota" rows="4" placeholder="Escreva uma anotação para esta venda">${vmlEsc(atual)}</textarea>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="vdSalvarNota('${orderId}')">Salvar</button>`);
    }
    function vdSalvarNota(orderId){
      const n = vmlNotas(); const t = document.getElementById('vml-nota').value.trim();
      if(t) n[orderId] = t; else delete n[orderId];
      localStorage.setItem('mk_vml_notas', JSON.stringify(n));
      fecharModal('modal-vml'); vdDesenhar();
    }

    // Linhas para exportação (Vendas e Resumo usam o mesmo formato)
    function vmlLinhasExport(lista){
      return lista.map(v => {
        const c = vmlCalc(v), dt = vmlDataBRT(v.data_venda);
        return {
          'Data': ptDate(dt.dia), 'Hora': dt.hora, 'Venda': String(v.order_id), 'Carrinho': v.pack_id ? String(v.pack_id) : '',
          'Status': vmlStatus(v), 'Anúncio': v.titulo || '', 'MLB': v.item_id || '', 'SKU': v.sku || '',
          'Modalidade': vmlModalidade(v), 'Envio': vmlLogistica(v), 'Comprador': v.comprador_nome || v.comprador_apelido || '',
          'Qtd': c.qtd, 'Valor unit.': Number(v.preco_unit) || 0, 'Valor produtos': c.bruto, 'Frete comprador': c.freteComp,
          'Custo': c.custo, 'Imposto': c.imposto, 'Tarifa de venda': c.tarifa, 'Frete vendedor': c.freteVend,
          'Margem contrib.': Math.round(c.mc * 100) / 100, 'MC %': Math.round(c.mcPct * 100) / 100
        };
      });
    }
    function vmlBaixar(lista, nome, formato){
      const linhas = vmlLinhasExport(lista);
      if(!linhas.length){ alert('Não há vendas para exportar.'); return; }
      const ws = XLSX.utils.json_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Vendas');
      XLSX.writeFile(wb, nome + (formato === 'csv' ? '.csv' : '.xlsx'), formato === 'csv' ? { bookType:'csv' } : undefined);
    }
    function vdExportar(){ vmlBaixar(vdFiltrar(), `vendas_${vdFiltro.de}_${vdFiltro.ate}`, 'xlsx'); }

    // ===================================================================
    // RESUMO FINANCEIRO
    // ===================================================================
    function rfFiltrar(ignorarStatus){
      const f = rfFiltro;
      const ped = f.pedido.trim(), tit = f.titulo.trim().toLowerCase(), sku = f.sku.trim().toLowerCase();
      return vmlDados.filter(v => {
        const st = vmlStatus(v);
        if(!ignorarStatus){
          if(f.status === 'aprovadas' && st !== 'aprovada') return false;
          if(f.status === 'canceladas' && st !== 'cancelada') return false;
        }
        if(ped && !(String(v.order_id).includes(ped) || String(v.pack_id || '').includes(ped))) return false;
        if(tit && !(String(v.titulo || '').toLowerCase().includes(tit) || String(v.item_id || '').toLowerCase().includes(tit))) return false;
        if(sku && !String(v.sku || '').toLowerCase().includes(sku)) return false;
        if(f.modalidade !== 'todas' && vmlModalidade(v) !== f.modalidade) return false;
        if(f.frete !== 'todos' && vmlLogistica(v) !== f.frete) return false;
        if(f.custo !== 'todos'){
          const c = vmlCalc(v);
          if(f.custo === 'sem-custo' && c.temCusto) return false;
          if(f.custo === 'sem-imposto' && c.temImposto) return false;
          if(f.custo === 'sem-um' && c.temCusto && c.temImposto) return false;
          if(f.custo === 'sem-ambos' && (c.temCusto || c.temImposto)) return false;
        }
        return true;
      });
    }

    async function renderResumoFin(){
      const el = document.getElementById('view-resumo-fin');
      if(!el) return;
      if(!rfFiltro.de){ rfFiltro.de = getToday(); rfFiltro.ate = getToday(); }
      if(!vmlPeriodo || vmlPeriodo.de !== rfFiltro.de || vmlPeriodo.ate !== rfFiltro.ate){
        el.innerHTML = '<div class="vazio"><b>Carregando resumo…</b></div>';
        await vmlGarantir(rfFiltro.de, rfFiltro.ate, rfDesenhar);
      }
      rfDesenhar();
    }

    function rfTotais(){
      const todas = rfFiltrar(true);
      const aprov = todas.filter(v => vmlStatus(v) === 'aprovada');
      const canc = todas.filter(v => vmlStatus(v) === 'cancelada');
      const t = { bruto:0, freteComp:0, freteVend:0, tarifa:0, custo:0, imposto:0, mc:0, un:0, porLog:{} };
      aprov.forEach(v => {
        const c = vmlCalc(v);
        t.bruto += c.bruto; t.freteComp += c.freteComp; t.freteVend += c.freteVend; t.tarifa += c.tarifa;
        t.custo += c.custo; t.imposto += c.imposto; t.mc += c.mc; t.un += c.qtd;
        const k = vmlLogistica(v); t.porLog[k] = (t.porLog[k] || 0) + c.bruto + (vmlFreteComprador ? c.freteComp : 0);
      });
      t.qtd = aprov.length; t.qtdCanc = canc.length;
      t.unCanc = canc.reduce((s,v) => s + (Number(v.qtd) || 1), 0);
      t.valCanc = canc.reduce((s,v) => s + vmlCalc(v).faturamento, 0);
      t.vendas = t.bruto + (vmlFreteComprador ? t.freteComp : 0);
      return t;
    }

    function rfDonut(partes){
      const total = partes.reduce((s,p) => s + Math.max(0, p.v), 0);
      if(total <= 0) return '<div class="vazio">Sem dados no período.</div>';
      const R = 70, C = 2 * Math.PI * R;
      let acum = 0;
      const arcos = partes.filter(p => p.v > 0).map(p => {
        const frac = p.v / total, dash = frac * C;
        const ang = (acum + frac / 2) * 2 * Math.PI - Math.PI / 2;
        const seg = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${p.cor}" stroke-width="34" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acum * C}" transform="rotate(-90 100 100)"><title>${p.nome}: R$ ${vmlNum(p.v)}</title></circle>`
          + (frac > 0.05 ? `<text x="${100 + Math.cos(ang) * R}" y="${100 + Math.sin(ang) * R + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${(frac * 100).toFixed(1)}%</text>` : '');
        acum += frac;
        return seg;
      }).join('');
      return `<div class="donut-wrap">
        <svg viewBox="0 0 200 200" width="210" height="210">${arcos}</svg>
        <div class="donut-leg">${partes.map(p => `<div><i style="background:${p.cor}"></i>${p.nome} · <b>R$ ${vmlNum(p.v)}</b></div>`).join('')}</div>
      </div>`;
    }

    const RF_COLS = [
      ['titulo','Anúncio',''], ['sku','SKU',''], ['data','Data',''], ['envio','Frete',''], ['unit','Valor unit.','num'], ['qtd','Qtd.','num'],
      ['fat','Faturamento ML','num'], ['custo','Custo (−)','num'], ['imposto','Imposto (−)','num'], ['tarifa','Tarifa de venda (−)','num'],
      ['fcomp','Frete comprador','num'], ['fvend','Frete vendedor (−)','num'], ['mc','Margem contrib. (=)','num'], ['mcp','MC em %','num']
    ];
    function rfValor(v, col){
      const c = vmlCalc(v);
      return ({ titulo:(v.titulo || '').toLowerCase(), sku:(v.sku || '').toLowerCase(), data:v.data_venda, envio:vmlLogistica(v), unit:Number(v.preco_unit) || 0, qtd:c.qtd,
        fat:c.faturamento, custo:c.custo, imposto:c.imposto, tarifa:c.tarifa, fcomp:c.freteComp, fvend:c.freteVend, mc:c.mc, mcp:c.mcPct })[col];
    }

    function rfDesenhar(){
      const el = document.getElementById('view-resumo-fin');
      if(!el || !el.classList.contains('active')) return;
      const f = rfFiltro, t = rfTotais();
      const lista = rfFiltrar().sort((a,b) => {
        const x = rfValor(a, f.ordem), y = rfValor(b, f.ordem);
        return (x < y ? -1 : (x > y ? 1 : 0)) * (f.desc ? -1 : 1);
      });
      const paginas = Math.max(1, Math.ceil(lista.length / f.porPagina));
      if(f.pagina > paginas) f.pagina = paginas;
      const pag = lista.slice((f.pagina - 1) * f.porPagina, f.pagina * f.porPagina);
      const sel = (id, val, opts) => `<select onchange="rfFiltro.${id}=this.value;rfFiltro.pagina=1;rfDesenhar();">${opts.map(([k,l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const log = k => 'R$ ' + vmlNum(t.porLog[k] || 0);
      const outros = Object.keys(t.porLog).filter(k => !['Full','Flex','Coleta','Agência','Places'].includes(k)).reduce((s,k) => s + t.porLog[k], 0);

      el.innerHTML = `
        <div class="pg-head">
          <div>
            <div class="pg-title">Resumo Financeiro</div>
            <div class="pg-sub">Receitas, despesas e margem de contribuição das suas vendas no Mercado Livre.</div>
          </div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
            <span class="sync-bar vml-sync"></span>
            <button class="btn-out btn btn-sm" onclick="vmlSincronizar(rfFiltro.de, rfFiltro.ate, rfDesenhar)">↻ Atualizar</button>
            <button class="btn-out btn btn-sm" onclick="rfLegenda()">Legendas</button>
            <button class="btn-out btn btn-sm" onclick="rfRanking()">🏆 Ranking de produtos</button>
            <div class="dd-wrap" style="position:relative;display:inline-block;">
              <button class="btn btn-sm" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">⬇ Exportar ▾</button>
              <div class="dd-menu" style="display:none;position:absolute;right:0;top:110%;z-index:20;min-width:150px;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-lg);padding:6px;">
                <div class="dd-item" style="padding:8px 10px;cursor:pointer;border-radius:7px;" onclick="rfExportar('xlsx')">Excel (.xlsx)</div>
                <div class="dd-item" style="padding:8px 10px;cursor:pointer;border-radius:7px;" onclick="rfExportar('csv')">CSV</div>
              </div>
            </div>
          </div>
        </div>

        <div class="kpi-grid k5">
          <div class="kpi k-venda">
            <div class="kpi-label" title="Valor dos produtos${vmlFreteComprador ? ' + frete pago pelo comprador' : ''} das vendas aprovadas">Vendas aprovadas</div>
            <div class="kpi-value">R$ ${vmlNum(t.vendas)}</div>
            <div class="kpi-sub"><span>Canceladas <b>R$ ${vmlNum(t.valCanc)}</b></span></div>
            <label style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:11.5px;color:var(--text-muted);cursor:pointer;">
              <input type="checkbox" ${vmlFreteComprador ? 'checked' : ''} onchange="rfToggleFrete(this.checked)" style="width:auto;"> Considerar frete do comprador
            </label>
          </div>
          <div class="kpi k-custo"><div class="kpi-label" title="Valores do cadastro de Produtos">Custo &amp; imposto</div><div class="kpi-value">R$ ${vmlNum(t.custo + t.imposto)}</div><div class="kpi-sub"><span>Custo <b>R$ ${vmlNum(t.custo)}</b></span><span>Imposto <b>R$ ${vmlNum(t.imposto)}</b></span></div></div>
          <div class="kpi k-tarifa"><div class="kpi-label">Tarifa de venda</div><div class="kpi-value">R$ ${vmlNum(t.tarifa)}</div><div class="kpi-sub"><span><b>${vmlPct(t.bruto ? t.tarifa / t.bruto * 100 : 0)}</b> das vendas</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Frete total</div><div class="kpi-value">R$ ${vmlNum(t.freteComp + t.freteVend)}</div><div class="kpi-sub"><span>Comprador <b>R$ ${vmlNum(t.freteComp)}</b></span><span>Vendedor <b>R$ ${vmlNum(t.freteVend)}</b></span></div></div>
          <div class="kpi k-mc"><div class="kpi-label" title="Vendas aprovadas − custo − imposto − tarifa − frete do vendedor">Margem de contribuição</div><div class="kpi-value">R$ ${vmlNum(t.mc)}</div><div class="kpi-sub"><span><b>${vmlPct(t.bruto ? t.mc / t.bruto * 100 : 0)}</b></span></div></div>
        </div>
        <div class="kpi-grid k4">
          <div class="kpi k-neutro"><div class="kpi-label">Por tipo de envio</div>
            <div class="kpi-sub" style="margin-top:9px;display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;">
              <span>Full <b>${log('Full')}</b></span><span>Flex <b>${log('Flex')}</b></span>
              <span>Coleta <b>${log('Coleta')}</b></span><span>Agência/Places <b>R$ ${vmlNum((t.porLog['Agência'] || 0) + (t.porLog['Places'] || 0))}</b></span>
              <span>Outros <b>R$ ${vmlNum(outros)}</b></span>
            </div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Qtd. vendas aprovadas</div><div class="kpi-value">${t.qtd}</div><div class="kpi-sub"><span><b>${t.un}</b> unidades</span><span>Canceladas <b>${t.qtdCanc}</b> (${t.unCanc} un.)</span></div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Ticket médio por venda</div><div class="kpi-value">R$ ${vmlNum(t.qtd ? t.vendas / t.qtd : 0)}</div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Ticket médio da margem</div><div class="kpi-value">R$ ${vmlNum(t.qtd ? t.mc / t.qtd : 0)}</div><div class="kpi-sub"><span><b>${vmlPct(t.bruto ? t.mc / t.bruto * 100 : 0)}</b></span></div></div>
        </div>

        <div style="display:grid;grid-template-columns:minmax(0,1.9fr) minmax(280px,1fr);gap:16px;" class="responsive-grid-2">
          <div class="card"><div class="card-header"><div class="card-title">Filtrar busca</div></div><div class="card-body">
            <div class="filtros">
              <div style="grid-column:span 2;"><label>Data início</label><div class="dt-nav">
                <input type="date" value="${f.de}" onchange="rfSetData('de', this.value)">
                <button class="ico-btn" title="Dia anterior" onclick="rfMoverDia(-1)">‹</button>
                <button class="ico-btn" title="Próximo dia" onclick="rfMoverDia(1)">›</button></div></div>
              <div><label>Data fim</label><input type="date" value="${f.ate}" onchange="rfSetData('ate', this.value)"></div>
              <div><label>Nº pedido / carrinho</label><input type="text" value="${vmlEsc(f.pedido)}" onchange="rfFiltro.pedido=this.value;rfFiltro.pagina=1;rfDesenhar();"></div>
              <div><label>Título ou MLB</label><input type="text" value="${vmlEsc(f.titulo)}" onchange="rfFiltro.titulo=this.value;rfFiltro.pagina=1;rfDesenhar();"></div>
              <div><label>SKU</label><input type="text" value="${vmlEsc(f.sku)}" onchange="rfFiltro.sku=this.value;rfFiltro.pagina=1;rfDesenhar();"></div>
              <div><label>Status da venda</label>${sel('status', f.status, [['todas','Todos'],['aprovadas','Aprovados'],['canceladas','Cancelados']])}</div>
              <div><label>Modalidade</label>${sel('modalidade', f.modalidade, [['todas','Todos'],['Premium','Premium'],['Clássico','Clássico'],['Grátis','Grátis']])}</div>
              <div><label>Tipo do frete</label>${sel('frete', f.frete, [['todos','Todos'],['Full','Full'],['Flex','Flex'],['Coleta','Coleta'],['Agência','Agência'],['Places','Places'],['Outros','Outros']])}</div>
              <div><label>Custo &amp; imposto</label>${sel('custo', f.custo, [['todos','Todos'],['sem-custo','Somente vendas sem custo'],['sem-imposto','Somente vendas sem imposto'],['sem-um','Sem custo ou sem imposto'],['sem-ambos','Sem custo e sem imposto']])}</div>
            </div>
            <div class="chips" style="margin-top:14px;">
              ${[['hoje','Hoje'],['ontem','Ontem'],['7d','7 dias'],['30d','30 dias'],['mes','Mês atual']].map(([k,l]) => `<button class="chip" onclick="rfAtalho('${k}')">${l}</button>`).join('')}
            </div>
          </div></div>
          <div class="card"><div class="card-header"><div class="card-title">Para onde vai cada real</div></div><div class="card-body">
            ${rfDonut([
              { nome:'Frete', v:t.freteVend, cor:'#3b82f6' }, { nome:'Tarifa', v:t.tarifa, cor:'#eab308' },
              { nome:'M. contribuição', v:t.mc, cor:'#10b981' }, { nome:'Custo', v:t.custo, cor:'#f97316' }, { nome:'Imposto', v:t.imposto, cor:'#ef4444' }])}
            <div class="text-muted" style="font-size:11px;margin-top:10px;">* O frete pago pelo comprador não entra no gráfico.</div>
          </div></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">${lista.length} registro${lista.length === 1 ? '' : 's'}</div>
            ${vmlPaginacao(f.pagina, paginas, 'rfIr')}
          </div>
          <div style="overflow-x:auto;">
            <table class="rf-table">
              <thead><tr>${RF_COLS.map(([k,l,cls]) => `<th class="${cls}" onclick="rfOrdenar('${k}')">${l}${f.ordem === k ? (f.desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
              <tbody>
                ${pag.length ? pag.map(v => {
                  const c = vmlCalc(v), dt = vmlDataBRT(v.data_venda), canc = vmlStatus(v) === 'cancelada';
                  return `<tr style="${canc ? 'opacity:.55;' : ''}">
                    <td style="max-width:260px;">${vmlEsc(v.titulo || '—')}${canc ? ' <span class="badge badge-danger">cancelada</span>' : ''}</td>
                    <td>${vmlEsc(v.sku || '—')}</td>
                    <td>${ptDate(dt.dia)}</td>
                    <td>${vmlLogistica(v)}</td>
                    <td class="num">${vmlNum(v.preco_unit)}</td>
                    <td class="num">${c.qtd}</td>
                    <td class="num">${vmlNum(c.faturamento)}</td>
                    <td class="num ${c.temCusto ? '' : 'sem-custo'}">${c.temCusto ? vmlNum(c.custo) : '—'}</td>
                    <td class="num ${c.temImposto ? '' : 'sem-custo'}">${c.temImposto ? vmlNum(c.imposto) : '—'}</td>
                    <td class="num">${vmlNum(c.tarifa)}</td>
                    <td class="num">${vmlNum(c.freteComp)}</td>
                    <td class="num">${c.fretePendente ? '…' : vmlNum(c.freteVend)}</td>
                    <td class="num"><b class="${c.mc >= 0 ? 'mc-pos' : 'mc-neg'}">${vmlNum(c.mc)}</b></td>
                    <td class="num"><b class="${c.mc >= 0 ? 'mc-pos' : 'mc-neg'}">${vmlPct(c.mcPct)}</b></td>
                  </tr>`;
                }).join('') : `<tr><td colspan="${RF_COLS.length}"><div class="vazio"><b>Nenhuma venda no período</b>${vmlSync.rodando ? 'Buscando no Mercado Livre…' : 'Ajuste as datas ou os filtros.'}</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;
      vmlAtualizarSync();
    }

    function rfIr(p){ rfFiltro.pagina = p; rfDesenhar(); }
    function rfOrdenar(col){ if(rfFiltro.ordem === col) rfFiltro.desc = !rfFiltro.desc; else { rfFiltro.ordem = col; rfFiltro.desc = true; } rfDesenhar(); }
    function rfToggleFrete(on){ vmlFreteComprador = on; localStorage.setItem('mk_vml_frete_comp', on ? '1' : '0'); rfDesenhar(); }
    function rfSetData(campo, val){
      if(!val) return;
      rfFiltro[campo] = val;
      if(rfFiltro.ate < rfFiltro.de){ if(campo === 'de') rfFiltro.ate = val; else rfFiltro.de = val; }
      rfFiltro.pagina = 1; renderResumoFin();
    }
    function rfMoverDia(n){ rfFiltro.de = addDias(rfFiltro.de, n); rfFiltro.ate = addDias(rfFiltro.ate, n); rfFiltro.pagina = 1; renderResumoFin(); }
    function rfAtalho(k){ const p = vmlAtalho(k); rfFiltro.de = p.de; rfFiltro.ate = p.ate; rfFiltro.pagina = 1; renderResumoFin(); }
    function rfExportar(formato){ vmlBaixar(rfFiltrar(), `resumo_financeiro_${rfFiltro.de}_${rfFiltro.ate}`, formato); }

    function rfLegenda(){
      vmlModal('Legendas da página', `
        <div style="line-height:2.2;">
          <div><b class="sem-custo">R$ / —</b> &nbsp;Venda sem custo ou sem imposto cadastrado no produto</div>
          <div><b class="mc-pos">R$</b> &nbsp;Margem de contribuição positiva</div>
          <div><b class="mc-neg">R$</b> &nbsp;Margem de contribuição negativa</div>
          <div class="text-muted" style="margin-top:10px;line-height:1.6;">Margem de contribuição = valor dos produtos − custo − imposto − tarifa de venda − frete pago pelo vendedor. Custo e imposto vêm do cadastro de Produtos.</div>
        </div>`);
    }

    // Ranking de produtos do período (vendas aprovadas)
    let rfRankAba = 'mcp', rfRankGrupo = 'sku';
    function rfRanking(aba, grupo){
      if(aba) rfRankAba = aba;
      if(grupo) rfRankGrupo = grupo;
      const aprov = rfFiltrar(true).filter(v => vmlStatus(v) === 'aprovada');
      const g = {};
      aprov.forEach(v => {
        const k = rfRankGrupo === 'sku' ? (v.sku || '(sem SKU)') : (v.item_id || '(sem MLB)');
        const c = vmlCalc(v);
        if(!g[k]) g[k] = { chave:k, titulo:v.titulo || '', bruto:0, mc:0, un:0, vendas:0 };
        g[k].bruto += c.bruto; g[k].mc += c.mc; g[k].un += c.qtd; g[k].vendas++;
      });
      const linhas = Object.values(g).map(x => ({ ...x, mcp: x.bruto ? x.mc / x.bruto * 100 : 0 }));
      const ord = { mcp:'mcp', mc:'mc', fat:'bruto', un:'un', cons:'mc' }[rfRankAba];
      linhas.sort((a,b) => b[ord] - a[ord]);
      const abas = [['mcp','Maior margem %'],['mc','Maior margem R$'],['fat','Mais geram faturamento'],['un','Mais unidades vendidas'],['cons','Consolidado']];
      const un = aprov.reduce((s,v) => s + (Number(v.qtd) || 1), 0);
      vmlModal(`Ranking de produtos — ${ptDate(rfFiltro.de)} a ${ptDate(rfFiltro.ate)}`, `
        <div class="chips" style="margin-bottom:12px;">${abas.map(([k,l]) => `<button class="chip ${rfRankAba === k ? 'active' : ''}" onclick="rfRanking('${k}')">${l}</button>`).join('')}</div>
        <div class="d-flex" style="justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap;">
          <div class="chips"><button class="chip ${rfRankGrupo === 'sku' ? 'active' : ''}" onclick="rfRanking(null,'sku')">SKU</button><button class="chip ${rfRankGrupo === 'mlb' ? 'active' : ''}" onclick="rfRanking(null,'mlb')">MLB</button></div>
          <div class="text-muted"><b style="color:var(--text);font-size:15px;">${un} unidades</b> em ${aprov.length} vendas aprovadas</div>
        </div>
        <div style="max-height:48vh;overflow:auto;">
          <table class="rf-table"><thead><tr><th>#</th><th>${rfRankGrupo === 'sku' ? 'SKU' : 'MLB'}</th><th>Título</th><th class="num">Unid.</th><th class="num">Vendas (R$)</th><th class="num">Margem (R$)</th><th class="num">Margem %</th></tr></thead>
          <tbody>${linhas.length ? linhas.map((x,i) => `<tr><td>${i + 1}</td><td><b>${vmlEsc(x.chave)}</b></td><td style="max-width:240px;">${vmlEsc(x.titulo)}</td><td class="num">${x.un}</td><td class="num">${vmlNum(x.bruto)}</td><td class="num"><b class="${x.mc >= 0 ? 'mc-pos' : 'mc-neg'}">${vmlNum(x.mc)}</b></td><td class="num"><b class="${x.mc >= 0 ? 'mc-pos' : 'mc-neg'}">${vmlPct(x.mcp)}</b></td></tr>`).join('') : '<tr><td colspan="7"><div class="vazio">Sem vendas aprovadas no período.</div></td></tr>'}</tbody></table>
        </div>
        <div class="text-muted" style="font-size:11px;margin-top:10px;">Somente vendas aprovadas do período. Vendas sem custo ou imposto cadastrado distorcem o ranking de margem.</div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '960px';
    }
