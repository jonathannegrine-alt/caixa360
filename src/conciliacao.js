// ===== CONCILIAÇÃO DO MERCADO LIVRE =====
// O Mercado Livre libera dois relatórios em Excel: "Conciliação por vendas" (o que foi vendido e cobrado em cada dia)
// e "Conciliação por liberação" (o dinheiro que entrou na conta em cada dia). A planilha é lida aqui no navegador
// (SheetJS, carregado na hora), as tarifas de cada linha são separadas por tipo e as linhas vão para concil_linhas.
// A comparação com as vendas do sistema é feita no banco (RPCs concil_resumo / concil_divergencias).

    let cn = { aba: 'resumo', cob: null, lendo: '', erro: '', res: null, div: null, classe: '', de: '', ate: '', marc: new Set(), dias: null, carregando: false };
    const cnE = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const cnN = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cnR = v => (v < 0 ? '-R$ ' : 'R$ ') + cnN(Math.abs(Number(v) || 0));
    const cnD = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '';
    function cnConta(){ return (typeof contaAtiva !== 'undefined' && contaAtiva) || cn.conta || (cn.cob && cn.cob[0] && cn.cob[0].ml_user_id) || (typeof contasML !== 'undefined' && contasML[0] && contasML[0].id) || ''; }
    function cnScript(src){ return new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('não consegui carregar ' + src)); document.head.appendChild(s); }); }

    // ---------- leitura da planilha ----------
    const cnDin = s => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
    function cnData(v){ const s = String(v == null ? '' : v).trim(); let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if(m) return m[3] + '-' + m[2] + '-' + m[1]; m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : ''; }
    // "Detalhes de tarifas": blocos {Tarifa N  Nome da tarifa: X;  Valor líquido: R$ 1,23; ...}
    function cnTarifas(txt){
      const o = { venda: 0, mp: 0, parcel: 0, envio: 0, dev: 0, outros: 0, nome: '' };
      for(const b of String(txt || '').split('}')){
        const n = (b.match(/Nome da tarifa: ([^;]+);/) || [])[1]; if(!n) continue;
        const m = b.match(/Valor líquido: R\$ ([\d.,-]+)/), v = (m ? cnDin(m[1]) : 0) * (/^(Cancelamento|Anulaci)/i.test(n.trim()) ? -1 : 1);
        if(!o.nome) o.nome = n.trim();
        if(/devolu/i.test(n)) o.dev += v; else if(/envio/i.test(n)) o.envio += v; else if(/parcelamento/i.test(n)) o.parcel += v;
        else if(/vender no Mercado Livre|Tarifa de venda/i.test(n)) o.venda += v; else if(/cobrar no Mercado Pago|recebimento/i.test(n)) o.mp += v; else o.outros += v;
      }
      return o;
    }
    function cnHash(str){ let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for(let i = 0; i < str.length; i++){ const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'); }
    const cn2 = v => Math.round((Number(v) || 0) * 100) / 100;
    // matriz da planilha → linhas de concil_linhas (sem usuário e conta)
    function cnLinhas(m){
      const h = m.findIndex(l => l && l.filter(c => c != null && c !== '').length >= 8); if(h < 0) throw new Error('não encontrei o cabeçalho da planilha');
      const cab = m[h].map(c => String(c == null ? '' : c).replace(/\s+/g, ' ').trim()), c = n => cab.indexOf(n);
      const origem = c('Data da liberação') >= 0 ? 'l' : (c('Data da venda') >= 0 || c('Tipo de operação') >= 0 ? 'v' : '');
      if(!origem || c('Valor líquido após tarifas') < 0) throw new Error('esta planilha não é o relatório de conciliação do Mercado Livre');
      const iData = origem === 'l' ? c('Data da liberação') : c('Data da operação'), vistos = new Map(), out = [];
      for(let i = h + 1; i < m.length; i++){
        const l = m[i]; if(!l) continue; const tipo = l[c('Tipo de operação')]; if(!tipo) continue;
        const data = cnData(l[iData]); if(!data) continue;
        const t = cnTarifas(l[c('Detalhes de tarifas')]), bruto = cn2(l[c('Valor bruto (=)')]), sinal = bruto < 0 ? -1 : 1;
        const r = { origem, data, numero: origem === 'l' ? String(l[c('Número da liberação')] || '') : null, tipo: String(tipo),
          ref: l[c('Número da operação')] != null ? String(l[c('Número da operação')]) : null, envio: l[c('Número do envio')] != null ? String(l[c('Número do envio')]) : null,
          status: l[c('Status da operação')] || null, item_id: l[c('ID do Item')] || null, sku: l[c('SKU')] || null,
          bruto, tarifas: cn2(l[c('Valor total de tarifas (desconto já aplicado)')]), pos: cn2(l[c('Valor total de tarifas pós-pagas')]), liquido: cn2(l[c('Valor líquido após tarifas')]),
          t_venda: cn2(t.venda), t_mp: cn2(t.mp), t_parcel: cn2(t.parcel), t_envio: cn2(t.envio), t_dev: cn2(t.dev), t_outros: cn2(t.outros),
          env_comp: bruto ? cn2(sinal * (Number(l[c('Envio pago pelo comprador (+)')]) || 0)) : 0, parc_comp: bruto ? cn2(sinal * (Number(l[c('Taxa de parcelamento paga pelo comprador (+)')]) || 0)) : 0,
          rebate: cn2(l[c('Desconto do Mercado Livre | Rebate (-)')]), nome: /^(Venda|Envio|Liberação|Estorno)/.test(tipo) ? null : (t.nome || null), periodo: l[c('Período de faturamento')] || null };
        const base = [r.origem, r.data, r.numero, r.tipo, r.ref, r.bruto, r.tarifas, r.pos, r.liquido].join('|'), k = (vistos.get(base) || 0) + 1; vistos.set(base, k);
        r.chave = cnHash(base + '|' + k) + cnHash(k + '|' + base);
        out.push(r);
      }
      return out;
    }

    async function cnEscolher(inp){ const fs = [...(inp.files || [])]; inp.value = ''; for(const f of fs) await cnArquivo(f); }
    async function cnArquivo(file){
      if(!file) return;
      if(!/\.xlsx?$/i.test(file.name || '')){ cn.erro = 'o relatório de conciliação vem em Excel (.xlsx).'; cnDesenhar(); return; }
      cn.erro = ''; cn.lendo = 'Lendo ' + file.name + '… (arquivo grande, pode levar um minuto)'; cnDesenhar();
      try {
        await cnScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        await new Promise(r => setTimeout(r, 50));
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const linhas = cnLinhas(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }));
        if(!linhas.length) throw new Error('a planilha não tem linhas');
        // de qual loja é: procura algumas vendas da planilha nas vendas do sistema
        const refs = [...new Set(linhas.filter(l => /^(Venda|Liberação)$/.test(l.tipo) && /^\d{14,18}$/.test(l.ref || '')).map(l => l.ref))].slice(0, 60);
        let conta = '';
        if(refs.length){ const r = await supa.from('vendas_ml').select('ml_user_id').eq('usuario_id', usuarioAtual.id).in('order_id', refs); const n = {}; (r.data || []).forEach(x => n[x.ml_user_id] = (n[x.ml_user_id] || 0) + 1); conta = Object.keys(n).sort((a, b) => n[b] - n[a])[0] || ''; }
        if(!conta) throw new Error('não reconheci de qual loja é esta planilha: nenhuma venda dela está no sistema. Confira se a conta do Mercado Livre está conectada e com as vendas do período sincronizadas.');
        const nomeConta = typeof contaNome === 'function' ? (contaNome(conta) || conta) : conta;
        let feito = 0; const lote = 800, total = linhas.length;
        for(let i = 0; i < total; i += lote * 3){
          const partes = [0, 1, 2].map(j => linhas.slice(i + j * lote, i + (j + 1) * lote)).filter(p => p.length);
          const rs = await Promise.all(partes.map(p => supa.from('concil_linhas').upsert(p.map(x => ({ ...x, usuario_id: usuarioAtual.id, ml_user_id: conta })), { onConflict: 'usuario_id,ml_user_id,chave', ignoreDuplicates: true })));
          const e = rs.find(x => x.error); if(e) throw new Error(e.error.message);
          feito += partes.reduce((s, p) => s + p.length, 0); cn.lendo = 'Gravando ' + nomeConta + ': ' + feito.toLocaleString('pt-BR') + ' de ' + total.toLocaleString('pt-BR') + ' linhas…'; cnDesenhar();
        }
        cn.conta = conta; cn.cob = null; cn.res = null; cn.div = null; cn.dias = null; cn.lendo = '';
        if(typeof toast === 'function') toast('Relatório importado: ' + total.toLocaleString('pt-BR') + ' linhas de ' + nomeConta + '.');
        await cnRender();
      } catch(e){ cn.lendo = ''; cn.erro = String(e && e.message || e); cnDesenhar(); }
    }

    // ---------- tela ----------
    const CN_CLASSE = {
      canc_cobrada: { r: 'Cancelada com cobrança', d: 'A venda foi cancelada, mas o Mercado Livre ficou com frete ou tarifa de devolução.' },
      estornada:    { r: 'Paga, com dinheiro estornado', d: 'O valor foi liberado e retirado depois, e a venda continua como paga. Costuma ser reclamação em aberto.' },
      nao_liberada: { r: 'Paga e não liberada', d: 'Venda paga há mais de 20 dias que ainda não teve o dinheiro liberado (ou teve menos da metade).' },
      frete:        { r: 'Frete diferente', d: 'O frete cobrado pelo Mercado Livre é diferente do que o sistema gravou na venda.' },
      tarifa:       { r: 'Tarifa diferente', d: 'A tarifa de venda cobrada é diferente da que o sistema gravou (em geral, desconto de campanha na tarifa).' },
      produto:      { r: 'Valor da venda diferente', d: 'O Mercado Livre registrou um valor de venda diferente do sistema: cupom, reembolso parcial ou quantidade.' },
      devolucao:    { r: 'Tarifa de devolução', d: 'Foi cobrada tarifa de devolução numa venda que continua paga.' },
    };
    const CN_AVULSA = { 'Anúncios MClicks': 'Publicidade (Product Ads)', 'Armazenamento Full': 'Armazenagem no Full', 'Cobrança de DIFAL': 'DIFAL (imposto interestadual)', 'Inconformidade no envio ao Full': 'Multa por envio fora do padrão ao Full', 'Estoque antigo no Full': 'Estoque antigo no Full', 'Movimentações de empréstimo': 'Juros de empréstimo do Mercado Pago', 'E-Shop': 'Mensalidade da Minha página' };

    // planilha × fatura lida pela API (src/fatura-ml.js): cada tipo da planilha cai numa classe da fatura
    const CN_FATURA = { 'Anúncios MClicks': 'pub', 'Armazenamento Full': 'full', 'Estoque antigo no Full': 'full', 'Inconformidade no envio ao Full': 'full', 'Cobrança de DIFAL': 'difal', 'E-Shop': 'loja' };
    const CN_FATURA_NOME = { pub: 'Publicidade, já sem a bonificação', full: 'Full: armazenagem, estoque antigo e multas', difal: 'DIFAL', loja: 'Mensalidade da loja' };
    function cnFaturaQuadro(avulsas){
      if(!cn.fat) return '';
      const pl = {}, fa = {};
      avulsas.forEach(a => { const k = CN_FATURA[a.tipo]; if(k) pl[k] = (pl[k] || 0) + Number(a.valor || 0); });
      cn.fat.forEach(x => { if(CN_FATURA_NOME[x.classe]) fa[x.classe] = (fa[x.classe] || 0) + Number(x.valor || 0); });
      const ks = Object.keys(CN_FATURA_NOME).filter(k => pl[k] || fa[k]);
      if(!ks.length) return '';
      const semFatura = !cn.fat.length;
      return `<div class="card"><div class="card-header"><div class="card-title">Planilha × fatura lida direto do Mercado Livre</div></div>
        <div class="text-muted" style="margin-bottom:10px;">A fatura é lida sozinha, todo dia, e é ela que alimenta o DRE quando você escolhe a entrada automática. Aqui os dois números ficam lado a lado, somando as cobranças de ${cnD(cn.de)} a ${cnD(cn.ate)}.</div>
        ${semFatura ? '<div class="alert alert-info">A fatura deste período ainda não foi lida. A primeira leitura leva cerca de uma hora.</div>' : `<div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Cobrança</th><th class="num">Na planilha</th><th class="num">Na fatura</th><th class="num">Diferença</th><th></th></tr></thead><tbody>
        ${ks.map(k => { const a = pl[k] || 0, b = fa[k] || 0, d = Math.round((b - a) * 100) / 100, ok = Math.abs(d) < 0.05;
          return `<tr><td><b>${CN_FATURA_NOME[k]}</b></td><td class="num">${cnR(a)}</td><td class="num">${cnR(b)}</td><td class="num" style="font-weight:700;${ok ? '' : 'color:var(--danger);'}">${ok ? '–' : cnR(d)}</td><td>${ok ? '<span class="v-tag conta">confere</span>' : '<span class="v-tag">diferente</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>`}</div>`;
    }
    async function cnRender(){
      const view = document.getElementById('view-conciliacao'); if(!view) return;
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      if(cn.cob === null){ cn.carregando = true; cnDesenhar(); const r = await supa.rpc('concil_cobertura'); cn.cob = r.data || []; }
      const conta = cnConta(), cv = cn.cob.find(x => x.ml_user_id === conta && x.origem === 'v') || cn.cob.find(x => x.ml_user_id === conta);
      if(cv && (!cn.de || cn.contaPer !== conta)){ cn.de = cv.de; cn.ate = cv.ate; cn.contaPer = conta; cn.res = null; cn.div = null; }
      if(cv && !cn.res){
        cn.carregando = true; cn.erro = ''; cnDesenhar();
        const [a, b, f] = await Promise.all([supa.rpc('concil_resumo', { p_de: cn.de, p_ate: cn.ate, p_conta: conta }), supa.rpc('concil_divergencias', { p_de: cn.de, p_ate: cn.ate, p_conta: conta }), supa.rpc('ml_fatura_detalhe', { p_de: cn.de, p_ate: cn.ate, p_conta: conta })]);
        if(a.error || b.error) cn.erro = (a.error || b.error).message; else { cn.res = a.data || {}; cn.div = b.data || []; cn.fat = f.error ? null : (f.data || []); }
      }
      cn.carregando = false; cnDesenhar();
    }
    function cnPeriodo(){ const de = document.getElementById('cn-de').value, ate = document.getElementById('cn-ate').value; if(!de || !ate || de > ate) return; cn.de = de; cn.ate = ate; cn.res = null; cn.div = null; cnRender(); }
    function cnAba(a){ cn.aba = a; cnDesenhar(); }
    function cnClasse(c){ cn.classe = c; cnDesenhar(); }
    function cnDetalhe(x){
      const p = [];
      if(x.classes.includes('canc_cobrada')) p.push('frete cobrado ' + cnR(x.m_fre) + (Number(x.m_dev) ? ' · devolução ' + cnR(x.m_dev) : ''));
      if(x.classes.includes('estornada')) p.push('estornado ' + cnR(-x.lib_est) + (x.lib_em ? ' em ' + cnD(x.lib_em) : ''));
      if(x.classes.includes('nao_liberada')) p.push(x.lib == null ? 'nenhuma liberação no relatório' : 'liberado até agora ' + cnR(x.lib));
      if(x.classes.includes('frete')) p.push('frete: sistema ' + cnR(x.s_fre) + ' · Mercado Livre ' + cnR(x.m_fre));
      if(x.classes.includes('tarifa')) p.push('tarifa: sistema ' + cnR(x.s_tar) + ' · Mercado Livre ' + cnR(x.m_tar));
      if(x.classes.includes('produto')) p.push('venda: sistema ' + cnR(x.s_prod) + ' · Mercado Livre ' + cnR(x.m_prod));
      if(x.classes.includes('devolucao')) p.push('tarifa de devolução ' + cnR(x.m_dev));
      return p.join(' · ');
    }
    // maiores diferenças primeiro
    function cnVisiveis(){ return (cn.div || []).filter(x => !cn.classe || x.classes.includes(cn.classe)).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)); }
    async function cnExcel(){
      try {
        await cnScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        const L = cnVisiveis(), aoa = [['Data', 'Venda', 'SKU', 'Produto', 'Motivo', 'Detalhe', 'Esperado pelo sistema', 'Liberado', 'Diferença (positivo = contra você)']];
        L.forEach(x => aoa.push([cnD(x.dia), x.order_id, x.sku || '', x.titulo || '', x.classes.map(c => CN_CLASSE[c].r).join('; '), cnDetalhe(x), Number(x.esperado) || 0, x.lib == null ? '' : Number(x.lib), Number(x.valor) || 0]));
        const ws = window.XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [10, 20, 18, 46, 30, 60, 14, 12, 14].map(w => ({ wch: w }));
        const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Divergências');
        window.XLSX.writeFile(wb, 'conciliacao_' + cn.de + '_a_' + cn.ate + '.xlsx');
      } catch(e){ if(typeof toast === 'function') toast('Não consegui gerar a planilha: ' + (e.message || e)); }
    }
    async function cnApagar(conta, origem, de, ate){
      if(!confirm('Apagar do sistema o relatório ' + (origem === 'v' ? 'por vendas' : 'por liberação') + ' de ' + cnD(de) + ' a ' + cnD(ate) + '? As planilhas no seu computador não são afetadas, e você pode importar de novo.')) return;
      const r = await supa.rpc('concil_apagar', { p_conta: conta, p_origem: origem, p_de: de, p_ate: ate });
      if(r.error){ if(typeof toast === 'function') toast('Não consegui apagar: ' + r.error.message); return; }
      cn.cob = null; cn.res = null; cn.div = null; cn.de = ''; cnRender();
    }

    function cnDesenhar(){
      const view = document.getElementById('view-conciliacao'); if(!view) return;
      const cab = `<div class="pg-head"><div><div class="pg-title">Conciliação do Mercado Livre</div><div class="pg-sub">Envie os dois relatórios de conciliação que o Mercado Livre libera (por vendas e por liberação). O sistema confere venda por venda com o que ele próprio gravou e mostra onde o dinheiro não fechou.</div></div>
        <label class="btn btn-sm" style="cursor:pointer;margin:0;">Enviar relatório (Excel)<input type="file" id="cn-arq" accept=".xlsx,.xls" multiple aria-label="Relatório de conciliação em Excel" style="display:none" onchange="cnEscolher(this)"></label></div>`;
      if(cn.lendo){ view.innerHTML = cab + `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>${cnE(cn.lendo)}</b></div></div>`; return; }
      const erro = cn.erro ? `<div class="alert alert-danger">Não consegui: ${cnE(cn.erro)}</div>` : '';
      if(cn.carregando && !cn.res){ view.innerHTML = cab + erro + `<div class="card"><div class="carregando-msg"><span class="carregando-roda"></span><b>Conferindo as vendas…</b></div></div>`; return; }
      const conta = cnConta(), cob = (cn.cob || []).filter(x => x.ml_user_id === conta), nome = k => (typeof contaNome === 'function' && contaNome(k)) || k;
      if(!cob.length){
        const outras = [...new Set((cn.cob || []).map(x => x.ml_user_id))];
        view.innerHTML = cab + erro + `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>Nenhum relatório importado${conta ? ' para ' + cnE(nome(conta)) : ''}</b>
          No Mercado Livre, abra Faturamento → Relatórios → Conciliação, gere os relatórios "por vendas" e "por liberação" do mês e envie os dois arquivos aqui.${outras.length ? '<br>Já há relatório de: ' + outras.map(k => cnE(nome(k))).join(', ') + '. Troque a conta no seletor do menu para ver.' : ''}</div></div>`;
        return;
      }
      const R = cn.res || {}, D = cn.div || [], contra = D.filter(x => x.valor > 0).reduce((s, x) => s + Number(x.valor), 0), favor = D.filter(x => x.valor < 0).reduce((s, x) => s - Number(x.valor), 0);
      const avulsas = (R.avulsas || []), totAv = avulsas.reduce((s, a) => s + Number(a.valor || 0), 0), ok = Math.max(0, (R.conferidas || 0) - D.length);
      const porClasse = {}; D.forEach(x => x.classes.forEach(c => { porClasse[c] = porClasse[c] || { n: 0, v: 0 }; porClasse[c].n++; porClasse[c].v += Number(x.valor) || 0; }));
      const temL = cob.some(x => x.origem === 'l'), temV = cob.some(x => x.origem === 'v');
      const falta = !temV ? 'Falta o relatório "por vendas": sem ele não dá para conferir tarifa e frete.' : (!temL ? 'Falta o relatório "por liberação": sem ele não dá para ver o que foi liberado, estornado ou retido.' : '');
      const cartoes = `<div class="kpi-grid k4i">
        <div class="kpi k-venda"><div class="kpi-label">Vendas conferidas</div><div class="kpi-value">${(R.conferidas || 0).toLocaleString('pt-BR')}</div><div class="kpi-sub"><span>de ${(R.vendas || 0).toLocaleString('pt-BR')} no período · ${ok.toLocaleString('pt-BR')} sem diferença</span></div></div>
        <div class="kpi k-atraso"><div class="kpi-label">Contra você</div><div class="kpi-value" style="color:var(--danger)">${cnR(contra)}</div><div class="kpi-sub"><span>${D.filter(x => x.valor > 0).length} vendas em que entrou menos do que o esperado</span></div></div>
        <div class="kpi k-mc"><div class="kpi-label">A seu favor</div><div class="kpi-value" style="color:var(--success,#16a34a)">${cnR(favor)}</div><div class="kpi-sub"><span>${D.filter(x => x.valor < 0).length} vendas em que o custo real foi menor</span></div></div>
        <div class="kpi k-hoje"><div class="kpi-label">Cobranças fora das vendas</div><div class="kpi-value">${cnR(totAv)}</div><div class="kpi-sub"><span>publicidade, armazenagem, impostos e juros</span></div></div>
      </div>`;
      const abas = `<div class="chips" style="margin:14px 0 10px;">${[['resumo', 'Resumo'], ['div', 'Vendas que não fecharam (' + D.length + ')'], ['avulsas', 'Cobranças fora das vendas'], ['dias', 'Dinheiro liberado por dia'], ['arquivos', 'Relatórios importados']].map(([k, t]) => `<button class="chip ${cn.aba === k ? 'active' : ''}" onclick="cnAba('${k}')">${t}</button>`).join('')}</div>`;
      const periodo = `<div class="card" style="padding:12px 16px;"><div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;"><b>${cnE(nome(conta))}</b><span class="text-muted">vendas de</span><input type="date" id="cn-de" value="${cn.de}" onchange="cnPeriodo()" aria-label="Data inicial" style="width:auto;"><span class="text-muted">até</span><input type="date" id="cn-ate" value="${cn.ate}" onchange="cnPeriodo()" aria-label="Data final" style="width:auto;">${cn.carregando ? '<span class="text-muted">conferindo…</span>' : ''}</div></div>`;
      let corpo = '';
      if(cn.aba === 'resumo'){
        const ordem = ['canc_cobrada', 'estornada', 'nao_liberada', 'devolucao', 'frete', 'produto', 'tarifa'].filter(c => porClasse[c]);
        corpo = `<div class="card"><div class="card-header"><div class="card-title">O que não fechou</div></div>
          ${ordem.length ? `<div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Motivo</th><th>O que significa</th><th class="num">Vendas</th><th class="num" title="Positivo = contra você">Diferença</th><th></th></tr></thead><tbody>
            ${ordem.map(c => `<tr><td><b>${CN_CLASSE[c].r}</b></td><td class="text-muted">${CN_CLASSE[c].d}</td><td class="num">${porClasse[c].n}</td><td class="num" style="font-weight:700;color:${porClasse[c].v > 0 ? 'var(--danger)' : 'var(--success,#16a34a)'}">${cnR(porClasse[c].v)}</td><td style="text-align:right;"><button class="btn-out btn-sm" onclick="cn.classe='${c}';cnAba('div')">Ver vendas</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="vazio"><b>Tudo fechou</b>Nenhuma diferença entre o sistema e o Mercado Livre neste período.</div>'}</div>
          <div class="card"><div class="card-header"><div class="card-title">Tarifa e frete: sistema x Mercado Livre</div></div>
          <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th></th><th class="num">Gravado no sistema</th><th class="num">Cobrado pelo Mercado Livre</th><th class="num">Diferença</th></tr></thead><tbody>
            <tr><td><b>Tarifa de venda</b></td><td class="num">${cnR(R.s_tar)}</td><td class="num">${cnR(R.m_tar)}</td><td class="num">${cnR((R.m_tar || 0) - (R.s_tar || 0))}</td></tr>
            <tr><td><b>Frete do vendedor</b></td><td class="num">${cnR(R.s_fre)}</td><td class="num">${cnR(R.m_fre)}</td><td class="num">${cnR((R.m_fre || 0) - (R.s_fre || 0))}</td></tr>
          </tbody></table></div><div class="text-muted" style="font-size:12.5px;padding:8px 2px 0;">Só entram as vendas em que o relatório já traz a cobrança (o frete é lançado quando o pacote sai; vendas do fim do mês aparecem no relatório seguinte).</div></div>`;
      } else if(cn.aba === 'div'){
        const L = cnVisiveis(), tot = L.reduce((s, x) => s + Number(x.valor || 0), 0), max = 400;
        corpo = `<div class="card"><div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;justify-content:space-between;margin-bottom:10px;">
          <div class="chips"><button class="chip ${!cn.classe ? 'active' : ''}" onclick="cnClasse('')">Todos (${D.length})</button>${Object.keys(CN_CLASSE).filter(c => porClasse[c]).map(c => `<button class="chip ${cn.classe === c ? 'active' : ''}" title="${cnE(CN_CLASSE[c].d)}" onclick="cnClasse('${c}')">${CN_CLASSE[c].r} (${porClasse[c].n})</button>`).join('')}</div>
          <button class="btn-out btn-sm" onclick="cnExcel()">Baixar em Excel</button></div>
          ${cn.classe ? `<div class="text-muted" style="margin-bottom:8px;">${CN_CLASSE[cn.classe].d}</div>` : ''}
          ${L.length ? `<div style="overflow-x:auto;"><table class="cp-tab" data-colk="concil-div"><thead><tr><th>Data</th><th>Venda</th><th>Produto</th><th>Motivo</th><th class="num" title="Valor do produto menos tarifa e frete, pelo que o sistema gravou">Esperado</th><th class="num" title="O que o relatório de liberação mostra para esta venda">Liberado</th><th class="num" title="Positivo = contra você">Diferença</th></tr></thead><tbody>
            ${L.slice(0, max).map(x => `<tr><td>${cnD(x.dia)}</td><td><a href="https://www.mercadolivre.com.br/vendas/${cnE(x.order_id)}/detalhe" target="_blank" rel="noopener">${cnE(x.order_id)}</a>${x.vendas > 1 ? '<br><small class="text-muted">carrinho com ' + x.vendas + ' vendas</small>' : ''}</td><td>${x.sku && typeof fotoCel === 'function' ? '<span style="float:left;margin-right:9px;">' + fotoCel(x.sku) + '</span>' : ''}<b>${cnE(x.sku || '—')}</b><br><small class="text-muted">${cnE(String(x.titulo || '').slice(0, 60))}</small></td>
              <td>${x.classes.map(c => CN_CLASSE[c].r).join(' · ')}<br><small class="text-muted">${cnE(cnDetalhe(x))}</small></td><td class="num">${x.status === 'cancelled' ? '—' : cnR(x.esperado)}</td><td class="num">${x.lib == null ? '—' : cnR(x.lib)}</td><td class="num" style="font-weight:700;color:${x.valor > 0 ? 'var(--danger)' : 'var(--success,#16a34a)'}">${cnR(x.valor)}</td></tr>`).join('')}
            </tbody><tfoot><tr><td colspan="6"><b>Total (${L.length} vendas)</b></td><td class="num"><b>${cnR(tot)}</b></td></tr></tfoot></table></div>${L.length > max ? `<div class="text-muted" style="padding-top:8px;">Mostrando as primeiras ${max}. O Excel traz todas.</div>` : ''}` : '<div class="vazio"><b>Nenhuma venda neste filtro</b></div>'}</div>`;
      } else if(cn.aba === 'avulsas'){
        corpo = `<div class="card"><div class="card-header"><div class="card-title">Cobranças que não aparecem em venda nenhuma</div></div>
          <div class="text-muted" style="margin:0 20px 10px;">São valores que o Mercado Livre cobra na fatura ou desconta do saldo e que não entram na margem de nenhuma venda. Para o lucro do mês ficar certo, precisam estar no seu DRE.</div>
          ${avulsas.length ? `<div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Cobrança</th><th>Como aparece no relatório</th><th class="num">Lançamentos</th><th class="num">Valor</th></tr></thead><tbody>
            ${avulsas.map(a => `<tr><td><b>${cnE(CN_AVULSA[a.tipo] || a.tipo)}</b></td><td class="text-muted">${cnE(a.nome)}</td><td class="num">${a.n}</td><td class="num" style="font-weight:700;">${cnR(a.valor)}</td></tr>`).join('')}
            </tbody><tfoot><tr><td colspan="3"><b>Total do período</b></td><td class="num"><b>${cnR(totAv)}</b></td></tr></tfoot></table></div>` : '<div class="vazio"><b>Nenhuma cobrança fora das vendas no período</b>Este quadro vem do relatório "por vendas".</div>'}</div>` + cnFaturaQuadro(avulsas);
      } else if(cn.aba === 'dias'){
        const dias = {}; (R.dias || []).forEach(x => { const d = dias[x.data] = dias[x.data] || { lib: 0, est: 0, env: 0, cash: 0, sai: 0, outros: 0 }; const v = Number(x.v) || 0;
          if(x.tipo === 'Liberação') d.lib += v; else if(x.tipo === 'Estorno de liberação') d.est += v; else if(/envio/i.test(x.tipo)) d.env += v; else if(x.tipo === 'Cashback') d.cash += v; else if(/Cofrinhos|Pagamento de crédito|Transferência/i.test(x.tipo)) d.sai += v; else d.outros += v; });
        const ks = Object.keys(dias).sort(), T = ks.reduce((s, k) => { for(const c in dias[k]) s[c] = (s[c] || 0) + dias[k][c]; return s; }, { lib: 0, est: 0, env: 0, cash: 0, sai: 0, outros: 0 });
        const lin = d => { const entrou = d.lib + d.est + d.env + d.cash + d.outros; return `<td class="num">${cnR(d.lib)}</td><td class="num" style="${d.est < 0 ? 'color:var(--danger)' : ''}">${cnR(d.est)}</td><td class="num">${cnR(d.env)}</td><td class="num">${cnR(d.cash)}</td><td class="num"><b>${cnR(entrou)}</b></td><td class="num text-muted">${cnR(d.sai)}</td>`; };
        corpo = `<div class="card"><div class="card-header"><div class="card-title">Dinheiro liberado por dia</div></div>
          <div class="text-muted" style="margin:0 20px 10px;">Pela data em que o dinheiro entrou na conta do Mercado Pago, não pela data da venda. "Saídas" são reservas, pagamentos de crédito e transferências que você mesmo fez: não são custo.</div>
          ${ks.length ? `<div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Dia</th><th class="num">Vendas liberadas</th><th class="num">Estornos</th><th class="num" title="Frete pago pelo comprador, liberado à parte">Frete</th><th class="num">Cashback</th><th class="num">Entrou no dia</th><th class="num">Saídas</th></tr></thead><tbody>
            ${ks.map(k => `<tr><td>${cnD(k)}</td>${lin(dias[k])}</tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td>${lin(T)}</tr></tfoot></table></div>` : '<div class="vazio"><b>Sem liberações no período</b>Este quadro vem do relatório "por liberação".</div>'}</div>`;
      } else {
        corpo = `<div class="card"><div class="card-header"><div class="card-title">Relatórios importados</div></div><div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Loja</th><th>Relatório</th><th>Período coberto</th><th class="num">Linhas</th><th></th></tr></thead><tbody>
          ${(cn.cob || []).map(x => `<tr><td><b>${cnE(nome(x.ml_user_id))}</b></td><td>${x.origem === 'v' ? 'Por vendas' : 'Por liberação'}</td><td>${cnD(x.de)} a ${cnD(x.ate)}</td><td class="num">${Number(x.linhas).toLocaleString('pt-BR')}</td><td style="text-align:right;"><button class="btn-out btn-sm" onclick="cnApagar('${cnE(x.ml_user_id)}','${x.origem}','${x.de}','${x.ate}')">Apagar</button></td></tr>`).join('')}
          </tbody></table></div><div class="text-muted" style="font-size:12.5px;padding:8px 20px 12px;">Pode enviar o mesmo arquivo de novo ou meses que se sobrepõem: o sistema não duplica as linhas.</div></div>`;
      }
      view.innerHTML = cab + erro + (falta ? `<div class="alert alert-warning">${falta}</div>` : '') + periodo + cartoes + abas + corpo;
    }
