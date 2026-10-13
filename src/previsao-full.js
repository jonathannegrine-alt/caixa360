// ===== PREVISÃO DE ENVIOS AO FULL (página própria: menu Produtos e estoque → Previsão de Full) =====
// Para quem precisa agendar o envio antes de o Mercado Livre publicar a sugestão da semana.
// Regra (versão 1, declarada na tela e afinada com os relatórios importados):
//   ritmo        = 40% do ritmo dos últimos 7 dias + 60% do ritmo dos últimos 30 dias (unidades por dia, só Full);
//                  produto zerado no Full: os 30 dias são divididos só pelos dias em que houve venda (corrige a ruptura)
//   aceleração   = se a última semana vendeu mais que a anterior, o ritmo sobe (no máximo 35%)
//   sazonalidade = quanto o produto vendeu nos próximos N dias do ano passado ÷ o que vendia nas duas semanas
//                  equivalentes (entre 0,8 e 2,5; só quando há venda suficiente no ano passado)
//   previsão     = ritmo × aceleração × sazonalidade × dias de cobertura
//   enviar       = previsão − aptas no Full − a caminho (arredondado para cima)
// Estoque: o da última importação do relatório do ML; sem relatório, o do Estoque Full já carregado no sistema.
// Importação: "Relatório de Planejamento de envios" ou "Relatório geral de estoque" (aba Resumo) → tabela full_sugestoes.
    let pfl = { chave: '', base: [], sug: [], refs: [], dias: 34, prazo: 14, erro: '', lendo: false, msg: '', sel: {}, qtd: {}, filtro: 'todos', fotos: {}, ruptura: false };
    const PFL_FILTROS = [['todos', 'Todos'], ['enviar', 'Com envio'], ['urgente', 'Enviar agora'], ['semana', 'Enviar em até 7 dias'], ['zerado', 'Zerados no Full'], ['sem', 'Sem necessidade']];
    // marcado para o envio? (padrão: tudo que tem quantidade a enviar) e quantidade (padrão: a calculada; pode ser trocada à mão)
    function pflSel(l){ return pfl.sel[l.sku] !== undefined ? pfl.sel[l.sku] : l.enviar > 0; }
    function pflQtd(l){ return pfl.qtd[l.sku] != null ? pfl.qtd[l.sku] : l.enviar; }
    function pflMarcar(sku, v){ pfl.sel[sku] = !!v; pflResumoSel(); }
    function pflSelTodos(v){ pflFiltrar(pflLinhas()).forEach(l => { pfl.sel[l.sku] = !!v; }); pflPagina(); }
    function pflQtdMudar(sku, v){ const n = Math.max(0, Math.round(Number(v) || 0)); pfl.qtd[sku] = n; if(n > 0) pfl.sel[sku] = true; pflResumoSel(); }
    function pflFiltro(f){ pfl.filtro = f; pflPagina(); }
    // dias até a data-limite de envio: quando acaba menos a antecedência necessária
    function pflAte(l){ return l.acaba == null ? null : l.acaba - pfl.prazo; }
    function pflFiltrar(T){ const f = pfl.filtro;
      return T.filter(l => f === 'enviar' ? l.enviar > 0 : f === 'urgente' ? l.enviar > 0 && pflAte(l) != null && pflAte(l) <= 0 : f === 'semana' ? l.enviar > 0 && pflAte(l) != null && pflAte(l) <= 7 : f === 'zerado' ? l.aptas === 0 : f === 'sem' ? l.enviar === 0 : true); }
    function pflResumoSel(){ const el = document.getElementById('pfl-sel'); if(!el) return; const S = pflLinhas().filter(l => pflSel(l) && pflQtd(l) > 0);
      el.textContent = S.length + ' produto' + (S.length === 1 ? '' : 's') + ' marcado' + (S.length === 1 ? '' : 's') + ' · ' + S.reduce((s, l) => s + pflQtd(l), 0).toLocaleString('pt-BR') + ' unidades'; }
    const pflE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const pflN = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    const pflNum = v => typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
    const PFL_MES = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

    async function pflCarregar(chave, conta){
      pfl.erro = '';
      if(!conta){ pfl.base = []; pfl.sug = []; pfl.chave = chave; return; }
      const [b, r] = await Promise.all([supa.rpc('full_previsao_base', { p_conta: conta, p_dias: pfl.dias }),
        supa.from('full_sugestoes').select('referencia').eq('usuario_id', usuarioAtual.id).eq('ml_user_id', conta).order('referencia', { ascending: false }).limit(400)]);
      if(b.error){ pfl.erro = b.error.message; return; }
      pfl.base = b.data || []; pfl.refs = [...new Set((r.data || []).map(x => x.referencia))];
      pfl.sug = [];
      if(pfl.refs.length){ const s = await supa.from('full_sugestoes').select('*').eq('usuario_id', usuarioAtual.id).eq('ml_user_id', conta).eq('referencia', pfl.refs[0]).limit(2000); pfl.sug = s.data || []; }
      // foto de cada produto (cadastro, anúncio ou última venda)
      pfl.fotos = {};
      try { const skus = [...new Set([...pfl.base.map(x => x.sku), ...pfl.sug.map(x => String(x.sku).toUpperCase())])];
        if(skus.length){ const f = await supa.rpc('sku_fotos', { p_skus: skus }); (f.data || []).forEach(x => { pfl.fotos[String(x.sku).toUpperCase()] = String(x.foto || '').replace(/^http:/, 'https:'); }); } } catch(e){}
      pfl.chave = chave;
    }
    // conta da previsão por produto
    function pflLinhas(){
      const sug = new Map(pfl.sug.map(s => [String(s.sku).toUpperCase(), s]));
      const full = new Map((typeof estoqueFullML !== 'undefined' && Array.isArray(estoqueFullML) ? estoqueFullML : []).map(e => [String(e.sku || '').trim().toUpperCase(), e]));
      const skus = new Set([...pfl.base.map(b => b.sku), ...sug.keys()]);
      const L = [];
      skus.forEach(k => {
        const b = pfl.base.find(x => x.sku === k) || { s7: 0, s7ant: 0, s30: 0, d30: 0, ano_base: 0, ano_prox: 0, ano_dias: pfl.dias }, s = sug.get(k), f = full.get(k);
        const aptas = s ? Number(s.aptas) || 0 : (f ? Number(f.aptos_venda) || 0 : 0), caminho = s ? Number(s.caminho) || 0 : (f ? (Number(f.em_separacao) || 0) + (Number(f.em_transito) || 0) : 0);
        // 6 semanas de venda (a mais recente por último), como no "Histórico de vendas semanais" do Mercado Livre
        const sem = Array.isArray(b.sem) && b.sem.length === 6 ? b.sem.map(Number) : [0, 0, 0, 0, Number(b.s7ant) || 0, Number(b.s7) || 0];
        const s7 = sem[5], s7a = sem[4], s30 = Number(b.s30) || 0, d30 = Number(b.d30) || 0, est = aptas + caminho;
        if(!s30 && !sem.some(x => x) && !(s && s.sugestao)) return;
        // média das 6 semanas. O Mercado Livre NÃO corrige a falta de estoque (vídeo oficial "Desmistificando Full EP 02": sem estoque as vendas
        // param e a recomendação fica menor que o potencial). Com pfl.ruptura ligado, produto zerado conta só as semanas em que vendeu.
        const comVenda = sem.filter(x => x > 0).length, media = sem.reduce((x, y) => x + y, 0) / (pfl.ruptura && aptas === 0 ? Math.max(comVenda, 3) : 6);
        // tendência: quanto as 2 últimas semanas passam da média (o ML mostra "+N% por alta demanda"); entra amortecida, até +40%
        const ult2 = (sem[4] + sem[5]) / 2, tend = media > 0 && aptas > 0 ? Math.max(0, Math.min(0.4, 0.6 * (ult2 / media - 1))) : 0, acel = 1 + tend, ritmo = media / 7;
        const base = Number(b.ano_base) || 0, prox = Number(b.ano_prox) || 0, n = Number(b.ano_dias) || pfl.dias;
        const saz = base >= 20 && prox > 0 ? Math.max(0.8, Math.min(2.5, (prox / n) / (base / 14))) : 1;
        const porSemana = media * acel * saz, porDia = porSemana / 7, previsao = porDia * pfl.dias;
        // cobertura em semanas e urgência (faixas medidas na tela do ML: até 2 semanas, até 4, até 4,6; acima disso não pede envio)
        const cob = porSemana > 0 ? est / porSemana : null, urgN = cob == null ? '' : cob < 2 ? 'esta semana' : cob < 4 ? 'próxima semana' : cob < 4.6 ? 'em 2 semanas' : 'sem urgência';
        // o envio é um lote de N dias de venda (não "até completar"): só quando a cobertura está abaixo de 4,6 semanas; com menos de uma semana de estoque leva até uma semana a mais
        let enviar = cob != null && cob < 4.6 ? previsao + (cob < 1 ? (1 - cob) * porSemana : 0) : 0;
        enviar = enviar >= 100 ? Math.round(enviar / 10) * 10 : Math.ceil(enviar);
        const acaba = porDia > 0 ? est / porDia : null;
        L.push({ sku: k, titulo: (s && s.produto) || b.titulo || '', sem, tend, urgN, cob, s7, s7a, s30, d30, aptas, caminho, ritmo, acel, saz, porDia, previsao, enviar, acaba, novo: false,
          cod: (s && s.inventory_id) || '', ml: s ? Number(s.sugestao) || 0 : null, urg: s ? s.urgencia : '', estrela: s ? !!s.estrela : false, temEstoque: !!(s || f) });
      });
      return L.sort((a, b) => (a.acaba == null ? 9999 : a.acaba) - (b.acaba == null ? 9999 : b.acaba));
    }
    function pflDia(n){ const d = new Date(); d.setDate(d.getDate() + Math.round(n)); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
    function pflCorpo(){
      const conta = typeof contaParam === 'function' ? contaParam() : null;
      if(!conta) return `<div class="card"><div class="card-body"><b>Escolha uma loja</b> no seletor do alto do menu para ver a previsão de envios ao Full. Cada loja tem o seu estoque e a sua previsão.</div></div>`;
      if(pfl.erro) return `<div class="alert alert-warning">${pflE(pfl.erro)}</div>`;
      const T = pflLinhas(), L = T, comML = T.filter(l => l.ml != null), ref = pfl.refs[0], F = pflFiltrar(T), S = T.filter(l => pflSel(l) && pflQtd(l) > 0);
      const totEnviar = L.reduce((s, l) => s + l.enviar, 0), urgentes = L.filter(l => l.enviar > 0 && l.acaba != null && l.acaba <= pfl.prazo).length;
      // acerto contra o Mercado Livre na última importação: soma das diferenças ÷ soma das sugestões
      const dif = comML.reduce((s, l) => s + Math.abs(l.enviar - l.ml), 0), totML = comML.reduce((s, l) => s + l.ml, 0), acerto = totML > 0 ? Math.max(0, 100 - dif / totML * 100) : null;
      const semEst = L.length && !L.some(l => l.temEstoque);
      const dc = t => typeof dica === 'function' ? ' ' + dica(t) : '';
      return `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div><div class="card-title">Previsão de envios ao Full</div><div class="text-muted" style="font-size:12px;">Quanto mandar de cada produto para cobrir o período escolhido, com base no ritmo de venda, na aceleração e no mesmo período do ano passado.</div></div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;font-size:12px;">
            <label>Cobrir <input type="number" min="7" max="120" value="${pfl.dias}" style="width:64px;" onchange="pflParam('dias', this.value)"> dias</label>
            <label>Agendar com <input type="number" min="0" max="60" value="${pfl.prazo}" style="width:58px;" onchange="pflParam('prazo', this.value)"> dias de antecedência${dc('Quantos dias antes você precisa marcar o envio (agendamento no galpão mais o tempo até o Full receber). Produto que acaba antes disso aparece como urgente.')}</label>
            <label class="btn-out btn btn-sm" style="cursor:pointer;">Importar relatório do Mercado Livre<input type="file" accept=".xlsx" style="display:none;" onchange="pflImportar(this)"></label>
            <button class="btn btn-sm" onclick="pflPdf(this)" title="Lista do que enviar, com foto, código do Full, SKU e quantidade, para mandar ao galpão.">Baixar PDF do envio</button>
            <button class="btn-out btn btn-sm" onclick="pflExportar()">Planilha</button></div></div>
        <div class="card-body">
          ${pfl.msg ? `<div class="alert alert-info">${pflE(pfl.msg)}</div>` : ''}
          ${semEst ? '<div class="alert alert-warning">Não achei o estoque do Full desta loja: importe o relatório do Mercado Livre (botão acima) ou abra Estoque → Full para carregar. Sem o estoque, a coluna "Enviar" mostra a previsão cheia.</div>' : ''}
          <div class="adm-nums"><div><small>Unidades a enviar</small><b>${pflN(totEnviar)}</b></div><div><small>Produtos que acabam em até ${pfl.prazo} dias</small><b style="${urgentes ? 'color:var(--danger)' : ''}">${urgentes}</b></div>
            <div><small>Relatório do Mercado Livre${dc('Data do último relatório importado para esta loja. Importe toda segunda de manhã: é com esse histórico que a regra é afinada.')}</small><b>${ref ? ref.split('-').reverse().join('/') : 'nenhum'}</b></div>
            <div><small>Proximidade com o Mercado Livre${dc('Compara o "Enviar" do sistema com a sugestão do Mercado Livre no último relatório importado: 100% seria igual em todos os produtos. Os dias de cobertura mudam esse número.')}</small><b>${acerto == null ? '—' : acerto.toFixed(0) + '%'}</b></div></div>
          <div class="adm-abas" style="border:0;padding:0;margin-bottom:10px;align-items:center;">${PFL_FILTROS.map(f => `<button class="${pfl.filtro === f[0] ? 'ativa' : ''}" onclick="pflFiltro('${f[0]}')">${f[1]} (${(pfl.filtro === f[0] ? F : (() => { const a = pfl.filtro; pfl.filtro = f[0]; const r = pflFiltrar(T); pfl.filtro = a; return r; })()).length})</button>`).join('')}
            <span class="text-muted" style="font-size:12.5px;margin-left:auto;" id="pfl-sel">${S.length} produto${S.length === 1 ? '' : 's'} marcado${S.length === 1 ? '' : 's'} · ${S.reduce((s, l) => s + pflQtd(l), 0).toLocaleString('pt-BR')} unidades</span></div>
          <div class="adm-tab"><table><thead><tr><th style="width:30px;"><input type="checkbox" title="Marcar ou desmarcar todos os que estão na lista" onchange="pflSelTodos(this.checked)" ${F.length && F.every(pflSel) ? 'checked' : ''}></th><th>Produto</th><th style="text-align:right;">7 dias</th><th style="text-align:right;">7 anteriores</th><th style="text-align:right;">30 dias</th><th style="text-align:right;">No Full</th><th style="text-align:right;">A caminho</th>
            <th style="text-align:right;">Por dia${dc('Ritmo previsto por dia, já com aceleração e sazonalidade. Passe o mouse no número para ver os fatores.')}</th><th>Acaba em</th><th>Enviar até${dc('Data-limite para o envio sair: o dia em que o estoque acaba menos os dias de antecedência que você informou acima.')}</th><th style="text-align:right;">Enviar${dc('Quantidade calculada. Você pode trocar o número; o PDF sai com o que estiver aqui, só dos produtos marcados.')}</th><th style="text-align:right;">Mercado Livre</th><th style="text-align:right;">Diferença</th></tr></thead><tbody>
          ${F.map(l => { const urg = l.enviar > 0 && l.acaba != null && l.acaba <= pfl.prazo, ate = pflAte(l), k = pflE(l.sku).split(String.fromCharCode(39)).join(String.fromCharCode(38) + "#39;");
            return `<tr><td><input type="checkbox" ${pflSel(l) ? 'checked' : ''} onchange="pflMarcar('${k}', this.checked)"></td><td><div style="display:flex;gap:10px;align-items:center;">${(pfl.fotos || {})[l.sku] ? `<img src="${pflE(pfl.fotos[l.sku])}" loading="lazy" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:8px;flex:none;border:1px solid var(--border);">` : '<span style="width:42px;height:42px;border-radius:8px;flex:none;background:var(--surface-3);"></span>'}<div><b>${pflE(l.sku)}</b>${l.estrela ? ' <span class="badge">estrela</span>' : ''}${l.novo ? ' <span class="badge" title="Pouco histórico: a previsão de produto novo erra mais; o Mercado Livre costuma pedir mais a cada semana.">novo</span>' : ''}<br><small class="text-muted">${l.cod ? pflE(l.cod) + ' · ' : ''}${pflE(String(l.titulo).slice(0, 62))}</small></div></div></td>
              <td style="text-align:right;" title="6 semanas, da mais antiga para a mais recente: ${l.sem.join(' · ')}">${pflN(l.s7)}${l.tend > 0 ? '<br><small style="color:var(--success,#16a34a);">+' + Math.round(l.tend * 100) + '% tendência</small>' : ''}</td><td style="text-align:right;">${pflN(l.s7a)}</td><td style="text-align:right;">${pflN(l.s30)}${l.d30 && l.d30 < 26 ? '<br><small class="text-muted">' + l.d30 + ' dias c/ venda</small>' : ''}</td>
              <td style="text-align:right;">${pflN(l.aptas)}</td><td style="text-align:right;">${pflN(l.caminho)}</td>
              <td style="text-align:right;" title="ritmo ${l.ritmo.toFixed(1)} × aceleração ${l.acel.toFixed(2)} × sazonalidade ${l.saz.toFixed(2)}">${l.porDia.toFixed(1).replace('.', ',')}</td>
              <td style="${urg ? 'color:var(--danger);font-weight:700;' : ''}">${l.acaba == null ? '—' : l.acaba < 1 ? 'zerado' : l.acaba > 120 ? 'mais de 4 meses' : pflDia(l.acaba) + ' <small class="text-muted">(' + Math.round(l.acaba) + ' d)</small>'}</td>
              <td style="${l.enviar > 0 && ate != null && ate <= 0 ? 'color:var(--danger);font-weight:700;' : ''}">${l.enviar <= 0 || ate == null ? '—' : ate <= 0 ? 'agora' : pflDia(ate)}${l.urgN && l.enviar > 0 ? '<br><small class="text-muted">' + l.urgN + '</small>' : ''}</td>
              <td style="text-align:right;"><input type="number" min="0" value="${pflQtd(l)}" style="width:86px;text-align:right;font-weight:700;" onchange="pflQtdMudar('${k}', this.value)"></td><td style="text-align:right;">${l.ml == null ? '—' : pflN(l.ml)}${l.urg ? '<br><small class="text-muted">' + pflE(l.urg) + '</small>' : ''}</td>
              <td style="text-align:right;">${l.ml == null ? '—' : (l.enviar - l.ml > 0 ? '+' : '') + pflN(l.enviar - l.ml)}</td></tr>`; }).join('') || ('<tr><td colspan="13" class="text-muted">' + (T.length ? 'Nenhum produto neste filtro.' : 'Sem vendas pelo Full nos últimos 30 dias nesta loja.') + '</td></tr>')}
          </tbody></table></div>
          <div class="text-muted adm-nota"><b>Como a conta é feita (regra 2, tirada da tela de Planejamento de envios do Mercado Livre):</b> média das últimas 6 semanas de venda pelo Full; se as 2 últimas semanas passam da média, entra uma tendência de alta (amortecida, até +40%); semana sem estoque entra como venda baixa, igual ao Mercado Livre faz (por isso produto que ficou zerado recebe sugestão menor do que o potencial dele). Com isso sai a cobertura: até 2 semanas de estoque = enviar esta semana; até 4 = próxima semana; até 4,6 = em 2 semanas; acima disso, sem necessidade. O envio é um lote do tamanho dos dias de cobertura escolhidos (o Mercado Livre usa perto de 5 semanas), mais até uma semana quando resta menos de uma semana de estoque. <span style="display:none;"> ritmo por dia = 40% dos últimos 7 dias + 60% dos últimos 30 (produto zerado e com poucos dias de venda: os 30 dias são divididos pelos dias em que vendeu, no mínimo 18). Se a última semana vendeu mais que a anterior, o ritmo sobe até 35%. Se o produto vendeu no ano passado, entra a sazonalidade: quanto ele vendeu nos ${pfl.dias} dias seguintes ÷ o que vendia nas duas semanas equivalentes. Enviar = ritmo × dias de cobertura − o que está no Full − o que está a caminho. A regra é uma aproximação: o Mercado Livre não publica a dele. Ela acerta mais em produto estabilizado do que em produto novo. </span>A regra é uma aproximação: o Mercado Livre não publica a dele. Importe o relatório toda segunda para comparar e afinar.</div>
        </div></div>`;
    }
    // página: carrega (quando muda a loja ou os dias de cobertura) e desenha
    async function pflPagina(recarregar){
      const el = document.getElementById('view-full'); if(!el) return;
      const conta = typeof contaParam === 'function' ? contaParam() : null, chave = (conta || '') + '|' + pfl.dias + '|' + getToday();
      const topo = '<div class="pg-head"><div><div class="pg-title">Previsão de Full</div><div class="pg-sub">Quanto enviar ao Full e até quando, para agendar o galpão antes de o Mercado Livre publicar a sugestão da semana.</div></div></div>';
      if(recarregar || pfl.chave !== chave){ el.innerHTML = topo + '<div class="vazio"><b>Calculando a previsão…</b></div>'; if(typeof usuarioAtual !== 'undefined' && usuarioAtual) await pflCarregar(chave, conta); }
      if(!el.classList.contains('active')) return;
      el.innerHTML = topo + pflCorpo();
    }
    function pflParam(k, v){ pfl[k] = Math.max(k === 'dias' ? 7 : 0, Math.min(120, Number(v) || 0)); pflPagina(k === 'dias'); }

    // ---------- importação do relatório do Mercado Livre ----------
    function pflDataDe(txt){
      const m = /(\d{1,2}) de ([a-zç]+)/i.exec(String(txt || '')); if(!m) return null;
      const mes = PFL_MES[m[2].toLowerCase()]; if(!mes) return null;
      const hoje = new Date(); let ano = hoje.getFullYear(); if(mes > hoje.getMonth() + 2) ano--;       // relatório de dezembro aberto em janeiro
      return ano + '-' + String(mes).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    }
    function pflLerPlanilha(wb){
      for(const nome of wb.SheetNames){
        const R = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: '' }), topo = R.slice(0, 14);
        const dataTxt = (topo.flat().find(c => /(Baixado|Atualizado) em/i.test(String(c))) || ''), ref = pflDataDe(dataTxt);
        const iCab = topo.findIndex(l => l.some(c => /^SKU$/i.test(String(c).trim()))); if(iCab < 0) continue;
        // cabeçalho em até 3 linhas: junta os textos de cada coluna
        const col = t => { for(let j = 0; j < 60; j++){ const txt = [0, 1, 2].map(k => String((R[iCab + k] || [])[j] || '')).join(' ').normalize('NFC').replace(/\s+/g, ' ').trim(); if(t.test(txt)) return j; } return -1; };
        const cSku = col(/^\s*SKU/i), cSug = col(/Unidades sugeridas para enviar|Estoque a enviar/i); if(cSku < 0 || cSug < 0) continue;
        const cInv = col(/C[oó]digo ML/i), cProd = col(/^\s*Produto\s*$|^\s*Produto /i), cV30 = col(/Unidades vendidas.{0,8}30/i), cApt = col(/Aptas para venda/), cPend = col(/recebimento pendente|Entrada pendente/i), cTransf = col(/Em transfer[eê]ncia/i),
          cMin = col(/Unidades m[ií]nimas/i), cUrg = col(/Urg[eê]ncia de envio/i), cPrazo = col(/Prazo limite/i), cEst = col(/Produto Estrela/i);
        const itens = [];
        R.slice(iCab + 1).forEach(l => { const sku = String(l[cSku] || '').trim(); if(!sku || /^SKU$/i.test(sku)) return;
          itens.push({ sku: sku.toUpperCase(), inventory_id: cInv >= 0 ? String(l[cInv] || '').trim() || null : null, produto: cProd >= 0 ? String(l[cProd] || '').slice(0, 200) : null, v30: cV30 >= 0 ? Math.round(pflNum(l[cV30])) : null,
            aptas: cApt >= 0 ? Math.round(pflNum(l[cApt])) : null, caminho: (cPend >= 0 ? Math.round(pflNum(l[cPend])) : 0) + (cTransf >= 0 ? Math.round(pflNum(l[cTransf])) : 0), minimo: cMin >= 0 ? Math.round(pflNum(l[cMin])) : null,
            sugestao: Math.round(pflNum(l[cSug])), urgencia: cUrg >= 0 ? String(l[cUrg] || '').slice(0, 40) : null, prazo: cPrazo >= 0 ? String(l[cPrazo] || '').slice(0, 20) : null, estrela: cEst >= 0 ? /^sim/i.test(String(l[cEst])) : null }); });
        if(itens.length) return { ref, itens, origem: /Planejamento/i.test(JSON.stringify(topo)) ? 'planejamento' : 'estoque' };
      }
      return null;
    }
    async function pflImportar(inp){
      const arq = inp.files && inp.files[0]; inp.value = ''; if(!arq) return;
      const conta = typeof contaParam === 'function' ? contaParam() : null; if(!conta){ if(typeof toast === 'function') toast('Escolha a loja antes de importar.'); return; }
      if(typeof XLSX === 'undefined'){ if(typeof toast === 'function') toast('O leitor de planilhas ainda não carregou. Tente de novo em instantes.'); return; }
      pfl.msg = 'Lendo ' + arq.name + '…'; pflPagina();
      try {
        const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array' }), d = pflLerPlanilha(wb);
        if(!d){ pfl.msg = 'Não reconheci este arquivo. Use o "Relatório de Planejamento de envios" ou o "Relatório geral de estoque" baixado do Mercado Livre (Full), sem alterar.'; }
        else {
          const ref = d.ref || getToday(), mapa = new Map(); d.itens.forEach(i => mapa.set(i.sku, i));        // SKU repetido no arquivo: fica a última linha
          const linhas = [...mapa.values()].map(i => ({ ...i, usuario_id: usuarioAtual.id, ml_user_id: conta, referencia: ref, origem: d.origem }));
          let erro = null;
          for(let k = 0; k < linhas.length && !erro; k += 300){ const r = await supa.from('full_sugestoes').upsert(linhas.slice(k, k + 300), { onConflict: 'usuario_id,ml_user_id,referencia,sku' }); erro = r.error; }
          pfl.msg = erro ? 'Não consegui gravar: ' + erro.message : 'Relatório de ' + ref.split('-').reverse().join('/') + ' importado para ' + (typeof contaNome === 'function' ? contaNome(conta) : 'a loja') + ': ' + linhas.length + ' produtos, ' + linhas.filter(l => l.sugestao > 0).length + ' com sugestão de envio. Confira se o arquivo é mesmo desta loja.';
        }
      } catch(e){ pfl.msg = 'Não consegui ler o arquivo: ' + ((e && e.message) || e); }
      pflPagina(true);
    }
    // PDF do envio: foto, código do Full (o da etiqueta), SKU, produto e quantidade
    async function pflPdf(bt){
      const L = pflLinhas().filter(l => pflSel(l) && pflQtd(l) > 0).map(l => ({ ...l, enviar: pflQtd(l) })).sort((a, b) => a.sku.localeCompare(b.sku));
      if(!L.length){ if(typeof toast === 'function') toast('Nenhum produto marcado com quantidade a enviar.'); return; }
      const rot = bt.textContent; bt.disabled = true; bt.textContent = 'Gerando…';
      try {
        const carrega = src => new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('sem conexão')); document.head.appendChild(s); });
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await carrega('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        // fotos: do cadastro/anúncio (RPC sku_fotos), convertidas para dentro do PDF; sem foto, a célula fica vazia
        const fotos = {};
        try { const r = await supa.rpc('sku_fotos', { p_skus: L.map(l => l.sku) }); (r.data || []).forEach(x => { fotos[String(x.sku).toUpperCase()] = x.foto; }); } catch(e){}
        const img = {};
        await Promise.all(L.map(async l => { const u = fotos[l.sku]; if(!u) return;
          try { const b = await (await fetch(String(u).replace(/^http:/, 'https:'))).blob(); img[l.sku] = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(b); }); } catch(e){} }));
        const conta = typeof contaParam === 'function' ? contaParam() : null, loja = conta && typeof contaNome === 'function' ? contaNome(conta) : '';
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Envio ao Full' + (loja ? ' · ' + loja : ''), 40, 50);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
        doc.text('Gerado em ' + new Date().toLocaleDateString('pt-BR') + '  ·  cobertura de ' + pfl.dias + ' dias  ·  ' + L.length + ' produtos, ' + L.reduce((s, l) => s + l.enviar, 0).toLocaleString('pt-BR') + ' unidades', 40, 68);
        doc.autoTable({ startY: 84, margin: { left: 40, right: 40 }, head: [['Foto', 'Código Full', 'SKU', 'Produto', 'Quantidade']],
          body: L.map(l => ['', l.cod || '—', l.sku, String(l.titulo || '').slice(0, 90), l.enviar.toLocaleString('pt-BR')]),
          foot: [['', '', '', L.length + ' produtos', L.reduce((s, l) => s + l.enviar, 0).toLocaleString('pt-BR')]],
          styles: { fontSize: 9.5, cellPadding: 5, overflow: 'linebreak', valign: 'middle', minCellHeight: 46 },
          headStyles: { fillColor: [40, 44, 60], textColor: 255, minCellHeight: 18 }, footStyles: { fillColor: [235, 237, 243], textColor: 20, fontStyle: 'bold', minCellHeight: 18 },
          columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 78, fontStyle: 'bold' }, 2: { cellWidth: 120, fontStyle: 'bold' }, 4: { halign: 'right', cellWidth: 68, fontStyle: 'bold', fontSize: 11 } },
          didDrawCell: d => { if(d.section !== 'body' || d.column.index !== 0) return; const u = img[L[d.row.index].sku]; if(!u) return;
            try { doc.addImage(u, /png/i.test(u.slice(0, 30)) ? 'PNG' : /webp/i.test(u.slice(0, 30)) ? 'WEBP' : 'JPEG', d.cell.x + 5, d.cell.y + 3, 40, 40); } catch(e){} },
          didParseCell: d => { if(d.section !== 'body' && d.column.index === 4) d.cell.styles.halign = 'right'; } });
        doc.save('envio_full_' + (loja ? loja.toLowerCase().replace(/[^a-z0-9]+/gi, '_') + '_' : '') + getToday() + '.pdf');
      } catch(e){ if(typeof toast === 'function') toast('Não consegui gerar o PDF: ' + ((e && e.message) || e)); }
      bt.disabled = false; bt.textContent = rot;
    }
    function pflExportar(){
      const L = pflLinhas(), n = v => String(v).replace('.', ',');
      const csv = ['Código Full;SKU;Produto;Vendas 7 dias;7 dias anteriores;Vendas 30 dias;No Full;A caminho;Previsto por dia;Dias até acabar;Enviar;Sugestão do Mercado Livre'].concat(L.map(l => [l.cod, l.sku, '"' + String(l.titulo).replace(/"/g, '""') + '"', l.s7, l.s7a, l.s30, l.aptas, l.caminho, n(l.porDia.toFixed(2)), l.acaba == null ? '' : Math.round(l.acaba), l.enviar, l.ml == null ? '' : l.ml].join(';'))).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'previsao-full-' + getToday() + '.csv'; a.click();
    }
