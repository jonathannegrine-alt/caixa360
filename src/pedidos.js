// ===== PEDIDOS (vendas que saem do galpão: Coleta, Agência e Flex) =====
// Acompanha o envio de cada pedido até sair, no modelo da tela de pedidos da UpSeller. Dados: vendas_ml
// (envio_status, envio_substatus, envio_limite e enviado_em são atualizados pelo ml-envios a cada 15 min).
//   Atrasado     = ainda não saiu, não foi cancelado e o prazo de envio (envio_limite) já passou
//   Vence hoje   = ainda não saiu e o prazo termina hoje
// O Full fica de fora: quem envia é o Mercado Livre.

    let pd = { linhas: [], carregadoEm: 0, carregando: null, aba: 'atrasados', busca: '', erro: '' };
    const PD_ABAS = [['atrasados', 'Atrasados'], ['hoje', 'Vencem hoje'], ['enviar', 'Para enviar'], ['aguardando', 'Aguardando liberação'], ['enviados', 'Enviados'], ['cancelados', 'Cancelados'], ['todos', 'Todos']];
    const PD_TIPO = { cross_docking: 'Coleta', xd_drop_off: 'Agência', drop_off: 'Correios', self_service: 'Flex' };
    const pdEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pdDiaBR = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    async function pdCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      if(pd.carregando) return pd.carregando;
      if(pd.uid !== usuarioAtual.id){ pd.uid = usuarioAtual.id; pd.carregadoEm = 0; }   // troca de usuário (ou demonstração) não aproveita os dados do outro
      if(!forcar && pd.carregadoEm && Date.now() - pd.carregadoEm < 3 * 60 * 1000) return;
      pd.carregando = (async () => {
        const desde = new Date(Date.now() - 25 * 86400000).toISOString();
        const campos = 'order_id,pack_id,shipping_id,ml_user_id,data_venda,status,sku,titulo,variacao,qtd,preco_unit,total_pago,comprador_nome,comprador_apelido,logistic_type,envio_status,envio_substatus,envio_limite,enviado_em,thumbnail,cidade,uf';
        const out = [];
        for(let i = 0; i < 10; i++){
          const r = await supa.from('vendas_ml').select(campos).eq('usuario_id', usuarioAtual.id).gte('data_venda', desde).or('logistic_type.is.null,logistic_type.neq.fulfillment').order('data_venda', { ascending: false }).range(i * 1000, i * 1000 + 999);
          if(r.error){ pd.erro = r.error.message; break; }
          out.push(...r.data); if(r.data.length < 1000) break;
        }
        // lista vazia não fica guardada: pode ter sido lida antes de a sessão terminar de abrir
        pd.linhas = out; pd.carregadoEm = out.length ? Date.now() : 0; pd.erro = pd.erro && out.length ? '' : pd.erro;
      })();
      try { await pd.carregando; } finally { pd.carregando = null; }
      if(typeof pdMarcaMenu === 'function') pdMarcaMenu();
    }

    // um envio (pacote) pode ter várias vendas (carrinho): a tela mostra um pacote por linha
    function pdPacotes(){
      const conta = typeof contaAtiva !== 'undefined' ? String(contaAtiva || '') : '';
      const m = new Map();
      pd.linhas.filter(v => !conta || String(v.ml_user_id) === conta).forEach(v => {
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
        : sub === 'in_packing_list' ? 'Na lista de coleta' : sub === 'ready_to_pack' ? 'Para embalar' : p.envio_status === 'ready_to_ship' ? 'Pronto para enviar' : (p.envio_status || 'Sem informação de envio');
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

    function pdDesenhar(){
      const view = document.getElementById('view-pedidos'); if(!view) return;
      const todos = pdPacotes(), n = a => todos.filter(p => pdNaAba(p, a)).length;
      const b = String(pd.busca || '').trim().toLowerCase();
      const lista = todos.filter(p => pdNaAba(p, pd.aba)).filter(p => !b || [p.order_id, p.pack_id, p.comprador_nome, p.comprador_apelido, ...p.itens.map(v => v.sku + ' ' + v.titulo)].join(' ').toLowerCase().includes(b))
        .sort((x, y) => pd.aba === 'enviados' ? String(y.enviado_em).localeCompare(String(x.enviado_em)) : (x.lim || 9e15) - (y.lim || 9e15) || String(x.data_venda).localeCompare(String(y.data_venda)));
      const dt = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      const atras = todos.filter(p => p.atrasado), maisVelho = atras.reduce((m, p) => Math.max(m, p.diasAtraso), 0);
      const semPrazo = todos.filter(p => !p.saiu && !p.cancel && !p.aguardando && !p.lim).length;
      view.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Pedidos</div><div class="pg-sub">Vendas que saem do galpão (Coleta, Agência e Flex), do pagamento até o envio. O Full fica de fora.</div></div>
          <div class="d-flex gap-1"><button class="btn-out btn-sm" onclick="pdAtualizar(this)">Atualizar do Mercado Livre</button></div></div>
        ${pd.erro ? `<div class="alert alert-danger">${pdEsc(pd.erro)}</div>` : ''}
        ${atras.length ? `<div class="alert alert-danger"><b>${atras.length} pedido${atras.length > 1 ? 's' : ''} atrasado${atras.length > 1 ? 's' : ''} para envio</b>&nbsp;— o mais antigo passou do prazo há ${maisVelho ? maisVelho + ' dia' + (maisVelho > 1 ? 's' : '') : 'menos de um dia'}. Atraso no envio pesa na reputação da conta.</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-atraso" onclick="pd.aba='atrasados';pdDesenhar();" style="cursor:pointer;"><div class="kpi-label">Atrasados</div><div class="kpi-value">${n('atrasados')}</div><div class="kpi-sub">passaram do prazo de envio</div></div>
          <div class="kpi k-hoje" onclick="pd.aba='hoje';pdDesenhar();" style="cursor:pointer;"><div class="kpi-label">Vencem hoje</div><div class="kpi-value">${n('hoje')}</div><div class="kpi-sub">precisam sair hoje</div></div>
          <div class="kpi k-frete" onclick="pd.aba='enviar';pdDesenhar();" style="cursor:pointer;"><div class="kpi-label">Para enviar</div><div class="kpi-value">${n('enviar')}</div><div class="kpi-sub">liberados e ainda no galpão</div></div>
          <div class="kpi k-mc" onclick="pd.aba='enviados';pdDesenhar();" style="cursor:pointer;"><div class="kpi-label">Enviados · 7 dias</div><div class="kpi-value">${n('enviados')}</div><div class="kpi-sub">${n('aguardando')} aguardando liberação do ML</div></div>
        </div>
        <div class="card"><div class="sku-barra">
          <input type="text" id="pd-busca" placeholder="Buscar por nº do pedido, comprador ou SKU" value="${pdEsc(pd.busca)}" oninput="pdBuscar(this.value)">
          <div class="chips">${PD_ABAS.map(([k, t]) => `<button class="chip ${pd.aba === k ? 'active' : ''}" onclick="pd.aba='${k}';pdDesenhar();">${t}<span class="n">${n(k)}</span></button>`).join('')}</div>
        </div>
        ${semPrazo && (pd.aba === 'enviar' || pd.aba === 'atrasados') ? `<div class="text-muted" style="font-size:12px;padding:0 16px 8px;">${semPrazo} pedido${semPrazo > 1 ? 's' : ''} ainda sem prazo de envio registrado: o prazo é preenchido na próxima consulta ao Mercado Livre (a cada 15 minutos).</div>` : ''}
        <div style="overflow-x:auto;"><table class="cp-tab pd-tab"><thead><tr><th>Produtos</th><th class="num">Valor</th><th>Comprador</th><th>Pedido</th><th>Tempo</th><th>Envio</th><th>Estado</th><th></th></tr></thead><tbody>
          ${lista.length ? lista.slice(0, 400).map(p => { const [est, cls] = pdEstado(p);
            return `<tr class="${p.atrasado ? 'pd-atrasado' : ''}">
              <td class="cp-prod" style="min-width:260px;">${p.itens.map(v => (typeof fotoLinha === 'function' ? fotoLinha(v.sku, `<b>${pdEsc(v.sku || '—')}</b> <span class="text-muted">× ${Number(v.qtd) || 1}</span><span title="${pdEsc(v.titulo)}">${pdEsc(v.titulo || '')}</span>`) : `<b>${pdEsc(v.sku)}</b> × ${Number(v.qtd) || 1}`)).join('<div style="height:6px;"></div>')}</td>
              <td class="num">${fmt(p.valor)}</td>
              <td style="white-space:normal;min-width:150px;">${pdEsc(p.comprador_nome || p.comprador_apelido || '—')}${p.cidade ? `<div class="cp-sub">${pdEsc(p.cidade)}${p.uf ? ' / ' + pdEsc(p.uf) : ''}</div>` : ''}</td>
              <td><a href="#" onclick="event.preventDefault();if(typeof vdDetalheML==='function')vdDetalheML('${p.order_id}')">${pdEsc(p.order_id)}</a>${p.pack_id ? `<div class="cp-sub">carrinho ${pdEsc(p.pack_id)}</div>` : ''}${typeof contaNome === 'function' && contasML && contasML.length > 1 ? `<div class="cp-sub">${pdEsc(contaNome(p.ml_user_id) || '')}</div>` : ''}</td>
              <td style="font-size:12.5px;white-space:nowrap;"><span class="text-muted">Vendido</span> ${dt(p.data_venda)}<br>${p.saiu ? `<span class="text-muted">Saiu</span> ${dt(p.enviado_em)}` : p.lim ? `<span class="${p.atrasado ? 'text-danger' : p.venceHoje ? 'text-warning' : 'text-muted'}">Enviar até</span> <b class="${p.atrasado ? 'text-danger' : ''}">${dt(p.lim)}</b>${p.atrasado ? `<div class="text-danger" style="font-weight:600;">atrasado ${p.diasAtraso ? 'há ' + p.diasAtraso + ' dia' + (p.diasAtraso > 1 ? 's' : '') : 'hoje'}</div>` : ''}` : '<span class="text-muted">prazo ainda não informado</span>'}</td>
              <td>${PD_TIPO[p.logistic_type] || pdEsc(p.logistic_type || '—')}</td>
              <td><span class="cp-sit ${cls}">${est}</span></td>
              <td style="text-align:right;"><button class="btn-out btn-sm" onclick="if(typeof vdDetalheML==='function')vdDetalheML('${p.order_id}')">Detalhes</button></td></tr>`; }).join('')
            : `<tr><td colspan="8"><div class="vazio"><b>${pd.aba === 'atrasados' ? 'Nenhum pedido atrasado' : 'Nada nesta lista'}</b>${pd.aba === 'atrasados' ? 'Todos os pedidos liberados estão dentro do prazo de envio.' : 'Troque a aba ou a busca.'}</div></td></tr>`}
        </tbody></table></div>${lista.length > 400 ? `<div class="text-muted" style="padding:10px 16px;font-size:12px;">Mostrando 400 de ${lista.length}. Use a busca para achar um pedido.</div>` : ''}</div>`;
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
