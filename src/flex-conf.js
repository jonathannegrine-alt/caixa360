// ===== CONFERÊNCIA DA FATURA DO FLEX =====
// O transportador do Flex manda uma fatura em PDF com um envio por linha ("Nº Pedido" = número do envio no
// Mercado Livre). Aqui o PDF é lido no navegador (pdf.js, carregado na hora), cada envio é casado com a venda
// (vendas_ml.shipping_id) e, para o que não está "pago e entregue", o Mercado Livre é consultado (Edge Function
// ml-envios, ação conferir) para saber o que aconteceu: cancelada antes da coleta, saiu e não foi entregue,
// entregue e devolvida depois, etc. O resultado vira um relatório para questionar ANTES de pagar.
// Valor a ressarcir no relatório = valor da venda menos um percentual (padrão 25%), definido pelo usuário.

    let fx = { fat: null, linhas: [], lendo: '', erro: '', hist: null, marc: new Set(), ver: 'questionar' };
    const fxE = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fxNum = s => { s = String(s || '').trim(); return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; };
    const fxIso = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
    const fxDH = t => t ? new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    function fxPct(){ const v = Number(localStorage.getItem('mk_flex_pct')); return v >= 0 && v < 100 && localStorage.getItem('mk_flex_pct') !== null ? v : 25; }

    const FX_CAT = {
      ok:           { r: 'Entregue',                         q: false, cls: 'cp-ok',      d: 'Venda paga e entregue.' },
      andamento:    { r: 'Em andamento',                     q: false, cls: 'cp-comprar', d: 'Venda paga; o Mercado Livre ainda não marcou a entrega.' },
      devolvida:    { r: 'Entregue e devolvida depois',      q: false, cls: 'cp-comprar', d: 'Foi entregue; o comprador devolveu ou reclamou depois. A entrega aconteceu.' },
      // frete:false = o frete não é contestado (a coleta aconteceu e o cancelamento não foi culpa do transportador)
      antes:        { r: 'Cancelada; pacote com o transportador', q: true, frete: false, cls: 'cp-excesso', d: 'A venda foi cancelada e o pacote consta como coletado nesta fatura, sem entrega.' },
      nao_entregue: { r: 'Saiu e não foi entregue',          q: true,  cls: 'cp-excesso', d: 'O envio saiu com o transportador e a venda foi cancelada sem entrega.' },
      // validar:true = não entra marcado; o usuário confere com o transportador antes
      pnr:          { r: 'Comprador diz que não recebeu',    q: true,  validar: true, cls: 'cp-excesso', d: 'Consta como entregue, mas o comprador reclamou que não recebeu e a venda foi cancelada.' },
      // marcada:true na linha = o usuário marcou a venda ("Conferir na fatura", página Vendas); sem problema no ML vira esta categoria
      marcada:      { r: 'Marcada por você',                 q: true,  validar: true, cls: 'cp-excesso', d: 'Você marcou esta venda para conferir na fatura (ex.: o comprador diz que não recebeu).' },
      paga_nao_ent: { r: 'Não entregue (venda ainda paga)',  q: true,  cls: 'cp-excesso', d: 'O Mercado Livre marcou o envio como não entregue.' },
      sem_venda:    { r: 'Sem venda correspondente',         q: true,  cls: 'cp-excesso', d: 'Este número de envio não existe nas suas vendas.' },
      duplicada:    { r: 'Cobrada em duplicidade',           q: true,  cls: 'cp-excesso', d: 'Este envio já foi cobrado (nesta fatura ou em outra já conferida).' },
    };

    // o que pedir ao transportador em cada situação
    const FX_PEDIDO = {
      antes: 'Devolver o produto. O frete desta coleta não está sendo contestado. Se o produto não for devolvido até o vencimento, abater o valor dele desta fatura.',
      nao_entregue: 'Devolver o produto e estornar o frete. Se não for devolvido, abater também o valor do produto.',
      pnr: 'Apresentar o comprovante de entrega. Sem comprovante, abater o frete e o valor do produto.',
      marcada: 'Apresentar o comprovante de entrega. Sem comprovante, abater o frete e o valor do produto.',
      paga_nao_ent: 'Informar onde está o pacote e devolver o produto.',
      sem_venda: 'Estornar o frete: este envio não consta nas nossas vendas.',
      duplicada: 'Estornar o frete cobrado em duplicidade.',
    };

    function fxScript(src){ return new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('não consegui carregar ' + src)); document.head.appendChild(s); }); }

    async function fxRender(){
      const view = document.getElementById('view-flex'); if(!view) return;
      if(fx.hist === null && typeof usuarioAtual !== 'undefined' && usuarioAtual){
        const r = await supa.from('flex_faturas').select('id,numero,transportador,emitida,de,ate,total,resumo,criado_em').eq('usuario_id', usuarioAtual.id).order('criado_em', { ascending: false }).limit(60);
        fx.hist = r.data || [];
      }
      fxDesenhar();
    }

    // ---------- leitura do PDF ----------
    async function fxEscolher(inp){ const file = inp.files && inp.files[0]; inp.value = ''; return fxArquivo(file); }
    async function fxArquivo(file){
      if(!file) return;
      if(!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf'){ fx.erro = 'este arquivo não é um PDF. A fatura do transportador vem em PDF.'; fx.fat = null; fx.linhas = []; fxDesenhar(); return; }
      fx.erro = ''; fx.fat = null; fx.linhas = []; fx.lendo = 'Lendo o PDF…'; fxDesenhar();
      try {
        await fxScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const linhas = new Map(); let cab = '', transp = '';
        for(let p = 1; p <= pdf.numPages; p++){
          const tc = await (await pdf.getPage(p)).getTextContent();
          const its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
          if(p === 1){ cab = its.slice().sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' '); transp = (its.slice().sort((a, b) => b.y - a.y || a.x - b.x)[0] || {}).s || ''; }
          // cada envio: um número de 10 a 12 dígitos; a linha é tudo que está na mesma altura
          its.filter(i => /(^|\s)\d{10,12}(\s|$)/.test(i.s)).forEach(a => {
            const txt = its.filter(i => Math.abs(i.y - a.y) <= 6).sort((x, y) => x.x - y.x).map(i => i.s).join(' ');
            const m = txt.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{5,10})\s+(\d{10,12})(?!\d)/); if(!m) return;
            const dinheiro = txt.slice(txt.indexOf(m[3])).match(/\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g) || [];
            const chave = m[2] + '|' + m[3];
            const largo = its.filter(i => Math.abs(i.y - a.y) <= 13).sort((x, y) => x.x - y.x || y.y - x.y).map(i => i.s).join(' ');
            const cep = (largo.match(/\d{5}-\d{3}/) || [])[0] || '';
            const nm = cep ? largo.slice(0, largo.indexOf(cep)).match(/FLEX\s+(.+)$/i) : null;
            if(!linhas.has(chave)) linhas.set(chave, { coleta: fxIso(m[1]), codigo: m[2], envio: m[3], frete: dinheiro.length ? fxNum(dinheiro[dinheiro.length - 1]) : 0, cep, dest: nm ? nm[1].replace(/\s+/g, ' ').trim() : '' });
          });
        }
        const num = (cab.match(/Fatura N.?:?\s*(\d+)/i) || [])[1] || '', per = cab.match(/(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/);
        fx.fat = { numero: num, transportador: transp, emitida: fxIso((cab.match(/Emitida em:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]), venc: fxIso((cab.match(/Vencimento:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]),
          de: per ? fxIso(per[1]) : '', ate: per ? fxIso(per[2]) : '', total: fxNum((cab.match(/Valor a Pagar:?\s*R\$\s*([\d.,]+)/i) || [])[1]), arquivo: file.name, ...fxQuadro(cab) };
        fx.linhas = [...linhas.values()];
        if(!fx.linhas.length) throw new Error('não achei nenhum envio neste PDF. Ele é a fatura do transportador do Flex, com um envio por linha?');
        await fxConferir();
      } catch(e){ fx.erro = (e && e.message) || String(e); fx.lendo = ''; fxDesenhar(); }
    }

    // Quadro de totais da fatura (1ª página): Pedidos | Frete | ICMS | Gris | ADValorem | Cobrança | Débitos | Despesa | Créditos | Receita | Fatura.
    // "Créditos" é onde o transportador lança estornos e abatimentos; "Débitos", cobranças extras.
    function fxQuadro(cab){
      const m = String(cab || '').match(/R\$\s*Fatura\s+(\d{1,6})((?:\s+\d{1,3}(?:\.\d{3})*,\d{2}){10})(?!\d)/);
      if(!m) return { quadro: false };
      const v = m[2].trim().split(/\s+/).map(fxNum);
      return { quadro: true, pedidos: Number(m[1]), freteBruto: v[0], debitos: v[5], creditos: v[7] };
    }

    // ---------- importar pelo link ----------
    function fxLink(){
      if(typeof vmlModal !== 'function') return;
      vmlModal('Importar a fatura pelo link', `<div class="form-group" style="margin:0;"><label for="fx-link-url">Link que o transportador mandou</label>
          <input type="url" id="fx-link-url" placeholder="https://tracken.app.br/tracken/fatura/..." style="width:100%;" onkeydown="if(event.key==='Enter')fxLinkIr()"></div>
        <div class="text-muted" style="font-size:12.5px;margin-top:10px;line-height:1.5;">Por segurança, só são aceitos links de <b>tracken.app.br</b>. O sistema baixa o PDF pelo servidor e lê apenas o texto dele. Se a sua fatura vem de outro endereço, baixe o PDF e use "Enviar fatura (PDF)".</div>
        <div id="fx-link-msg" class="alert alert-danger" style="display:none;margin-top:12px;"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" id="fx-link-bt" onclick="fxLinkIr()">Importar</button>`);
      setTimeout(() => { const i = document.getElementById('fx-link-url'); if(i) i.focus(); }, 60);
    }
    async function fxLinkIr(){
      const inp = document.getElementById('fx-link-url'), msg = document.getElementById('fx-link-msg'), bt = document.getElementById('fx-link-bt'); if(!inp) return;
      const erro = t => { if(msg){ msg.textContent = t; msg.style.display = 'block'; } if(bt){ bt.disabled = false; bt.textContent = 'Importar'; } };
      const url = inp.value.trim();
      if(!/^https:\/\/tracken\.app\.br\/tracken\/fatura\/[0-9a-f]{16,64}$/i.test(url)){ erro('Este link não é de uma fatura de tracken.app.br. Confira se colou o link inteiro; para outro transportador, baixe o PDF e use "Enviar fatura (PDF)".'); return; }
      if(bt){ bt.disabled = true; bt.textContent = 'Baixando…'; } if(msg) msg.style.display = 'none';
      let r;
      try {
        const sd = await supa.auth.getSession(), tk = sd.data.session.access_token;
        r = await fetch(SUPA_URL + '/functions/v1/flex-fatura', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then(x => x.json());
      } catch(e){ r = { error: 'sem conexão com o servidor' }; }
      if(!r || r.error || !r.pdf){ erro('Não consegui importar: ' + ((r && r.error) || 'resposta vazia')); return; }
      const bin = atob(r.pdf), u8 = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      fecharModal('modal-vml');
      fxArquivo(new File([u8], r.nome || 'fatura.pdf', { type: 'application/pdf' }));
    }

    // ---------- conferência ----------
    async function fxConferir(){
      const L = fx.linhas, uid = usuarioAtual.id;
      fx.lendo = 'Procurando as ' + L.length + ' vendas…'; fxDesenhar();
      const ids = [...new Set(L.map(l => l.envio))], vendas = [];
      for(let i = 0; i < ids.length; i += 150){
        const r = await supa.from('vendas_ml').select('order_id,shipping_id,ml_user_id,status,sku,titulo,qtd,preco_unit,custo_unit,envio_status,logistic_type,data_venda').eq('usuario_id', uid).in('shipping_id', ids.slice(i, i + 150));
        if(r.error) throw r.error; vendas.push(...(r.data || []));
      }
      // vendas marcadas na página Vendas para conferir na fatura
      const marcadas = new Set(), pedidos = [...new Set(vendas.map(v => String(v.order_id)))];
      for(let i = 0; i < pedidos.length; i += 150){
        const r = await supa.from('vendas_conferir').select('order_id').eq('usuario_id', uid).in('order_id', pedidos.slice(i, i + 150));
        (r.data || []).forEach(x => marcadas.add(String(x.order_id)));
      }
      const porEnvio = new Map(); vendas.forEach(v => { const k = String(v.shipping_id); if(!porEnvio.has(k)) porEnvio.set(k, []); porEnvio.get(k).push(v); });
      // envios já cobrados em faturas conferidas antes
      const antigos = new Map();
      const ant = await supa.from('flex_faturas').select('id,numero,transportador,de,ate,total,linhas').eq('usuario_id', uid).neq('numero', fx.fat.numero || '—').limit(200);
      // FATURA RETIFICADA: mesmo transportador e mesmo período de uma fatura já conferida = ela substitui a anterior.
      // Os envios da anterior não contam como cobrança em duplicidade.
      const F0 = fx.fat, ret = F0.de && F0.ate ? (ant.data || []).find(f => f.de === F0.de && f.ate === F0.ate && fxN(f.transportador) === fxN(F0.transportador)) : null;
      F0.substitui = ret ? { id: ret.id, numero: ret.numero, total: Number(ret.total) || 0, envios: (ret.linhas || []).length } : null;
      (ant.data || []).filter(f => f !== ret).forEach(f => (f.linhas || []).forEach(l => antigos.set(String(l.envio), f.numero)));
      const vistos = new Set();
      L.forEach(l => {
        const vs = porEnvio.get(l.envio) || [];
        l.vendas = vs.map(v => ({ pedido: String(v.order_id), sku: v.sku || '', titulo: v.titulo || '', qtd: Number(v.qtd) || 1, valor: (Number(v.preco_unit) || 0) * (Number(v.qtd) || 1), custo: (Number(v.custo_unit) || 0) * (Number(v.qtd) || 1) }));
        l.conta = vs[0] ? String(vs[0].ml_user_id) : ''; l.valor = l.vendas.reduce((s, v) => s + v.valor, 0); l.custo = l.vendas.reduce((s, v) => s + v.custo, 0);
        l.cancelada = vs.length > 0 && vs.every(v => v.status === 'cancelled'); l.envioStatus = vs[0] ? vs[0].envio_status : null; l.det = null; l.nota = '';
        if(vistos.has(l.envio)){ l.cat = 'duplicada'; l.nota = 'aparece mais de uma vez nesta fatura'; }
        else if(antigos.has(l.envio)){ l.cat = 'duplicada'; l.nota = 'já cobrado na fatura ' + antigos.get(l.envio); }
        else if(!vs.length) l.cat = 'sem_venda';
        else if(!l.cancelada && l.envioStatus === 'delivered') l.cat = 'ok';
        else l.cat = '';                       // precisa perguntar ao Mercado Livre
        vistos.add(l.envio);
      });
      const pend = L.filter(l => l.cat === '');
      const sd = await supa.auth.getSession(), tk = sd.data.session.access_token;
      for(let i = 0; i < pend.length; i += 40){
        fx.lendo = 'Consultando o Mercado Livre: ' + Math.min(i + 40, pend.length) + ' de ' + pend.length + ' envios…'; fxDesenhar();
        const lote = pend.slice(i, i + 40);
        const r = await fetch(SUPA_URL + '/functions/v1/ml-envios', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'conferir', envios: lote.map(l => ({ envio: l.envio, pedido: l.vendas[0] && l.vendas[0].pedido, conta: l.conta })) }) }).then(x => x.json()).catch(() => ({ error: 'sem conexão' }));
        if(r.error) throw new Error('não consegui consultar o Mercado Livre: ' + r.error);
        (r.envios || []).forEach(d => { const l = lote.find(x => String(x.envio) === String(d.envio)); if(l){ l.det = d; fxClassificar(l); } });
      }
      pend.filter(l => l.cat === '').forEach(l => { l.cat = l.cancelada ? 'antes' : 'andamento'; l.nota = 'o Mercado Livre não devolveu os detalhes deste envio'; });
      L.forEach(l => {
        l.marcada = l.vendas.some(v => marcadas.has(v.pedido));
        if(l.marcada && !FX_CAT[l.cat].q){ l.nota = 'Você marcou esta venda para conferir. No Mercado Livre ela consta como ' + (l.cat === 'ok' ? 'entregue' : FX_CAT[l.cat].r.toLowerCase()) + '. ' + (l.nota || ''); l.cat = 'marcada'; }
      });
      fx.marc = new Set(L.filter(l => FX_CAT[l.cat].q && !FX_CAT[l.cat].validar).map(l => l.codigo + '|' + l.envio));
      fx.lendo = ''; fx.ver = 'questionar'; fxDesenhar();
    }

    // decide o que aconteceu com o envio pelo histórico do Mercado Livre
    function fxClassificar(l){
      const d = l.det || {}, h = d.hist || [], quando = s => (h.find(i => i.s === s) || {}).d || null;
      const saiu = quando('shipped'), entregue = quando('delivered') || (d.status === 'delivered' ? 'sim' : null), naoEnt = quando('not_delivered') || (d.status === 'not_delivered' ? 'sim' : null);
      const p = d.pedido || {}, r = d.reclamacao || {};
      const quem = { buyer: 'pelo comprador', seller: 'pelo vendedor', meli: 'pelo Mercado Livre', mediations: 'em reclamação', shipment: 'por problema no envio', fraud: 'por suspeita de fraude', internal: 'pelo Mercado Livre' }[p.por] || { buyer: 'pelo comprador', seller: 'pelo vendedor', mediations: 'em reclamação', shipment: 'por problema no envio', fraud: 'por suspeita de fraude' }[p.grupo] || '';
      const motivo = r.motivo_nome ? '"' + r.motivo_nome + '"' : '';
      l.saiu = saiu; l.entregue = entregue && entregue !== 'sim' ? entregue : null; l.cancEm = p.quando || quando('cancelled');
      if(l.cancelada || p.status === 'cancelled'){
        l.cancelada = true;
        const txtCanc = 'Cancelada ' + quem + (l.cancEm ? ' em ' + fxDH(l.cancEm) : '') + (motivo ? ', motivo ' + motivo : '');
        if(entregue){ l.cat = /^PNR/.test(r.motivo || '') ? 'pnr' : 'devolvida'; l.nota = 'Entregue' + (l.entregue ? ' em ' + fxDH(l.entregue) : '') + '. ' + txtCanc + '.'; }
        else if(saiu){ const dias = l.cancEm ? Math.round((new Date(l.cancEm) - new Date(saiu)) / 3600000) : null; l.cat = 'nao_entregue'; l.nota = 'Saiu em ' + fxDH(saiu) + ' e não consta entrega' + (dias != null ? ' (' + (dias >= 48 ? Math.round(dias / 24) + ' dias' : dias + ' horas') + ' depois foi cancelada)' : '') + '. ' + txtCanc + '.'; }
        else { l.cat = 'antes'; l.nota = txtCanc + '. O envio consta nesta fatura como coletado' + (l.coleta ? ' em ' + ptDate(l.coleta).slice(0, 5) : '') + ' e não teve saída nem entrega registradas no Mercado Livre: o produto ficou com o transportador.'; }
      } else if(entregue){ l.cat = 'ok'; }
      else if(naoEnt){ l.cat = 'paga_nao_ent'; l.nota = 'O Mercado Livre marcou como não entregue' + (saiu ? ' (saiu em ' + fxDH(saiu) + ')' : '') + '.'; }
      else { l.cat = 'andamento'; l.nota = saiu ? 'Saiu em ' + fxDH(saiu) + ', ainda sem entrega registrada.' : 'Ainda sem saída registrada no Mercado Livre.'; }
    }

    // ---------- tela ----------
    // com uma loja escolhida no seletor, a conferência mostra só os envios dela (envio sem venda aparece em todas)
    function fxLoja(){ return typeof lojaAtiva === 'function' ? (lojaAtiva() || '') : ''; }
    function fxVisiveis(){ const lj = fxLoja(); return fx.linhas.filter(l => !lj || !l.conta || l.conta === lj); }
    function fxFreteQ(l){ return FX_CAT[l.cat] && FX_CAT[l.cat].frete === false ? 0 : l.frete; }
    function fxProdutoQ(l){ return FX_CAT[l.cat].q && l.valor && l.cat !== 'duplicada' ? l.valor * (1 - fxPct() / 100) : 0; }
    function fxResumo(){
      const L = fxVisiveis(), q = L.filter(l => FX_CAT[l.cat] && FX_CAT[l.cat].q), pct = fxPct();
      const marc = L.filter(l => fx.marc.has(l.codigo + '|' + l.envio));
      return { envios: L.length, frete: L.reduce((s, l) => s + l.frete, 0), ok: L.filter(l => l.cat === 'ok').length, questionar: q.length,
        qFrete: marc.reduce((s, l) => s + fxFreteQ(l), 0), qVenda: marc.reduce((s, l) => s + l.valor, 0), qRessarcir: marc.reduce((s, l) => s + fxProdutoQ(l), 0), validar: L.filter(l => FX_CAT[l.cat].validar && !fx.marc.has(l.codigo + '|' + l.envio)).length, qCusto: marc.reduce((s, l) => s + l.custo, 0), marcados: marc.length,
        porCat: Object.keys(FX_CAT).map(k => [k, L.filter(l => l.cat === k).length]).filter(x => x[1]) };
    }

    function fxDesenhar(){
      const view = document.getElementById('view-flex'); if(!view) return;
      const cab = `<div class="pg-head"><div><div class="pg-title">Conferência da fatura do Flex</div><div class="pg-sub">Envie o PDF da fatura do transportador (ou cole o link dela) antes de pagar. O sistema confere envio por envio com as suas vendas e mostra o que vale questionar.</div></div>
        <div class="d-flex gap-1" style="flex-wrap:wrap;"><button class="btn-out btn-sm" onclick="fxLink()" title="Cole o link que o transportador manda (tracken.app.br)">Importar pelo link</button><label class="btn btn-sm" style="cursor:pointer;margin:0;">Enviar fatura (PDF)<input type="file" accept="application/pdf,.pdf" aria-label="Fatura do Flex em PDF" style="display:none" onchange="fxEscolher(this)"></label></div></div>`;
      if(fx.lendo){ view.innerHTML = cab + `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>${fxE(fx.lendo)}</b></div></div>`; return; }
      const erro = fx.erro ? `<div class="alert alert-danger">Não consegui conferir: ${fxE(fx.erro)}</div>` : '';
      if(!fx.fat){
        const h = fx.hist || [];
        const T = h.reduce((s, x) => { const r = x.resumo || {}; s.env += Number(r.envios) || 0; s.tot += Number(x.total) || 0; s.ped += (Number(r.qFrete) || 0) + (Number(r.qRessarcir) || 0); s.cre += Number(r.creditos) || 0; s.marc += Number(r.marcados) || 0; return s; }, { env: 0, tot: 0, ped: 0, cre: 0, marc: 0 });
        const cartoes = h.length ? `<div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Envios conferidos</div><div class="kpi-value">${T.env.toLocaleString('pt-BR')}</div><div class="kpi-sub"><span>em ${h.length} fatura${h.length === 1 ? '' : 's'} · ${fmt(T.tot)} cobrados</span></div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Cobrado a mais</div><div class="kpi-value" style="color:var(--danger)">${fmt(T.ped)}</div><div class="kpi-sub"><span>${T.marc} envios para questionar</span></div></div>
          <div class="kpi k-mc"><div class="kpi-label">Estornos já lançados</div><div class="kpi-value">${fmt(T.cre)}</div><div class="kpi-sub"><span>créditos que vieram nas faturas</span></div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Ainda a recuperar</div><div class="kpi-value" style="color:${T.ped - T.cre > 0 ? 'var(--danger)' : 'var(--success,#16a34a)'}">${fmt(Math.max(0, T.ped - T.cre))}</div><div class="kpi-sub"><span>cobrado a mais menos os estornos</span></div></div>
        </div>` : '';
        view.innerHTML = cab + erro + cartoes + `<div class="card"><div class="card-header"><div class="card-title">Faturas já conferidas</div></div>
          ${h.length ? `<div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Fatura</th><th>Transportador</th><th>Período</th><th class="num">Envios</th><th class="num">Valor fechado</th><th class="num" title="Créditos (estornos e abatimentos) que o transportador lançou nesta fatura">Estornos na fatura</th><th class="num">A questionar</th><th></th></tr></thead><tbody>
            ${h.map(f => `<tr><td><b>${fxE(f.numero || '—')}</b><br><small class="text-muted">conferida em ${fxDH(f.criado_em)}</small></td><td>${fxE(f.transportador || '')}</td><td>${f.de ? ptDate(f.de) + ' a ' + ptDate(f.ate) : '—'}</td>${(() => { const lj = fxLoja(), pl = f.resumo && f.resumo.porLoja, nome = k => k === '-' ? 'sem venda' : (typeof contaNome === 'function' && contaNome(k)) || k;
              const est = f.resumo && f.resumo.quadro ? `<td class="num" style="${f.resumo.creditos > 0 ? 'color:var(--success,#16a34a);font-weight:700;' : ''}">${f.resumo.creditos > 0 ? fmt(f.resumo.creditos) : 'nenhum'}</td>` : '<td class="num text-muted" title="Fatura conferida antes de o sistema ler este campo: abra e guarde de novo, ou reenvie o PDF">—</td>';
              if(lj && pl){ const o = pl[lj] || { envios: 0, frete: 0, marcados: 0, pedir: 0 }; return `<td class="num">${o.envios}</td><td class="num">${fmt(o.frete)}</td>${est}<td class="num" style="color:${o.pedir > 0 ? 'var(--danger)' : 'var(--primary)'};font-weight:700;">${o.marcados} · ${fmt(o.pedir)}</td>`; }
              const det = pl ? '<br><small class="text-muted">' + Object.keys(pl).map(k => fxE(nome(k)) + ' ' + pl[k].envios).join(' · ') + '</small>' : '', ped = f.resumo ? f.resumo.qFrete + f.resumo.qRessarcir : 0;
              return `<td class="num">${(f.resumo && f.resumo.envios) || '—'}${det}</td><td class="num">${fmt(Number(f.total) || 0)}</td>${est}<td class="num" style="color:${ped > 0 ? 'var(--danger)' : 'var(--primary)'};font-weight:700;">${f.resumo ? f.resumo.marcados + ' · ' + fmt(ped) : '—'}</td>`; })()}<td style="text-align:right;"><button class="btn-out btn-sm" onclick="fxAbrir(${f.id})">Abrir</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="vazio"><div class="vazio-ico"></div><b>Nenhuma fatura conferida ainda</b>Clique em "Enviar fatura (PDF)" e escolha o arquivo que o transportador mandou.</div>'}</div>`;
        return;
      }
      const R = fxResumo(), F = fx.fat, pct = fxPct(), lj = fxLoja(), difTotal = !lj && Math.abs(R.frete - F.total) > 0.05, pedir = R.qFrete + R.qRessarcir;
      const lista = fxVisiveis().filter(l => fx.ver === 'todas' ? true : fx.ver === 'questionar' ? FX_CAT[l.cat].q : l.cat === fx.ver);
      const loja = c => c && typeof contaNome === 'function' ? contaNome(c) : '';
      const justo = (F.total || R.frete) - pedir;
      view.innerHTML = cab + erro + `
        <div class="fx-acoes"><button class="btn-out btn" onclick="fx.fat=null;fx.linhas=[];fx.hist=null;fxRender()">← Voltar para as faturas</button>
          <span style="flex:1;"></span><button class="btn-out btn" ${R.marcados ? '' : 'disabled'} onclick="fxPdf()">Relatório para o transportador</button>${(() => { const j = fxLancada(); return j ? `<button class="btn-out btn" onclick="fxLancar()" title="${fxE('Já está em Contas a pagar: ' + (j.desc || '') + ' · ' + fmt(Number(j.val) || 0) + ' · vence ' + ptDate(j.data))}">✓ Lançada no Contas a pagar</button>` : '<button class="btn-out btn" onclick="fxLancar()" title="Abre uma conta a pagar já preenchida com o valor, o vencimento e o número desta fatura">Lançar no Contas a pagar</button>'; })()}<button class="btn" onclick="fxSalvar(this)">Guardar conferência</button></div>
        <div class="card"><div class="card-body" style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div><b style="font-size:15px;">Fatura ${fxE(F.numero || '')} · ${fxE(F.transportador || '')}</b><div class="text-muted" style="font-size:12.5px;margin-top:3px;">${F.de ? 'Período ' + ptDate(F.de) + ' a ' + ptDate(F.ate) + ' · ' : ''}${F.venc ? 'vence em ' + ptDate(F.venc) + ' · ' : ''}${fxE(F.arquivo || '')}</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;align-items:center;">
            <label style="font-size:12.5px;display:flex;gap:6px;align-items:center;margin:0;" title="O relatório pede de volta o valor da venda menos este percentual">Ressarcimento = venda menos <input type="number" min="0" max="90" step="1" value="${pct}" style="width:64px;" onchange="localStorage.setItem('mk_flex_pct', this.value);fxDesenhar()"> %</label>

          </div></div></div>
        ${F.quadro ? `<div class="alert ${F.creditos > 0 ? 'alert-success' : 'alert-info'}" style="display:flex;gap:22px;flex-wrap:wrap;align-items:center;">
            <span>Período <b>${F.de ? ptDate(F.de) + ' a ' + ptDate(F.ate) : '—'}</b></span><span>Pedidos <b>${F.pedidos}</b></span><span>Fretes <b>${fmt(F.freteBruto)}</b></span>
            <span>Cobranças extras (débitos) <b>${fmt(F.debitos)}</b></span><span>Estornos (créditos) <b>${fmt(F.creditos)}</b></span><span>Valor fechado <b>${fmt(F.total)}</b></span>
            <span style="flex-basis:100%;font-size:12.5px;">${F.creditos > 0 ? 'O transportador lançou ' + fmt(F.creditos) + ' de estorno nesta fatura. Confira se bate com o que foi combinado.' : 'Esta fatura não tem nenhum estorno lançado. Se o transportador prometeu abater algum envio, ele não entrou aqui.'}</span></div>` : ''}
        ${F.substitui ? `<div class="alert alert-info"><b>Fatura retificada:</b> substitui a fatura nº ${fxE(F.substitui.numero)} (mesmo transportador e mesmo período). Antes: ${fmt(F.substitui.total)} em ${F.substitui.envios} envios · agora: ${fmt(F.total)} em ${R.envios} envios${Math.abs(F.total - F.substitui.total) > 0.005 ? ' · diferença <b>' + fmt(F.total - F.substitui.total) + '</b>' : ''}. Ao guardar, a conferência da ${fxE(F.substitui.numero)} é trocada por esta.</div>` : ''}
        ${difTotal ? `<div class="alert alert-warning">A soma dos envios que li (${fmt(R.frete)}) é diferente do valor a pagar da fatura (${fmt(F.total)}). Pode haver linha que não consegui ler: confira o total de envios.</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-venda"><div class="kpi-label">Envios conferidos${lj && typeof contaNome === 'function' ? ' · ' + fxE(contaNome(lj)) : ''}</div><div class="kpi-value">${R.envios}</div><div class="kpi-sub"><span><b>${R.envios ? Math.round(R.ok / R.envios * 100) : 0}%</b> pagos e entregues</span><span>${lj ? 'desta loja ' + fmt(R.frete) + ' · fatura ' + fmt(F.total) : 'valor fechado ' + fmt(F.total || R.frete)}</span></div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Cobrado a mais</div><div class="kpi-value" style="color:var(--danger)">${fmt(pedir)}</div><div class="kpi-sub"><span>${R.marcados} de ${R.questionar} envios marcados</span><span>fretes <b>${fmt(R.qFrete)}</b> · produtos <b>${fmt(R.qRessarcir)}</b></span>${R.validar ? `<span style="color:var(--warning,#d97706)"><b style="color:inherit">${R.validar}</b> para você conferir antes</span>` : ''}</div></div>
          <div class="kpi k-mc"><div class="kpi-label">Estornos já lançados</div><div class="kpi-value">${F.quadro ? fmt(F.creditos) : '—'}</div><div class="kpi-sub"><span>${F.quadro ? (F.creditos > 0 ? 'créditos que o transportador pôs na fatura' : 'a fatura não traz nenhum estorno') : 'fatura lida antes de o sistema ler este campo'}</span></div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Valor justo a pagar</div><div class="kpi-value" style="color:var(--info,#2563eb)">${fmt(justo)}</div><div class="kpi-sub"><span>valor fechado menos o cobrado a mais</span></div></div>
        </div>
        <div class="card"><div class="card-body" style="padding-bottom:0;"><div class="chips">
          <button class="chip ${fx.ver === 'questionar' ? 'active' : ''}" onclick="fx.ver='questionar';fxDesenhar()">Para questionar ${R.questionar}</button>
          ${R.porCat.map(([k, n]) => `<button class="chip ${fx.ver === k ? 'active' : ''}" onclick="fx.ver='${k}';fxDesenhar()">${FX_CAT[k].r} ${n}</button>`).join('')}
          <button class="chip ${fx.ver === 'todas' ? 'active' : ''}" onclick="fx.ver='todas';fxDesenhar()">Todas ${R.envios}</button></div></div>
          <div style="overflow-x:auto;"><table class="cp-tab fx-conf"><thead><tr><th title="Entra no relatório para o transportador"></th><th>Envio</th><th>Coleta</th><th>Situação</th><th>O que aconteceu</th><th>Produto</th><th class="num">Frete cobrado</th><th class="num">Valor da venda</th><th class="num" title="Custo gravado na venda">Custo real</th><th class="num" title="Valor da venda menos ${pct}%">A ressarcir</th></tr></thead><tbody>
            ${lista.length ? lista.map(l => { const c = FX_CAT[l.cat], k = l.codigo + '|' + l.envio, v = l.vendas[0];
              return `<tr><td><input type="checkbox" style="width:auto;" ${fx.marc.has(k) ? 'checked' : ''} onchange="this.checked?fx.marc.add('${k}'):fx.marc.delete('${k}');fxDesenhar()"></td>
                <td>${v ? `<a class="fx-link" style="color:var(--primary);font-weight:700;" href="https://www.mercadolivre.com.br/vendas/${fxE(v.pedido)}/detalhe" target="_blank" rel="noopener" title="Abrir a venda no Mercado Livre">${fxE(l.envio)}</a>` : `<b>${fxE(l.envio)}</b>`}<br><small class="text-muted">cód. ${fxE(l.codigo)}${loja(l.conta) ? ' · ' + fxE(loja(l.conta)) : ''}${l.dest ? '<br>' + fxE(l.dest) + (l.cep ? ' · CEP ' + fxE(l.cep) : '') : ''}</small></td>
                <td>${l.coleta ? ptDate(l.coleta).slice(0, 5) : '—'}</td>
                <td><span class="cp-sit ${c.cls}">${c.r}</span>${l.marcada && l.cat !== 'marcada' ? '<br><small style="color:var(--warning,#d97706);font-weight:700;">⚑ marcada por você</small>' : ''}</td>
                <td class="fx-oque">${fxE(l.nota || c.d)}${c.validar && !fx.marc.has(k) ? '<br><b style="color:var(--warning,#d97706)">Confira antes:</b> peça ao transportador a prova de entrega; se ele não comprovar, marque a caixa ao lado para incluir no relatório.' : ''}${FX_PEDIDO[l.cat] ? '<br><b>Pedir:</b> ' + fxE(FX_PEDIDO[l.cat]) : ''}${v ? `<br><a class="fx-link" style="color:var(--primary);" href="https://www.mercadolivre.com.br/vendas/${fxE(v.pedido)}/detalhe" target="_blank" rel="noopener">venda #${fxE(v.pedido)}</a>` : ''}</td>
                <td class="cp-prod"><b>${fxE(l.vendas.map(x => x.sku).filter(Boolean).join(', ') || '—')}</b><span>${fxE(v ? v.titulo : '')}</span></td>
                <td class="num">${fmt(l.frete)}${c.q && c.frete === false ? '<br><small class="text-muted">não contestado</small>' : ''}</td><td class="num">${l.valor ? fmt(l.valor) : '—'}</td><td class="num">${l.custo ? fmt(l.custo) : '—'}</td><td class="num"><b>${fxProdutoQ(l) ? fmt(fxProdutoQ(l)) : '—'}</b></td></tr>`; }).join('')
              : '<tr><td colspan="10" class="text-muted" style="text-align:center;padding:22px;">Nada nesta lista.</td></tr>'}
          </tbody></table></div>
          <div class="text-muted" style="font-size:12px;padding:12px 18px;line-height:1.5;">Marque ou desmarque as linhas que entram no relatório. "A ressarcir" é o valor da venda menos ${pct}% e só é pedido quando o produto ficou com o transportador ou se perdeu; nas vendas entregues e devolvidas depois, a entrega aconteceu e não há o que cobrar dele.</div></div>`;
    }

    async function fxSalvar(btn){
      if(!fx.fat) return; if(btn){ btn.disabled = true; btn.textContent = 'Guardando…'; }
      const uid = usuarioAtual.id, F = fx.fat, todas = fx.linhas, mk = l => fx.marc.has(l.codigo + '|' + l.envio);
      const porLoja = {}; todas.forEach(l => { const k = l.conta || '-', o = porLoja[k] || (porLoja[k] = { envios: 0, frete: 0, marcados: 0, pedir: 0 }); o.envios++; o.frete += l.frete; if(mk(l)){ o.marcados++; o.pedir += fxFreteQ(l) + fxProdutoQ(l); } });
      const R = { envios: todas.length, frete: todas.reduce((s, l) => s + l.frete, 0), marcados: todas.filter(mk).length, qFrete: todas.filter(mk).reduce((s, l) => s + fxFreteQ(l), 0), qRessarcir: todas.filter(mk).reduce((s, l) => s + fxProdutoQ(l), 0), porLoja };
      const linhas = fx.linhas.map(l => ({ envio: l.envio, codigo: l.codigo, coleta: l.coleta, cep: l.cep || '', dest: l.dest || '', frete: l.frete, cat: l.cat, nota: l.nota, conta: l.conta, valor: l.valor, custo: l.custo, vendas: l.vendas, marc: fx.marc.has(l.codigo + '|' + l.envio) }));
      if(F.numero) await supa.from('flex_faturas').delete().eq('usuario_id', uid).eq('numero', F.numero);
      if(F.substitui && F.substitui.id) await supa.from('flex_faturas').delete().eq('usuario_id', uid).eq('id', F.substitui.id);   // retificada: sai a anterior
      const r = await supa.from('flex_faturas').insert({ usuario_id: uid, numero: F.numero || null, transportador: F.transportador || null, emitida: F.emitida || null, de: F.de || null, ate: F.ate || null, total: F.total || null, arquivo: F.arquivo || null, linhas, resumo: { ...R, venc: F.venc || null, substitui: F.substitui ? F.substitui.numero : null, quadro: !!F.quadro, pedidos: F.pedidos || null, freteBruto: F.freteBruto || 0, debitos: F.debitos || 0, creditos: F.creditos || 0 } });
      if(btn){ btn.disabled = false; btn.textContent = 'Guardar conferência'; }
      toast(r.error ? 'Não consegui guardar: ' + r.error.message : 'Conferência guardada. Envios desta fatura cobrados de novo em outra serão apontados.');
      fx.hist = null;
    }
    async function fxAbrir(id){
      const r = await supa.from('flex_faturas').select('*').eq('id', id).eq('usuario_id', usuarioAtual.id).maybeSingle();
      if(r.error || !r.data){ toast('Não consegui abrir esta fatura.'); return; }
      const f = r.data;
      fx.fat = { numero: f.numero || '', transportador: f.transportador || '', emitida: f.emitida || '', de: f.de || '', ate: f.ate || '', total: Number(f.total) || 0, arquivo: f.arquivo || '', venc: (f.resumo && f.resumo.venc) || '', substitui: f.resumo && f.resumo.substitui ? { numero: f.resumo.substitui, total: 0, envios: 0, guardada: true } : null, quadro: !!(f.resumo && f.resumo.quadro), pedidos: (f.resumo && f.resumo.pedidos) || 0, freteBruto: (f.resumo && f.resumo.freteBruto) || 0, debitos: (f.resumo && f.resumo.debitos) || 0, creditos: (f.resumo && f.resumo.creditos) || 0 };
      fx.linhas = (f.linhas || []).map(l => ({ ...l, vendas: l.vendas || [], cat: FX_CAT[l.cat] ? l.cat : 'andamento' }));
      fx.marc = new Set(fx.linhas.filter(l => l.marc).map(l => l.codigo + '|' + l.envio)); fx.ver = 'questionar'; fxDesenhar();
    }

    // ---------- lançar no Contas a pagar ----------
    // conta já lançada: mesmo nº de documento e fornecedor (ou histórico) que fala da fatura do Flex
    function fxLancada(numero){
      const F = fx.fat; numero = numero || (F && F.numero); if(!F || !numero) return null;
      const T = typeof pagTodos === 'function' ? pagTodos() : pagamentos, t = fxN(F.transportador);
      // o número pode estar no Nº do documento ou no histórico (contas lançadas à mão: 'Fatura nº: 27976', 'Flex - Fat 26779')
      const num = new RegExp('(^|[^0-9])' + String(numero) + '([^0-9]|$)');
      return T.find(p => (String(p.doc || '').trim() === String(numero) || num.test(String(p.desc || ''))) && (!t || fxN(p.forn).includes(t.slice(0, 8)) || /flex/i.test(String(p.desc || '') + ' ' + String(p.cat || '')))) || null;
    }
    const fxN = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    function fxLancar(){
      const F = fx.fat; if(!F || typeof abrirModalLanc !== 'function') return;
      const j = fxLancada();
      // retificada: se a anterior já está em Contas a pagar, troca valor, vencimento e número nela (não lança duas vezes)
      const a = !j && F.substitui ? fxLancada(F.substitui.numero) : null;
      if(a && !a.pago && confirm('A fatura anterior (nº ' + F.substitui.numero + ') está em Contas a pagar: ' + fmt(Number(a.val) || 0) + ', vence ' + ptDate(a.data) + '. Atualizar essa conta para a retificada (nº ' + F.numero + ', ' + fmt(Number(F.total) || 0) + (F.venc ? ', vence ' + ptDate(F.venc) : '') + ')?')){
        a.val = Number(F.total) || a.val; if(F.venc) a.data = F.venc; a.doc = F.numero; if(F.emitida) a.emissao = F.emitida;
        a.desc = 'Fatura Flex nº ' + F.numero + ' (retifica a ' + F.substitui.numero + ')' + (F.de ? ' · ' + ptDate(F.de) + ' a ' + ptDate(F.ate) : '');
        salvar(); if(typeof recalc === 'function') recalc(); toast('Conta atualizada para a fatura retificada.'); fxDesenhar(); return;
      }
      if(a && a.pago) toast('A fatura anterior (nº ' + F.substitui.numero + ') já está paga. Lance a diferença, se houver.');
      if(j && !confirm('Esta fatura já está em Contas a pagar (' + fmt(Number(j.val) || 0) + ', vence ' + ptDate(j.data) + '). Lançar de novo?')) return;
      abrirModalLanc();
      const T = typeof pagTodos === 'function' ? pagTodos() : pagamentos;
      // categoria: a mais usada nas contas do Flex; senão a primeira categoria com "Flex" no nome
      const cont = {}; T.filter(p => p.cat && /flex/i.test(p.cat)).forEach(p => { cont[p.cat] = (cont[p.cat] || 0) + 1; });
      const cat = Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0] || ((categorias.find(c => /flex/i.test(c.nome)) || {}).nome) || '';
      // loja: a que tem mais frete nesta fatura
      const pl = {}; fx.linhas.forEach(l => { if(l.conta) pl[l.conta] = (pl[l.conta] || 0) + l.frete; });
      const loja = Object.keys(pl).sort((a, b) => pl[b] - pl[a])[0] || '';
      const set = (id, v) => { const e = document.getElementById(id); if(e && v != null && v !== '') e.value = v; };
      set('pf-forn', F.transportador || '');
      set('pf-venc', F.venc || '');
      set('pf-val', F.total ? fmtMoney(Number(F.total)) : '');
      set('pf-emis', F.emitida || '');
      set('pf-doc', F.numero || '');
      set('pf-desc', 'Fatura Flex ' + (F.numero ? 'nº ' + F.numero : '') + (F.substitui ? ' (retifica a ' + F.substitui.numero + ')' : '') + (F.de ? ' · ' + ptDate(F.de) + ' a ' + ptDate(F.ate) : ''));
      const sc = document.getElementById('pf-cat'); if(sc && cat && [...sc.options].some(o => o.value === cat || o.text === cat)){ sc.value = cat; if(typeof pfGrupoMostrar === 'function') pfGrupoMostrar(); }
      const sl = document.getElementById('pf-loja'); if(sl && loja && [...sl.options].some(o => o.value === loja)) sl.value = loja;
      // depois de salvar, o botão vira "Lançada"
      const ok = document.querySelector('#modal-vml .modal-footer .btn:not(.btn-out)') || [...document.querySelectorAll('#modal-vml button')].find(b => b.textContent.trim() === 'Salvar');
      if(ok) ok.addEventListener('click', () => setTimeout(() => { if(fx.fat) fxDesenhar(); }, 300));
    }

    // ---------- relatório para o transportador ----------
    async function fxPdf(){
      const marc = fxVisiveis().filter(l => fx.marc.has(l.codigo + '|' + l.envio)); if(!marc.length) return;
      try {
        await fxScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await fxScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' }), F = fx.fat, lj = fxLoja();
        const nomeLoja = k => k ? ((typeof contaNome === 'function' && contaNome(k)) || k) : 'Sem venda correspondente';
        const lojas = [...new Set(marc.map(l => l.conta || ''))].sort();
        doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.text('Contestação de fatura — entregas Flex', 40, 44);
        doc.setFontSize(10); doc.setFont(undefined, 'normal');
        doc.text('Fatura nº ' + (F.numero || '—') + (F.transportador ? ' · ' + F.transportador : '') + (F.de ? ' · período ' + ptDate(F.de) + ' a ' + ptDate(F.ate) : ''), 40, 62);
        doc.text('Emitido em ' + ptDate(getToday()) + ' · ' + marc.length + ' envio(s) contestado(s)' + (lj ? ' · loja ' + nomeLoja(lj) : ' de ' + fx.linhas.length + ' cobrados'), 40, 77);
        let y = 96, totF = 0, totP = 0;
        lojas.forEach(k => {
          const ls = marc.filter(l => (l.conta || '') === k), f = ls.reduce((s, l) => s + fxFreteQ(l), 0), p = ls.reduce((s, l) => s + fxProdutoQ(l), 0); totF += f; totP += p;
          if(y > 470){ doc.addPage(); y = 50; }
          doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text('Loja: ' + nomeLoja(k) + ' — ' + ls.length + ' envio(s)', 40, y); doc.setFont(undefined, 'normal');
          doc.autoTable({
            startY: y + 8, styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' }, headStyles: { fillColor: [79, 70, 229] }, margin: { left: 40, right: 40 },
            columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 86 }, 2: { cellWidth: 40 }, 3: { cellWidth: 96 }, 4: { cellWidth: 190 }, 5: { cellWidth: 122 }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
            head: [['Nº do envio', 'Nº da venda', 'Coleta', 'Destinatário / CEP', 'O que aconteceu', 'O que pedimos', 'Frete contestado', 'Valor da venda', 'Custo do produto', 'Total']],
            body: ls.map(l => [l.envio + '\ncód. ' + l.codigo, l.vendas.map(v => v.pedido).join('\n') || '—', l.coleta ? ptDate(l.coleta).slice(0, 5) : '', (l.dest || '—') + (l.cep ? '\nCEP ' + l.cep : ''),
              FX_CAT[l.cat].r + '. ' + (l.nota || FX_CAT[l.cat].d) + (l.vendas[0] && l.vendas[0].sku ? '\nProduto: ' + l.vendas.map(v => v.qtd + 'x ' + v.sku).join(', ') : ''), FX_PEDIDO[l.cat] || 'Rever a cobrança.',
              fxFreteQ(l) ? fmt(fxFreteQ(l)) : '—', l.valor ? fmt(l.valor) : '—', fxProdutoQ(l) ? fmt(fxProdutoQ(l)) : '—', fmt(fxFreteQ(l) + fxProdutoQ(l))]),
            foot: [['', '', '', '', '', 'Total da loja', fmt(f), fmt(ls.reduce((s, l) => s + l.valor, 0)), fmt(p), fmt(f + p)]], footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold', halign: 'right' }
          });
          y = doc.lastAutoTable.finalY + 26;
        });
        if(y > 520){ doc.addPage(); y = 50; }
        doc.setFontSize(10); doc.setFont(undefined, 'bold');
        doc.text((lj ? 'Contestado nesta loja: ' : 'Valor da fatura: ' + fmt(F.total || 0) + '     Contestado: ') + fmt(totF + totP) + (lj ? '' : '     Valor após a contestação: ' + fmt((F.total || 0) - totF - totP)), 40, y);
        doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
        doc.text('As ocorrências foram conferidas no histórico de cada envio no Mercado Livre. O custo do produto considera o valor de reposição e as despesas de operação.', 40, y + 16);
        doc.text('Produtos devolvidos em bom estado até o vencimento da fatura não precisam ser abatidos: nesse caso, fica só o frete contestado, quando houver.', 40, y + 29);
        doc.save('contestacao_flex_fatura_' + (F.numero || getToday()) + (lj ? '_' + String(nomeLoja(lj)).replace(/[^A-Za-z0-9]+/g, '_') : '') + '.pdf');
      } catch(e){ toast('Não consegui gerar o PDF: ' + ((e && e.message) || e)); }
    }
