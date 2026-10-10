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
    function esoAbrir(sku, qtd, kits){ const k = esN(sku); return (kits || esoKits()).has(k) ? (kits || esoKits()).get(k).map(c => ({ sku: c.sku, qtd: qtd * c.qtd })) : [{ sku, qtd }]; }

    // ---------- 1) depósitos ----------
    function estNovoDeposito(){ estGerenciarDepositos(); }
    function estGerenciarDepositos(){
      vmlModal('Gerenciar depósitos', `
        <div class="text-muted" style="margin-bottom:12px;">Cada depósito tem o seu estoque. O do tipo Full é atualizado sozinho pelo Mercado Livre; os outros você atualiza por compra, venda, contagem ou planilha.</div>
        <table class="cp-tab"><thead><tr><th>Nome</th><th>Tipo</th><th class="num">Produtos com saldo</th><th></th></tr></thead><tbody>
          ${est.depositos.map(d => { const n = est.saldo.filter(s => Number(s.deposito_id) === d.id && Number(s.fisico) !== 0).length; return `<tr style="${d.ativo ? '' : 'opacity:.55;'}">
            <td><input type="text" value="${esEsc(d.nome)}" onchange="estDepRenomear(${d.id}, this.value)" style="min-width:200px;"></td>
            <td>${d.tipo === 'full' ? 'Full (Mercado Livre)' : 'Próprio'}${d.ativo ? '' : ' · desativado'}</td>
            <td class="num">${d.tipo === 'full' ? '—' : n}</td>
            <td style="text-align:right;white-space:nowrap;">${d.ativo ? `<button class="btn-out btn-sm" onclick="estDepAtivo(${d.id}, false)">Desativar</button>` : `<button class="btn-out btn-sm" onclick="estDepAtivo(${d.id}, true)">Reativar</button>`} <button class="btn-out btn-sm" style="color:var(--danger);" onclick="estDepExcluir(${d.id})">Excluir</button></td></tr>`; }).join('')}
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

    // ---------- 2) vendas: ocupado e baixa ----------
    async function esoLer(forcar){
      if(!forcar && eso.lidoEm && Date.now() - eso.lidoEm < 2 * 60 * 1000) return;
      const d25 = new Date(Date.now() - 25 * 86400000).toISOString(), d3 = new Date(Date.now() - 3 * 86400000).toISOString(), d12 = new Date(Date.now() - 12 * 86400000).toISOString();
      const campos = 'order_id,sku,qtd,status,logistic_type,envio_status,enviado_em,data_venda';
      const base = () => supa.from('vendas_ml').select(campos).eq('usuario_id', usuarioAtual.id).neq('status', 'cancelled').or('logistic_type.is.null,logistic_type.neq.fulfillment');
      // o banco devolve no máximo 1000 linhas por consulta: lê em páginas
      const paginas = async q => { const out = []; for(let i = 0; i < 8; i++){ const r = await q().range(i * 1000, i * 1000 + 999); if(r.error || !r.data) break; out.push(...r.data); if(r.data.length < 1000) break; } return out; };
      const [pend, env, e, c] = await Promise.all([
        // ainda não enviadas: com o envio já conferido no Mercado Livre, ou vendidas nos últimos 3 dias (conferência pode estar atrasada)
        paginas(() => base().is('enviado_em', null).gte('data_venda', d25).or('envio_status.not.is.null,data_venda.gte.' + d3).order('data_venda', { ascending: false })),
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
      while((m = re.exec(texto))) { const sku = ((m[2].match(/SKU:\s*(\S+)/) || [])[1] || '').trim(); blocos.push({ codigo_ml: m[1], anuncio_sku: sku }); }
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
      vmlModal('Envio ao Full nº ' + esEsc(r.numero || '?'), `
        ${ja ? `<div class="alert alert-warning">Já existe um envio com este número (${esEsc(ja.titulo)}). Salvar vai substituir os produtos dele.</div>` : ''}
        ${r.confere ? '' : `<div class="alert alert-danger">A soma das unidades lidas (${esInt(r.soma)}) não bate com o total do documento (${esInt(r.totalDoc)}). Confira as quantidades antes de salvar.</div>`}
        <div class="form-row">
          <div class="form-group"><label class="form-label">Loja</label><select id="eso-conta">${contas.map(c => `<option value="${esEsc(c.id)}">${esEsc(c.apelido || c.id)}</option>`).join('') || '<option value="">—</option>'}</select></div>
          <div class="form-group"><label class="form-label">Saída prevista (deixe vazio se ainda não tem vaga)</label><input type="date" id="eso-data"></div>
        </div>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;margin-bottom:14px;"><input type="checkbox" id="eso-ocupar" checked style="margin-top:3px;"><span><b>Ocupar o estoque enquanto está em preparação</b><br><span class="text-muted">Marcado, as unidades saem do "disponível" desde já. O físico só baixa quando você der a saída.</span></span></label>
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
      const ja = eso.envios.find(x => x.numero === reg.numero);
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
        <div class="d-flex" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;"><div class="text-muted" style="max-width:560px;">Importe o PDF de preparação do Mercado Livre. O envio ocupa o estoque enquanto está em preparação; ao dar a saída, o galpão baixa produto por produto.</div><button class="btn" onclick="esoImportarEnvio()">Importar PDF do envio</button></div>
        <div style="overflow-x:auto;max-height:56vh;"><table class="cp-tab"><thead><tr><th>Situação</th><th>Envio</th><th>Saída prevista</th><th class="num">Anúncios</th><th class="num">Unidades</th><th></th></tr></thead><tbody>
          ${eso.envios.length ? eso.envios.map(x => `<tr><td><span class="cp-sit ${sit[x.situacao][1]}">${sit[x.situacao][0]}</span></td>
            <td class="cp-prod"><b>${esEsc(x.titulo)}</b><span>${x.situacao === 'preparando' ? (x.ocupar === false ? 'não ocupa o estoque' : 'ocupando o estoque') : x.saiu_em ? 'saiu em ' + dt(x.saiu_em) : ''}</span></td>
            <td>${x.situacao === 'preparando' ? `<input type="date" value="${x.data_prevista || ''}" onchange="esoEnvioCampo(${x.id}, 'data_prevista', this.value || null)" style="width:150px;">` : dt(x.data_prevista)}</td>
            <td class="num">${(x.itens || []).length}</td><td class="num"><b>${esInt(un(x))}</b></td>
            <td style="text-align:right;white-space:nowrap;">${x.situacao === 'preparando' ? `<button class="btn btn-sm" onclick="esoDarSaida(${x.id}, this)">Dar saída</button> <button class="btn-out btn-sm" onclick="esoEnvioCampo(${x.id}, 'ocupar', ${x.ocupar === false})">${x.ocupar === false ? 'Ocupar estoque' : 'Não ocupar'}</button> <button class="btn-out btn-sm" style="color:var(--danger);" onclick="esoExcluirEnvio(${x.id})">Excluir</button>`
              : x.situacao === 'saiu' ? `<button class="btn-out btn-sm" onclick="esoEnvioCampo(${x.id}, 'situacao', 'recebido')">Marcar recebido no Full</button> <button class="btn-out btn-sm" onclick="esoDesfazerSaida(${x.id})">Desfazer saída</button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="6"><div class="vazio"><b>Nenhum envio lançado</b>Clique em Importar PDF do envio.</div></td></tr>'}
        </tbody></table></div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '980px';
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
    let esoCont = null;
    function esoContagens(){
      const dep = est.depositos.find(d => d.id === est.dep); if(!dep || dep.tipo === 'full') return;
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
      const dep = est.depositos.find(d => d.id === est.dep);
      const linhas = estLinhas(dep).sort((a, b) => a.k.localeCompare(b.k)).map(l => ({ SKU: l.sku, 'Produto': l.nome, 'Quantidade contada': '' }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ SKU: '', 'Produto': '', 'Quantidade contada': '' }]), 'Contagem');
      XLSX.writeFile(wb, 'contagem_de_estoque_modelo.xlsx');
    }
    function esoContagemPlanilha(){
      const dep = est.depositos.find(d => d.id === est.dep);
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.id = 'eso-planilha';
      inp.onchange = () => { const f = inp.files[0]; if(!f) return; const rd = new FileReader(); rd.onload = e => {
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
          const m = upseller && f.name.match(/_(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.xlsx?$/i);
          const quando = m ? new Date().getFullYear() + '-' + m[1] + '-' + m[2] + 'T' + m[3] + ':' + m[4] : new Date().toISOString().substring(0, 16);
          esoContagemRevisar([...mapa.values()], upseller ? 'Planilha da UpSeller' : 'Planilha modelo', f.name, quando);
        } catch(err){ alert('Não consegui ler a planilha: ' + err.message); } }; rd.readAsArrayBuffer(f); };
      inp.click();
    }
    function esoContagemDigitar(){
      const dep = est.depositos.find(d => d.id === est.dep);
      const linhas = estLinhas(dep).sort((a, b) => a.k.localeCompare(b.k));
      vmlModal('Digitar contagem — ' + esEsc(dep.nome), `
        <div class="text-muted" style="margin-bottom:10px;">Preencha só os produtos que foram contados; os que ficarem em branco não entram.</div>
        <div style="overflow-x:auto;max-height:56vh;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num">No sistema</th><th class="num">Contado</th></tr></thead><tbody>
          ${linhas.map(l => `<tr><td class="cp-prod"><b>${esEsc(l.sku)}</b><span>${esEsc(l.nome)}</span></td><td class="num">${esInt(l.fisico)}</td><td class="num"><input type="number" class="cp-dias eso-ct" data-sku="${esEsc(l.sku)}" style="width:110px !important;" placeholder="—"></td></tr>`).join('')}
        </tbody></table></div>`,
        `<button class="btn-out" onclick="esoContagens()">Voltar</button><button class="btn" onclick="esoContagemRevisar([...document.querySelectorAll('.eso-ct')].filter(i => i.value !== '').map(i => ({ sku: i.dataset.sku, real: Number(i.value) || 0 })), 'Digitada', '', new Date().toISOString().substring(0, 16))">Conferir diferenças</button>`);
    }
    // confronto: o que o sistema tinha x o que foi contado
    function esoContagemRevisar(itens, origem, arquivo, quando){
      const dep = est.depositos.find(d => d.id === est.dep);
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
          ${lista.map(i => `<tr><td><b>${esEsc(i.sku)}</b></td><td class="num">${esInt(i.sistema)}</td><td class="num">${esInt(i.real)}</td><td class="num ${i.dif > 0 ? 'text-success' : i.dif < 0 ? 'text-danger' : 'text-muted'}"><b>${i.dif > 0 ? '+' : ''}${esInt(i.dif)}</b></td></tr>`).join('')}
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
        ${lista.map(i => `<tr><td><b>${esEsc(i.sku)}</b></td><td class="num">${esInt(i.sistema)}</td><td class="num">${esInt(i.real)}</td><td class="num ${i.dif > 0 ? 'text-success' : i.dif < 0 ? 'text-danger' : 'text-muted'}"><b>${i.dif > 0 ? '+' : ''}${esInt(i.dif)}</b></td></tr>`).join('')}
        </tbody></table></div>`, `<button class="btn-out" onclick="esoContagens()">Voltar</button>`);
    }
