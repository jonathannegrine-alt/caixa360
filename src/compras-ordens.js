// ===== ORDENS DE COMPRA (vindas do Olist) + CONFERÊNCIA DE CHEGADA =====
// A ordem é lançada no Olist (lá ela gera as contas a pagar). Aqui ela aparece com os itens, e a chegada da
// mercadoria é conferida no Caixa 360, no modelo da UpSeller: por produto, comprado / já recebido / chegou agora,
// podendo receber em várias vezes. O que foi comprado e ainda não chegou é o estoque "a caminho".
// Dados: tabela olist_ordens (preenchida pela Edge Function olist-compras) e compras_recebimentos (lançada aqui).
// Cada recebimento soma no estoque do galpão (estoqueGalpao), a não ser que o usuário marque que já estava contado.

    let oc = { ordens: [], receb: [], carregadoEm: 0, buscando: false, erro: '', filtro: 'pendentes' };
    const ocN = s => String(s == null ? '' : s).trim().toLowerCase();
    const ocEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const ocInt = n => Math.round(Number(n) || 0).toLocaleString('pt-BR');

    // há ordens guardadas no banco (importadas do Olist ou criadas aqui)? então a tela nova vale mesmo sem o Olist
    async function ocGuardadas(){
      if(oc.temGuardadas !== undefined || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const g = await supa.from('olist_ordens').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioAtual.id);
      oc.temGuardadas = !g.error && (g.count || 0) > 0;
    }
    // lê do banco; com forcar=true (ou dados com mais de 10 min) pede ao Olist a lista atualizada antes
    async function ocCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return false;
      if(typeof olist === 'undefined') return false;
      if(olist.conectado === null) await olistStatus();
      // sem o aplicativo do Olist (nunca autorizado ou desconectado) só lê o que já está guardado: as ordens importadas continuam aparecendo
      if(!olist.v3){ await ocGuardadas(); if(!oc.temGuardadas) return false; }
      if(oc.buscando) return true;
      if(!forcar && oc.carregadoEm && Date.now() - oc.carregadoEm < 10 * 60 * 1000) return true;
      oc.buscando = true; oc.erro = '';
      try {
        const j = olist.v3 ? await olistChamarCompras({ acao: 'ordens' }) : {};
        if(j.error) oc.erro = j.error;
        const [o, r] = await Promise.all([
          supa.from('olist_ordens').select('*').eq('usuario_id', usuarioAtual.id).order('id', { ascending: false }).limit(1000),
          supa.from('compras_recebimentos').select('*').eq('usuario_id', usuarioAtual.id).order('recebido_em', { ascending: false }).limit(5000),
        ]);
        if(o.data) oc.ordens = o.data;
        if(r.data) oc.receb = r.data;
        if(o.error || r.error) oc.erro = (o.error || r.error).message;
        oc.carregadoEm = Date.now();
      } finally { oc.buscando = false; }
      return true;
    }

    // situação de cada ordem a partir do que foi conferido aqui
    function ocResumo(o){
      const rec = {};
      oc.receb.filter(r => Number(r.ordem_id) === Number(o.id)).forEach(r => { const k = ocN(r.sku); rec[k] = (rec[k] || 0) + Number(r.qtd); });
      const itens = (o.itens || []).map(i => { const comprado = Number(i.qtd) || 0, recebido = rec[ocN(i.sku)] || 0; return { ...i, comprado, recebido, falta: Math.max(0, comprado - recebido) }; });
      const comprado = itens.reduce((s, i) => s + i.comprado, 0), recebido = itens.reduce((s, i) => s + Math.min(i.recebido, i.comprado), 0), falta = itens.reduce((s, i) => s + i.falta, 0);
      const valorFalta = itens.reduce((s, i) => s + i.falta * (Number(i.valor) || 0), 0);
      // atendida no Olist e sem nenhuma conferência aqui = já tinha chegado antes de existir a conferência
      const antiga = Number(o.situacao) === 1 && recebido === 0;
      const sit = Number(o.situacao) === 2 ? 'Cancelada' : antiga ? 'Recebida' : falta === 0 && comprado > 0 ? 'Recebida' : recebido > 0 ? 'Parcial' : 'A receber';
      return { itens, comprado, recebido: antiga ? comprado : recebido, falta: antiga ? 0 : falta, valorFalta: antiga ? 0 : valorFalta, sit, antiga };
    }

    // unidades compradas e ainda não recebidas, por SKU (usado pela Sugestão de compras)
    function ocTransitoPorSku(){
      const m = new Map();
      oc.ordens.forEach(o => { const r = ocResumo(o); if(r.sit === 'A receber' || r.sit === 'Parcial') r.itens.forEach(i => { if(i.falta > 0) m.set(ocN(i.sku), (m.get(ocN(i.sku)) || 0) + i.falta); }); });
      return m;
    }
    function ocTemDados(){ return typeof olist !== 'undefined' && (!!olist.v3 || !!oc.temGuardadas) && oc.carregadoEm > 0; }

    async function ocRender(){
      const view = document.getElementById('view-ordens-compra');
      if(!view) return;
      if(typeof olist !== 'undefined' && olist.conectado === null) await olistStatus();
      let host = document.getElementById('oc-olist');
      await ocGuardadas();
      const usar = typeof olist !== 'undefined' && (!!olist.v3 || !!oc.temGuardadas);
      // sem o aplicativo do Olist autorizado e sem ordens guardadas, fica a tela antiga
      [...view.children].forEach(el => { if(el.id !== 'oc-olist') el.style.display = usar ? 'none' : (el.dataset.ocAntes || ''); });
      if(!usar){ if(host) host.remove(); if(typeof renderOrdensCompra === 'function') renderOrdensCompra(); return; }
      if(!host){ host = document.createElement('div'); host.id = 'oc-olist'; view.appendChild(host); }
      if(!oc.carregadoEm) host.innerHTML = '<div class="vazio"><b>Buscando as ordens de compra no Olist…</b></div>';
      await ocCarregar(false);
      ocDesenhar();
    }

    function ocDesenhar(){
      const host = document.getElementById('oc-olist');
      if(!host) return;
      // com uma loja escolhida no seletor, só as ordens dela (ordem do Olist ou sem loja = loja padrão)
      const lojaSel = typeof lojaAtiva === 'function' ? lojaAtiva() : '';
      const daLoja = o => !lojaSel || ((o.extra && o.extra.loja) || (typeof lojaPadraoId === 'function' ? lojaPadraoId() : '')) === lojaSel;
      const lista = oc.ordens.filter(daLoja).map(o => ({ o, r: ocResumo(o) })).filter(x => x.r.sit !== 'Cancelada');
      const pend = lista.filter(x => x.r.sit === 'A receber' || x.r.sit === 'Parcial');
      const unCaminho = pend.reduce((s, x) => s + x.r.falta, 0), valCaminho = pend.reduce((s, x) => s + x.r.valorFalta, 0);
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const rec30 = oc.receb.filter(r => r.recebido_em >= d30).reduce((s, r) => s + Number(r.qtd), 0);
      const f = oc.filtro;
      const mostrar = lista.filter(x => f === 'todas' ? true : f === 'pendentes' ? (x.r.sit === 'A receber' || x.r.sit === 'Parcial') : x.r.sit === f);
      const cont = s => lista.filter(x => x.r.sit === s).length;
      const selo = s => `<span class="cp-sit ${s === 'Recebida' ? 'cp-ok' : s === 'Parcial' ? 'cp-excesso' : 'cp-comprar'}">${s}</span>`;
      const dt = d => d ? ptDate(String(d).substring(0, 10)) : '—';

      host.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Ordens de compra</div><div class="pg-sub">As ordens vêm do Olist. Aqui você confere a chegada da mercadoria; o que ainda não chegou conta como estoque a caminho.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;"><button class="btn-out btn-sm" onclick="if(typeof pepsAbrir==='function')pepsAbrir()" title="Fila de lotes de cada produto: o custo das vendas acompanha o preço de cada compra">Custo por lote</button>${typeof olist !== 'undefined' && olist.v3 ? '<button class="btn-out btn-sm" onclick="ocAtualizar(this)">Atualizar do Olist</button>' : ''}<button class="btn btn-sm" onclick="ocCriar()">+ Nova ordem</button></div>
        </div>
        ${oc.erro ? `<div class="alert alert-danger">${ocEsc(oc.erro)}</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-frete"><div class="kpi-label">A caminho</div><div class="kpi-value">${ocInt(unCaminho)} un.</div><div class="kpi-sub">${fmt(valCaminho)} em mercadoria comprada</div></div>
          <div class="kpi k-venda"><div class="kpi-label">Aguardando chegada</div><div class="kpi-value">${cont('A receber')}</div><div class="kpi-sub">ordens sem nenhuma conferência</div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Recebimento parcial</div><div class="kpi-value">${cont('Parcial')}</div><div class="kpi-sub">chegou uma parte</div></div>
          <div class="kpi k-mc"><div class="kpi-label">Recebido em 30 dias</div><div class="kpi-value">${ocInt(rec30)} un.</div><div class="kpi-sub">conferidas aqui</div></div>
        </div>
        <div class="card"><div class="card-body"><div class="chips">
          ${[['pendentes', 'A receber e parciais', pend.length], ['A receber', 'A receber', cont('A receber')], ['Parcial', 'Parcial', cont('Parcial')], ['Recebida', 'Recebidas', cont('Recebida')], ['todas', 'Todas', lista.length]]
            .map(([k, t, n]) => `<button class="chip ${f === k ? 'active' : ''}" onclick="oc.filtro='${k}';ocDesenhar();">${t}<span class="n">${n}</span></button>`).join('')}
        </div></div></div>
        <div class="card"><div style="overflow-x:auto;"><table class="cp-tab">
          <thead><tr><th>Situação</th><th>Ordem</th><th>Fornecedor</th><th>Produtos</th><th>Previsão de chegada</th><th>Chegada</th><th class="num">Valor da ordem</th><th></th></tr></thead>
          <tbody>${mostrar.length ? mostrar.map(({ o, r }) => {
            const pct = r.comprado ? Math.round(r.recebido / r.comprado * 100) : 0;
            return `<tr>
              <td>${selo(r.sit)}</td>
              <td class="cp-prod"><b>Nº ${ocEsc(o.numero || o.id)}</b><span>${dt(o.data)}${Number(o.id) < 0 ? ' · criada aqui' : ''}</span></td>
              <td class="cp-forn" style="max-width:240px;">${ocEsc(o.fornecedor || '—')}</td>
              <td class="cp-prod" style="max-width:300px;"><b>${r.itens.length} ${r.itens.length === 1 ? 'produto' : 'produtos'}</b><span title="${ocEsc(r.itens.map(i => i.sku).join(', '))}">${ocEsc(r.itens.map(i => i.sku).slice(0, 4).join(', '))}${r.itens.length > 4 ? '…' : ''}</span></td>
              <td>${r.sit === 'A receber' || r.sit === 'Parcial' ? `<input type="date" value="${ocPrev(o) || ''}" onchange="ocSalvarPrevisao(${o.id}, this.value)" style="width:150px;${ocPrev(o) && ocPrev(o) < getToday() ? 'border-color:var(--danger);color:var(--danger);' : ''}" title="${ocPrev(o) && ocPrev(o) < getToday() ? 'A previsão já passou' : 'Quando a mercadoria deve chegar'}">` : dt(ocPrev(o))}</td>
              <td><div class="cp-cob"><div class="cp-cob-n"><b>${ocInt(r.recebido)}</b> de ${ocInt(r.comprado)} un.</div><div class="cp-cob-t"><span class="cp-cob-${pct >= 100 ? 'v' : pct > 0 ? 'a' : 'r'}" style="width:${Math.max(3, Math.min(100, pct))}%;"></span></div></div></td>
              <td class="num"><b>${fmt(Number(o.total) || 0)}</b></td>
              <td style="text-align:right;">${r.sit === 'A receber' || r.sit === 'Parcial' ? `<button class="btn btn-sm" onclick="ocConferir(${o.id})">Conferir chegada</button>` : `<button class="btn-out btn-sm" onclick="ocConferir(${o.id})">Ver</button>`}</td>
            </tr>`; }).join('') : `<tr><td colspan="8"><div class="vazio"><b>Nenhuma ordem nesta lista</b>Troque o filtro acima ou clique em Atualizar do Olist.</div></td></tr>`}</tbody>
        </table></div></div>`;
    }

    async function ocAtualizar(btn){ if(btn){ btn.disabled = true; btn.textContent = 'Atualizando…'; } await ocCarregar(true); ocDesenhar(); }

    // Conferência: uma linha por produto, com o que foi comprado, o que já chegou e o campo "chegou agora"
    function ocConferir(id){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o) return;
      const r = ocResumo(o), aberta = r.sit === 'A receber' || r.sit === 'Parcial';
      const hist = oc.receb.filter(x => Number(x.ordem_id) === Number(id));
      const dth = t => new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
      vmlModal(`Ordem nº ${ocEsc(o.numero || o.id)} — ${ocEsc(o.fornecedor || '')}`, `
        ${r.antiga ? '<div class="alert alert-info">Esta ordem já estava como atendida no Olist antes de a conferência existir aqui, então aparece como recebida.</div>' : ''}
        <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num">Comprado</th><th class="num">Já recebido</th><th class="num">Falta</th>${aberta ? '<th class="num">Chegou agora <a class="fx-link" style="color:var(--primary);font-size:11px;margin-left:6px;" onclick="ocReceberTudo()">receber tudo</a></th>' : ''}</tr></thead><tbody>
          ${r.itens.map((i, n) => `<tr><td class="cp-prod">${typeof fotoLinha === 'function' ? fotoLinha(i.sku, `<b>${ocEsc(i.sku)}</b><span>${ocEsc(i.descricao || '')}</span>`) : `<b>${ocEsc(i.sku)}</b><span>${ocEsc(i.descricao || '')}</span>`}</td><td class="num">${ocInt(i.comprado)}</td><td class="num">${ocInt(r.antiga ? i.comprado : i.recebido)}</td><td class="num"><b>${ocInt(r.antiga ? 0 : i.falta)}</b></td>
            ${aberta ? `<td class="num"><input type="number" min="0" step="1" class="cp-dias oc-qtd" style="width:110px !important;" data-sku="${ocEsc(i.sku)}" data-falta="${i.falta}" placeholder="0" ${i.falta ? '' : 'disabled'}></td>` : ''}</tr>`).join('')}
        </tbody></table></div>
        ${aberta ? `
          <div class="form-row" style="margin-top:14px;">
            <div class="form-group" style="max-width:210px;"><label class="form-label">Data em que chegou</label><input type="date" id="oc-data" value="${getToday()}" max="${getToday()}"></div>
            <div class="form-group"><label class="form-label">Observação (opcional)</label><input type="text" id="oc-obs" placeholder="Ex.: conferido por Ricardo, 2 caixas avariadas"></div>
          </div>
          <div class="text-muted" style="font-size:12px;margin:-4px 0 10px;">Se a mercadoria chegou em outro dia, informe a data certa: o custo por lote usa essa data para saber a partir de quando o preço desta compra vale.</div>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;"><input type="checkbox" id="oc-ja" style="margin-top:3px;"><span><b>Estas unidades já estão contadas no estoque do galpão</b><br><span class="text-muted">Marque quando estiver registrando uma chegada antiga, que já entrou na última lista de estoque importada. Sem marcar, a quantidade é somada ao galpão.</span></span></label>` : ''}
        ${hist.length ? `<div class="form-label" style="margin-top:18px;">Chegadas já lançadas</div><table><tbody>
          ${hist.map(h => `<tr><td>${dth(h.recebido_em)}</td><td><b>${ocEsc(h.sku)}</b></td><td style="text-align:right;">${ocInt(h.qtd)} un.</td><td class="text-muted" style="font-size:12px;">${h.somou === false ? 'sem somar ao galpão' : 'somado ao galpão'}${h.obs ? ' · ' + ocEsc(h.obs) : ''}</td><td style="text-align:right;"><button class="btn-out btn-sm" onclick="ocDesfazer(${h.id})">Desfazer</button></td></tr>`).join('')}
        </tbody></table>` : ''}`,
        `${Number(o.id) < 0 ? `<button class="btn-out" style="color:var(--danger);margin-right:auto;" onclick="ocExcluirLocal(${o.id}, this)">Excluir ordem</button><button class="btn-out" onclick="ocEditarLocal(${o.id})">Editar ordem</button>` : '<span style="margin-right:auto;"></span>'}<button class="btn-out" onclick="ocDuplicar(${o.id})" title="Abre uma ordem nova com os mesmos itens e fornecedor">Repetir compra</button><button class="btn-out" onclick="ocPdf(${o.id})">PDF</button><button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button>${aberta ? `<button class="btn" onclick="ocLancar(${o.id}, this)">Lançar chegada</button>` : ''}`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
    }
    function ocReceberTudo(){ document.querySelectorAll('.oc-qtd').forEach(i => { if(!i.disabled) i.value = i.dataset.falta; }); }

    // soma (ou tira) do estoque do galpão, casando o SKU sem diferenciar maiúsculas
    function ocMexerGalpao(sku, qtd, descricao){
      let e = estoqueGalpao.find(x => ocN(x.sku) === ocN(sku));
      if(!e){ e = { sku, descricao: descricao || sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }; estoqueGalpao.push(e); }
      e.qtd_galpao = Math.max(0, (Number(e.qtd_galpao) || 0) + qtd);
      e.data_atualizacao = getToday();
    }

    // registra no controle de estoque (depósito próprio); sem ele, mexe direto na lista antiga
    async function ocNoEstoque(linhas, motivo, ref, obs){
      if(typeof estCarregar === 'function'){
        await estCarregar(false);
        const dep = typeof estDepProprio === 'function' ? estDepProprio() : null;
        if(dep){
          linhas.forEach(l => { if(!estoqueGalpao.some(x => ocN(x.sku) === ocN(l.sku))) estoqueGalpao.push({ sku: l.sku, descricao: l.descricao || l.sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }); });
          const r = await estMovimentar(dep.id, linhas.map(l => ({ sku: l.sku, qtd: l.qtd, motivo, ref, obs: obs || null, custo_unit: l.custo_unit })));
          if(!r.ok) alert('A chegada foi lançada, mas não consegui registrar no estoque: ' + r.erro);
          return;
        }
      }
      linhas.forEach(l => ocMexerGalpao(l.sku, l.qtd, l.descricao)); salvar();
    }

    async function ocLancar(id, btn){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o) return;
      const ja = document.getElementById('oc-ja')?.checked || false, obs = (document.getElementById('oc-obs')?.value || '').trim();
      const linhas = [...document.querySelectorAll('.oc-qtd')].map(i => ({ sku: i.dataset.sku, qtd: Number(i.value) || 0, falta: Number(i.dataset.falta) || 0 })).filter(l => l.qtd > 0);
      if(!linhas.length){ alert('Informe a quantidade que chegou em pelo menos um produto.'); return; }
      const acima = linhas.filter(l => l.qtd > l.falta);
      if(acima.length && !confirm('Em ' + acima.length + ' produto(s) a quantidade informada é maior do que a que faltava (' + acima.map(l => l.sku).join(', ') + '). Lançar assim mesmo?')) return;
      if(btn){ btn.disabled = true; btn.textContent = 'Lançando…'; }
      // chegada de hoje fica com a hora de agora; de outro dia, meio-dia daquele dia
      const dia = (document.getElementById('oc-data')?.value || '').trim(), quando = dia && dia !== getToday() ? new Date(dia + 'T12:00:00').toISOString() : new Date().toISOString();
      const { data, error } = await supa.from('compras_recebimentos').insert(linhas.map(l => ({ usuario_id: usuarioAtual.id, ordem_id: Number(id), sku: l.sku, qtd: l.qtd, obs: obs || null, somou: !ja, recebido_em: quando }))).select();
      if(error){ alert('Não consegui lançar a chegada: ' + error.message); if(btn){ btn.disabled = false; btn.textContent = 'Lançar chegada'; } return; }
      oc.receb = (data || []).concat(oc.receb);
      if(!ja) await ocNoEstoque(linhas.map(l => { const it = (o.itens || []).find(i => ocN(i.sku) === ocN(l.sku)); return { sku: l.sku, qtd: l.qtd, descricao: it && it.descricao, custo_unit: it && Number(it.valor) > 0 ? Number(it.valor) : null }; }), 'compra', 'OC ' + (o.numero || o.id), obs);
      if(typeof pepsRecalcular === 'function') pepsRecalcular(false);   // a chegada vira um lote de custo
      fecharModal('modal-vml');
      ocDesenhar();
    }

    async function ocDesfazer(recId){
      const h = oc.receb.find(x => Number(x.id) === Number(recId)); if(!h) return;
      if(!confirm('Desfazer esta chegada de ' + ocInt(h.qtd) + ' un. de ' + h.sku + '?' + (h.somou === false ? '' : ' A quantidade será tirada do estoque do galpão.'))) return;
      const { error } = await supa.from('compras_recebimentos').delete().eq('id', recId);
      if(error){ alert('Não consegui desfazer: ' + error.message); return; }
      oc.receb = oc.receb.filter(x => Number(x.id) !== Number(recId));
      if(h.somou !== false){ const o = oc.ordens.find(x => Number(x.id) === Number(h.ordem_id)); await ocNoEstoque([{ sku: h.sku, qtd: -Number(h.qtd) }], 'ajuste', 'OC ' + ((o && o.numero) || h.ordem_id), 'Chegada desfeita'); }
      if(typeof pepsRecalcular === 'function') pepsRecalcular(false);
      ocDesenhar();
      ocConferir(h.ordem_id);
    }
