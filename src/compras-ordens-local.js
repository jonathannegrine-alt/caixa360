// ===== ORDENS DE COMPRA CRIADAS NO CAIXA 360 + PREVISÃO DE CHEGADA =====
// Complementa src/compras-ordens.js. Ordem criada aqui fica na mesma tabela olist_ordens (id negativo, origem
// 'caixa360') e tem as funções da ordem de compra do Olist:
//   fornecedor (com "últimas compras"), itens (SKU, quantidade, preço, IPI), totais (desconto, frete, IPI),
//   nº no fornecedor, data da compra e prevista, condição de pagamento com parcelas geradas e editáveis,
//   categoria, loja, transportador, frete por conta, observações, PDF da ordem.
// As parcelas viram contas a pagar (fonte 'ordem', tiny_key 'oc:<id>:<n>') quando "Lançar no Contas a pagar"
// está marcado. O que não cabe nas colunas antigas fica em olist_ordens.extra (jsonb).
// A previsão de chegada de qualquer ordem (inclusive do Olist) fica em data_prevista_local.

    const ocPrev = o => o.data_prevista_local || o.data_prevista || null;
    let ocNova = null;
    const OC_FRETE = ['Por conta do fornecedor (CIF)', 'Por nossa conta (FOB)', 'Por conta de terceiros', 'Transporte próprio do fornecedor', 'Transporte próprio nosso', 'Sem transporte'];
    const ocNum = v => { let s = String(v == null ? '' : v).trim().replace(/[^\d.,-]/g, ''); if(s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isFinite(n) ? n : 0; };
    const ocR2 = n => Math.round(n * 100) / 100;

    async function ocSalvarPrevisao(id, valor){
      const r = await supa.from('olist_ordens').update({ data_prevista_local: valor || null }).eq('usuario_id', usuarioAtual.id).eq('id', id);
      if(r.error){ toast('Não consegui guardar a previsão: ' + r.error.message); return; }
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(o) o.data_prevista_local = valor || null;
      ocDesenhar();
    }

    // último preço pago por SKU (ordens não canceladas, da mais antiga para a mais nova)
    function ocUltimoPreco(){
      const m = new Map();
      oc.ordens.filter(o => Number(o.situacao) !== 2).slice().sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))).forEach(o => (o.itens || []).forEach(i => { if(Number(i.valor) > 0 && i.sku) m.set(ocN(i.sku), Number(i.valor)); }));
      return m;
    }
    function ocNomeProduto(sku){
      const k = ocN(sku);
      return (skus.find(s => ocN(s.sku) === k) || {}).titulo || (estoqueGalpao.find(e => ocN(e.sku) === k) || {}).descricao || (typeof componentes !== 'undefined' && (componentes.find(c => ocN(c.codigo) === k) || {}).descricao) || '';
    }

    // itensIniciais: [{ sku, qtd, valor }] (vindos da lista de compras, por exemplo)
    function ocCriar(itensIniciais){
      const locais = oc.ordens.filter(o => Number(o.id) < 0).length;
      ocNova = { id: null, numero: 'C' + String(locais + 1).padStart(3, '0'), fornecedor: '', data: getToday(), prev: '', nforn: '', desconto: '', frete: '', condicao: '', categoria: '', loja: typeof lojaNova === 'function' ? lojaNova() : '',
        lancar: !(typeof olist !== 'undefined' && olist.conectado && (!lojaNova || lojaNova() === lojaPadraoId())), transportador: '', fretePor: '', obs: '', obsInterna: '', parcelas: [],
        itens: (Array.isArray(itensIniciais) && itensIniciais.length ? itensIniciais.map(i => ({ sku: i.sku, desc: ocNomeProduto(i.sku), qtd: i.qtd, valor: i.valor ? fmtMoney(Number(i.valor)) : '', ipi: '' })) : [{ sku: '', desc: '', qtd: '', valor: '', ipi: '' }]) };
      ocCriarDesenhar();
    }
    // editar qualquer ordem. Ordem do Olist editada aqui fica marcada (extra.editada) e a busca no Olist deixa de sobrescrevê-la
    function ocEditar(id){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o) return;
      const e = o.extra || {}, doOlist = Number(o.id) > 0 && !e.editada;
      // ordem do Olist: a diferença entre o total e a soma dos itens entra como frete (a mais) ou desconto (a menos)
      const prod = (o.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.valor) || 0), 0), dif = doOlist ? ocR2((Number(o.total) || 0) - prod) : 0;
      ocNova = { id: o.id, numero: o.numero, fornecedor: o.fornecedor || '', data: o.data || getToday(), prev: ocPrev(o) || '', nforn: e.nforn || '', desconto: e.desconto ? fmtMoney(e.desconto) : dif < 0 ? fmtMoney(-dif) : '', frete: e.frete ? fmtMoney(e.frete) : dif > 0 ? fmtMoney(dif) : '',
        condicao: e.condicao || '', categoria: e.categoria || '', loja: e.loja || '', lancar: !!e.lancar, transportador: e.transportador || '', fretePor: e.fretePor || '', obs: e.obs || '', obsInterna: e.obsInterna || '',
        parcelas: (e.parcelas || []).map(p => ({ data: p.data, val: p.val })),
        itens: (o.itens || []).map(i => ({ sku: i.sku, desc: i.descricao || ocNomeProduto(i.sku), qtd: i.qtd, valor: fmtMoney(Number(i.valor) || 0), ipi: i.ipi || '' })) };
      if(!ocNova.itens.length) ocNova.itens.push({ sku: '', desc: '', qtd: '', valor: '', ipi: '' });
      ocCriarDesenhar();
    }
    const ocEditarLocal = ocEditar;
    function ocDuplicar(id){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o) return;
      ocCriar((o.itens || []).map(i => ({ sku: i.sku, qtd: i.qtd, valor: i.valor })));
      ocNova.fornecedor = o.fornecedor || ''; const e = o.extra || {};
      Object.assign(ocNova, { condicao: e.condicao || '', categoria: e.categoria || '', transportador: e.transportador || '', fretePor: e.fretePor || '' });
      ocCriarDesenhar();
    }

    function ocCriarLer(){
      if(!ocNova) return;
      const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
      const campos = { fornecedor: 'ocn-forn', data: 'ocn-data', prev: 'ocn-prev', nforn: 'ocn-nforn', desconto: 'ocn-desc', frete: 'ocn-frete', condicao: 'ocn-cond', categoria: 'ocn-cat', loja: 'ocn-loja', transportador: 'ocn-transp', fretePor: 'ocn-fretepor', obs: 'ocn-obs', obsInterna: 'ocn-obsint' };
      Object.keys(campos).forEach(k => { const x = v(campos[k]); if(x !== undefined) ocNova[k] = x; });
      const lc = document.getElementById('ocn-lancar'); if(lc) ocNova.lancar = lc.checked;
      const linhas = [...document.querySelectorAll('.ocn-linha')];
      if(linhas.length) ocNova.itens = linhas.map(l => ({ sku: l.querySelector('.ocn-sku').value.trim(), desc: l.querySelector('.ocn-nome').value.trim(), qtd: l.querySelector('.ocn-qtd').value, valor: l.querySelector('.ocn-val').value, ipi: l.querySelector('.ocn-ipi').value }));
      const pl = [...document.querySelectorAll('.ocn-parc')];
      if(pl.length) ocNova.parcelas = pl.map(l => ({ data: l.querySelector('.ocn-pd').value, val: ocNum(l.querySelector('.ocn-pv').value) }));
    }
    function ocTotais(){
      const it = ocNova.itens.map(i => ({ q: Number(i.qtd) || 0, v: ocNum(i.valor), ipi: ocNum(i.ipi) })).filter(i => i.q > 0);
      const produtos = it.reduce((s, i) => s + i.q * i.v, 0), ipi = it.reduce((s, i) => s + i.q * i.v * i.ipi / 100, 0);
      const desconto = ocNum(ocNova.desconto), frete = ocNum(ocNova.frete);
      return { n: it.length, qtd: it.reduce((s, i) => s + i.q, 0), produtos: ocR2(produtos), ipi: ocR2(ipi), desconto, frete, geral: ocR2(produtos + ipi + frete - desconto) };
    }
    function ocCriarLinha(){ ocCriarLer(); ocNova.itens.push({ sku: '', desc: '', qtd: '', valor: '', ipi: '' }); ocCriarDesenhar(); setTimeout(() => { const l = document.querySelectorAll('.ocn-sku'); if(l.length) l[l.length - 1].focus(); }, 30); }
    function ocCriarTirar(n){ ocCriarLer(); ocNova.itens.splice(n, 1); if(!ocNova.itens.length) ocNova.itens.push({ sku: '', desc: '', qtd: '', valor: '', ipi: '' }); ocCriarDesenhar(); }
    // ao escolher o SKU: preenche o nome e o último preço pago
    function ocCriarSku(k){
      ocCriarLer(); const i = ocNova.itens[k]; if(!i || !i.sku) return;
      const nome = ocNomeProduto(i.sku), preco = ocUltimoPreco().get(ocN(i.sku)) || Number((skus.find(s => ocN(s.sku) === ocN(i.sku)) || {}).custo) || 0;
      if(nome && !i.desc) i.desc = nome;
      if(preco && !ocNum(i.valor)) i.valor = fmtMoney(preco);
      ocCriarDesenhar();
    }
    function ocCriarTotal(){
      ocCriarLer(); const t = ocTotais();
      const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
      set('ocn-t-n', t.n); set('ocn-t-q', t.qtd.toLocaleString('pt-BR')); set('ocn-t-prod', fmt(t.produtos)); set('ocn-t-ipi', fmt(t.ipi)); set('ocn-t-geral', fmt(t.geral));
      document.querySelectorAll('.ocn-linha').forEach((l, k) => { const i = ocNova.itens[k], c = l.querySelector('.ocn-tot'); if(i && c) c.textContent = fmt((Number(i.qtd) || 0) * ocNum(i.valor) * (1 + ocNum(i.ipi) / 100)); });
      const sp = document.getElementById('ocn-parc-soma'); if(sp){ const s = ocNova.parcelas.reduce((a, p) => a + (Number(p.val) || 0), 0), d = ocR2(s - t.geral); sp.innerHTML = '<b>' + fmt(s) + '</b>' + (ocNova.parcelas.length && d ? ` <span class="text-danger">(${d > 0 ? 'sobra' : 'falta'} ${fmt(Math.abs(d))} para o total da ordem)</span>` : ''); }
    }
    // condição de pagamento no formato do Olist: "30 60", "3x" ou "15 +2x"
    function ocGerarParcelas(){
      ocCriarLer();
      const t = ocTotais(), base = ocNova.data || getToday();
      if(!(t.geral > 0)){ toast('Inclua os itens da compra antes de gerar as parcelas.'); return; }
      const mes = (data, n) => { const d = parseDate(data), dia = d.getDate(), r = new Date(d.getFullYear(), d.getMonth() + n, 1); r.setDate(Math.min(dia, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate())); return dateStr(r); };
      const datas = []; let ult = null;
      String(ocNova.condicao || '').trim().split(/[\s,;]+/).filter(Boolean).forEach(tok => {
        const mx = tok.match(/^\+?(\d+)x$/i);
        if(mx){ const n = Math.min(60, Number(mx[1])); for(let i = 0; i < n; i++){ ult = ult ? mes(ult, 1) : mes(base, 1); datas.push(ult); } }
        else if(/^\d+$/.test(tok)){ ult = addDias(base, Number(tok)); datas.push(ult); }
      });
      if(!datas.length){ toast('Escreva a condição: prazos em dias (30 60), número de parcelas (3x) ou os dois (15 +2x). Para pagamento à vista use 0.'); return; }
      const v = Math.floor(t.geral / datas.length * 100) / 100;
      ocNova.parcelas = datas.map((d, i) => ({ data: d, val: i === datas.length - 1 ? ocR2(t.geral - v * (datas.length - 1)) : v }));
      ocCriarDesenhar();
    }
    function ocUltimasCompras(){
      ocCriarLer(); const f = ocN(ocNova.fornecedor); if(!f){ toast('Escolha o fornecedor.'); return; }
      const l = oc.ordens.filter(o => ocN(o.fornecedor) === f && Number(o.situacao) !== 2 && Number(o.id) !== Number(ocNova.id)).slice(0, 8);
      const host = document.getElementById('ocn-ultimas'); if(!host) return;
      host.innerHTML = l.length ? `<div class="pf-tab" style="margin:8px 0 0;"><table><thead><tr><th>Ordem</th><th>Data</th><th>Itens</th><th style="text-align:right;">Total</th><th></th></tr></thead><tbody>${l.map(o => `<tr><td>${ocEsc(o.numero || '')}</td><td>${o.data ? ptDate(String(o.data).slice(0, 10)) : '—'}</td><td style="max-width:360px;">${(o.itens || []).slice(0, 4).map(i => ocEsc(i.sku) + ' × ' + ocInt(i.qtd)).join(', ')}${(o.itens || []).length > 4 ? '…' : ''}</td><td style="text-align:right;">${fmt(Number(o.total) || 0)}</td><td><button class="btn-out btn-sm" onclick="ocCopiarItens(${o.id})">Repetir itens</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="text-muted" style="font-size:12.5px;margin-top:6px;">Nenhuma compra anterior deste fornecedor.</div>';
    }
    function ocCopiarItens(id){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o) return;
      ocCriarLer(); ocNova.itens = (o.itens || []).map(i => ({ sku: i.sku, desc: i.descricao || ocNomeProduto(i.sku), qtd: i.qtd, valor: fmtMoney(Number(i.valor) || 0), ipi: i.ipi || '' })); ocCriarDesenhar();
    }

    function ocCriarDesenhar(){
      const n = ocNova, forn = [...new Set(oc.ordens.map(o => o.fornecedor).concat((typeof pagTodos === 'function' ? pagTodos() : pagamentos).map(p => p.forn)).filter(Boolean))].sort().slice(0, 500);
      const prods = [...new Set([...skus.map(s => s.sku), ...estoqueGalpao.map(e => e.sku)])].filter(Boolean).sort();
      const cats = categorias.map(c => c.nome), t = ocTotais();
      const loja = typeof lojaSelect === 'function' ? lojaSelect('ocn-loja', n.loja) : '';
      const sec = tit => `<div class="oc-sec">${tit}</div>`;
      vmlModal((n.id ? 'Editar ordem de compra ' : 'Nova ordem de compra ') + ocEsc(n.numero), `
        <div class="pf-grid" style="grid-template-columns:2fr 1fr 1fr;">
          <label class="pf-c"><span>Fornecedor</span><input id="ocn-forn" list="ocn-forns" value="${ocEsc(n.fornecedor)}" placeholder="Nome do fornecedor"><datalist id="ocn-forns">${forn.map(f => `<option value="${ocEsc(f)}">`).join('')}</datalist></label>
          <label class="pf-c"><span>Nº no fornecedor</span><input id="ocn-nforn" value="${ocEsc(n.nforn)}" placeholder="Pedido dele, se houver"></label>
          ${loja ? `<label class="pf-c"><span>Loja</span>${loja}</label>` : '<span></span>'}
        </div>
        <a class="fx-link" style="color:var(--primary);cursor:pointer;font-size:12.5px;" onclick="ocUltimasCompras()">ver últimas compras deste fornecedor</a><div id="ocn-ultimas"></div>

        ${sec('Itens da compra')}
        <datalist id="ocn-prods">${prods.map(p => `<option value="${ocEsc(p)}">`).join('')}</datalist>
        <div class="pf-tab" style="max-height:none;margin-top:0;"><table><thead><tr><th>Cód (SKU)</th><th>Item</th><th style="text-align:right;">Qtde</th><th style="text-align:right;">Preço un</th><th style="text-align:right;">IPI %</th><th style="text-align:right;">Preço total</th><th></th></tr></thead><tbody>
          ${n.itens.map((i, k) => `<tr class="ocn-linha"><td><span style="display:flex;align-items:center;gap:7px;">${i.sku && typeof fotoMini === 'function' ? fotoMini(i.sku) : '<span class="foto-mini vazia" style="cursor:default;"></span>'}<input class="ocn-sku" list="ocn-prods" value="${ocEsc(i.sku)}" placeholder="SKU" style="width:150px;" onchange="ocCriarSku(${k})"></span></td>
            <td><input class="ocn-nome" value="${ocEsc(i.desc || '')}" placeholder="Descrição" style="min-width:180px;width:100%;"></td>
            <td style="text-align:right;"><input type="number" class="ocn-qtd" value="${ocEsc(i.qtd)}" min="0" style="width:90px;text-align:right;" oninput="ocCriarTotal()"></td>
            <td style="text-align:right;"><input class="ocn-val money-input" value="${ocEsc(i.valor)}" placeholder="0,00" style="width:100px;text-align:right;" oninput="onMoneyInput(this);ocCriarTotal()"></td>
            <td style="text-align:right;"><input class="ocn-ipi" value="${ocEsc(i.ipi || '')}" placeholder="0" style="width:60px;text-align:right;" oninput="ocCriarTotal()"></td>
            <td class="ocn-tot" style="text-align:right;white-space:nowrap;font-weight:600;">${fmt((Number(i.qtd) || 0) * ocNum(i.valor) * (1 + ocNum(i.ipi) / 100))}</td>
            <td><button type="button" class="ico-btn" title="Tirar este item" onclick="ocCriarTirar(${k})">✕</button></td></tr>`).join('')}
        </tbody></table></div>
        <button type="button" class="btn-out btn-sm" style="margin-top:8px;" onclick="ocCriarLinha()">+ adicionar item</button>

        ${sec('Totais da compra')}
        <div class="oc-totais">
          <div><span>Nº de itens</span><b id="ocn-t-n">${t.n}</b></div>
          <div><span>Soma das qtdes</span><b id="ocn-t-q">${t.qtd.toLocaleString('pt-BR')}</b></div>
          <div><span>Total dos produtos</span><b id="ocn-t-prod">${fmt(t.produtos)}</b></div>
          <div><span>Total do IPI</span><b id="ocn-t-ipi">${fmt(t.ipi)}</b></div>
          <label><span>Desconto (R$)</span><input id="ocn-desc" class="money-input" value="${ocEsc(n.desconto)}" placeholder="0,00" oninput="onMoneyInput(this);ocCriarTotal()"></label>
          <label><span>Frete (R$)</span><input id="ocn-frete" class="money-input" value="${ocEsc(n.frete)}" placeholder="0,00" oninput="onMoneyInput(this);ocCriarTotal()"></label>
          <div class="oc-geral"><span>Total geral</span><b id="ocn-t-geral">${fmt(t.geral)}</b></div>
        </div>

        ${sec('Detalhes da compra')}
        <div class="pf-grid" style="grid-template-columns:1fr 1fr 1fr;">
          <label class="pf-c"><span>Data da compra</span><input type="date" id="ocn-data" value="${n.data}"></label>
          <label class="pf-c"><span>Data prevista de chegada</span><input type="date" id="ocn-prev" value="${n.prev}"></label>
          <label class="pf-c"><span>Categoria (no Contas a pagar)</span><select id="ocn-cat"><option value="">Selecione</option>${cats.map(c => `<option ${n.categoria === c ? 'selected' : ''}>${ocEsc(c)}</option>`).join('')}</select></label>
        </div>

        ${sec('Pagamento')}
        <div class="pf-grid" style="grid-template-columns:2fr 1fr;align-items:end;">
          <label class="pf-c"><span>Condição de pagamento</span><div style="display:flex;gap:8px;"><input id="ocn-cond" value="${ocEsc(n.condicao)}" placeholder="30 60, 3x ou 15 +2x" onkeydown="if(event.key==='Enter'){event.preventDefault();ocGerarParcelas();}"><button type="button" class="btn btn-sm" style="white-space:nowrap;" onclick="ocGerarParcelas()">Gerar parcelas</button></div></label>
          <label class="pf-check" style="margin:0 0 9px;"><input type="checkbox" id="ocn-lancar" ${n.lancar ? 'checked' : ''}> Lançar as parcelas no Contas a pagar</label>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:4px;">Prazos em dias a contar da data da compra (30 60), número de parcelas mensais (3x) ou os dois (15 +2x). Depois de gerar, altere datas e valores à vontade.${typeof olist !== 'undefined' && olist.conectado ? ' Se esta compra também for lançada no Olist, deixe "Lançar no Contas a pagar" desmarcado para não duplicar.' : ''}</div>
        ${n.parcelas.length ? `<div class="pf-tab"><table><thead><tr><th>#</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th></th></tr></thead><tbody>
          ${n.parcelas.map((p, k) => `<tr class="ocn-parc"><td>${k + 1}/${n.parcelas.length}</td><td><input type="date" class="ocn-pd" value="${p.data}"></td><td style="text-align:right;"><input class="ocn-pv money-input" value="${fmtMoney(Number(p.val) || 0)}" style="width:120px;text-align:right;" oninput="onMoneyInput(this)" onchange="ocCriarTotal()"></td><td><button type="button" class="ico-btn" onclick="ocCriarLer();ocNova.parcelas.splice(${k},1);ocCriarDesenhar()">✕</button></td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="2">Soma das parcelas</td><td style="text-align:right;" id="ocn-parc-soma" colspan="2"></td></tr></tfoot></table></div>` : ''}
        ${n.id ? (() => { const o = oc.ordens.find(x => Number(x.id) === Number(n.id)); return o ? ocParcelasHtml(o) : ''; })() : ''}

        ${sec('Transporte e observações')}
        <div class="pf-grid">
          <label class="pf-c"><span>Transportador</span><input id="ocn-transp" value="${ocEsc(n.transportador)}"></label>
          <label class="pf-c"><span>Frete por conta</span><select id="ocn-fretepor"><option value="">Selecione</option>${OC_FRETE.map(f => `<option ${n.fretePor === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
          <label class="pf-c pf-larg"><span>Observações (saem no PDF)</span><input id="ocn-obs" value="${ocEsc(n.obs)}"></label>
          <label class="pf-c pf-larg"><span>Observações internas (não saem no PDF)</span><input id="ocn-obsint" value="${ocEsc(n.obsInterna)}"></label>
        </div>`,
        `${n.id && n.id < 0 ? `<button class="btn-out" style="color:var(--danger);margin-right:auto;" onclick="ocExcluirLocal(${n.id}, this)">Excluir ordem</button>` : ''}<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn-out" onclick="ocPdf()">Baixar PDF</button><button class="btn" onclick="ocCriarSalvar(this)">Salvar ordem</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '1000px';
      ocCriarTotal();
    }

    function ocMontarRegistro(){
      ocCriarLer();
      const n = ocNova, t = ocTotais();
      const itens = n.itens.map(i => ({ sku: i.sku, descricao: i.desc || ocNomeProduto(i.sku), qtd: Number(i.qtd) || 0, valor: ocNum(i.valor), ipi: ocNum(i.ipi) || undefined })).filter(i => i.sku && i.qtd > 0);
      const parcelas = n.parcelas.filter(p => p.data && Number(p.val) > 0);
      return { itens, t, parcelas, extra: { nforn: n.nforn.trim() || null, desconto: t.desconto || 0, frete: t.frete || 0, ipi: t.ipi || 0, condicao: n.condicao.trim() || null, categoria: n.categoria || null, loja: n.loja || null, lancar: !!n.lancar,
        transportador: n.transportador.trim() || null, fretePor: n.fretePor || null, obs: n.obs.trim() || null, obsInterna: n.obsInterna.trim() || null, parcelas } };
    }

    async function ocCriarSalvar(btn){
      const R = ocMontarRegistro(), n = ocNova;
      if(!n.fornecedor.trim()){ toast('Informe o fornecedor.'); return; }
      if(!R.itens.length){ toast('Inclua pelo menos um item com quantidade.'); return; }
      if(R.extra.lancar && !R.parcelas.length){ toast('Para lançar no Contas a pagar, gere as parcelas (condição de pagamento).'); return; }
      if(n.id > 0) R.extra.editada = true;                     // ordem do Olist alterada aqui: a busca no Olist não sobrescreve
      const reg = { usuario_id: usuarioAtual.id, id: n.id || -Date.now(), numero: n.numero, data: n.data || getToday(), data_prevista_local: n.prev || null, situacao: 0, fornecedor: n.fornecedor.trim(), total: R.t.geral, itens: R.itens, origem: 'caixa360', extra: R.extra };
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      const r = n.id ? await supa.from('olist_ordens').update({ data: reg.data, data_prevista_local: reg.data_prevista_local, fornecedor: reg.fornecedor, total: reg.total, itens: reg.itens, extra: reg.extra }).eq('usuario_id', usuarioAtual.id).eq('id', n.id)
                     : await supa.from('olist_ordens').insert(reg);
      if(r.error){ toast('Não consegui salvar a ordem: ' + r.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Salvar ordem'; } return; }
      const i = oc.ordens.findIndex(x => Number(x.id) === Number(reg.id));
      // edição: situação e origem continuam as da ordem (uma ordem atendida do Olist não volta a "a receber")
      if(i >= 0){ const { situacao, origem, ...mud } = reg; Object.assign(oc.ordens[i], mud); } else oc.ordens.unshift(reg);
      ocContasDaOrdem(i >= 0 ? oc.ordens[i] : reg);
      ocNova = null;
      fecharModal('modal-vml'); ocDesenhar();
      toast('Ordem ' + reg.numero + ' salva' + (reg.extra.lancar ? ' e ' + reg.extra.parcelas.length + ' parcela(s) lançada(s) no Contas a pagar.' : '.'));
    }

    // parcelas da ordem no Contas a pagar: refaz as em aberto; as já pagas ficam como estão
    function ocContasDaOrdem(o, excluir){
      const pref = 'oc:' + o.id + ':', e = o.extra || {};
      if(typeof lojasAbrir === 'function') lojasAbrir();
      try {
        const pagas = new Set(pagamentos.filter(p => String(p.tiny_key || '').startsWith(pref) && p.pago).map(p => p.tiny_key));
        const tinha = pagamentos.some(p => String(p.tiny_key || '').startsWith(pref));
        pagamentos = pagamentos.filter(p => !String(p.tiny_key || '').startsWith(pref) || p.pago);
        if(!excluir && e.lancar) (e.parcelas || []).forEach((p, k) => {
          const chave = pref + (k + 1); if(pagas.has(chave)) return;
          pagamentos.push({ desc: 'Compra ' + o.numero + ' — ' + o.fornecedor, forn: o.fornecedor, val: Number(p.val) || 0, data: p.data, cat: e.categoria || '', pago: false, tipo: e.parcelas.length > 1 ? 'parcelado' : 'unico',
            parcela: e.parcelas.length > 1 ? (k + 1) + '/' + e.parcelas.length : null, grupo_id: e.parcelas.length > 1 ? 'g_oc_' + o.id : null, fonte: 'ordem', tiny_key: chave, emissao: o.data, doc: e.nforn || null, loja: e.loja || null, desconto: 0, juros: 0 });
        });
        if(!tinha && !(e.lancar && (e.parcelas || []).length)) return;
      } finally { if(typeof lojasFechar === 'function') lojasFechar(); }
      salvar(); if(typeof recalc === 'function') try { recalc(); } catch(err){}
    }

    async function ocExcluirLocal(id, bt){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o || Number(o.id) >= 0) return;
      if(oc.receb.some(r => Number(r.ordem_id) === Number(id))){ toast('Esta ordem já tem chegada lançada. Desfaça as chegadas antes de excluir.'); return; }
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar exclusão'; return; }
      const r = await supa.from('olist_ordens').delete().eq('usuario_id', usuarioAtual.id).eq('id', id);
      if(r.error){ toast('Não consegui excluir: ' + r.error.message); return; }
      oc.ordens = oc.ordens.filter(x => Number(x.id) !== Number(id));
      ocContasDaOrdem(o, true);
      fecharModal('modal-vml'); ocDesenhar();
    }

    // parcelas da ordem no Contas a pagar, com a situação de cada uma (paga em / em aberto):
    //   ordem criada aqui → contas com tiny_key 'oc:<id>:<n>'; ordem do Olist → contas cuja descrição traz
    //   "ordem de compra nº <numero>" (é assim que o Olist descreve as contas que a ordem gera).
    //   Sem nenhuma conta ligada, devolve as parcelas planejadas da ordem com situação desconhecida (pago: null).
    function ocParcelasDaOrdem(o){
      const todas = (typeof pagTodos === 'function' ? pagTodos() : pagamentos).filter(p => !p.oculta), pref = 'oc:' + o.id + ':';
      const reNum = /ordem de compra n[º°o]?\.?\s*(\d+)/i;
      let L = todas.filter(p => String(p.tiny_key || '').startsWith(pref));
      if(!L.length && Number(o.id) > 0 && o.numero) L = todas.filter(p => { const m = reNum.exec(p.desc || ''); return m && m[1] === String(o.numero); });
      const ordem = p => { const m = /^(\d+)\//.exec(p.parcela || ''); return m ? Number(m[1]) : 0; };
      if(L.length) return L.slice().sort((a, b) => ordem(a) - ordem(b) || String(a.data).localeCompare(String(b.data)))
        .map((p, k) => ({ parc: p.parcela || (k + 1) + '/' + L.length, venc: p.data, val: Number(p.val) || 0, pago: !!p.pago, dataPaga: p.dataPaga || null, valorPago: p.valorPago != null ? Number(p.valorPago) : null }));
      const pl = (o.extra && o.extra.parcelas) || [];
      return pl.map((p, k) => ({ parc: (k + 1) + '/' + pl.length, venc: p.data, val: Number(p.val) || 0, pago: null }));
    }
    // resumo curto para a lista: "1 de 3 parcelas pagas"
    function ocParcelasResumo(o){
      const P = ocParcelasDaOrdem(o); if(!P.length || P.some(p => p.pago === null)) return '';
      const pg = P.filter(p => p.pago).length;
      return pg === P.length ? (P.length === 1 ? 'paga' : 'todas as ' + P.length + ' parcelas pagas') : pg + ' de ' + P.length + ' parcela' + (P.length === 1 ? '' : 's') + ' paga' + (pg === 1 ? '' : 's');
    }
    // quadro das parcelas (janela da ordem)
    function ocParcelasHtml(o){
      const P = ocParcelasDaOrdem(o); if(!P.length) return '';
      const sit = p => p.pago === null ? '<span class="text-muted">não lançada no Contas a pagar</span>' : p.pago ? '<span class="badge badge-success">Paga' + (p.dataPaga ? ' em ' + ptDate(String(p.dataPaga).slice(0, 10)) : '') + '</span>' : '<span class="badge ' + (p.venc < getToday() ? 'badge-danger">Atrasada' : 'badge-warning">Em aberto') + '</span>';
      const pago = P.filter(p => p.pago).reduce((s, p) => s + (p.valorPago != null ? p.valorPago : p.val), 0), aberto = P.filter(p => p.pago === false).reduce((s, p) => s + p.val, 0);
      return `<div class="form-label" style="margin-top:18px;">Pagamento (Contas a pagar)</div><div class="pf-tab" style="margin-top:4px;"><table><thead><tr><th>Parcela</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Situação</th></tr></thead><tbody>
        ${P.map(p => `<tr><td>${ocEsc(p.parc)}</td><td>${p.venc ? ptDate(String(p.venc).slice(0, 10)) : '—'}</td><td style="text-align:right;">${fmt(p.val)}</td><td>${sit(p)}</td></tr>`).join('')}
        </tbody>${P.some(p => p.pago !== null) ? `<tfoot><tr><td colspan="2">Pago ${fmt(pago)} · em aberto ${fmt(aberto)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div>`;
    }

    // PDF da ordem (do formulário aberto ou de uma ordem salva, inclusive do Olist)
    async function ocPdfLib(){
      const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('não consegui carregar a biblioteca de PDF')); document.head.appendChild(s); });
      await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    }
    // dados de uma ordem salva para o PDF
    function ocPdfDados(o){
      const e = o.extra || {}, itens = o.itens || [], prod = itens.reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.valor) || 0), 0);
      return { o, e, itens, t: { produtos: prod, ipi: Number(e.ipi) || 0, desconto: Number(e.desconto) || 0, frete: Number(e.frete) || 0, geral: Number(o.total) || prod, qtd: itens.reduce((s, i) => s + (Number(i.qtd) || 0), 0) } };
    }
    // desenha uma ordem na página atual do documento
    function ocPdfPagina(doc, { o, e, itens, t }){
      const n2 = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20); doc.text('Ordem de compra ' + (o.numero || ''), 40, 50);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70);
      const linhas = ['Fornecedor: ' + (o.fornecedor || ''), 'Data da compra: ' + (o.data ? ptDate(String(o.data).slice(0, 10)) : '') + (ocPrev(o) ? '     Previsão de chegada: ' + ptDate(String(ocPrev(o)).slice(0, 10)) : '') + (e.nforn ? '     Nº no fornecedor: ' + e.nforn : ''),
        e.condicao ? 'Condição de pagamento: ' + e.condicao : '', e.transportador || e.fretePor ? 'Transporte: ' + [e.transportador, e.fretePor].filter(Boolean).join(' · ') : ''].filter(Boolean);
      let y = 68; linhas.forEach(l => { doc.text(l, 40, y); y += 14; });
      doc.autoTable({ startY: y + 6, margin: { left: 40, right: 40 },
        head: [['#', 'SKU', 'Item', 'Qtde', 'Preço un', 'Total']],
        body: itens.map((i, k) => [k + 1, i.sku, i.descricao || '', (Number(i.qtd) || 0).toLocaleString('pt-BR'), 'R$ ' + n2(i.valor), 'R$ ' + n2((Number(i.qtd) || 0) * (Number(i.valor) || 0))]),
        styles: { fontSize: 9.5, cellPadding: 5, overflow: 'linebreak' }, headStyles: { fillColor: [40, 44, 60], textColor: 255 },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 95, fontStyle: 'bold' }, 3: { halign: 'right', cellWidth: 55 }, 4: { halign: 'right', cellWidth: 75 }, 5: { halign: 'right', cellWidth: 85 } } });
      let yy = doc.lastAutoTable.finalY + 18; doc.setTextColor(30);
      const tot = [['Total dos produtos', t.produtos], t.ipi ? ['IPI', t.ipi] : null, t.frete ? ['Frete', t.frete] : null, t.desconto ? ['Desconto', -t.desconto] : null].filter(Boolean);
      tot.forEach(([r, v]) => { doc.text(r, 380, yy); doc.text('R$ ' + n2(v), 555, yy, { align: 'right' }); yy += 14; });
      doc.setFont('helvetica', 'bold'); doc.text('Total geral', 380, yy + 2); doc.text('R$ ' + n2(t.geral), 555, yy + 2, { align: 'right' }); doc.setFont('helvetica', 'normal'); yy += 24;
      // parcelas com a situação no Contas a pagar (paga em / em aberto); no formulário ainda não salvo, só as planejadas
      const P = o.id != null ? ocParcelasDaOrdem(o) : (e.parcelas || []).map((p, k, a) => ({ parc: (k + 1) + '/' + a.length, venc: p.data, val: Number(p.val) || 0, pago: null }));
      if(P.length){
        doc.autoTable({ startY: yy, margin: { left: 40, right: 40 }, head: [['Parcela', 'Vencimento', 'Valor', 'Situação']],
          body: P.map(p => [p.parc, p.venc ? ptDate(String(p.venc).slice(0, 10)) : '', 'R$ ' + n2(p.val), p.pago === null ? '' : p.pago ? 'Paga' + (p.dataPaga ? ' em ' + ptDate(String(p.dataPaga).slice(0, 10)) : '') : 'Em aberto']),
          styles: { fontSize: 9.5, cellPadding: 4 }, headStyles: { fillColor: [235, 237, 243], textColor: 20 }, columnStyles: { 2: { halign: 'right' } },
          didParseCell: d => { if(d.section === 'body' && d.column.index === 3){ const p = P[d.row.index]; if(p && p.pago) d.cell.styles.textColor = [22, 128, 61]; else if(p && p.pago === false) d.cell.styles.textColor = [180, 83, 9]; d.cell.styles.fontStyle = 'bold'; } } });
        yy = doc.lastAutoTable.finalY + 8;
        if(P.some(p => p.pago !== null)){ const pg = P.filter(p => p.pago).reduce((s, p) => s + (p.valorPago != null ? p.valorPago : p.val), 0), ab = P.filter(p => p.pago === false).reduce((s, p) => s + p.val, 0);
          doc.text('Pago: R$ ' + n2(pg) + '     Em aberto: R$ ' + n2(ab), 40, yy + 6); yy += 22; }
        else yy += 10;
      }
      if(e.obs) doc.text(doc.splitTextToSize('Observações: ' + e.obs, 515), 40, yy);
    }
    async function ocPdf(id){
      let d;
      if(id != null){ const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o) return; d = ocPdfDados(o); }
      else { const R = ocMontarRegistro(); d = { o: { numero: ocNova.numero, fornecedor: ocNova.fornecedor, data: ocNova.data, data_prevista_local: ocNova.prev }, e: R.extra, itens: R.itens, t: R.t }; if(!d.itens.length){ toast('Inclua os itens antes de gerar o PDF.'); return; } }
      try {
        await ocPdfLib();
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        ocPdfPagina(doc, d);
        doc.save('ordem_de_compra_' + String(d.o.numero || '').toLowerCase() + '.pdf');
      } catch(err){ toast('Não consegui gerar o PDF: ' + (err.message || err)); }
    }

    // ---------- ações com as ordens marcadas na lista ----------
    const ocMarcadas = () => oc.ordens.filter(o => oc.sel && oc.sel.has(Number(o.id))).sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')) || Number(a.numero) - Number(b.numero));
    // um PDF só, uma ordem por página
    async function ocPdfVarias(bt){
      const L = ocMarcadas(); if(!L.length){ toast('Marque as ordens na lista.'); return; }
      const rot = bt ? bt.textContent : ''; if(bt){ bt.disabled = true; bt.textContent = 'Gerando…'; }
      try {
        await ocPdfLib();
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        L.forEach((o, k) => { if(k) doc.addPage(); ocPdfPagina(doc, ocPdfDados(o)); });
        doc.save(L.length === 1 ? 'ordem_de_compra_' + String(L[0].numero || '').toLowerCase() + '.pdf' : 'ordens_de_compra_' + getToday() + '.pdf');
      } catch(err){ toast('Não consegui gerar o PDF: ' + (err.message || err)); }
      if(bt){ bt.disabled = false; bt.textContent = rot; }
    }
    // planilha (CSV) com um item por linha
    function ocPlanilhaVarias(){
      const L = ocMarcadas(); if(!L.length){ toast('Marque as ordens na lista.'); return; }
      const n = v => String((Number(v) || 0).toFixed(2)).replace('.', ','), q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const linhas = ['Ordem;Data;Fornecedor;Situação;SKU;Item;Qtde;Preço un;Total do item;Total da ordem'];
      L.forEach(o => { const r = ocResumo(o); (o.itens || []).forEach(i => linhas.push([q(o.numero), o.data || '', q(o.fornecedor), r.sit, q(i.sku), q(i.descricao), Number(i.qtd) || 0, n(i.valor), n((Number(i.qtd) || 0) * (Number(i.valor) || 0)), n(o.total)].join(';'))); });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'ordens_de_compra_' + getToday() + '.csv'; a.click();
    }
    // excluir as marcadas: criada aqui sai do banco (e as parcelas em aberto saem do Contas a pagar);
    // a que veio do Olist fica guardada como excluída (extra.excluida), para a busca no Olist não trazê-la de volta.
    // Ordem com chegada lançada não é excluída.
    async function ocExcluirVarias(bt){
      const L = ocMarcadas(); if(!L.length){ toast('Marque as ordens na lista.'); return; }
      const comChegada = L.filter(o => oc.receb.some(r => Number(r.ordem_id) === Number(o.id))), ok = L.filter(o => !comChegada.includes(o));
      if(!ok.length){ toast('As ordens marcadas já têm chegada lançada. Desfaça as chegadas antes de excluir.'); return; }
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar: excluir ' + ok.length + ' ordem' + (ok.length === 1 ? '' : 's'); setTimeout(() => { if(bt.isConnected){ bt.dataset.conf = ''; bt.textContent = 'Excluir marcadas'; } }, 6000); return; }
      if(bt){ bt.disabled = true; bt.textContent = 'Excluindo…'; }
      let erro = null;
      for(const o of ok){
        const r = Number(o.id) < 0 ? await supa.from('olist_ordens').delete().eq('usuario_id', usuarioAtual.id).eq('id', o.id)
                                   : await supa.from('olist_ordens').update({ extra: { ...(o.extra || {}), excluida: true } }).eq('usuario_id', usuarioAtual.id).eq('id', o.id);
        if(r.error){ erro = r.error.message; break; }
        if(Number(o.id) < 0){ oc.ordens = oc.ordens.filter(x => x !== o); ocContasDaOrdem(o, true); } else o.extra = { ...(o.extra || {}), excluida: true };
        oc.sel.delete(Number(o.id));
      }
      if(erro) toast('Não consegui excluir: ' + erro);
      else toast(ok.length + ' ordem' + (ok.length === 1 ? ' excluída' : 's excluídas') + (comChegada.length ? '. ' + comChegada.length + ' com chegada lançada ficaram (desfaça as chegadas antes).' : '.'));
      ocDesenhar();
    }
