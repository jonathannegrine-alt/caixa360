// ===== PEDIDOS (vendas que saem do galpão: Coleta, Agência e Flex) =====
// Acompanha o envio de cada pedido até sair, no modelo da tela de pedidos da UpSeller. Dados: vendas_ml
// (envio_status, envio_substatus, envio_limite e enviado_em são atualizados pelo ml-envios a cada 15 min).
//   Atrasado     = ainda não saiu, não foi cancelado e o prazo de envio (envio_limite) já passou
//   Vence hoje   = ainda não saiu e o prazo termina hoje
// O Full fica de fora: quem envia é o Mercado Livre.
// Busca (nº da venda, carrinho, envio, comprador ou SKU) procura em TODAS as abas; sem nada nos últimos 25 dias carregados,
// procura no banco em qualquer data (pdBuscarBanco) e mostra também venda do Full.

    let pd = { linhas: [], carregadoEm: 0, carregando: null, aba: 'atrasados', tipo: '', busca: '', erro: '', sel: new Set(), conf: new Set(), extras: [], extrasTermo: '', buscandoBanco: false };
    const PD_ABAS = [['atrasados', 'Atrasados'], ['hoje', 'Vencem hoje'], ['enviar', 'Para enviar'], ['aguardando', 'Aguardando liberação'], ['enviados', 'Enviados'], ['cancelados', 'Cancelados'], ['todos', 'Todos']];
    const PD_TIPO = { cross_docking: 'Coleta', xd_drop_off: 'Agência', drop_off: 'Correios', self_service: 'Flex', fulfillment: 'Full' };
    // filtro por forma de envio (Coleta, Agência, Flex); vale nas abas e na lista, os quadros de cima mostram a divisão
    const PD_GRUPOS = [['coleta', 'Coleta', ['cross_docking']], ['agencia', 'Agência', ['xd_drop_off', 'drop_off']], ['flex', 'Flex', ['self_service']]];
    const pdGrupo = p => (PD_GRUPOS.find(g => g[2].includes(p.logistic_type)) || ['outro'])[0];
    // clicar de novo no que já está marcado tira o filtro (quadro/aba volta para Todos; forma de envio volta para Todas)
    function pdTipo(t){ pd.tipo = pd.tipo === t ? '' : t; pdDesenhar(); }
    function pdAba(a){ pd.aba = pd.aba === a && a !== 'todos' ? 'todos' : a; pdDesenhar(); }
    function pdIr(aba, tipo){
      if(tipo){ if(pd.aba === aba && pd.tipo === tipo) pd.tipo = ''; else { pd.aba = aba; pd.tipo = tipo; } }
      else if(pd.aba === aba){ pd.aba = 'todos'; pd.tipo = ''; }
      else { pd.aba = aba; pd.tipo = ''; }
      pdDesenhar();
    }
    const pdEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pdDiaBR = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    const PD_CAMPOS = 'order_id,pack_id,shipping_id,ml_user_id,data_venda,status,sku,titulo,variacao,qtd,preco_unit,total_pago,comprador_nome,comprador_apelido,logistic_type,envio_status,envio_substatus,envio_limite,enviado_em,thumbnail,cidade,uf';
    async function pdCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      if(pd.carregando) return pd.carregando;
      if(pd.uid !== usuarioAtual.id){ pd.uid = usuarioAtual.id; pd.carregadoEm = 0; }   // troca de usuário (ou demonstração) não aproveita os dados do outro
      if(!forcar && pd.carregadoEm && Date.now() - pd.carregadoEm < 3 * 60 * 1000) return;
      pd.carregando = (async () => {
        const desde = new Date(Date.now() - 25 * 86400000).toISOString();
        const campos = PD_CAMPOS;
        const out = [];
        for(let i = 0; i < 10; i++){
          const r = await supa.from('vendas_ml').select(campos).eq('usuario_id', usuarioAtual.id).gte('data_venda', desde).or('logistic_type.is.null,logistic_type.neq.fulfillment').order('data_venda', { ascending: false }).range(i * 1000, i * 1000 + 999);
          if(r.error){ pd.erro = r.error.message; break; }
          out.push(...r.data); if(r.data.length < 1000) break;
        }
        const cf = await supa.from('vendas_conferir').select('order_id').eq('usuario_id', usuarioAtual.id);
        if(!cf.error) pd.conf = new Set((cf.data || []).map(x => String(x.order_id)));
        // lista vazia não fica guardada: pode ter sido lida antes de a sessão terminar de abrir
        pd.linhas = out; pd.carregadoEm = out.length ? Date.now() : 0; pd.erro = pd.erro && out.length ? '' : pd.erro;
      })();
      try { await pd.carregando; } finally { pd.carregando = null; }
      if(typeof pdMarcaMenu === 'function') pdMarcaMenu();
    }

    // um envio (pacote) pode ter várias vendas (carrinho): a tela mostra um pacote por linha
    function pdPacotes(comExtras){
      const conta = typeof contaAtiva !== 'undefined' ? String(contaAtiva || '') : '';
      const m = new Map(), ja = new Set(pd.linhas.map(v => String(v.order_id)));
      const fonte = comExtras && pd.extras.length ? pd.linhas.concat(pd.extras.filter(v => !ja.has(String(v.order_id)))) : pd.linhas;
      fonte.filter(v => !conta || String(v.ml_user_id) === conta).forEach(v => {
        const k = v.shipping_id ? 's' + v.shipping_id : 'o' + v.order_id;
        if(!m.has(k)) m.set(k, { k, itens: [], ...v });
        m.get(k).itens.push(v);
      });
      const agora = Date.now(), hoje = pdDiaBR(agora);
      return [...m.values()].map(p => {
        const cancel = p.itens.every(v => v.status === 'cancelled') || p.envio_status === 'cancelled';
        const saiu = !!p.enviado_em;
        const lim = p.envio_limite ? new Date(p.envio_limite).getTime() : null;
        const aguardando = !saiu && !cancel && p.envio_status === 'pending';
        const atrasado = !saiu && !cancel && lim !== null && lim < agora;
        const venceHoje = !saiu && !cancel && !atrasado && lim !== null && pdDiaBR(lim) === hoje;
        const valor = p.itens.reduce((s, v) => s + (Number(v.total_pago) || (Number(v.preco_unit) || 0) * (Number(v.qtd) || 0)), 0);
        return { ...p, cancel, saiu, lim, aguardando, atrasado, venceHoje, valor, diasAtraso: atrasado ? Math.floor((agora - lim) / 86400000) : 0 };
      });
    }
    function pdNaAba(p, aba){
      if(aba === 'atrasados') return p.atrasado;
      if(aba === 'hoje') return p.venceHoje;
      if(aba === 'enviar') return !p.saiu && !p.cancel && !p.aguardando;
      if(aba === 'aguardando') return p.aguardando;
      if(aba === 'enviados') return p.saiu && !p.cancel && Date.now() - new Date(p.enviado_em).getTime() < 7 * 86400000;
      if(aba === 'cancelados') return p.cancel;
      return true;
    }
    // estado em português, como o vendedor vê no Mercado Livre
    function pdEstado(p){
      if(p.cancel) return ['Cancelado', 'cp-semvenda'];
      if(p.saiu) return p.envio_status === 'delivered' ? ['Entregue', 'cp-ok'] : p.envio_status === 'not_delivered' ? ['Não entregue', 'cp-urgente'] : ['Enviado', 'cp-ok'];
      const sub = String(p.envio_substatus || '');
      const nome = p.envio_status === 'pending' ? (sub === 'buffered' ? 'Aguardando liberação do ML' : 'Pendente')
        : sub === 'ready_to_print' ? 'Etiqueta para imprimir' : sub === 'printed' ? 'Etiqueta impressa' : sub === 'ready_for_pickup' ? 'Aguardando coleta'
        : sub === 'in_packing_list' ? 'Na lista de coleta' : sub === 'ready_to_pack' ? 'Para embalar' : sub === 'invoice_pending' ? 'Aguardando nota fiscal'
        : sub === 'picked_up' ? 'Coletado' : sub === 'dropped_off' ? 'Entregue na agência' : sub === 'packed' ? 'Embalado'
        : p.envio_status === 'ready_to_ship' ? 'Pronto para enviar' : (p.envio_status || 'Sem informação de envio');
      return [nome, p.atrasado ? 'cp-urgente' : p.venceHoje ? 'cp-comprar' : 'cp-excesso'];
    }

    async function renderPedidos(){
      const view = document.getElementById('view-pedidos'); if(!view) return;
      if(!pd.carregadoEm) view.innerHTML = '<div class="vazio"><b>Carregando os pedidos…</b></div>';
      await pdCarregar(false);
      if(!pd.carregadoEm) await pdCarregar(true);   // a carga em andamento pode ter começado antes de a sessão abrir
      pdDesenhar();
    }
    async function pdAtualizar(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Consultando o Mercado Livre…'; }
      try { const sd = await supa.auth.getSession(), s = sd && sd.data && sd.data.session;
        if(s) await fetch(SUPA_URL + '/functions/v1/ml-envios', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: '{}' }); } catch(e){}
      await pdCarregar(true); pdDesenhar();
    }
    let pdBuscaT = null;
    function pdBuscar(v){ pd.busca = v; clearTimeout(pdBuscaT); pdBuscaT = setTimeout(() => { pdDesenhar(); const i = document.getElementById('pd-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
    // botão Buscar / Enter: busca agora e, se não achar nos pedidos carregados, procura no banco em qualquer data
    async function pdBuscarJa(){
      const i = document.getElementById('pd-busca'); if(i) pd.busca = i.value;
      clearTimeout(pdBuscaT); pdDesenhar();
      const t = String(pd.busca || '').trim();
      if(t.length < 3 || pdFiltrar(pdPacotes(true), t.toLowerCase()).length || pd.extrasTermo === t) return;
      pd.buscandoBanco = true; pdDesenhar();
      try { pd.extras = await pdBuscarBanco(t); pd.extrasTermo = t; } catch(e){ pd.extras = []; }
      pd.buscandoBanco = false; pdDesenhar();
    }
    function pdLimpar(){ pd.busca = ''; pd.extras = []; pd.extrasTermo = ''; pdDesenhar(); }
    async function pdBuscarBanco(t){
      const num = /^\d{6,}$/.test(t), esc = t.replace(/[%,()]/g, ' ');
      let q = supa.from('vendas_ml').select(PD_CAMPOS).eq('usuario_id', usuarioAtual.id);
      q = num ? q.or('order_id.eq.' + t + ',pack_id.eq.' + t + ',shipping_id.eq.' + t) : q.or('comprador_apelido.ilike.%' + esc + '%,comprador_nome.ilike.%' + esc + '%,sku.ilike.%' + esc + '%');
      const r = await q.order('data_venda', { ascending: false }).limit(200);
      return r.error ? [] : (r.data || []);
    }
    function pdFiltrar(lista, b){
      return !b ? lista : lista.filter(p => [p.order_id, p.pack_id, p.shipping_id, p.comprador_nome, p.comprador_apelido, ...p.itens.map(v => v.sku + ' ' + v.titulo)].join(' ').toLowerCase().includes(b));
    }

    function pdDesenhar(){
      const view = document.getElementById('view-pedidos'); if(!view) return;
      const geral = pdPacotes(), todos = pd.tipo ? geral.filter(p => pdGrupo(p) === pd.tipo) : geral, n = a => todos.filter(p => pdNaAba(p, a)).length;
      // divisão por forma de envio dentro de cada quadro (clicar abre a aba já filtrada)
      const pdDiv = a => { const d = PD_GRUPOS.map(([g, t]) => [g, t, geral.filter(p => pdNaAba(p, a) && pdGrupo(p) === g).length]).filter(x => x[2]);
        return d.length ? '<div class="kpi-sub">' + d.map(([g, t, q]) => { const on = pd.aba === a && pd.tipo === g; return `<span class="pd-div ${on ? 'on' : ''}" onclick="event.stopPropagation();pdIr('${a}','${g}')" title="${on ? 'Clique de novo para tirar o filtro' : 'Ver só ' + t}"><b>${q}</b> ${t.toLowerCase()}${on ? ' ✕' : ''}</span>`; }).join('') + '</div>' : ''; };
      const nG = a => geral.filter(p => pdNaAba(p, a)).length;
      const pdOn = a => pd.aba === a ? 'pd-on' : '';
      const pdSelo = a => pd.aba === a ? '<span class="pd-selo" title="Filtro ligado. Clique de novo para ver todos">✓ filtrando · ✕</span>' : '';
      const b = String(pd.busca || '').trim().toLowerCase(), buscando = !!b;
      // com busca, procura em todas as abas (o pedido aparece onde estiver)
      const lista = pdFiltrar(buscando ? pdPacotes(true) : todos.filter(p => pdNaAba(p, pd.aba)), b)
        .sort((x, y) => buscando ? String(y.data_venda).localeCompare(String(x.data_venda)) : pd.aba === 'enviados' ? String(y.enviado_em).localeCompare(String(x.enviado_em)) : (x.lim || 9e15) - (y.lim || 9e15) || String(x.data_venda).localeCompare(String(y.data_venda)));
      const dt = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      const atras = geral.filter(p => p.atrasado), maisVelho = atras.reduce((m, p) => Math.max(m, p.diasAtraso), 0);
      const semPrazo = todos.filter(p => !p.saiu && !p.cancel && !p.aguardando && !p.lim).length;
      view.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Pedidos</div><div class="pg-sub">Vendas que saem do galpão (Coleta, Agência e Flex), do pagamento até o envio. O Full fica de fora.</div></div>
          <div class="d-flex gap-1"><button class="btn-out btn-sm" onclick="pdAtualizar(this)">Atualizar do Mercado Livre</button></div></div>
        ${pd.erro ? `<div class="alert alert-danger">${pdEsc(pd.erro)}</div>` : ''}
        ${atras.length ? `<div class="alert alert-danger"><b>${atras.length} pedido${atras.length > 1 ? 's' : ''} atrasado${atras.length > 1 ? 's' : ''} para envio</b>&nbsp;— o mais antigo passou do prazo há ${maisVelho ? maisVelho + ' dia' + (maisVelho > 1 ? 's' : '') : 'menos de um dia'}. Atraso no envio pesa na reputação da conta.</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-atraso ${pdOn('atrasados')}" onclick="pdIr('atrasados')" style="cursor:pointer;">${pdSelo('atrasados')}<div class="kpi-label">Atrasados</div><div class="kpi-value">${nG('atrasados')}</div><div class="kpi-sub">passaram do prazo de envio</div>${pdDiv('atrasados')}</div>
          <div class="kpi k-hoje ${pdOn('hoje')}" onclick="pdIr('hoje')" style="cursor:pointer;">${pdSelo('hoje')}<div class="kpi-label">Vencem hoje</div><div class="kpi-value">${nG('hoje')}</div><div class="kpi-sub">precisam sair hoje</div>${pdDiv('hoje')}</div>
          <div class="kpi k-frete ${pdOn('enviar')}" onclick="pdIr('enviar')" style="cursor:pointer;">${pdSelo('enviar')}<div class="kpi-label">Para enviar</div><div class="kpi-value">${nG('enviar')}</div><div class="kpi-sub">liberados e ainda no galpão</div>${pdDiv('enviar')}</div>
          <div class="kpi k-mc ${pdOn('enviados')}" onclick="pdIr('enviados')" style="cursor:pointer;">${pdSelo('enviados')}<div class="kpi-label">Enviados · 7 dias</div><div class="kpi-value">${nG('enviados')}</div><div class="kpi-sub">${nG('aguardando')} aguardando liberação do ML</div></div>
        </div>
        <div class="card"><div class="sku-barra">
          <div style="display:flex;gap:6px;flex:1;min-width:260px;"><input type="text" id="pd-busca" placeholder="Buscar por nº do pedido, comprador ou SKU" value="${pdEsc(pd.busca)}" oninput="pdBuscar(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();pdBuscarJa();}" style="flex:1;"><button class="btn btn-sm" onclick="pdBuscarJa()">🔍 Buscar</button>${buscando ? '<button class="btn-out btn-sm" onclick="pdLimpar()">Limpar</button>' : ''}</div>
          <div class="chips" style="${buscando ? 'opacity:.45;pointer-events:none;' : ''}">${PD_ABAS.map(([k, t]) => `<button class="chip ${pd.aba === k ? 'active' : ''}" onclick="pdAba('${k}')">${t}<span class="n">${n(k)}</span></button>`).join('')}</div>
          <div class="chips" style="${buscando ? 'opacity:.45;pointer-events:none;' : ''}"><span class="text-muted" style="font-size:12px;align-self:center;">Envio:</span>${[['', 'Todos']].concat(PD_GRUPOS).map(([g, t]) => `<button class="chip ${pd.tipo === g ? 'active' : ''}" onclick="pdTipo('${g}')">${t}<span class="n">${(g ? geral.filter(p => pdGrupo(p) === g) : geral).filter(p => pdNaAba(p, pd.aba)).length}</span></button>`).join('')}</div>
        </div>
        ${buscando ? `<div class="alert alert-info" style="margin:0 16px 10px;">${pd.buscandoBanco ? 'Não achei nos pedidos dos últimos 25 dias; procurando em todas as datas…' : `Buscando "${pdEsc(pd.busca.trim())}" em <b>todas as abas</b>${pd.extrasTermo === pd.busca.trim() ? ' e em todas as datas' : ''}. A coluna Estado mostra onde cada pedido está.`}</div>` : ''}
        ${!buscando && semPrazo && (pd.aba === 'enviar' || pd.aba === 'atrasados') ? `<div class="text-muted" style="font-size:12px;padding:0 16px 8px;">${semPrazo} pedido${semPrazo > 1 ? 's' : ''} ainda sem prazo de envio registrado: o prazo é preenchido na próxima consulta ao Mercado Livre (a cada 15 minutos).</div>` : ''}
        ${pdBarraSel()}
        <div style="overflow-x:auto;"><table class="cp-tab pd-tab" data-sem-ordem><thead><tr><th style="width:30px;"><input type="checkbox" title="Marcar ou desmarcar todos os pedidos da lista" ${lista.length && lista.slice(0, 400).every(p => pd.sel.has(p.k)) ? 'checked' : ''} onchange="pdMarcarTodos(this.checked)"></th><th>Produtos</th><th class="num">Valor</th><th>Comprador</th><th>Pedido</th><th>Tempo</th><th>Envio</th><th>Estado</th><th></th></tr></thead><tbody>
          ${lista.length ? lista.slice(0, 400).map(p => { const [est, cls] = pdEstado(p);
            return `<tr class="${p.atrasado ? 'pd-atrasado' : ''}">
              <td><input type="checkbox" class="pd-marca" data-k="${pdEsc(p.k)}" ${pd.sel.has(p.k) ? 'checked' : ''} onchange="pdMarcar(this.dataset.k, this.checked)"></td>
              <td class="cp-prod" style="min-width:260px;">${p.itens.map(v => (typeof fotoLinha === 'function' ? fotoLinha(v.sku, `<b>${pdEsc(v.sku || '—')}</b> <span class="text-muted">× ${Number(v.qtd) || 1}</span><span title="${pdEsc(v.titulo)}">${pdEsc(v.titulo || '')}</span>`) : `<b>${pdEsc(v.sku)}</b> × ${Number(v.qtd) || 1}`)).join('<div style="height:6px;"></div>')}</td>
              <td class="num">${fmt(p.valor)}</td>
              <td style="white-space:normal;min-width:150px;">${pdEsc(p.comprador_nome || p.comprador_apelido || '—')}${p.cidade ? `<div class="cp-sub">${pdEsc(p.cidade)}${p.uf ? ' / ' + pdEsc(p.uf) : ''}</div>` : ''}</td>
              <td><a href="https://www.mercadolivre.com.br/vendas/${pdEsc(p.order_id)}/detalhe" target="_blank" rel="noopener" title="Abrir a venda no Mercado Livre">${pdEsc(p.order_id)} ↗</a>${p.pack_id ? `<div class="cp-sub">carrinho ${pdEsc(p.pack_id)}</div>` : ''}${typeof contaNome === 'function' && contasML && contasML.length > 1 ? `<div class="cp-sub">${pdEsc(contaNome(p.ml_user_id) || '')}</div>` : ''}${pdConfCaixa(p)}</td>
              <td style="font-size:12.5px;white-space:nowrap;"><span class="text-muted">Vendido</span> ${dt(p.data_venda)}<br>${p.saiu ? `<span class="text-muted">Saiu</span> ${dt(p.enviado_em)}` : p.lim ? `<span class="${p.atrasado ? 'text-danger' : p.venceHoje ? 'text-warning' : 'text-muted'}">Enviar até</span> <b class="${p.atrasado ? 'text-danger' : ''}">${dt(p.lim)}</b>${p.atrasado ? `<div class="text-danger" style="font-weight:600;">atrasado ${p.diasAtraso ? 'há ' + p.diasAtraso + ' dia' + (p.diasAtraso > 1 ? 's' : '') : 'hoje'}</div>` : ''}` : '<span class="text-muted">prazo ainda não informado</span>'}</td>
              <td>${PD_TIPO[p.logistic_type] || pdEsc(p.logistic_type || '—')}</td>
              <td><span class="cp-sit ${cls}">${est}</span></td>
              <td style="text-align:right;white-space:nowrap;">${!p.cancel && p.shipping_id && p.logistic_type !== 'fulfillment' ? `<button class="btn-out btn-sm" onclick="if(typeof vdEtiqueta==='function')vdEtiqueta('${p.order_id}', this)" title="Abre a etiqueta do envio em PDF para imprimir">🖨 Etiqueta</button> ` : ''}<button class="btn-out btn-sm" onclick="pdDetalhe('${p.order_id}')">Detalhes</button></td></tr>`; }).join('')
            : `<tr><td colspan="9"><div class="vazio"><b>${buscando ? 'Nenhum pedido encontrado' : pd.aba === 'atrasados' ? 'Nenhum pedido atrasado' : 'Nada nesta lista'}</b>${buscando ? (pd.extrasTermo === pd.busca.trim() ? 'Procurei em todas as abas e em todas as datas.' : 'Clique em Buscar (ou Enter) para procurar também nas vendas mais antigas.') : pd.aba === 'atrasados' ? 'Todos os pedidos liberados estão dentro do prazo de envio.' : 'Troque a aba ou a busca.'}</div></td></tr>`}
        </tbody></table></div>${lista.length > 400 ? `<div class="text-muted" style="padding:10px 16px;font-size:12px;">Mostrando 400 de ${lista.length}. Use a busca para achar um pedido.</div>` : ''}</div>`;
    }

    // ---------- pedidos marcados: PDF ----------
    function pdMarcados(){ return pdPacotes().filter(p => pd.sel.has(p.k)).sort((x, y) => (x.lim || 9e15) - (y.lim || 9e15) || String(x.data_venda).localeCompare(String(y.data_venda))); }
    function pdBarraSel(){
      const M = pdMarcados(), un = M.reduce((s, p) => s + p.itens.reduce((a, v) => a + (Number(v.qtd) || 1), 0), 0);
      return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:0 16px 10px;font-size:12.5px;">
        ${M.length ? `<span><b>${M.length}</b> pedido${M.length === 1 ? '' : 's'} marcado${M.length === 1 ? '' : 's'} · ${un} unidade${un === 1 ? '' : 's'}</span><a href="#" onclick="pd.sel.clear();pdDesenhar();return false;">desmarcar</a>` : '<span class="text-muted">Marque os pedidos para gerar o PDF.</span>'}
        <button class="btn btn-sm" style="margin-left:auto;" ${M.length ? '' : 'disabled'} onclick="pdPdf(this)">PDF</button></div>`;
    }
    function pdMarcar(k, v){ if(v) pd.sel.add(k); else pd.sel.delete(k); pdDesenhar(); }
    function pdMarcarTodos(v){ document.querySelectorAll('#view-pedidos .pd-marca').forEach(c => { if(v) pd.sel.add(c.dataset.k); else pd.sel.delete(c.dataset.k); }); pdDesenhar(); }
    // uma linha por produto, com foto; os dados do pedido ocupam as linhas dele; coluna "Conferido" em branco para marcar à mão
    async function pdPdf(bt){
      const M = pdMarcados(); if(!M.length){ if(typeof toast === 'function') toast('Marque os pedidos na lista.'); return; }
      const rot = bt ? bt.textContent : ''; if(bt){ bt.disabled = true; bt.textContent = 'Gerando…'; }
      try {
        const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem conexão')); document.head.appendChild(s); });
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        // fotos: cadastro/anúncio (RPC sku_fotos) ou a da própria venda
        const skusL = [...new Set(M.flatMap(p => p.itens.map(v => String(v.sku || '').toUpperCase())).filter(Boolean))], url = {}, img = {};
        try { const r = await supa.rpc('sku_fotos', { p_skus: skusL }); (r.data || []).forEach(x => { url[String(x.sku).toUpperCase()] = x.foto; }); } catch(e){}
        M.forEach(p => p.itens.forEach(v => { const k = String(v.sku || '').toUpperCase(); if(!url[k] && v.thumbnail) url[k] = v.thumbnail; }));
        await Promise.all(Object.keys(url).map(async k => { try { const b = await (await fetch(String(url[k]).replace(/^http:/, 'https:'))).blob(); img[k] = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(b); }); } catch(e){} }));
        const dt = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
        const atr = M.filter(p => p.atrasado).length, un = M.reduce((s, p) => s + p.itens.reduce((a, v) => a + (Number(v.qtd) || 1), 0), 0);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Pedidos', 40, 44);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
        doc.text('Gerado em ' + new Date().toLocaleString('pt-BR').slice(0, 17) + '  ·  ' + M.length + ' pedido' + (M.length === 1 ? '' : 's') + ', ' + un + ' unidade' + (un === 1 ? '' : 's') + (atr ? '  ·  ' + atr + ' atrasado' + (atr === 1 ? '' : 's') : ''), 40, 60);
        const body = [], foto = [];
        M.forEach(p => {
          const [est] = pdEstado(p), n = p.itens.length;
          const ped = p.order_id + (p.pack_id ? '\ncarrinho ' + p.pack_id : '') + '\nVendido ' + dt(p.data_venda);
          const prazo = p.saiu ? 'Saiu ' + dt(p.enviado_em) : p.lim ? 'Enviar até ' + dt(p.lim) + (p.atrasado ? '\nATRASADO' + (p.diasAtraso ? ' há ' + p.diasAtraso + ' dia' + (p.diasAtraso > 1 ? 's' : '') : '') : '') : 'sem prazo';
          const comp = (p.comprador_nome || p.comprador_apelido || '—') + (p.cidade ? '\n' + p.cidade + (p.uf ? ' / ' + p.uf : '') : '');
          const envio = (PD_TIPO[p.logistic_type] || p.logistic_type || '—') + '\n' + est;
          p.itens.forEach((v, i) => {
            foto.push(String(v.sku || '').toUpperCase());
            const prod = ['', v.sku || '—', String(v.titulo || '').slice(0, 80) + (v.variacao ? '\n' + v.variacao : ''), String(Number(v.qtd) || 1), ''];
            // carrinho: os dados do pedido ocupam as linhas de todos os produtos dele (rowSpan)
            body.push(i ? prod : [{ content: ped, rowSpan: n }, { content: prazo, rowSpan: n, styles: p.atrasado ? { textColor: [185, 28, 28], fontStyle: 'bold' } : {} }, { content: comp, rowSpan: n }, { content: envio, rowSpan: n }].concat(prod));
          });
        });
        doc.autoTable({ startY: 74, margin: { left: 30, right: 30 }, head: [['Pedido', 'Prazo de envio', 'Comprador', 'Envio', 'Foto', 'SKU', 'Produto', 'Qtd', 'Conferido']], body,
          styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'middle', minCellHeight: 40 }, headStyles: { fillColor: [40, 44, 60], textColor: 255, minCellHeight: 16 },
          columnStyles: { 0: { cellWidth: 105 }, 1: { cellWidth: 92 }, 2: { cellWidth: 100 }, 3: { cellWidth: 82 }, 4: { cellWidth: 42 }, 5: { cellWidth: 105, fontStyle: 'bold' }, 7: { halign: 'center', cellWidth: 32, fontStyle: 'bold', fontSize: 11 }, 8: { cellWidth: 56 } },
          // foto do produto (uma por linha da tabela) e quadrinho em branco para o galpão marcar
          didDrawCell: d => { if(d.section !== 'body') return;
            if(d.column.index === 4){ const u = img[foto[d.row.index]];
              if(u){ try { doc.addImage(u, /png/i.test(u.slice(0, 30)) ? 'PNG' : /webp/i.test(u.slice(0, 30)) ? 'WEBP' : 'JPEG', d.cell.x + 3, d.cell.y + 3, 34, 34); } catch(e){} } }
            if(d.column.index === 8){ doc.setDrawColor(120); doc.rect(d.cell.x + 20, d.cell.y + d.cell.height / 2 - 7, 14, 14); } } });
        doc.save('pedidos_' + getToday() + '.pdf');
      } catch(e){ if(typeof toast === 'function') toast('Não consegui gerar o PDF: ' + ((e && e.message) || e)); }
      if(bt){ bt.disabled = false; bt.textContent = rot; }
    }

    // janela de detalhes: itens do pacote + entrega, pagamento, comprador e etiqueta lidos no Mercado Livre
    // "Conferir na fatura Flex": a mesma marcação da página Vendas (tabela vendas_conferir), usada na conferência da fatura
    function pdConfCaixa(p){
      const conf = pd.conf.has(String(p.order_id));
      if(p.logistic_type !== 'self_service' && !conf) return '';
      return `<label style="display:flex;gap:5px;align-items:center;margin-top:4px;font-size:12px;cursor:pointer;white-space:nowrap;${conf ? 'color:var(--warning,#d97706);font-weight:700;' : 'color:var(--text-muted);'}" title="Marque para conferir este pedido quando chegar a fatura do Flex (ex.: comprador diz que não recebeu)"><input type="checkbox" style="width:auto;margin:0;" ${conf ? 'checked' : ''} onchange="pdConferir('${p.order_id}', '${p.ml_user_id || ''}', ${p.shipping_id || 'null'}, this)"> ⚑ Conferir na fatura Flex</label>`;
    }
    async function pdConferir(orderId, conta, envio, cx){
      const marcar = cx.checked, uid = usuarioAtual.id; cx.disabled = true;
      const r = marcar
        ? await supa.from('vendas_conferir').upsert({ usuario_id: uid, order_id: orderId, ml_user_id: conta || null, shipping_id: envio || null })
        : await supa.from('vendas_conferir').delete().eq('usuario_id', uid).eq('order_id', orderId);
      if(r.error){ cx.checked = !marcar; cx.disabled = false; alert('Não consegui salvar a marcação: ' + r.error.message); return; }
      if(marcar) pd.conf.add(String(orderId)); else pd.conf.delete(String(orderId));
      if(typeof vdConf !== 'undefined' && vdConf){ if(marcar) vdConf.add(String(orderId)); else vdConf.delete(String(orderId)); }   // página Vendas usa a mesma lista
      pdDesenhar();
    }
    // foto no detalhe: a mesma da lista (cadastro/anúncio, estFotos de estoque.js) ou a da própria venda
    function pdFotoDet(v){
      const k = typeof esN === 'function' ? esN(v.sku) : '', u = (k && typeof estFotos !== 'undefined' && estFotos.get(k)) || v.thumbnail;
      if(u) return `<img class="v-thumb" src="${pdEsc(u)}" alt="">`;
      return typeof fotoCel === 'function' && k ? fotoCel(v.sku) : '<div class="v-thumb"></div>';
    }
    function pdDetalhe(orderId){
      if(typeof vmlModal !== 'function' || typeof vdDetalheML !== 'function') return;
      const p = pdPacotes().find(x => x.itens.some(v => String(v.order_id) === String(orderId)));
      const itens = p ? p.itens.map(v => `<div class="d-flex gap-2" style="align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">${pdFotoDet(v)}<div><div class="v-tit"><span class="v-qtd">${Number(v.qtd) || 1}x</span>${pdEsc(v.titulo || '')}</div><div class="text-muted">SKU: ${pdEsc(v.sku || '—')}${v.variacao ? ' · ' + pdEsc(v.variacao) : ''} · #${pdEsc(v.order_id)}</div></div></div>`).join('') : '';
      vmlModal('Pedido #' + pdEsc(orderId), itens + (p ? pdConfCaixa(p) : '') + '<div id="vd-det-ml"><div class="text-muted" style="padding:16px 0 4px;">Buscando entrega, pagamento e comprador no Mercado Livre…</div></div>',
        `<a class="btn-out btn" href="https://www.mercadolivre.com.br/vendas/${pdEsc(orderId)}/detalhe" target="_blank" rel="noopener" style="text-decoration:none;">Abrir no Mercado Livre ↗</a><button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>`);
      vdDetalheML(orderId);
    }

    // alerta da página Início: pedidos que passaram do prazo de envio (lê os dados já carregados; carrega em segundo plano)
    function pdAlertaInicio(){
      if(!pd.carregadoEm){
        if(!pd.carregando && typeof usuarioAtual !== 'undefined' && usuarioAtual) pdCarregar(false).then(() => { const v = document.getElementById('view-inicio'); if(v && v.classList.contains('active') && typeof renderInicio === 'function' && pdPacotes().some(p => p.atrasado || p.venceHoje)) renderInicio(); }).catch(() => {});
        return null;
      }
      const t = pdPacotes(), at = t.filter(p => p.atrasado), hj = t.filter(p => p.venceHoje);
      if(at.length){ const d = at.reduce((m, p) => Math.max(m, p.diasAtraso), 0);
        return { t: 'danger', i: '🚚', tx: `<b>${at.length} pedido${at.length > 1 ? 's' : ''} atrasado${at.length > 1 ? 's' : ''} para envio</b>${d ? ` — o mais antigo há ${d} dia${d > 1 ? 's' : ''}` : ''}.${hj.length ? ` Mais ${hj.length} vence${hj.length > 1 ? 'm' : ''} hoje.` : ''}`, ac: "pd.aba='atrasados';nav('pedidos')", la: 'Ver pedidos' }; }
      if(hj.length) return { t: 'warning', i: '🚚', tx: `<b>${hj.length} pedido${hj.length > 1 ? 's' : ''}</b> precisa${hj.length > 1 ? 'm' : ''} sair hoje.`, ac: "pd.aba='hoje';nav('pedidos')", la: 'Ver pedidos' };
      return null;
    }

    function pdMarcaMenu(){ const el = document.getElementById('nav-pd-n'); if(!el || !pd.carregadoEm) return; const n = pdPacotes().filter(p => p.atrasado).length; el.style.display = n ? '' : 'none'; el.textContent = n ? n + ' atrasado' + (n > 1 ? 's' : '') : ''; el.style.background = n ? 'var(--danger)' : ''; }
