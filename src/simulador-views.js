// ===== SIMULADOR - PLANILHA DE DIAS =====
    // Dados da planilha simulador (editáveis)
    let simPlanilhaDados = [];
    let simDias = 30;
    let simModoProj = 'total';
    let _simParcelasState = [];
    let _simTotalOriginal = 0;

    function renderPlanilhaSimulador(valorExtra, dataPag){
      const hoje = getToday();
      simPlanilhaDados = [];
      for(let i = 0; i < simDias; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        const compra = data === dataPag ? (valorExtra || 0) : 0;
        simPlanilhaDados.push({data, conf:e.conf, proj:e.proj, pag:getPag(data), compra});
      }
      return gerarHTMLPlanilhaSimulador();
    }

    function gerarHTMLPlanilhaSimulador(){
      let saldoReal = saldoAtual;
      let saldoSim  = saldoAtual;
      const th = 'padding:7px 8px;background:#f9fafb;border:1px solid #e5e5e5;font-size:11px;white-space:nowrap;';
      const td = 'padding:5px 8px;border:1px solid #e5e5e5;font-size:12px;';
      const btnBase = 'padding:4px 10px;font-size:12px;border:none;cursor:pointer;';
      const btnOn  = btnBase + 'background:var(--primary);color:#fff;';
      const btnOff = btnBase + 'background:#fff;color:#444;';
      const grpStyle = 'display:flex;border:1px solid #e5e5e5;border-radius:6px;overflow:hidden;';
      let html = `<div style="margin-top:15px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
          <strong style="font-size:13px;">Fluxo ${simDias} dias — edite "Compra simulada" em qualquer linha</strong>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:12px;color:#666;">Fator: <strong>${Math.round(cfgPct*100)}%</strong></span>
            <div style="${grpStyle}">
              <button onclick="setSimModoProj('total')" style="${simModoProj==='total'?btnOn:btnOff}">+Projetado</button>
              <button onclick="setSimModoProj('conf')" style="${simModoProj==='conf'?btnOn:btnOff}">Confirmado</button>
            </div>
            <div style="${grpStyle}">
              <button onclick="setSimDias(30)" style="${simDias===30?btnOn:btnOff}">30d</button>
              <button onclick="setSimDias(60)" style="${simDias===60?btnOn:btnOff}">60d</button>
              <button onclick="setSimDias(90)" style="${simDias===90?btnOn:btnOff}">90d</button>
            </div>
            <button class="btn-out btn-sm" onclick="recalcularSimulador()">↺ Recalcular</button>
            <button class="btn-out btn-sm" onclick="exportarSimulacaoXLS()">📊 Exportar XLS</button>
          </div>
        </div>
        <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead style="position:sticky;top:0;z-index:5;"><tr>
            <th style="${th}">Data</th>
            <th style="${th}">Conf. ML</th>
            <th style="${th};${simModoProj==='conf'?'color:#bbb;':''}">Proj. compl.</th>
            <th style="${th}">A pagar</th>
            <th style="${th}">Compra simulada <span class="tip tip-down"><span class="tip-icon">?</span><span class="tip-box">Valor que você está simulando pagar neste dia. Edite para testar diferentes cenários.</span></span></th>
            <th style="${th}">Saldo real acum. <span class="tip tip-down"><span class="tip-icon">?</span><span class="tip-box">Saldo acumulado sem considerar a compra simulada — o que o caixa terá de qualquer forma.</span></span></th>
            <th style="${th}">Saldo simulado acum. <span class="tip tip-down"><span class="tip-icon">?</span><span class="tip-box">Saldo acumulado após deduzir a compra simulada. Fica vermelho se cair abaixo da reserva mínima.</span></span></th>
            <th style="${th}">Status</th>
          </tr></thead><tbody>`;

      simPlanilhaDados.forEach((d, i) => {
        const entrada = simModoProj === 'conf' ? d.conf : (d.conf + d.proj);
        saldoReal += entrada - d.pag;
        saldoSim  += entrada - d.pag - d.compra;
        const corLinha = saldoSim < reservaMinima ? 'background:#fff5f5;' : '';
        const status = saldoSim < reservaMinima
          ? '<span style="color:var(--danger);font-size:11px;">⚠️ risco</span>'
          : '<span style="color:var(--success);font-size:11px;">✓ ok</span>';
        html += `<tr style="${corLinha}">
          <td style="${td}">${ptDate(d.data)}</td>
          <td style="${td};color:var(--success);">${d.conf>0?fmt(d.conf):'—'}</td>
          <td style="${td};color:${simModoProj==='conf'?'#ccc':'#0891b2'};">${d.proj>0?(simModoProj==='conf'?'—':fmt(d.proj)):'—'}</td>
          <td style="${td};color:var(--danger);">${d.pag>0?fmt(d.pag):'—'}</td>
          <td style="${td};padding:2px 4px;">
            <input type="text" value="${d.compra>0?fmtMoney(d.compra):''}"
              style="width:120px;padding:4px 6px;border:1px solid ${d.compra>0?'var(--primary)':'#e5e5e5'};border-radius:4px;font-size:12px;background:${d.compra>0?'#eff6ff':'#fff'};"
              onblur="if(this.value)this.value=fmtMoney(parseMoney(this.value))"
              onchange="simPlanilhaDados[${i}].compra=parseMoney(this.value)||0;recalcularSimulador()">
          </td>
          <td style="${td};font-weight:600;color:${saldoReal<reservaMinima?'var(--danger)':'var(--success)'};">${fmt(saldoReal)}</td>
          <td style="${td};font-weight:600;color:${saldoSim<reservaMinima?'var(--danger)':'var(--success)'};">${fmt(saldoSim)}</td>
          <td style="${td}">${status}</td>
        </tr>`;
      });
      html += '</tbody></table></div></div>';
      return html;
    }

    function recalcularSimulador(){
      if(_simParcelasState.length > 0){ recalcularSimParcelado(); return; }
      const res = document.getElementById('sim-resultado');
      if(!res || simPlanilhaDados.length === 0) return;

      // Preservar compras editadas pelo usuário
      const compraEdits = {};
      simPlanilhaDados.forEach(d => { if(d.compra > 0) compraEdits[d.data] = d.compra; });

      // Recomputar todos os dias com getEntrada() fresco (respeita cfgPct atual e simDias)
      const hoje = getToday();
      const novosDados = [];
      for(let i = 0; i < simDias; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        novosDados.push({data, conf:e.conf, proj:e.proj, pag:getPag(data), compra: compraEdits[data] || 0});
      }
      simPlanilhaDados = novosDados;

      const badge = res.querySelector('.alert');
      res.innerHTML = (badge ? badge.outerHTML : '') + gerarHTMLPlanilhaSimulador();
    }

    function setSimDias(n){ simDias = n; recalcularSimulador(); }
    function setSimModoProj(m){ simModoProj = m; recalcularSimulador(); }
    function setSimParcelaData(idx, val){ if(_simParcelasState[idx]){ _simParcelasState[idx].data = val; recalcularSimParcelado(); } }
    function setSimParcelaValor(idx, val){
      if(!_simParcelasState[idx]) return;
      const novoValor = parseMoney(val) || 0;
      _simParcelasState[idx].valor = novoValor;
      // Auto-ajusta as outras parcelas para manter o total original
      const outras = _simParcelasState.filter((_, i) => i !== idx);
      if(outras.length > 0 && _simTotalOriginal > 0){
        const restante = _simTotalOriginal - novoValor;
        const porOutra = Math.round(restante / outras.length * 100) / 100;
        _simParcelasState.forEach((p, i) => { if(i !== idx) p.valor = porOutra; });
      }
      recalcularSimParcelado();
    }

    function exportarSimulacaoXLS(){
      if(simPlanilhaDados.length === 0){ alert('Rode uma simulação primeiro.'); return; }
      const modo = simModoProj === 'conf' ? 'Confirmado' : '+Projetado';
      const rows = [['Data','Conf. ML (R$)','Proj. compl. (R$)','A pagar (R$)','Compra sim. (R$)','Saldo real (R$)','Saldo sim. (R$)','Status','Modo']];
      let saldoReal = saldoAtual;
      let saldoSim  = saldoAtual;
      simPlanilhaDados.forEach(d => {
        const entrada = simModoProj === 'conf' ? d.conf : (d.conf + d.proj);
        saldoReal = Math.round((saldoReal + entrada - d.pag) * 100) / 100;
        saldoSim  = Math.round((saldoSim  + entrada - d.pag - d.compra) * 100) / 100;
        rows.push([
          d.data,
          Math.round((d.conf||0)*100)/100,
          simModoProj==='conf' ? 0 : Math.round((d.proj||0)*100)/100,
          Math.round((d.pag||0)*100)/100,
          Math.round((d.compra||0)*100)/100,
          saldoReal, saldoSim,
          saldoSim < reservaMinima ? 'Risco' : 'OK', modo
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Simulacao');
      XLSX.writeFile(wb, 'simulacao_' + getToday() + '.xlsx');
    }


    // ===== VISUALIZAÇÃO CONTAS A PAGAR =====
    let pagarViewMode = 'lista';

    function setPagarView(mode){
      pagarViewMode = mode;
      ['lista','kanban','cal'].forEach(m => {
        document.getElementById(m+'-pagar').style.display = m === mode ? 'block' : 'none';
        document.getElementById('pagar-view-'+m).className = 'btn-toggle' + (m === mode ? ' active' : '');
      });
      if(mode === 'lista') renderPagar();
      else if(mode === 'kanban') renderKanbanPagar();
      else if(mode === 'cal') renderCalPagar();
    }

    function renderKanbanPagar(){
      const hoje = getToday();
      const cols = {
        atrasado: {label:'⚠️ Atrasado', items:[], css:'atrasado'},
        hoje:     {label:'📅 Hoje',     items:[], css:'hoje'},
        aberto:   {label:'🕐 Em aberto',items:[], css:'em-aberto'},
        pago:     {label:'✓ Pago',      items:[], css:'pago'},
      };

      // Usa os mesmos filtros da lista
      const filtrados = getPagamentosFiltrados();
      filtrados.forEach(p => {
        const idx = pagamentos.indexOf(p);
        if(p.pago) cols.pago.items.push({p, idx});
        else if(p.data === hoje) cols.hoje.items.push({p, idx});
        else if(p.data < hoje) cols.atrasado.items.push({p, idx});
        else cols.aberto.items.push({p, idx});
      });

      // Ordenar cada coluna por data
      Object.values(cols).forEach(col => col.items.sort((a,b) => a.p.data.localeCompare(b.p.data)));

      const div = document.getElementById('kanban-pagar');
      div.innerHTML = '<div class="kanban-board">' +
        Object.values(cols).map(col => {
          const total = col.items.reduce((s, {p}) => s + p.val, 0);
          const cards = col.items.map(({p, idx}) => `
            <div class="kanban-card ${col.css}" onclick="editarLanc(${idx})">
              <div class="kanban-card-title">${p.desc} ${p.parcela ? '<span style="font-size:10px;color:#666;">('+p.parcela+')</span>' : ''}</div>
              <div class="kanban-card-forn">${p.forn || 'Sem fornecedor'} · ${p.cat}</div>
              <div class="kanban-card-val" style="color:${col.css==='pago'?'var(--success)':'var(--danger)'};">${fmt(p.val)}</div>
              <div class="kanban-card-date">${ptDate(p.data)}</div>
            </div>`).join('');
          return `<div class="kanban-col">
            <div class="kanban-col-header ${col.css}">${col.label} <span style="opacity:0.7;">(${col.items.length})</span></div>
            <div class="kanban-items">${cards || '<div style="padding:20px;text-align:center;color:#ccc;font-size:12px;">Nenhuma conta</div>'}</div>
            <div class="kanban-total">Total: ${fmt(total)}</div>
          </div>`;
        }).join('') + '</div>';
    }

    function renderCalPagar(){
      const div = document.getElementById('cal-pagar');
      // Reusar a lógica do calendário principal mas para contas a pagar
      const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const hoje = getToday();
      const d = new Date();
      const primeiroDia = new Date(d.getFullYear(), d.getMonth(), 1);
      const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const diasAnt = primeiroDia.getDay();

      let html = `<div style="padding:16px;">
        <div style="text-align:center;font-weight:600;margin-bottom:12px;">${meses[d.getMonth()]} ${d.getFullYear()}</div>
        <div class="cal-grid">`;

      ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(dn =>
        html += `<div class="cal-header">${dn}</div>`);

      // Dias vazios antes
      for(let i = 0; i < diasAnt; i++) html += '<div class="cal-day outro-mes"></div>';

      // Dias do mês
      for(let dia = 1; dia <= ultimoDia.getDate(); dia++){
        const data = dateStr(new Date(d.getFullYear(), d.getMonth(), dia));
        const contas = pagamentos.filter(p => p.data === data && !p.pago);
        const atrasadas = pagamentos.filter(p => p.data === data && !p.pago && data < hoje);
        const total = contas.reduce((s,p) => s+p.val, 0);
        const isHoje = data === hoje;

        html += `<div class="cal-day ${isHoje?'hoje':''}" onclick="abrirDia('${data}')">
          <div class="cal-day-num">${dia}</div>
          ${total > 0 ? `<div class="cal-valor-saida">-${fmt(total)}</div>
          <div style="font-size:9px;color:#666;">${contas.length} conta(s)</div>` : ''}
        </div>`;
      }

      // Preencher resto
      const total = diasAnt + ultimoDia.getDate();
      for(let i = total; i < 35; i++) html += '<div class="cal-day outro-mes"></div>';

      html += '</div></div>';
      div.innerHTML = html;
    }

    // ===== CALENDÁRIO A RECEBER =====
    let recViewMode = 'lista';
    let recMesAtual = new Date();

    function setRecView(mode){
      recViewMode = mode;
      document.getElementById('rec-lista-view').style.display = mode === 'lista' ? 'block' : 'none';
      document.getElementById('rec-cal-view').style.display = mode === 'cal' ? 'block' : 'none';
      document.getElementById('rec-view-lista').className = 'btn-toggle' + (mode === 'lista' ? ' active' : '');
      document.getElementById('rec-view-cal').className = 'btn-toggle' + (mode === 'cal' ? ' active' : '');
      if(mode === 'cal') renderRecCal();
    }

    function navegarRecMes(dir){
      recMesAtual.setMonth(recMesAtual.getMonth() + dir);
      renderRecCal();
    }

    function renderRecCal(){
      const div = document.getElementById('rec-cal-grid');
      if(!div) return;
      const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const ano = recMesAtual.getFullYear();
      const mes = recMesAtual.getMonth();

      document.getElementById('rec-cal-label').textContent = meses[mes] + ' ' + ano;

      const primeiroDia = new Date(ano, mes, 1);
      const ultimoDia = new Date(ano, mes + 1, 0);
      const diasAnt = primeiroDia.getDay();
      const hoje = getToday();

      let html = '';
      ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(dn =>
        html += `<div class="cal-header">${dn}</div>`);

      for(let i = 0; i < diasAnt; i++) html += '<div class="cal-day outro-mes"></div>';

      const hojeItensRec = JSON.parse(localStorage.getItem('mk_liberacoes_hoje') || '[]');
      const hojeTotalRec = hojeItensRec.reduce((s,i) => s + i.val, 0);

      for(let dia = 1; dia <= ultimoDia.getDate(); dia++){
        const data = dateStr(new Date(ano, mes, dia));
        const isHoje = data === hoje;
        const total = isHoje ? hojeTotalRec : liberacoes.filter(l => l.data === data).reduce((s,l) => s+l.val, 0);
        const clickAttr = isHoje && hojeTotalRec > 0 ? ' onclick="abrirModalHoje()" style="cursor:pointer;"' : '';

        html += `<div class="cal-day ${isHoje?'hoje':''}"${clickAttr}>
          <div class="cal-day-num">${dia}</div>
          ${total > 0 ? `<div class="cal-valor-entrada">${isHoje?'⏰ ':''}+${fmt(total)}</div>` : ''}
          ${isHoje && hojeTotalRec > 0 ? `<div style="font-size:.6rem;color:var(--accent);margin-top:1px;">ver horas</div>` : ''}
        </div>`;
      }

      const total = diasAnt + ultimoDia.getDate();
      for(let i = total; i < 35; i++) html += '<div class="cal-day outro-mes"></div>';

      div.innerHTML = html;
    }

    // ===== SELEÇÃO MÚLTIPLA CONTAS A PAGAR =====
    function selecionarTodosPagar(checked){
      document.querySelectorAll('.cb-pagar').forEach(cb => cb.checked = checked);
      atualizarContPagar();
    }

    function atualizarContPagar(){
      const checks = document.querySelectorAll('.cb-pagar:checked');
      const sel = checks.length;
      const total = document.querySelectorAll('.cb-pagar').length;

      const el = document.getElementById('pagar-sel-count');
      if(el) el.textContent = sel > 0 ? sel + ' selecionado(s)' : '';

      const cbTodos = document.getElementById('cb-todos');
      if(cbTodos){ cbTodos.indeterminate = sel > 0 && sel < total; cbTodos.checked = sel === total && total > 0; }

      // Total dinâmico: selecionados > 0 → total dos selecionados; senão → total do filtro
      const totalEl = document.getElementById('total-filtrado');
      if(totalEl && sel > 0){
        const somasel = Array.from(checks).reduce((s, cb) => s + (parseFloat(cb.dataset.val) || 0), 0);
        totalEl.textContent = fmt(somasel) + ' (selecionados)';
      } else if(totalEl && sel === 0){
        // Restaurar total do filtro
        renderPagar();
      }
    }

    function getIdxsSelecionadosPagar(){
      return Array.from(document.querySelectorAll('.cb-pagar:checked')).map(cb => parseInt(cb.dataset.idx));
    }

    function marcarSelecionadosPagos(){
      const idxs = getIdxsSelecionadosPagar();
      if(!idxs.length){ alert('Selecione ao menos 1 lançamento'); return; }
      abrirModalBaixa(idxs);
    }

    let _baixaIdxs = [];

    function abrirModalBaixa(idxs){
      _baixaIdxs = idxs.filter(i => !pagamentos[i].pago);
      if(!_baixaIdxs.length){ alert('Nenhuma conta em aberto selecionada.'); return; }

      const isSingle = _baixaIdxs.length === 1;
      const total = _baixaIdxs.reduce((s, i) => s + pagamentos[i].val, 0);

      document.getElementById('baixa-title').textContent = isSingle
        ? 'Confirmar pagamento'
        : `Confirmar ${_baixaIdxs.length} pagamentos`;

      // Lista de itens
      const listaEl = document.getElementById('baixa-lista');
      listaEl.innerHTML = _baixaIdxs.map(i => {
        const p = pagamentos[i];
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;">
          <span style="color:#333;">${p.desc}${p.parcela?' ('+p.parcela+')':''}<span style="color:#999;font-size:11px;margin-left:6px;">${ptDate(p.data)}</span></span>
          <span style="font-weight:600;">${fmt(p.val)}</span>
        </div>`;
      }).join('') + (isSingle ? '' : `<div style="display:flex;justify-content:space-between;padding:6px 4px;font-size:13px;font-weight:700;border-top:2px solid #e5e7eb;margin-top:2px;"><span>Total</span><span>${fmt(total)}</span></div>`);

      document.getElementById('baixa-data').value = getToday();
      document.getElementById('baixa-val-orig').textContent = fmt(total);
      document.getElementById('baixa-desconto').value = '';
      document.getElementById('baixa-juros').value = '';
      document.getElementById('baixa-valor-pago').value = fmt(total);

      // Desconto/juros só faz sentido mostrar para lote também, mas campos ficam visíveis sempre
      document.getElementById('baixa-campos-extras').style.display = 'grid';

      document.getElementById('modal-baixa').classList.add('open');
    }

    function _parseBaixaMoneyInput(el){
      const raw = el.value.replace(/[^\d,]/g,'').replace(',','.');
      return parseFloat(raw) || 0;
    }

    function onBaixaValorPagoInput(el){
      const total = _baixaIdxs.reduce((s, i) => s + pagamentos[i].val, 0);
      const pago  = _parseBaixaMoneyInput(el);
      const diff  = pago - total;
      if(diff < 0){
        document.getElementById('baixa-desconto').value = fmt(Math.abs(diff));
        document.getElementById('baixa-juros').value = '';
      } else if(diff > 0){
        document.getElementById('baixa-juros').value = fmt(diff);
        document.getElementById('baixa-desconto').value = '';
      } else {
        document.getElementById('baixa-desconto').value = '';
        document.getElementById('baixa-juros').value = '';
      }
    }

    function onBaixaDescontoInput(el){
      const total    = _baixaIdxs.reduce((s, i) => s + pagamentos[i].val, 0);
      const desconto = _parseBaixaMoneyInput(el);
      const juros    = _parseBaixaMoneyInput(document.getElementById('baixa-juros'));
      document.getElementById('baixa-valor-pago').value = fmt(Math.max(0, total - desconto + juros));
    }

    function onBaixaJurosInput(el){
      const total    = _baixaIdxs.reduce((s, i) => s + pagamentos[i].val, 0);
      const desconto = _parseBaixaMoneyInput(document.getElementById('baixa-desconto'));
      const juros    = _parseBaixaMoneyInput(el);
      document.getElementById('baixa-valor-pago').value = fmt(Math.max(0, total - desconto + juros));
    }

    function confirmarBaixa(){
      const dataPaga = document.getElementById('baixa-data').value;
      if(!dataPaga){ alert('Informe a data do pagamento.'); return; }

      const total      = _baixaIdxs.reduce((s, i) => s + pagamentos[i].val, 0);
      const totalPago  = _parseBaixaMoneyInput(document.getElementById('baixa-valor-pago'));
      const descTotal  = _parseBaixaMoneyInput(document.getElementById('baixa-desconto'));
      const jurosTotal = _parseBaixaMoneyInput(document.getElementById('baixa-juros'));

      if(_baixaIdxs.length === 1){
        const i = _baixaIdxs[0];
        pagamentos[i].pago      = true;
        pagamentos[i].dataPaga  = dataPaga;
        pagamentos[i].valorPago = totalPago;
        pagamentos[i].desconto  = descTotal;
        pagamentos[i].juros     = jurosTotal;
      } else {
        // Distribuir proporcionalmente
        _baixaIdxs.forEach(i => {
          const p      = pagamentos[i];
          const peso   = total > 0 ? p.val / total : 1 / _baixaIdxs.length;
          p.pago      = true;
          p.dataPaga  = dataPaga;
          p.desconto  = Math.round(descTotal  * peso * 100) / 100;
          p.juros     = Math.round(jurosTotal * peso * 100) / 100;
          p.valorPago = Math.round((p.val - p.desconto + p.juros) * 100) / 100;
        });
      }

      // Debitar valor pago do saldo (saldoMP)
      saldoMP = Math.max(0, saldoMP - totalPago);
      saldoAtual = saldoMP + saldoOutros;
      const mpEl = document.getElementById('saldo-mp');
      const totalEl = document.getElementById('saldo-total-label');
      if(mpEl) mpEl.value = fmtMoney(saldoMP);
      if(totalEl) totalEl.textContent = fmt(saldoAtual);

      fecharModal('modal-baixa');
      salvar(); salvarCfg(); renderPagar(); recalc();
    }

    function deletarSelecionadosPagar(){
      const idxs = getIdxsSelecionadosPagar();
      if(!idxs.length){ alert('Selecione ao menos 1 lançamento'); return; }
      if(!confirm('Deletar ' + idxs.length + ' lançamento(s)?')) return;
      idxs.sort((a,b) => b-a).forEach(i => pagamentos.splice(i,1));
      salvar(); renderPagar(); recalc();
    }
