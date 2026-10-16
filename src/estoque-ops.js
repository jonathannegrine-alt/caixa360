// ===== ESTOQUE: OPERAÇÕES =====
// Complementa src/estoque.js:
//   1) gerenciar depósitos (criar, renomear, desativar/excluir);
//   2) vendas: "ocupado" enquanto o pedido não foi enviado e baixa do físico quando o Mercado Livre marca como
//      enviado (vendas_ml.enviado_em, preenchido pela Edge Function ml-envios); kit baixa os componentes;
//   3) envio ao Full a partir do PDF de preparação do Mercado Livre: baixa componente por componente;
//   4) contagem de estoque (digitada ou por planilha) com o confronto sistema x contado.

    let eso = { vendas: [], envios: [], contagens: [], lidoEm: 0 };
    const esoKits = () => { const m = new Map(); composicaoKit.forEach(c => { const k = esN(c.sku_comercial); if(!m.has(k)) m.set(k, []); m.get(k).push({ sku: c.sku_componente, qtd: Number(c.qty) || 1 }); }); return m; };
    // um SKU de anúncio vira a lista de produtos físicos (kit aberto nos componentes)
    // Mapeamento: quando o SKU que vem no anúncio não é o do estoque (digitado errado, código antigo, pacote com
    // várias unidades), diz para qual produto ou kit ele vai e quantas unidades cada venda consome.
    // Fica em comprasCfg.equivalentes [{ de, para, mult }] — o mesmo lugar que a Sugestão de compras já usava.
    function esoMapa(){ const m = new Map(); ((typeof comprasCfg !== 'undefined' && comprasCfg.equivalentes) || []).forEach(e => { if(e.de && e.para) m.set(esN(e.de), { para: e.para, mult: Number(e.mult) > 0 ? Number(e.mult) : 1 }); }); return m; }
    function esoCfg(){ const c = (typeof comprasCfg !== 'undefined' && comprasCfg.estoque) || {}; return { diasSemConferir: c.diasSemConferir >= 0 ? Number(c.diasSemConferir) : 3, ocuparPadrao: c.ocuparPadrao !== false }; }
    function esoAbrir(sku, qtd, kits){
      const eq = esoMapa().get(esN(sku)); if(eq){ sku = eq.para; qtd = qtd * eq.mult; }
      const k = esN(sku), ks = kits || esoKits();
      return ks.has(k) ? ks.get(k).map(c => ({ sku: c.sku, qtd: qtd * c.qtd })) : [{ sku, qtd }];
    }

    // ---------- 1) depósitos ----------
    function estNovoDeposito(){ estGerenciarDepositos(); }
    let estCfgAba = 'dep';
    const ESTCFG_ABAS = [['dep', 'Depósitos'], ['regras', 'Regras'], ['mapa', 'Mapeamento de anúncios']];
    const estCfgTopo = () => '<div class="chips" style="margin-bottom:16px;">' + ESTCFG_ABAS.map(([k, n]) => '<button class="chip ' + (estCfgAba === k ? 'active' : '') + '" onclick="estCfgIr(\'' + k + '\')">' + n + '</button>').join('') + '</div>';
    function estCfgIr(a){ estCfgAba = a; estGerenciarDepositos(); }

    function estGerenciarDepositos(){
      if(estCfgAba === 'regras') return estCfgRegras();
      if(estCfgAba === 'mapa') return esoMapeamento();
      vmlModal('Configurar estoque', estCfgTopo() + `
        <div class="text-muted" style="margin-bottom:12px;">Escolha quais estoques aparecem na tela. Cada loja do Mercado Livre tem o seu Full, atualizado sozinho; os outros você atualiza por compra, venda, contagem ou planilha. A aba <b>Total</b> soma os que estiverem marcados.</div>
        <table class="cp-tab"><thead><tr><th>Mostrar</th><th>Nome</th><th>Tipo</th>${typeof lojasVarias === 'function' && lojasVarias() ? '<th>Lojas que usam</th>' : ''}<th class="num">Produtos com saldo</th><th></th></tr></thead><tbody>
          ${est.depositos.map(d => { const n = est.saldo.filter(s => Number(s.deposito_id) === d.id && Number(s.fisico) !== 0).length; return `<tr style="${d.ativo ? '' : 'opacity:.55;'}">
            <td><input type="checkbox" ${d.ativo ? 'checked' : ''} onchange="estDepAtivo(${d.id}, this.checked)" title="Mostrar este estoque na tela e somar no Total"></td>
            <td><input type="text" value="${esEsc(d.nome)}" onchange="estDepRenomear(${d.id}, this.value)" style="min-width:200px;"></td>
            <td>${d.tipo === 'full' ? 'Full do Mercado Livre' + (d.ml_user_id && typeof contaNome === 'function' && contaNome(d.ml_user_id) ? ' · ' + esEsc(contaNome(d.ml_user_id)) : '') : 'Próprio'}</td>
            ${typeof lojasVarias === 'function' && lojasVarias() ? `<td>${d.tipo === 'full' ? '<span class="text-muted">a própria loja</span>' : contasML.map(c => `<label style="display:inline-flex;gap:5px;align-items:center;margin-right:10px;font-size:12.5px;white-space:nowrap;"><input type="checkbox" ${!Array.isArray(d.lojas) || !d.lojas.length || d.lojas.map(String).includes(c.id) ? 'checked' : ''} onchange="estDepLoja(${d.id}, '${c.id}', this.checked)">${esEsc(c.apelido || c.id)}</label>`).join('')}</td>` : ''}
            <td class="num">${d.tipo === 'full' ? '—' : n}</td>
            <td style="text-align:right;white-space:nowrap;">${d.tipo === 'full' ? '' : `<button class="btn-out btn-sm" style="color:var(--danger);" onclick="estDepExcluir(${d.id})">Excluir</button>`}</td></tr>`; }).join('')}
        </tbody></table>
        <div class="d-flex" style="gap:8px;margin-top:16px;flex-wrap:wrap;"><input type="text" id="est-dep-novo" placeholder="Nome do novo depósito" style="flex:1 1 240px;max-width:340px;"><button class="btn" onclick="estDepCriar()">Criar depósito</button></div>`);
    }
    async function estDepCriar(){
      const nome = (document.getElementById('est-dep-novo').value || '').trim(); if(!nome) return;
      const r = await supa.from('estoque_depositos').insert({ usuario_id: usuarioAtual.id, nome, tipo: 'proprio' });
      if(r.error){ alert(r.error.message.includes('duplicate') ? 'Já existe um depósito com esse nome.' : 'Não consegui criar: ' + r.error.message); return; }
      await estCarregar(true); estDesenhar(); estGerenciarDepositos();
    }
    async function estDepRenomear(id, nome){
      nome = String(nome || '').trim(); if(!nome) return;
      const r = await supa.from('estoque_depositos').update({ nome }).eq('id', id);
      if(r.error){ alert('Não consegui renomear: ' + r.error.message); return; }
      await estCarregar(true); estDesenhar();
    }
    // quais lojas usam o galpão (vale para o balanço e para a tela de estoque de cada loja)
    async function estDepLoja(id, loja, marcado){
      const d = est.depositos.find(x => x.id === id); if(!d) return;
      let l = Array.isArray(d.lojas) && d.lojas.length ? d.lojas.map(String) : contasML.map(c => c.id);
      l = marcado ? [...new Set(l.concat(loja))] : l.filter(x => x !== loja);
      if(!l.length){ toast('Pelo menos uma loja precisa usar o depósito.'); estGerenciarDepositos(); return; }
      const r = await supa.from('estoque_depositos').update({ lojas: l.length === contasML.length ? null : l }).eq('id', id);
      if(r.error){ toast('Não consegui salvar: ' + r.error.message); return; }
      await estCarregar(true); estDesenhar(); estGerenciarDepositos();
    }
    async function estDepAtivo(id, ativo){
      if(!ativo && est.depositos.filter(d => d.ativo).length <= 1){ alert('Precisa ficar pelo menos um depósito ativo.'); return; }
      await supa.from('estoque_depositos').update({ ativo }).eq('id', id);
      await estCarregar(true); estDesenhar(); estGerenciarDepositos();
    }
    async function estDepExcluir(id){
      const d = est.depositos.find(x => x.id === id); if(!d) return;
      const temMov = est.saldo.some(s => Number(s.deposito_id) === id);
      if(!confirm(temMov ? 'Excluir "' + d.nome + '"? Todo o histórico de movimentações dele será apagado e não dá para desfazer. Se quiser só esconder, use Desativar.' : 'Excluir o depósito "' + d.nome + '"?')) return;
      const r = await supa.from('estoque_depositos').delete().eq('id', id);
      if(r.error){ alert('Não consegui excluir: ' + r.error.message); return; }
      est.dep = null; await estCarregar(true); estDesenhar(); estGerenciarDepositos();
    }

    function estCfgRegras(){
      const c = esoCfg();
      vmlModal('Configurar estoque', estCfgTopo() + `
        <div class="cpp-campo"><label>Envio ao Full ocupa o estoque enquanto está em preparação</label>
          <select id="estcfg-ocupar"><option value="1" ${c.ocuparPadrao ? 'selected' : ''}>Sim, já sai do disponível (padrão ao importar o PDF)</option><option value="0" ${c.ocuparPadrao ? '' : 'selected'}>Não, só sai quando eu der a saída</option></select>
          <small>Você ainda pode mudar em cada envio. O físico só baixa quando a saída é lançada.</small></div>
        <div class="cpp-ajuda">Como o estoque se movimenta: a <b>compra conferida</b> entra no depósito; a <b>venda</b> fica ocupada até o Mercado Livre marcar o pedido como <b>enviado</b> (aí baixa do físico) ou a venda ser <b>cancelada</b> (aí volta a ficar disponível); o <b>envio ao Full</b> baixa quando você dá a saída; a <b>contagem</b> acerta o saldo e vira o novo ponto de partida.</div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="estCfgSalvar()">Salvar regras</button>`);
    }
    function estCfgSalvar(){
      comprasCfg.estoque = { ocuparPadrao: document.getElementById('estcfg-ocupar').value === '1' };
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
      eso.lidoEm = 0; fecharModal('modal-vml'); esoLer(true).then(() => estDesenhar());
    }

    // lista os SKUs que chegam dos anúncios (vendas e Full) e para onde cada um vai no estoque
    let esoMapaSo = 'sem';
    function esoMapeamento(){
      const kits = esoKits(), mapa = esoMapa();
      const prods = new Map(); estoqueGalpao.forEach(e => prods.set(esN(e.sku), e.sku)); skus.forEach(s => { if(!prods.has(esN(s.sku))) prods.set(esN(s.sku), s.sku); });
      const vistos = new Map(), ve = (sku, campo, q) => { if(!sku) return; const k = esN(sku), o = vistos.get(k) || { sku, vend: 0, full: 0 }; o[campo] += q; vistos.set(k, o); };
      eso.vendas.forEach(v => ve(v.sku, 'vend', Number(v.qtd) || 0));
      (Array.isArray(estoqueFullML) ? estoqueFullML : []).forEach(x => { if(x.sku && x.sku !== x.item_id) ve(x.sku, 'full', Number(x.total_geral) || 0); });
      mapa.forEach((v, k) => { if(!vistos.has(k)) vistos.set(k, { sku: k.toUpperCase(), vend: 0, full: 0 }); });
      const linhas = [...vistos.values()].map(o => { const k = esN(o.sku), eq = mapa.get(k);
        const tipo = eq ? 'mapeado' : kits.has(k) ? 'kit' : prods.has(k) ? 'produto' : 'sem';
        return { ...o, k, tipo, eq }; }).filter(l => l.tipo !== 'sem' || l.vend + l.full > 0)   // anúncio parado e zerado não precisa de mapeamento
        .sort((a, b) => (a.tipo === 'sem' ? 0 : 1) - (b.tipo === 'sem' ? 0 : 1) || (b.vend + b.full) - (a.vend + a.full));
      const sem = linhas.filter(l => l.tipo === 'sem').length;
      const mostra = linhas.filter(l => esoMapaSo === 'todos' || l.tipo === 'sem' || l.tipo === 'mapeado');
      const selo = { produto: ['Produto do estoque', 'cp-ok'], kit: ['Kit cadastrado', 'cp-ok'], mapeado: ['Mapeado por você', 'cp-comprar'], sem: ['Sem correspondência', 'cp-urgente'] };
      vmlModal('Configurar estoque', estCfgTopo() + `
        <div class="cpp-ajuda">O sistema casa sozinho o SKU do anúncio com o produto ou kit de mesmo código. Aqui ficam só os casos em que o código do anúncio é outro (digitado errado, código antigo, pacote com várias unidades): diga para qual produto ele vai e quantas unidades cada venda consome.</div>
        <datalist id="eso-map-lista">${[...prods.values()].concat([...kits.keys()].map(k => (composicaoKit.find(c => esN(c.sku_comercial) === k) || {}).sku_comercial || k)).sort().map(p => `<option value="${esEsc(p)}">`).join('')}</datalist>
        <div class="chips" style="margin-bottom:10px;"><button class="chip ${esoMapaSo === 'sem' ? 'active' : ''}" onclick="esoMapaSo='sem';esoMapeamento();">Sem correspondência e mapeados<span class="n">${sem + mapa.size}</span></button><button class="chip ${esoMapaSo === 'todos' ? 'active' : ''}" onclick="esoMapaSo='todos';esoMapeamento();">Todos os anúncios<span class="n">${linhas.length}</span></button></div>
        <div style="overflow-x:auto;max-height:48vh;"><table class="cp-tab"><thead><tr><th>SKU do anúncio</th><th class="num" title="Unidades vendidas nos últimos 25 dias, fora do Full">Vendido</th><th class="num">No Full</th><th>Situação</th><th>Vai para o produto ou kit</th><th class="num" title="Quantas unidades do produto cada unidade vendida consome">× unidades</th></tr></thead><tbody>
          ${mostra.length ? mostra.map(l => `<tr><td>${typeof fotoLinha === 'function' ? fotoLinha(l.sku, `<b>${esEsc(l.sku)}</b>`) : `<b>${esEsc(l.sku)}</b>`}</td><td class="num">${l.vend ? esInt(l.vend) : '—'}</td><td class="num">${l.full ? esInt(l.full) : '—'}</td><td><span class="cp-sit ${selo[l.tipo][1]}">${selo[l.tipo][0]}</span></td>
            <td>${l.tipo === 'sem' || l.tipo === 'mapeado' ? `<input type="text" class="eso-map-para" data-de="${esEsc(l.sku)}" list="eso-map-lista" value="${esEsc(l.eq ? l.eq.para : '')}" placeholder="Escolha o produto" style="min-width:220px;">` : '<span class="text-muted">o próprio código</span>'}</td>
            <td class="num">${l.tipo === 'sem' || l.tipo === 'mapeado' ? `<input type="number" class="eso-map-mult" data-de="${esEsc(l.sku)}" min="1" value="${l.eq ? l.eq.mult : 1}" style="width:80px;text-align:right;">` : ''}</td></tr>`).join('') : '<tr><td colspan="6" class="text-muted" style="padding:18px;text-align:center;">Todos os anúncios casam com um produto ou kit do estoque.</td></tr>'}
        </tbody></table></div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="esoMapaSalvar()">Salvar mapeamento</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '980px';
    }
    function esoMapaSalvar(){
      const novo = [];
      document.querySelectorAll('.eso-map-para').forEach(i => { const para = i.value.trim(), de = i.dataset.de; if(!para || esN(para) === esN(de)) return;
        const m = document.querySelector('.eso-map-mult[data-de="' + de.replace(/"/g, '\\"') + '"]'); novo.push({ de, para, mult: Math.max(1, Number(m && m.value) || 1) }); });
      // mantém os mapeamentos que não estavam na tela (filtro "sem correspondência" esconde nada, mas por segurança)
      const naTela = new Set([...document.querySelectorAll('.eso-map-para')].map(i => esN(i.dataset.de)));
      (comprasCfg.equivalentes || []).forEach(e => { if(!naTela.has(esN(e.de))) novo.push(e); });
      comprasCfg.equivalentes = novo;
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
      eso.lidoEm = 0; esoMapeamento(); estDesenhar();
    }

    // ---------- 2) vendas: ocupado e baixa ----------
    async function esoLer(forcar){
      if(!forcar && eso.lidoEm && Date.now() - eso.lidoEm < 2 * 60 * 1000) return;
      const d25 = new Date(Date.now() - 25 * 86400000).toISOString(), d3 = new Date(Date.now() - esoCfg().diasSemConferir * 86400000).toISOString(), d12 = new Date(Date.now() - 12 * 86400000).toISOString();
      const campos = 'order_id,sku,qtd,status,logistic_type,envio_status,enviado_em,data_venda';
      const base = () => supa.from('vendas_ml').select(campos).eq('usuario_id', usuarioAtual.id).neq('status', 'cancelled').or('logistic_type.is.null,logistic_type.neq.fulfillment');
      // o banco devolve no máximo 1000 linhas por consulta: lê em páginas
      const paginas = async q => { const out = []; for(let i = 0; i < 8; i++){ const r = await q().range(i * 1000, i * 1000 + 999); if(r.error || !r.data) break; out.push(...r.data); if(r.data.length < 1000) break; } return out; };
      const [pend, env, e, c] = await Promise.all([
        // ainda não enviadas: ficam ocupando o estoque até o envio sair ou a venda ser cancelada
        paginas(() => base().is('enviado_em', null).gte('data_venda', d25).or('envio_status.is.null,envio_status.neq.cancelled').order('data_venda', { ascending: false })),
        // enviadas nos últimos 12 dias: candidatas à baixa do físico
        paginas(() => base().gte('enviado_em', d12).order('enviado_em', { ascending: false })),
        supa.from('estoque_envios_full').select('*').eq('usuario_id', usuarioAtual.id).order('id', { ascending: false }).limit(300),
        supa.from('estoque_contagens').select('*').eq('usuario_id', usuarioAtual.id).order('id', { ascending: false }).limit(100),
      ]);
      eso.vendas = pend.concat(env);
      if(e.data) eso.envios = e.data;
      if(c.data) eso.contagens = c.data;
      eso.lidoEm = Date.now();
    }

    // ocupado no depósito próprio: vendas aprovadas ainda não enviadas + envios ao Full em preparação que ocupam
    function estOcupadoPorSku(depId){
      const m = new Map(), dep = estDepProprio();
      if(!dep || dep.id !== depId) return m;
      const kits = esoKits(), soma = (sku, q) => { const k = esN(sku); m.set(k, (m.get(k) || 0) + q); };
      eso.vendas.filter(v => !v.enviado_em && v.sku && v.status !== 'cancelled').forEach(v => esoAbrir(v.sku, Number(v.qtd) || 0, kits).forEach(c => soma(c.sku, c.qtd)));
      eso.envios.filter(x => x.situacao === 'preparando' && x.ocupar !== false && Number(x.deposito_id) === depId).forEach(x => (x.itens || []).forEach(i => (i.componentes || []).forEach(c => soma(c.sku, Number(c.qtd) || 0))));
      return m;
    }

    // Baixa do físico pelas vendas ENVIADAS depois do último acerto do produto (carga ou contagem).
    // O horário do acerto vem da referência "planilha-AAAA-MM-DDTHH:MM" (hora em que a planilha foi tirada) ou,
    // sem ela, da hora em que a movimentação foi gravada. Cada pedido baixa uma vez só (ref = nº do pedido).
    async function esoBaixarVendas(){
      const dep = estDepProprio(); if(!dep) return 0;
      const desde = new Date(Date.now() - 40 * 86400000).toISOString();
      const mv = await supa.from('estoque_mov').select('sku_norm,motivo,ref,criado_em').eq('usuario_id', usuarioAtual.id).eq('deposito_id', dep.id).in('motivo', ['carga_inicial', 'contagem', 'venda']).gte('criado_em', desde).limit(20000);
      if(mv.error) return 0;
      const corte = new Map(), feitas = new Set();
      (mv.data || []).forEach(m => {
        if(m.motivo === 'venda'){ feitas.add(m.ref + '|' + m.sku_norm); return; }
        const r = String(m.ref || '').match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/), t = new Date(r ? r[1] + ':00Z' : m.criado_em).getTime();
        if(!corte.has(m.sku_norm) || t > corte.get(m.sku_norm)) corte.set(m.sku_norm, t);
      });
      const kits = esoKits(), linhas = [];
      eso.vendas.filter(v => v.enviado_em && v.sku).forEach(v => {
        const quando = new Date(v.enviado_em).getTime();
        esoAbrir(v.sku, Number(v.qtd) || 0, kits).forEach(c => {
          const k = esN(c.sku);
          if(!corte.has(k) || quando <= corte.get(k) || feitas.has(v.order_id + '|' + k)) return;   // sem acerto ainda, ou já estava fora do físico, ou já baixado
          feitas.add(v.order_id + '|' + k);
          linhas.push({ sku: c.sku, qtd: -c.qtd, motivo: 'venda', ref: String(v.order_id), obs: esN(c.sku) !== esN(v.sku) ? 'Kit ' + v.sku : null });
        });
      });
      if(!linhas.length) return 0;
      // junta linhas do mesmo pedido e produto (carrinho com o mesmo item duas vezes)
      const junto = new Map(); linhas.forEach(l => { const k = l.ref + '|' + esN(l.sku); if(junto.has(k)) junto.get(k).qtd += l.qtd; else junto.set(k, l); });
      const r = await estMovimentar(dep.id, [...junto.values()]);
      return r.ok ? r.n : 0;
    }

    // chamado ao abrir o Estoque: confere envios no Mercado Livre, baixa o que saiu e redesenha
    async function esoSincronizar(conferirML){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      if(conferirML){
        try { const sd = await supa.auth.getSession(), s = sd && sd.data && sd.data.session;
          if(s) await fetch(SUPA_URL + '/functions/v1/ml-envios', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: '{}' }); } catch(e){}
      }
      await esoLer(true);
      const n = await esoBaixarVendas();
      return n;
    }

    // ---------- 3) envio ao Full pelo PDF ----------
    function esoPdfJs(){
      return new Promise((ok, erro) => {
        if(window.pdfjsLib) return ok(window.pdfjsLib);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; ok(window.pdfjsLib); };
        s.onerror = () => erro(new Error('não consegui carregar o leitor de PDF'));
        document.head.appendChild(s);
      });
    }
    // lê o "Inbound-...-preparation-instructions.pdf": nº do envio, e por linha o SKU do anúncio e as unidades
    async function esoLerPdf(buffer){
      const lib = await esoPdfJs(), pdf = await lib.getDocument({ data: buffer }).promise;
      const itens = [];
      for(let p = 1; p <= pdf.numPages; p++){
        const pg = await pdf.getPage(p), tc = await pg.getTextContent();
        tc.items.forEach(i => { const s = String(i.str || '').trim(); if(s) itens.push({ s, x: i.transform[4], y: i.transform[5] - p * 100000 }); });   // páginas seguintes ficam "abaixo"
      }
      const emOrdem = itens.slice().sort((a, b) => b.y - a.y || a.x - b.x);
      const texto = emOrdem.map(i => i.s).join(' ');
      const numero = (texto.match(/Frete\s*#\s*(\d+)/) || [])[1] || '';
      const totalDoc = Number((texto.match(/Total de unidades:\s*([\d.,]+)/) || [])[1]?.replace(/[.,]/g, '')) || 0;
      // coluna UNIDADES: números alinhados com o título da coluna
      const cab = itens.find(i => /^UNIDADES$/i.test(i.s));
      const ehNum = s => /^\d{1,3}([.,]\d{3})*$|^\d+$/.test(s);
      const unidades = emOrdem.filter(i => ehNum(i.s) && (cab ? Math.abs(i.x - cab.x) < 45 && i.y < cab.y : true)).map(i => ({ y: i.y, n: Number(i.s.replace(/[.,]/g, '')) }));
      // cada produto começa em "Código ML:"; o SKU vem depois de "SKU:" (pode quebrar de linha)
      const blocos = [], re = /Código ML:\s*([A-Z0-9]+)([\s\S]*?)(?=Código ML:|$)/g; let m;
      // só o texto da coluna PRODUTO: o SKU pode quebrar de linha e, lido na horizontal, viria misturado com as outras colunas
      const textoProd = (cab ? emOrdem.filter(i => i.x < cab.x - 10) : emOrdem).map(i => i.s).join(' ');
      const conhecidos = new Set([...composicaoKit.map(c => esN(c.sku_comercial)), ...skus.map(s => esN(s.sku)), ...estoqueGalpao.map(e => esN(e.sku))]);
      while((m = re.exec(textoProd))) {
        // 1º: o Código ML é o código do anúncio no estoque do Full, que já tem o SKU inteiro
        const doFull = Array.isArray(estoqueFullML) ? estoqueFullML.find(x => x.item_id === m[1] && x.sku && x.sku !== x.item_id) : null;
        // 2º: o texto depois de "SKU:"; SKU comprido quebra de linha ("J-2022-CANELADO-BEGE-ADAO-" + "CASCA")
        const t = m[2].match(/SKU:\s*(\S+)(?:\s+(\S+))?/) || [], t1 = (t[1] || '').trim(), junto = t1 + (t[2] || '').trim();
        const sku = doFull ? doFull.sku : conhecidos.has(esN(t1)) ? t1 : (conhecidos.has(esN(junto)) || /-$/.test(t1)) ? junto : t1;
        blocos.push({ codigo_ml: m[1], anuncio_sku: sku });
      }
      // posição vertical de cada bloco, para casar com a unidade da mesma linha da tabela
      const ys = emOrdem.filter(i => /Código ML:/.test(i.s)).map(i => i.y);
      blocos.forEach((b, n) => { const y = ys[n]; const u = y == null ? unidades[n] : unidades.slice().sort((a, c) => Math.abs(a.y - y) - Math.abs(c.y - y))[0]; b.qtd = u ? u.n : 0; });
      const soma = blocos.reduce((s, b) => s + b.qtd, 0);
      return { numero, itens: blocos, totalDoc, confere: !!blocos.length && (!totalDoc || soma === totalDoc), soma };
    }

    function esoImportarEnvio(){
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf'; inp.id = 'eso-pdf';
      inp.onchange = () => { const f = inp.files[0]; if(!f) return; const rd = new FileReader(); rd.onload = async e => {
        try { const r = await esoLerPdf(new Uint8Array(e.target.result)); if(!r.itens.length){ alert('Não achei produtos neste PDF. Use o arquivo "preparation-instructions" do envio.'); return; } esoRevisarEnvio(r, f.name); }
        catch(err){ alert('Não consegui ler o PDF: ' + err.message); } }; rd.readAsArrayBuffer(f); };
      inp.click();
    }

    let esoRascunho = null;
    function esoRevisarEnvio(r, arquivo){
      esoRascunho = r;
      const kits = esoKits(), conhecidos = new Set([...kits.keys(), ...skus.map(s => esN(s.sku)), ...estoqueGalpao.map(e => esN(e.sku))]);
      const contas = typeof contasML !== 'undefined' ? contasML : [];
      const ja = eso.envios.find(x => x.numero === r.numero);
      // a loja sai do próprio PDF: o Código ML de cada linha é o código do anúncio no estoque do Full
      const doFull = Array.isArray(estoqueFullML) ? r.itens.map(i => estoqueFullML.find(x => x.item_id === i.codigo_ml)).find(x => x && x._conta) : null;
      const contaAuto = doFull ? String(doFull._conta) : '';
      vmlModal('Envio ao Full nº ' + esEsc(r.numero || '?'), `
        ${ja ? `<div class="alert alert-warning">Já existe um envio com este número (${esEsc(ja.titulo)}). Salvar vai substituir os produtos dele.</div>` : ''}
        ${!ja && !r.daPrevisao ? (() => { const pl = eso.envios.filter(x => x.situacao === 'preparando' && /^Previsão/.test(x.numero || ''));
          return pl.length ? `<div class="alert alert-info" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><label style="display:flex;gap:6px;align-items:center;cursor:pointer;margin:0;"><input type="checkbox" id="eso-subst-ok" checked> Substituir o envio planejado pela previsão</label>
            <select id="eso-subst" style="width:auto;">${pl.map(x => `<option value="${x.id}">${esEsc(x.titulo)} · ${esInt((x.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0))} un.</option>`).join('')}</select>
            <span class="text-muted" style="font-size:12px;">Desmarque se for um envio a mais.</span></div>` : ''; })() : ''}
        ${r.confere ? '' : `<div class="alert alert-danger">A soma das unidades lidas (${esInt(r.soma)}) não bate com o total do documento (${esInt(r.totalDoc)}). Confira as quantidades antes de salvar.</div>`}
        <div class="form-row">
          <div class="form-group"><label class="form-label">Loja</label><select id="eso-conta">${contas.map(c => `<option value="${esEsc(c.id)}" ${String(c.id) === contaAuto ? 'selected' : ''}>${esEsc(c.apelido || c.id)}</option>`).join('') || '<option value="">—</option>'}</select></div>
          <div class="form-group"><label class="form-label">Saída prevista (deixe vazio se ainda não tem vaga)</label><input type="date" id="eso-data"></div>
        </div>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;margin-bottom:14px;"><input type="checkbox" id="eso-ocupar" ${esoCfg().ocuparPadrao ? 'checked' : ''} style="margin-top:3px;"><span><b>Ocupar o estoque enquanto está em preparação</b><br><span class="text-muted">Marcado, as unidades saem do "disponível" desde já. O físico só baixa quando você der a saída.</span></span></label>
        <div style="overflow-x:auto;max-height:46vh;"><table class="cp-tab"><thead><tr><th>Anúncio (SKU do Mercado Livre)</th><th class="num">Unidades</th><th>Sai do galpão</th></tr></thead><tbody>
          ${r.itens.map((i, n) => { const comp = esoAbrir(i.anuncio_sku, i.qtd, kits), ok = conhecidos.has(esN(i.anuncio_sku));
            return `<tr><td><input type="text" class="eso-sku" data-n="${n}" value="${esEsc(i.anuncio_sku)}" style="min-width:230px;${ok ? '' : 'border-color:var(--danger);'}">${ok ? '' : '<div class="text-danger" style="font-size:11px;">SKU não cadastrado: corrija ou cadastre o kit</div>'}</td>
              <td class="num"><input type="number" class="cp-dias eso-qtd" data-n="${n}" value="${i.qtd}" style="width:100px !important;"></td>
              <td style="font-size:12px;white-space:normal;">${kits.has(esN(i.anuncio_sku)) ? comp.map(c => `<b>${esInt(c.qtd)}</b> × ${esEsc(c.sku)}`).join(' &nbsp;·&nbsp; ') : '<span class="text-muted">o próprio produto</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="text-muted" style="font-size:12px;margin-top:8px;">Arquivo: ${esEsc(arquivo || '')} · ${r.itens.length} anúncios · ${esInt(r.soma)} unidades. Kit sai do galpão produto por produto.</div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="esoSalvarEnvio(this)">Salvar envio</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '920px';
    }

    async function esoSalvarEnvio(btn){
      const r = esoRascunho, dep = estDepProprio(); if(!r || !dep) return;
      const kits = esoKits();
      const itens = r.itens.map((i, n) => { const sku = (document.querySelector('.eso-sku[data-n="' + n + '"]')?.value || '').trim(), qtd = Number(document.querySelector('.eso-qtd[data-n="' + n + '"]')?.value) || 0;
        return { anuncio_sku: sku, codigo_ml: i.codigo_ml, qtd, componentes: esoAbrir(sku, qtd, kits) }; }).filter(i => i.anuncio_sku && i.qtd > 0);
      if(!itens.length){ alert('Nenhum produto com quantidade.'); return; }
      const conta = document.getElementById('eso-conta')?.value || '', loja = (typeof contaNome === 'function' && conta && contaNome(conta)) || '';
      const apelido = /florevi/i.test(loja) ? 'Florevi' : /mk|emeka/i.test(loja) ? 'MK' : loja;
      const reg = { usuario_id: usuarioAtual.id, deposito_id: dep.id, numero: r.numero || String(Date.now()), titulo: ('Full ' + (r.numero || '') + ' ' + apelido).trim(), ml_user_id: conta || null,
        data_prevista: document.getElementById('eso-data')?.value || null, ocupar: document.getElementById('eso-ocupar')?.checked !== false, itens, situacao: 'preparando' };
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      // mesmo número = substitui; PDF oficial do ML com "substituir o envio planejado" marcado = toma o lugar do envio da previsão
      const subst = document.getElementById('eso-subst-ok')?.checked ? eso.envios.find(x => x.id === Number(document.getElementById('eso-subst')?.value)) : null;
      const ja = eso.envios.find(x => x.numero === reg.numero) || subst;
      if(ja && ja.situacao !== 'preparando'){ alert('Este envio já teve a saída lançada; não dá para substituir.'); return; }
      const g = ja ? await supa.from('estoque_envios_full').update(reg).eq('id', ja.id) : await supa.from('estoque_envios_full').insert(reg);
      if(g.error){ alert('Não consegui salvar o envio: ' + g.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Salvar envio'; } return; }
      fecharModal('modal-vml'); await esoLer(true); estDesenhar();
    }

    // lista dos envios (preparando / saiu / recebido)
    function esoEnvios(){
      const dt = d => d ? ptDate(String(d).substring(0, 10)) : '—';
      const un = x => (x.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);
      const sit = { preparando: ['Em preparação', 'cp-comprar'], saiu: ['Saiu do galpão', 'cp-excesso'], recebido: ['Recebido no Full', 'cp-ok'], cancelado: ['Cancelado', 'cp-semvenda'] };
      vmlModal('Envios ao Full', `
        <div class="chips" style="margin-bottom:12px;"><button class="chip active">Envios</button><button class="chip" onclick="esoHistorico()">Histórico e acertividade</button></div>
        <div class="d-flex" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;"><div class="text-muted" style="max-width:560px;">Importe o PDF de preparação do Mercado Livre. O envio ocupa o estoque enquanto está em preparação; ao dar a saída, o galpão baixa produto por produto.</div><button class="btn" onclick="esoImportarEnvio()">Importar PDF do envio</button></div>
        <div style="overflow-x:auto;max-height:56vh;"><table class="cp-tab"><thead><tr><th>Situação</th><th>Envio</th><th>Saída prevista</th><th class="num">Anúncios</th><th class="num">Unidades</th><th></th></tr></thead><tbody>
          ${eso.envios.length ? eso.envios.map(x => `<tr><td><span class="cp-sit ${sit[x.situacao][1]}">${sit[x.situacao][0]}</span></td>
            <td class="cp-prod"><a href="#" onclick="event.preventDefault();esoEnvioItens(${x.id})" title="Ver os itens deste envio"><b>${esEsc(x.titulo)}</b></a><span>${x.situacao === 'preparando' ? (x.ocupar === false ? 'não ocupa o estoque' : 'ocupando o estoque') : x.saiu_em ? 'saiu em ' + dt(x.saiu_em) : ''}</span></td>
            <td>${x.situacao === 'preparando' ? `<input type="date" value="${x.data_prevista || ''}" onchange="esoEnvioCampo(${x.id}, 'data_prevista', this.value || null)" style="width:150px;">` : dt(x.data_prevista)}</td>
            <td class="num">${(x.itens || []).length}</td><td class="num"><b>${esInt(un(x))}</b></td>
            <td style="text-align:right;white-space:nowrap;"><button class="btn-out btn-sm" onclick="esoEnvioItens(${x.id})">Ver itens</button> ${x.situacao === 'preparando' ? `<button class="btn btn-sm" onclick="esoDarSaida(${x.id}, this)">Dar saída</button> <button class="btn-out btn-sm" onclick="esoEnvioCampo(${x.id}, 'ocupar', ${x.ocupar === false})">${x.ocupar === false ? 'Ocupar estoque' : 'Não ocupar'}</button> <button class="btn-out btn-sm" style="color:var(--danger);" onclick="esoExcluirEnvio(${x.id})">Excluir</button>`
              : x.situacao === 'saiu' ? `<button class="btn btn-sm" onclick="esoConferir(${x.id})">Lançar conferência do Full</button> <button class="btn-out btn-sm" onclick="esoDesfazerSaida(${x.id})">Desfazer saída</button>`
              : x.situacao === 'recebido' ? `<button class="btn-out btn-sm" onclick="esoConferir(${x.id})">${x.conferencia ? 'Ver conferência' : 'Lançar conferência do Full'}</button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="6"><div class="vazio"><b>Nenhum envio lançado</b>Clique em Importar PDF do envio.</div></td></tr>'}
        </tbody></table></div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '980px';
    }
    // ---------- conferência do Full: o que o Mercado Livre contou ao receber x o que saiu do galpão ----------
    function esoConfResumo(x){
      const it = (x.conferencia && x.conferencia.itens) || [];
      const env = it.reduce((s, i) => s + (Number(i.enviado) || 0), 0), rec = it.reduce((s, i) => s + (Number(i.recebido) || 0), 0);
      const erro = it.reduce((s, i) => s + Math.abs((Number(i.recebido) || 0) - (Number(i.enviado) || 0)), 0);
      const difs = it.filter(i => Number(i.recebido) !== Number(i.enviado)).length;
      return { env, rec, dif: rec - env, erro, difs, acerto: env ? Math.max(0, 1 - erro / env) : null, bateu: !!it.length && difs === 0 };
    }
    function esoConferir(id){
      const x = eso.envios.find(e => e.id === id); if(!x) return;
      const ant = new Map(((x.conferencia && x.conferencia.itens) || []).map(i => [esN(i.anuncio_sku), i]));
      const itens = (x.itens || []).slice().sort((a, b) => String(a.anuncio_sku).localeCompare(String(b.anuncio_sku)));
      const cel = (sku, html) => typeof fotoLinha === 'function' ? fotoLinha(sku, html) : html;
      vmlModal('Conferência do Full — ' + esEsc(x.titulo), `
        <div class="text-muted" style="margin-bottom:10px;">Lance o que o Mercado Livre contou ao receber o envio (relatório do envio no Mercado Livre). A diferença aparece ao lado. O estoque não muda: a conferência serve para medir a acertividade dos envios.</div>
        <div class="d-flex" style="gap:8px;flex-wrap:wrap;margin-bottom:10px;"><button class="btn-out btn-sm" onclick="document.querySelectorAll('.eso-cf').forEach(i => { i.value = i.dataset.env; esoConfDif(i); })">Preencher igual ao enviado</button><span class="text-muted" style="font-size:12px;align-self:center;">depois corrija só o que o Full contou diferente</span></div>
        <div style="overflow-x:auto;max-height:50vh;"><table class="cp-tab"><thead><tr><th>Anúncio</th><th class="num">Enviado</th><th class="num">Recebido pelo Full</th><th class="num">Diferença</th></tr></thead><tbody>
          ${itens.map(i => { const a = ant.get(esN(i.anuncio_sku)), v = a ? Number(a.recebido) : '';
            return '<tr><td class="cp-prod">' + cel(i.anuncio_sku, '<b>' + esEsc(i.anuncio_sku) + '</b>' + (i.codigo_ml ? '<span>' + esEsc(i.codigo_ml) + '</span>' : '')) + '</td><td class="num">' + esInt(i.qtd) + '</td><td class="num"><input type="number" min="0" class="cp-dias eso-cf" data-sku="' + esEsc(i.anuncio_sku) + '" data-ml="' + esEsc(i.codigo_ml || '') + '" data-env="' + (Number(i.qtd) || 0) + '" value="' + v + '" oninput="esoConfDif(this)" style="width:100px !important;"></td><td class="num eso-cf-dif">' + esoConfDifHtml(v === '' ? null : v - (Number(i.qtd) || 0)) + '</td></tr>'; }).join('')}
        </tbody></table></div>
        <div class="form-group" style="margin-top:12px;"><label class="form-label">Observação</label><input type="text" id="eso-cf-obs" placeholder="Ex.: 2 unidades avariadas no recebimento" value="${esEsc((x.conferencia && x.conferencia.obs) || '')}"></div>`,
        `<button class="btn-out" onclick="esoEnvios()">Voltar</button><button class="btn" onclick="esoConfSalvar(${x.id}, this)">Salvar conferência</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
    }
    function esoConfDifHtml(d){ return d === null || isNaN(d) ? '<span class="text-muted">—</span>' : d === 0 ? '<span class="text-success">ok</span>' : '<b class="' + (d < 0 ? 'text-danger' : 'text-warning') + '">' + (d > 0 ? '+' : '') + esInt(d) + '</b>'; }
    function esoConfDif(inp){ const td = inp.closest('tr').querySelector('.eso-cf-dif'); if(td) td.innerHTML = esoConfDifHtml(inp.value === '' ? null : Number(inp.value) - Number(inp.dataset.env)); }
    async function esoConfSalvar(id, btn){
      const campos = [...document.querySelectorAll('.eso-cf')];
      if(campos.some(i => i.value === '')){ alert('Preencha o recebido de todos os anúncios (use "Preencher igual ao enviado" e corrija o que mudou).'); return; }
      const itens = campos.map(i => ({ anuncio_sku: i.dataset.sku, codigo_ml: i.dataset.ml || null, enviado: Number(i.dataset.env) || 0, recebido: Number(i.value) || 0 }));
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      const r = await supa.from('estoque_envios_full').update({ conferencia: { itens, obs: (document.getElementById('eso-cf-obs')?.value || '').trim() || null }, conferido_em: new Date().toISOString(), situacao: 'recebido' }).eq('id', id);
      if(r.error){ alert('Não consegui salvar a conferência: ' + r.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Salvar conferência'; } return; }
      await esoLer(true); estDesenhar(); esoHistorico();
    }
    // histórico dos envios que saíram e a acertividade das conferências
    function esoHistorico(){
      const dt = d => d ? ptDate(String(d).substring(0, 10)) : '—', pct = v => v === null ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
      const saidos = eso.envios.filter(x => x.situacao === 'saiu' || x.situacao === 'recebido').sort((a, b) => String(b.saiu_em || b.criado_em).localeCompare(String(a.saiu_em || a.criado_em)));
      const conf = saidos.filter(x => x.conferencia && (x.conferencia.itens || []).length).map(x => ({ x, r: esoConfResumo(x) }));
      const env = conf.reduce((s, c) => s + c.r.env, 0), erro = conf.reduce((s, c) => s + c.r.erro, 0);
      const falta = conf.reduce((s, c) => s + (c.x.conferencia.itens || []).reduce((a, i) => a + Math.max(0, i.enviado - i.recebido), 0), 0), sobra = conf.reduce((s, c) => s + (c.x.conferencia.itens || []).reduce((a, i) => a + Math.max(0, i.recebido - i.enviado), 0), 0);
      const bateram = conf.filter(c => c.r.bateu).length;
      vmlModal('Envios ao Full', `
        <div class="chips" style="margin-bottom:12px;"><button class="chip" onclick="esoEnvios()">Envios</button><button class="chip active">Histórico e acertividade</button></div>
        <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="kpi k-neutro"><div class="kpi-label">Envios que saíram</div><div class="kpi-value">${saidos.length}</div><div class="kpi-sub">${conf.length} conferidos · ${saidos.length - conf.length} aguardando</div></div>
          <div class="kpi ${conf.length && bateram === conf.length ? 'k-mc' : 'k-hoje'}"><div class="kpi-label">Envios que bateram</div><div class="kpi-value">${conf.length ? pct(bateram / conf.length) : '—'}</div><div class="kpi-sub">${bateram} de ${conf.length} sem nenhuma diferença</div></div>
          <div class="kpi k-venda"><div class="kpi-label">Acertividade em unidades</div><div class="kpi-value">${env ? pct(Math.max(0, 1 - erro / env)) : '—'}</div><div class="kpi-sub">${esInt(erro)} un. com diferença em ${esInt(env)} enviadas</div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Faltou / sobrou no Full</div><div class="kpi-value">−${esInt(falta)} / +${esInt(sobra)}</div><div class="kpi-sub">unidades, somando as conferências</div></div>
        </div>
        <div style="overflow-x:auto;max-height:46vh;"><table class="cp-tab"><thead><tr><th>Envio</th><th>Saiu</th><th>Conferido</th><th class="num">Enviado</th><th class="num">Recebido</th><th class="num">Diferença</th><th class="num">Acerto</th><th>Resultado</th><th></th></tr></thead><tbody>
          ${saidos.length ? saidos.map(x => { const tem = x.conferencia && (x.conferencia.itens || []).length, r = tem ? esoConfResumo(x) : null, un = (x.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);
            return '<tr><td class="cp-prod"><a href="#" onclick="event.preventDefault();esoEnvioItens(' + x.id + ')"><b>' + esEsc(x.titulo) + '</b></a>' + (tem && x.conferencia.obs ? '<span title="' + esEsc(x.conferencia.obs) + '">' + esEsc(x.conferencia.obs) + '</span>' : '') + '</td><td>' + dt(x.saiu_em) + '</td><td>' + dt(x.conferido_em) + '</td><td class="num">' + esInt(tem ? r.env : un) + '</td><td class="num">' + (tem ? esInt(r.rec) : '—') + '</td><td class="num">' + (tem ? esoConfDifHtml(r.dif) : '—') + '</td><td class="num">' + (tem ? pct(r.acerto) : '—') + '</td><td>' + (!tem ? '<span class="cp-sit cp-semvenda">Aguardando conferência</span>' : r.bateu ? '<span class="cp-sit cp-ok">Bateu</span>' : '<span class="cp-sit cp-urgente">' + r.difs + ' anúncio' + (r.difs === 1 ? '' : 's') + ' com diferença</span>') + '</td><td style="text-align:right;"><button class="btn-out btn-sm" onclick="esoConferir(' + x.id + ')">' + (tem ? 'Ver' : 'Conferir') + '</button></td></tr>'; }).join('')
            : '<tr><td colspan="9"><div class="vazio"><b>Nenhum envio saiu ainda</b>Quando você der a saída de um envio, ele aparece aqui para lançar a conferência do Full.</div></td></tr>'}
        </tbody></table></div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '1080px';
    }

    let esoItensVer = 'anuncio';
    function esoEnvioItens(id, modo){
      const x = eso.envios.find(e => e.id === id); if(!x) return;
      if(modo) esoItensVer = modo;
      const itens = (x.itens || []).slice().sort((a, b) => (Number(b.qtd) || 0) - (Number(a.qtd) || 0));
      const prods = esoMovsDoEnvio(x, 1).sort((a, b) => b.qtd - a.qtd);
      const un = itens.reduce((s, i) => s + (Number(i.qtd) || 0), 0), unG = prods.reduce((s, p) => s + p.qtd, 0);
      const cel = (sku, html) => typeof fotoLinha === 'function' ? fotoLinha(sku, html) : html;
      const corpo = esoItensVer === 'produto'
        ? '<thead><tr><th>Produto do galpão</th><th class="num">Unidades que saem</th><th class="num">No galpão hoje</th></tr></thead><tbody>' + prods.map(p => { const s = skus.find(z => esN(z.sku) === esN(p.sku)), saldo = estSaldoDe(x.deposito_id, p.sku);
            return '<tr><td class="cp-prod">' + cel(p.sku, '<b>' + esEsc(p.sku) + '</b><span>' + esEsc((s && s.titulo) || '') + '</span>') + '</td><td class="num"><b>' + esInt(p.qtd) + '</b></td><td class="num ' + (saldo < p.qtd ? 'text-danger' : '') + '">' + esInt(saldo) + '</td></tr>'; }).join('') + '</tbody>'
        : '<thead><tr><th>Anúncio (SKU do Mercado Livre)</th><th class="num">Unidades</th><th>Sai do galpão</th></tr></thead><tbody>' + itens.map(i => { const comp = i.componentes || [], kit = comp.length > 1 || (comp[0] && esN(comp[0].sku) !== esN(i.anuncio_sku));
            return '<tr><td class="cp-prod">' + cel(i.anuncio_sku, '<b>' + esEsc(i.anuncio_sku) + '</b>' + (i.codigo_ml ? '<span>' + esEsc(i.codigo_ml) + '</span>' : '')) + '</td><td class="num"><b>' + esInt(i.qtd) + '</b></td><td style="font-size:12px;white-space:normal;">' + (kit ? comp.map(c => '<b>' + esInt(c.qtd) + '</b> × ' + esEsc(c.sku)).join(' &nbsp;·&nbsp; ') : '<span class="text-muted">o próprio produto</span>') + '</td></tr>'; }).join('') + '</tbody>';
      const sit = { preparando: 'Em preparação', saiu: 'Saiu do galpão', recebido: 'Recebido no Full', cancelado: 'Cancelado' }[x.situacao] || x.situacao;
      vmlModal('Itens do envio ' + esEsc(x.titulo), `
        <div class="text-muted" style="margin-bottom:10px;">${sit}${x.situacao === 'preparando' ? (x.ocupar === false ? ' · não ocupa o estoque' : ' · ocupando o estoque') : ''} · ${itens.length} anúncios · ${esInt(un)} unidades${unG !== un ? ' (' + esInt(unG) + ' unidades de produto, com os kits abertos)' : ''}</div>
        <div class="chips" style="margin-bottom:10px;"><button class="chip ${esoItensVer === 'anuncio' ? 'active' : ''}" onclick="esoEnvioItens(${x.id}, 'anuncio')">Por anúncio</button><button class="chip ${esoItensVer === 'produto' ? 'active' : ''}" onclick="esoEnvioItens(${x.id}, 'produto')">Por produto do galpão</button></div>
        <div style="overflow-x:auto;max-height:54vh;"><table class="cp-tab">${corpo}</table></div>`,
        '<button class="btn-out" onclick="esoEnvios()">Voltar</button>');
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '920px';
    }
    async function esoEnvioCampo(id, campo, valor){ const r = await supa.from('estoque_envios_full').update({ [campo]: valor }).eq('id', id); if(r.error){ alert(r.error.message); return; } await esoLer(true); estDesenhar(); esoEnvios(); }
    async function esoExcluirEnvio(id){ if(!confirm('Excluir este envio em preparação?')) return; await supa.from('estoque_envios_full').delete().eq('id', id); await esoLer(true); estDesenhar(); esoEnvios(); }
    function esoMovsDoEnvio(x, sinal){
      const junto = new Map();
      (x.itens || []).forEach(i => (i.componentes || []).forEach(c => { const k = esN(c.sku); if(junto.has(k)) junto.get(k).qtd += sinal * Number(c.qtd); else junto.set(k, { sku: c.sku, qtd: sinal * Number(c.qtd) }); }));
      return [...junto.values()];
    }
    async function esoDarSaida(id, btn){
      const x = eso.envios.find(e => e.id === id); if(!x) return;
      const mov = esoMovsDoEnvio(x, -1), falta = mov.filter(m => estSaldoDe(x.deposito_id, m.sku) + m.qtd < 0);
      if(falta.length && !confirm('O estoque físico não cobre ' + falta.length + ' produto(s): ' + falta.map(m => m.sku).slice(0, 6).join(', ') + '. Dar a saída assim mesmo (o saldo fica negativo)?')) return;
      if(!confirm('Dar saída do envio "' + x.titulo + '"? O galpão baixa ' + esInt(-mov.reduce((s, m) => s + m.qtd, 0)) + ' unidades em ' + mov.length + ' produtos.')) return;
      if(btn){ btn.disabled = true; btn.textContent = 'Lançando…'; }
      const r = await estMovimentar(x.deposito_id, mov.map(m => ({ ...m, motivo: 'envio_full', ref: x.titulo })));
      if(!r.ok){ alert('Não consegui lançar a saída: ' + r.erro); return; }
      await supa.from('estoque_envios_full').update({ situacao: 'saiu', saiu_em: new Date().toISOString() }).eq('id', id);
      await esoLer(true); estDesenhar(); esoEnvios();
    }
    async function esoDesfazerSaida(id){
      const x = eso.envios.find(e => e.id === id); if(!x) return;
      if(!confirm('Desfazer a saída de "' + x.titulo + '"? As unidades voltam para o galpão e o envio volta para "em preparação".')) return;
      const r = await estMovimentar(x.deposito_id, esoMovsDoEnvio(x, 1).map(m => ({ ...m, motivo: 'ajuste', ref: x.titulo, obs: 'Saída do envio desfeita' })));
      if(!r.ok){ alert('Não consegui desfazer: ' + r.erro); return; }
      await supa.from('estoque_mov').delete().eq('usuario_id', usuarioAtual.id).eq('deposito_id', x.deposito_id).eq('motivo', 'envio_full').eq('ref', x.titulo);   // libera para lançar de novo
      await supa.from('estoque_mov').delete().eq('usuario_id', usuarioAtual.id).eq('deposito_id', x.deposito_id).eq('motivo', 'ajuste').eq('ref', x.titulo).eq('obs', 'Saída do envio desfeita');
      await supa.from('estoque_envios_full').update({ situacao: 'preparando', saiu_em: null }).eq('id', id);
      await estLerSaldo(); await esoLer(true); estDesenhar(); esoEnvios();
    }
    // unidades que saíram do galpão e o Mercado Livre ainda não recebeu, por produto (para a Sugestão de compras)
    function esoACaminhoDoFull(){
      const m = new Map();
      eso.envios.filter(x => x.situacao === 'saiu').forEach(x => esoMovsDoEnvio(x, 1).forEach(c => m.set(esN(c.sku), (m.get(esN(c.sku)) || 0) + c.qtd)));
      return m;
    }

    // ---------- 4) contagem de estoque ----------
    let esoCont = null, esoCtDep = null, esoCtVolta = false;   // depósito da contagem em andamento
    function esoContagens(){
      const aberto = est.depositos.find(d => d.id === est.dep); if(!aberto || aberto.tipo === 'full') return;
      if(!esoCtVolta) esoCtDep = aberto.id; esoCtVolta = false; const dep = est.depositos.find(d => d.id === esoCtDep) || aberto;
      const dt = t => new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      const minhas = eso.contagens.filter(c => Number(c.deposito_id) === dep.id);
      vmlModal('Contagem de estoque — ' + esEsc(dep.nome), `
        <div class="text-muted" style="margin-bottom:12px;">Informe o que foi contado e o sistema mostra a diferença para o que ele esperava. Você decide se ajusta o estoque ou só guarda a comparação.</div>
        <div class="d-flex" style="gap:8px;flex-wrap:wrap;margin-bottom:16px;">
          <button class="btn" onclick="esoContagemPlanilha()">Importar planilha</button>
          <button class="btn-out" onclick="esoContagemDigitar()">Digitar a contagem</button>
          <button class="btn-out" onclick="esoContagemModelo()">Baixar planilha modelo</button>
        </div>
        <div class="form-label">Contagens anteriores</div>
        <div style="overflow-x:auto;max-height:44vh;"><table class="cp-tab"><thead><tr><th>Nº</th><th>Quando</th><th>Origem</th><th class="num">Produtos</th><th class="num">Com diferença</th><th>Situação</th><th></th></tr></thead><tbody>
          ${minhas.length ? minhas.map(c => { const dif = (c.itens || []).filter(i => Number(i.real) !== Number(i.sistema)).length; return `<tr><td><b>CT${c.id}</b></td><td>${dt(c.criado_em)}</td><td>${esEsc(c.origem || '')}${c.obs ? '<div class="cp-sub" style="white-space:normal;">' + esEsc(c.obs) + '</div>' : ''}</td><td class="num">${(c.itens || []).length}</td><td class="num">${dif}</td><td>${c.aplicada_em ? '<span class="cp-sit cp-ok">Estoque ajustado</span>' : '<span class="cp-sit cp-semvenda">Só comparação</span>'}</td><td style="text-align:right;"><button class="btn-out btn-sm" onclick="esoContagemVer(${c.id})">Ver</button></td></tr>`; }).join('') : '<tr><td colspan="7" class="text-muted" style="padding:16px;text-align:center;">Nenhuma contagem ainda.</td></tr>'}
        </tbody></table></div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '920px';
    }
    function esoContagemModelo(){
      const dep = est.depositos.find(d => d.id === esoCtDep);
      const linhas = estLinhas(dep).sort((a, b) => a.k.localeCompare(b.k)).map(l => ({ SKU: l.sku, 'Produto': l.nome, 'Quantidade contada': '' }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ SKU: '', 'Produto': '', 'Quantidade contada': '' }]), 'Contagem');
      XLSX.writeFile(wb, 'contagem_de_estoque_modelo.xlsx');
    }
    function esoContagemPlanilha(arq){
      const dep = est.depositos.find(d => d.id === esoCtDep);
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.id = 'eso-planilha';
      const _ler = () => {
        const f = arq || inp.files[0]; if(!f) return; const rd = new FileReader(); rd.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          if(!rows.length){ alert('A planilha está vazia.'); return; }
          if('KIT SKU' in rows[0]){ alert('Esta é a lista de KITS. Use a Lista de Estoque de produtos (aba SKU da UpSeller) ou a planilha modelo.'); return; }
          const upseller = 'Estoque Atual' in rows[0], colQ = upseller ? 'Estoque Atual' : Object.keys(rows[0]).find(k => /quantidade|contad|qtd|estoque/i.test(k));
          if(!('SKU' in rows[0]) || !colQ){ alert('Não achei as colunas SKU e quantidade. Baixe a planilha modelo para ver o formato.'); return; }
          const arms = upseller ? [...new Set(rows.map(r => String(r['Armazém'] || '').trim()).filter(Boolean))] : [];
          let arm = '';
          if(arms.length > 1){ arm = (prompt('A planilha tem mais de um armazém:\n' + arms.join('\n') + '\n\nDigite o que corresponde a "' + dep.nome + '":', arms[0]) || '').trim(); if(!arm) return; }
          const mapa = new Map();
          rows.forEach(r => { const sku = String(r.SKU || '').trim(); if(!sku || (arm && String(r['Armazém'] || '').trim() !== arm) || String(r[colQ]).trim() === '') return;
            const k = esN(sku), a = mapa.get(k) || { sku, real: 0, custo: 0, titulo: String(r['Título'] || r['Produto'] || '').trim() }; a.real += Number(r[colQ]) || 0; if(upseller && Number(r['Custo Médio']) > 0) a.custo = Number(r['Custo Médio']); mapa.set(k, a); });
          // hora em que a planilha da UpSeller foi tirada vem no nome: Lista_de_Estoque_MMDDHHMMSS (horário UTC)
          const m = upseller && (f.name.match(/_(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.xlsx?$/i) || f.name.match(/Lista_de_Estoque_(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i));
          const quando = m ? new Date().getFullYear() + '-' + m[1] + '-' + m[2] + 'T' + m[3] + ':' + m[4] : new Date().toISOString().substring(0, 16);
          esoContagemRevisar([...mapa.values()], upseller ? 'Planilha da UpSeller' : 'Planilha modelo', f.name, quando);
        } catch(err){ alert('Não consegui ler a planilha: ' + err.message); } }; rd.readAsArrayBuffer(f); };
      inp.onchange = () => (typeof impGuarda === 'function' ? impGuarda(arq || inp.files[0], ["contagem_modelo","upseller_estoque"], true) : Promise.resolve(true)).then(ok => { if(ok) _ler(); });
      if(arq) inp.onchange(); else inp.click();
    }
    function esoContagemDigitar(){
      const dep = est.depositos.find(d => d.id === esoCtDep);
      const todas = estLinhas(dep).sort((a, b) => a.k.localeCompare(b.k));
      // com produtos marcados na tela de estoque, a digitação mostra só eles (os da folha de contagem)
      const marc = typeof estSel !== 'undefined' && estSel.size ? todas.filter(l => estSel.has(l.k)) : [], linhas = marc.length ? marc : todas;
      vmlModal('Digitar contagem — ' + esEsc(dep.nome), `
        <div class="text-muted" style="margin-bottom:10px;">${marc.length ? 'Mostrando só os <b>' + marc.length + ' produtos marcados</b> na tela de estoque. ' : ''}Preencha só os produtos que foram contados; os que ficarem em branco não entram.</div>
        <div style="overflow-x:auto;max-height:56vh;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num">No sistema</th><th class="num">Contado</th></tr></thead><tbody>
          ${linhas.map(l => `<tr><td class="cp-prod">${typeof fotoLinha === 'function' ? fotoLinha(l.sku, `<b>${esEsc(l.sku)}</b><span>${esEsc(l.nome)}</span>`) : `<b>${esEsc(l.sku)}</b><span>${esEsc(l.nome)}</span>`}</td><td class="num">${esInt(l.fisico)}</td><td class="num"><input type="number" class="cp-dias eso-ct" data-sku="${esEsc(l.sku)}" style="width:110px !important;" placeholder="—"></td></tr>`).join('')}
        </tbody></table></div>`,
        `<button class="btn-out" onclick="esoContagens()">Voltar</button><button class="btn" onclick="esoContagemRevisar([...document.querySelectorAll('.eso-ct')].filter(i => i.value !== '').map(i => ({ sku: i.dataset.sku, real: Number(i.value) || 0 })), 'Digitada', '', new Date().toISOString().substring(0, 16))">Conferir diferenças</button>`);
    }
    // confronto: o que o sistema tinha x o que foi contado
    function esoContagemRevisar(itens, origem, arquivo, quando){
      const dep = est.depositos.find(d => d.id === esoCtDep);
      if(!itens.length){ alert('Nenhum produto com quantidade.'); return; }
      const lista = itens.map(i => ({ ...i, sistema: estSaldoDe(dep.id, i.sku) })).map(i => ({ ...i, dif: i.real - i.sistema })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
      esoCont = { lista, origem, arquivo, quando, dep: dep.id };
      const difs = lista.filter(i => i.dif !== 0), sobra = difs.filter(i => i.dif > 0).reduce((s, i) => s + i.dif, 0), falta = difs.filter(i => i.dif < 0).reduce((s, i) => s - i.dif, 0);
      vmlModal('Confronto da contagem — ' + esEsc(dep.nome), `
        <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="kpi k-neutro"><div class="kpi-label">Produtos contados</div><div class="kpi-value">${lista.length}</div></div>
          <div class="kpi ${difs.length ? 'k-hoje' : 'k-mc'}"><div class="kpi-label">Com diferença</div><div class="kpi-value">${difs.length}</div></div>
          <div class="kpi k-mc"><div class="kpi-label">Contado a mais</div><div class="kpi-value">+${esInt(sobra)}</div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Contado a menos</div><div class="kpi-value">−${esInt(falta)}</div></div>
        </div>
        <div style="overflow-x:auto;max-height:40vh;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num">No Caixa 360</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>
          ${lista.map(i => `<tr><td>${typeof fotoLinha === 'function' ? fotoLinha(i.sku, `<b>${esEsc(i.sku)}</b>`) : `<b>${esEsc(i.sku)}</b>`}</td><td class="num">${esInt(i.sistema)}</td><td class="num">${esInt(i.real)}</td><td class="num ${i.dif > 0 ? 'text-success' : i.dif < 0 ? 'text-danger' : 'text-muted'}"><b>${i.dif > 0 ? '+' : ''}${esInt(i.dif)}</b></td></tr>`).join('')}
        </tbody></table></div>
        <div class="form-group" style="margin-top:12px;"><label class="form-label">Observação</label><input type="text" id="eso-ct-obs" placeholder="Ex.: contagem enviada pelo galpão em 10/10" value="${esEsc(arquivo || '')}"></div>`,
        `<button class="btn-out" onclick="esoContagens()">Cancelar</button><button class="btn-out" onclick="esoContagemSalvar(false, this)">Só guardar a comparação</button><button class="btn" onclick="esoContagemSalvar(true, this)">Ajustar o estoque para o contado</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
    }
    async function esoContagemSalvar(aplicar, btn){
      const c = esoCont; if(!c) return;
      if(btn){ btn.disabled = true; }
      const obs = (document.getElementById('eso-ct-obs')?.value || '').trim();
      const ins = await supa.from('estoque_contagens').insert({ usuario_id: usuarioAtual.id, deposito_id: c.dep, origem: c.origem, obs: obs || null, itens: c.lista.map(i => ({ sku: i.sku, sistema: i.sistema, real: i.real })), aplicada_em: aplicar ? new Date().toISOString() : null }).select().single();
      if(ins.error){ alert('Não consegui guardar a contagem: ' + ins.error.message); return; }
      if(aplicar){
        // custo médio e título que vieram na planilha da UpSeller
        c.lista.forEach(i => { let g = estoqueGalpao.find(x => esN(x.sku) === esN(i.sku)); if(!g){ g = { sku: i.sku, descricao: i.titulo || i.sku, qtd_galpao: 0, qtd_full: 0, qtd_full_pendente: 0, em_transito: 0, custo_medio: 0, data_atualizacao: getToday() }; estoqueGalpao.push(g); } if(i.titulo) g.descricao = i.titulo; if(i.custo > 0) g.custo_medio = i.custo; });
        // todo produto contado ganha uma linha (mesmo sem diferença): ela marca desde quando as vendas enviadas voltam a baixar
        const mov = c.lista.map(i => ({ sku: i.sku, qtd: i.dif, motivo: 'contagem', ref: 'planilha-' + c.quando, obs: 'Contagem CT' + ins.data.id + (obs ? ' · ' + obs : '') }));
        const marc = mov.filter(m => m.qtd === 0); mov.forEach(m => { if(m.qtd === 0) m.qtd = 0; });
        const r = await estMovimentar(c.dep, mov.filter(m => m.qtd !== 0));
        if(!r.ok){ alert('A contagem foi guardada, mas não consegui ajustar o estoque: ' + r.erro); }
        if(marc.length){ await supa.from('estoque_mov').insert(marc.map(m => ({ usuario_id: usuarioAtual.id, deposito_id: c.dep, sku: m.sku, qtd: 0, motivo: 'contagem', ref: m.ref, obs: m.obs }))); }
        if(typeof salvar === 'function') salvar();
      }
      await esoLer(true); await estLerSaldo();
      if(aplicar) await esoBaixarVendas();
      estDesenhar(); esoContagens();
    }
    function esoContagemVer(id){
      const c = eso.contagens.find(x => x.id === id); if(!c) return;
      const lista = (c.itens || []).map(i => ({ ...i, dif: Number(i.real) - Number(i.sistema) })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
      vmlModal('Contagem CT' + c.id, `${c.obs ? `<div class="text-muted" style="margin-bottom:10px;">${esEsc(c.obs)}</div>` : ''}
        <div style="overflow-x:auto;max-height:60vh;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num">No Caixa 360</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>
        ${lista.map(i => `<tr><td>${typeof fotoLinha === 'function' ? fotoLinha(i.sku, `<b>${esEsc(i.sku)}</b>`) : `<b>${esEsc(i.sku)}</b>`}</td><td class="num">${esInt(i.sistema)}</td><td class="num">${esInt(i.real)}</td><td class="num ${i.dif > 0 ? 'text-success' : i.dif < 0 ? 'text-danger' : 'text-muted'}"><b>${i.dif > 0 ? '+' : ''}${esInt(i.dif)}</b></td></tr>`).join('')}
        </tbody></table></div>`, `<button class="btn-out" onclick="esoContagens()">Voltar</button>`);
    }
