// ===== RENDERS =====
    function renderDashboard(){
      const score = calcScore();
      document.getElementById('score-value').textContent = score;
      const needle = document.getElementById('score-needle');
      needle.style.transform = `rotate(${score * 1.8 - 90}deg)`;

      const mediaGasto = calcMediaGastoDia();
      const cobertura = mediaGasto > 0 ? Math.round(saldoAtual / mediaGasto) : 0;

      document.getElementById('stat-comprar').textContent = fmt(calcMaxCompra());
      document.getElementById('stat-pior').textContent = fmt(calcPiorSaldo());
      document.getElementById('stat-saldo').textContent = fmt(saldoAtual);
      document.getElementById('stat-cobertura').textContent = cobertura + ' dias';

      renderCentroDecisao();
      renderAlertasDashboard();

      // Indicador de modo de projeção
      const modoEl = document.getElementById('dash-modo-proj');
      if(modoEl){
        if(modoProjecaoAtivo === 'tendencia' && regressaoAtual){
          const sinal = regressaoAtual.b >= 0 ? '↗' : '↘';
          const dias = periodoHistorico || 90;
          const varMensal = Math.round(regressaoAtual.b * 30);
          const tooltip = `Nos últimos ${dias} dias, suas vendas estão ${regressaoAtual.b >= 0 ? 'crescendo' : 'caindo'} em média R$${Math.abs(regressaoAtual.b).toFixed(0)}/dia. Isso equivale a R$${Math.abs(varMensal).toLocaleString('pt-BR')} por mês ${regressaoAtual.b >= 0 ? 'a mais' : 'a menos'}. Calculado por regressão linear sobre o extrato de recebimentos do ML. Mude o modo em: Configurações → Modo de Projeção.`;
          modoEl.innerHTML = `Projeção: Tendência ${sinal} (R$${regressaoAtual.b >= 0 ? '+' : ''}${regressaoAtual.b.toFixed(0)}/dia) <span class="tip tip-up" style="vertical-align:middle"><span class="tip-icon">?</span><span class="tip-box">${tooltip}</span></span>`;
          modoEl.style.color = regressaoAtual.b >= 0 ? 'var(--success)' : 'var(--warning)';
        } else {
          modoEl.textContent = 'Projeção: Média simples';
          modoEl.style.color = 'var(--gray-600)';
        }
      }

      atualizarResumo();
    }
    
    function setPlanilhaView(mode){
      planilhaViewMode = mode;
      document.getElementById('plan-view-tabela').className = 'btn-toggle' + (mode==='tabela' ? ' active' : '');
      document.getElementById('plan-view-cal').className   = 'btn-toggle' + (mode==='cal'    ? ' active' : '');
      document.getElementById('planilha-tabela-wrap').style.display = mode === 'tabela' ? '' : 'none';
      document.getElementById('planilha-cal-wrap').style.display    = mode === 'cal'    ? '' : 'none';
      document.getElementById('plan-controles-tabela').style.display = mode === 'tabela' ? '' : 'none';
      document.getElementById('plan-controles-cal').style.display    = mode === 'cal'    ? 'flex' : 'none';
      document.getElementById('plan-label-periodo').style.display    = mode === 'tabela' ? '' : 'none';
      if(mode === 'tabela') renderPlanilha();
      else renderPlanilhaCal();
    }

    function renderPlanilhaCal(){
      const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const ano = planilhaCal_mes.getFullYear();
      const mes = planilhaCal_mes.getMonth();
      const labelEl = document.getElementById('planilha-cal-label');
      if(labelEl) labelEl.textContent = meses[mes] + ' ' + ano;

      // Sincronizar toggles do cal com planilhaMode
      const tc = document.getElementById('plan-cal-toggle-conf');
      const tp = document.getElementById('plan-cal-toggle-proj');
      if(tc) tc.className = 'btn-toggle' + (planilhaMode==='confirmado' ? ' active' : '');
      if(tp) tp.className = 'btn-toggle' + (planilhaMode==='projetado'  ? ' active' : '');

      const primeiroDia = new Date(ano, mes, 1);
      const ultimoDia   = new Date(ano, mes + 1, 0);
      const diasNoMes   = ultimoDia.getDate();
      const diasAnteriores = primeiroDia.getDay();
      const hoje = getToday();
      const primeiroDiaMes = dateStr(new Date(ano, mes, 1));
      const showProj = planilhaMode === 'projetado';

      // Calcular saldo acumulado até início do mês (mesma lógica de renderCalendario)
      let saldoAcum = saldoAtual;
      const dHoje    = parseDate(hoje);
      const dPrimeiro = new Date(ano, mes, 1);
      if(dPrimeiro > dHoje){
        let d = hoje;
        while(d < primeiroDiaMes){
          const e = getEntrada(d);
          saldoAcum += (showProj ? e.total : e.conf) - getPag(d);
          d = addDias(d, 1);
        }
      } else if(dPrimeiro <= dHoje && dHoje <= dateStr(ultimoDia)){
        let d = primeiroDiaMes;
        while(d < hoje){
          const e = getEntrada(d);
          saldoAcum -= (showProj ? e.total : e.conf) - getPag(d);
          d = addDias(d, 1);
        }
      }

      let html = '<div class="cal-grid">';
      ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(d => html += `<div class="cal-header">${d}</div>`);

      // Dias do mês anterior
      const diasMesAnt = new Date(ano, mes, 0).getDate();
      for(let i = diasAnteriores - 1; i >= 0; i--)
        html += `<div class="cal-day outro-mes"><div class="cal-day-num">${diasMesAnt - i}</div></div>`;

      for(let dia = 1; dia <= diasNoMes; dia++){
        const data   = dateStr(new Date(ano, mes, dia));
        const isHoje = data === hoje;
        const e      = getEntrada(data);
        const entrada  = showProj ? e.total : e.conf;
        const pag      = getPag(data);
        const saldoDia = entrada - pag;
        saldoAcum += saldoDia;

        const riscoLeve  = reservaMinima > 0 && saldoAcum < reservaMinima && saldoAcum >= 0;
        const riscoForte = saldoAcum < 0;
        const classeRisco = riscoForte ? ' risco-forte' : riscoLeve ? ' risco-leve' : '';
        const corAcum = riscoForte ? 'var(--danger)' : riscoLeve ? '#e65c00' : 'var(--success)';

        html += `<div class="cal-day${isHoje ? ' hoje' : ''}${classeRisco}">
          <div class="cal-day-num">${dia}</div>
          ${entrada > 0 ? `<div class="cal-valor-entrada">+${fmt(entrada)}</div>` : ''}
          ${pag > 0     ? `<div class="cal-valor-saida">-${fmt(pag)}</div>`     : ''}
          ${(entrada > 0 || pag > 0) ? `<div class="cal-saldo ${saldoDia >= 0 ? 'text-success' : 'text-danger'}">${fmt(saldoDia)}</div>` : ''}
          <div class="cal-acum" style="color:${corAcum};">≡ ${fmt(saldoAcum)}</div>
        </div>`;
      }

      // Completar grade (35 ou 42 células)
      const totalDias = diasAnteriores + diasNoMes;
      const restante  = totalDias <= 35 ? 35 - totalDias : 42 - totalDias;
      for(let dia = 1; dia <= restante; dia++)
        html += `<div class="cal-day outro-mes"><div class="cal-day-num">${dia}</div></div>`;

      html += '</div>';
      document.getElementById('planilha-cal-grid').innerHTML = html;
    }

    function navPlanilhaCal(dir){
      planilhaCal_mes = new Date(planilhaCal_mes.getFullYear(), planilhaCal_mes.getMonth() + dir, 1);
      renderPlanilhaCal();
    }

    function setPlanilhaDias(dias, btn){
      planilhaDias = dias;
      planilhaCustomMode = false;
      document.getElementById('plan-custom-range').style.display = 'none';
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      if(btn) btn.classList.add('active');
      renderPlanilha();
    }

    function togglePlanilhaCustom(){
      planilhaCustomMode = true;
      document.getElementById('plan-custom-range').style.display = 'flex';
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('plan-btn-custom').classList.add('active');
      renderPlanilha();
    }

    function renderPlanilha(){
      const tbody = document.getElementById('tbody-planilha');
      const hoje = getToday();
      let saldoAcum = saldoAtual;
      let html = '';

      document.getElementById('plan-toggle-conf').className = 'btn-toggle' + (planilhaMode === 'confirmado' ? ' active' : '');
      document.getElementById('plan-toggle-proj').className = 'btn-toggle' + (planilhaMode === 'projetado' ? ' active' : '');

      const thProj = document.getElementById('th-proj');
      const thTotal = document.getElementById('th-total');
      if(thProj) thProj.style.display = planilhaMode === 'projetado' ? '' : 'none';
      if(thTotal) thTotal.style.display = planilhaMode === 'projetado' ? '' : 'none';

      // Determinar intervalo de datas
      let dataIni, dataFim;
      if(planilhaCustomMode){
        dataIni = document.getElementById('plan-de')?.value || hoje;
        dataFim = document.getElementById('plan-ate')?.value || addDias(hoje, 30);
      } else {
        dataIni = hoje;
        dataFim = addDias(hoje, planilhaDias - 1);
      }

      const showProj = planilhaMode === 'projetado';
      let d = dataIni;

      while(d <= dataFim){
        const dia = nomeDia(d);
        const e = getEntrada(d);
        const entrada = showProj ? e.total : e.conf;
        const pag = getPag(d);
        const saldoDia = entrada - pag;
        saldoAcum += saldoDia;
        const corSaldo = saldoAcum < reservaMinima && reservaMinima > 0 ? 'text-danger' : '';
        const bgRisco = saldoAcum < reservaMinima && reservaMinima > 0 ? 'background:#fff5f5;' : '';

        html += `<tr style="${bgRisco}">
          <td>${ptDate(d)}</td>
          <td>${dia}</td>
          <td style="color:var(--success);">${e.conf > 0 ? fmt(e.conf) : '—'}</td>
          ${showProj ? `<td style="color:#0891b2;">${e.proj > 0 ? fmt(e.proj) : '—'}</td><td style="font-weight:600;">${fmt(entrada)}</td>` : ''}
          <td style="color:var(--danger);">${pag > 0 ? fmt(pag) : '—'}</td>
          <td class="${saldoDia < 0 ? 'text-danger' : 'text-success'}">${fmt(saldoDia)}</td>
          <td class="${corSaldo}" style="font-weight:600;">${fmt(saldoAcum)}</td>
          <td style="font-size:11px;color:#888;">${pag > 0 ? Math.round(saldoAcum / pag) + 'd' : '—'}</td>
        </tr>`;

        d = addDias(d, 1);
      }

      tbody.innerHTML = html || '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999;">Nenhum dado no período</td></tr>';
      makeSortable('tbody-planilha', [8]);
      initResizableCols('tbody-planilha');

      const labelEl = document.getElementById('plan-label-periodo');
      if(labelEl) labelEl.textContent = 'Período: ' + ptDate(dataIni) + ' até ' + ptDate(dataFim);
    }
    
    function onFiltroPeridoChange(){
      const periodo = document.getElementById('filtro-periodo')?.value || '';
      const customRange = document.getElementById('filtro-custom-range');
      if(customRange) customRange.style.display = periodo === 'custom' ? 'flex' : 'none';
      renderPagar();
    }

    function getPagamentosFiltrados(){
      const busca = (document.getElementById('filtro-busca')?.value || '').toLowerCase();
      const periodo = document.getElementById('filtro-periodo')?.value || '';
      const status = document.getElementById('filtro-status')?.value || '';
      const cat = document.getElementById('filtro-cat')?.value || '';
      const hoje = getToday();

      // Período personalizado
      let customDe = '', customAte = '';
      if(periodo === 'custom'){
        customDe = document.getElementById('filtro-de')?.value || '';
        customAte = document.getElementById('filtro-ate')?.value || '';
      }

      // Atualizar label do filtro ativo
      const labelEl = document.getElementById('filtro-label-ativo');
      if(labelEl){
        if(periodo === 'dia') labelEl.textContent = 'Filtro ativo: Hoje (' + ptDate(hoje) + ')';
        else if(periodo === 'semana') labelEl.textContent = 'Filtro ativo: Esta semana (' + ptDate(hoje) + ' até ' + ptDate(addDias(hoje, 7)) + ')';
        else if(periodo === 'mes') labelEl.textContent = 'Filtro ativo: Próximos 30 dias (' + ptDate(hoje) + ' até ' + ptDate(addDias(hoje, 30)) + ')';
        else if(periodo === 'custom' && customDe && customAte) labelEl.textContent = 'Filtro ativo: ' + ptDate(customDe) + ' até ' + ptDate(customAte);
        else labelEl.textContent = '';
      }

      const isPagas = status === 'pagas';
      return pagamentos.filter(p => {
        if(busca && !p.desc.toLowerCase().includes(busca) &&
           !(p.forn || '').toLowerCase().includes(busca)) return false;
        // Para pagas, usa dataPaga se disponível, senão data de vencimento
        const dataRef = isPagas ? (p.dataPaga || p.data) : p.data;
        if(periodo === 'dia' && dataRef !== hoje) return false;
        const isVencida = !p.pago && p.data < hoje;
        if(periodo === 'semana'){
          if(isPagas){ if(Math.abs(diasDif(hoje, dataRef)) > 7)  return false; }
          else if(!isVencida){ if(p.data < hoje || diasDif(hoje, p.data) > 7)  return false; }
        }
        if(periodo === 'mes'){
          if(isPagas){ if(Math.abs(diasDif(hoje, dataRef)) > 30) return false; }
          else if(!isVencida){ if(p.data < hoje || diasDif(hoje, p.data) > 30) return false; }
        }
        if(periodo === 'custom'){
          if(customDe && p.data < customDe) return false;
          if(customAte && p.data > customAte) return false;
        }
        if(status === 'abertas' && p.pago) return false;
        if(status === 'pagas' && !p.pago) return false;
        if(status === 'atrasado' && (p.pago || p.data >= hoje)) return false;
        if(cat && p.cat !== cat) return false;
        return true;
      });
    }

    function renderPagar(){
      const lista = document.getElementById('lista-pagar');
      const hoje = getToday();

      const filtrados = getPagamentosFiltrados();
      const sortOpt = document.getElementById('pagar-sort')?.value || 'data';
      if(sortOpt === 'data') filtrados.sort((a,b) => a.data.localeCompare(b.data));
      else if(sortOpt === 'valor_desc') filtrados.sort((a,b) => b.val - a.val);
      else if(sortOpt === 'valor_asc') filtrados.sort((a,b) => a.val - b.val);
      else if(sortOpt === 'forn') filtrados.sort((a,b) => (a.forn||'').localeCompare(b.forn||'','pt-BR'));
      else if(sortOpt === 'desc') filtrados.sort((a,b) => (a.desc||'').localeCompare(b.desc||'','pt-BR'));
      else if(sortOpt === 'status') filtrados.sort((a,b) => (a.pago?1:0) - (b.pago?1:0) || a.data.localeCompare(b.data));

      // Total do filtro (sem seleção)
      const totalFiltro = filtrados.filter(p => !p.pago).reduce((s,p) => s + p.val, 0);
      document.getElementById('total-filtrado').textContent = fmt(totalFiltro);

      if(filtrados.length === 0){
        lista.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Nenhuma conta encontrada</div>';
        return;
      }

      let html = '';
      filtrados.forEach(p => {
        const idx = pagamentos.indexOf(p);
        const isAtrasado = !p.pago && p.data < hoje;
        const badge = p.pago
          ? '<span class="badge badge-success">Pago</span>'
          : isAtrasado
            ? '<span class="badge badge-danger">Atrasado</span>'
            : '<span class="badge badge-warning">Em aberto</span>';

        const btnBaixa = !p.pago
          ? `<button class="btn-out btn-sm" style="font-size:11px;padding:3px 8px;margin-top:4px;" onclick="event.stopPropagation();abrirModalBaixa([${idx}])">✓ Baixar</button>`
          : `<div style="font-size:11px;color:#999;margin-top:2px;">${p.dataPaga ? ptDate(p.dataPaga) : ''}${p.desconto > 0 ? ' · desc '+fmt(p.desconto) : ''}${p.juros > 0 ? ' · juros '+fmt(p.juros) : ''}</div>`;

        html += `<div class="entry" onclick="editarLanc(${idx})">
          <input type="checkbox" class="cb-pagar" data-idx="${idx}" data-val="${p.val}" onclick="event.stopPropagation();atualizarContPagar()">
          <div class="entry-main">
            <div class="entry-title">${p.desc}${p.parcela ? ' <span style="font-size:10px;color:#999;">('+p.parcela+')</span>' : ''}</div>
            <div class="entry-meta">${ptDate(p.data)} • ${p.forn || 'Sem fornecedor'} • ${p.cat}</div>
          </div>
          <div style="text-align:right;">
            <div class="entry-value">${p.valorPago != null && p.pago ? fmt(p.valorPago) : fmt(p.val)}</div>
            ${badge}
            ${btnBaixa}
          </div>
        </div>`;
      });

      lista.innerHTML = html;
    }
    
    function renderCalendario(){
      const grid = document.getElementById('calendario-grid');
      const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

      document.getElementById('cal-mes-label').textContent = meses[mesAtual.getMonth()] + ' ' + mesAtual.getFullYear();
      document.getElementById('cal-toggle-conf').className = 'btn-toggle' + (calendarioMode === 'confirmado' ? ' active' : '');
      document.getElementById('cal-toggle-proj').className = 'btn-toggle' + (calendarioMode === 'projetado' ? ' active' : '');

      const ano = mesAtual.getFullYear();
      const mes = mesAtual.getMonth();
      const primeiroDia = new Date(ano, mes, 1);
      const ultimoDia = new Date(ano, mes + 1, 0);
      const diasNoMes = ultimoDia.getDate();
      const diasAnteriores = primeiroDia.getDay();
      const hoje = getToday();

      // Calcular saldo acumulado até o primeiro dia do mês (para continuar a projeção corretamente)
      // Partir de saldoAtual e simular do 1º dia do mês em diante
      const primeiroDiaMes = dateStr(new Date(ano, mes, 1));
      let saldoAcum = saldoAtual;
      // Ajustar saldo acumulado até primeiro dia do mês (em relação a hoje)
      const dHoje = parseDate(hoje);
      const dPrimeiro = new Date(ano, mes, 1);
      if(dPrimeiro < dHoje){
        // Mês passado: recalcular do início do mês
        let d = primeiroDiaMes;
        const sFim = hoje;
        saldoAcum = saldoAtual;
        // Não temos histórico real; apenas projetar do mês sem ajuste
      } else if(dPrimeiro > dHoje){
        // Mês futuro: projetar do hoje até o início do mês
        let d = hoje;
        while(d < primeiroDiaMes){
          const e = getEntrada(d);
          const entrada = calendarioMode === 'confirmado' ? e.conf : e.total;
          saldoAcum += entrada - getPag(d);
          d = addDias(d, 1);
        }
      }
      // Mês atual: saldo começa de saldoAtual (ajustado pelo loop do hoje até o dia 1)
      if(dPrimeiro <= dHoje && dHoje <= ultimoDia){
        // Já estamos neste mês — simular do dia 1 até hoje
        saldoAcum = saldoAtual;
        let d = primeiroDiaMes;
        while(d < hoje){
          const e = getEntrada(d);
          const entrada = calendarioMode === 'confirmado' ? e.conf : e.total;
          saldoAcum -= (entrada - getPag(d)); // reverter para chegar ao saldo no dia 1
          d = addDias(d, 1);
        }
      }

      let html = '<div class="cal-grid">';
      ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(d => html += `<div class="cal-header">${d}</div>`);

      // Dias mês anterior
      const mesAnt = new Date(ano, mes, 0);
      const diasMesAnt = mesAnt.getDate();
      for(let i = diasAnteriores - 1; i >= 0; i--)
        html += `<div class="cal-day outro-mes"><div class="cal-day-num">${diasMesAnt - i}</div></div>`;

      for(let dia = 1; dia <= diasNoMes; dia++){
        const data = dateStr(new Date(ano, mes, dia));
        const isHoje = data === hoje;
        const e = getEntrada(data);
        const entrada = calendarioMode === 'confirmado' ? e.conf : e.total;
        const pag = getPag(data);
        const saldoDia = entrada - pag;
        saldoAcum += saldoDia;

        const riscoLeve = reservaMinima > 0 && saldoAcum < reservaMinima && saldoAcum >= 0;
        const riscoForte = saldoAcum < 0;
        const classeRisco = riscoForte ? ' risco-forte' : riscoLeve ? ' risco-leve' : '';
        const corAcum = riscoForte ? 'var(--danger)' : riscoLeve ? '#e65c00' : 'var(--success)';

        html += `<div class="cal-day${isHoje ? ' hoje' : ''}${classeRisco}" onclick="abrirDia('${data}')">
          <div class="cal-day-num">${dia}</div>
          ${entrada > 0 ? `<div class="cal-valor-entrada">+${fmt(entrada)}</div>` : ''}
          ${pag > 0 ? `<div class="cal-valor-saida">-${fmt(pag)}</div>` : ''}
          ${e.proj > 0 && calendarioMode === 'projetado' ? `<div class="cal-valor-proj">~${fmt(e.proj)}</div>` : ''}
          ${entrada > 0 || pag > 0 ? `<div class="cal-saldo ${saldoDia >= 0 ? 'text-success' : 'text-danger'}">${fmt(saldoDia)}</div>` : ''}
          <div class="cal-acum" style="color:${corAcum};">≡ ${fmt(saldoAcum)}</div>
        </div>`;
      }

      const totalDias = diasAnteriores + diasNoMes;
      for(let dia = 1; dia <= (35 - totalDias); dia++)
        html += `<div class="cal-day outro-mes"><div class="cal-day-num">${dia}</div></div>`;

      html += '</div>';
      grid.innerHTML = html;
    }
    
    function toggleCalendario(mode){
      calendarioMode = mode;
      renderCalendario();
    }
    
    function navegarMes(direcao){
      mesAtual.setMonth(mesAtual.getMonth() + direcao);
      renderCalendario();
    }
    
    function renderFormSimulador(){
      document.getElementById('sim-parcelado').style.display = tipoSimulador === 'parcelado' ? 'block' : 'none';
    }
    
    function simular(){
      const simValorEl = document.getElementById('sim-valor');
      const valor = parseMoney(simValorEl.value) || 0;
      if(valor) simValorEl.value = fmtMoney(valor);
      const data = document.getElementById('sim-data').value;
      const resultado = document.getElementById('sim-resultado');

      // Modo parcelado com valor preenchido → sugerir melhores datas por parcela
      if(tipoSimulador === 'parcelado' && valor > 0){
        simularParcelado(valor);
        return;
      }

      // Limpa estado parcelado ao simular no modo avulso
      _simParcelasState = [];

      // Caso 1: Só valor → encontrar melhor data
      if(valor > 0 && !data){
        const melhorData = encontrarMelhorData(valor);
        if(melhorData){
          const det = simularDetalhado(valor, melhorData);
          resultado.innerHTML = `<div class="alert alert-info" style="margin-bottom:10px;">
            ✅ Melhor data para pagar <strong>${fmt(valor)}</strong>: <strong>${ptDate(melhorData)}</strong>
            <div style="margin-top:4px;font-size:12px;">Menor saldo no período: ${fmt(det.minSaldo)} (em ${ptDate(det.dataCritica)})</div>
          </div>` + renderPlanilhaSimulador(valor, melhorData);
        } else {
          resultado.innerHTML = `<div class="alert alert-danger">
            ❌ Não é viável pagar ${fmt(valor)} nos próximos 30 dias com o fluxo atual.
          </div>` + renderPlanilhaSimulador(valor, '');
        }
        return;
      }
      
      // Caso 2: Só data → calcular quanto pode pagar
      if(!valor && data){
        const maxPagar = calcularMaxPagar(data);
        resultado.innerHTML = `<div class="alert alert-info" style="margin-bottom:10px;">
          ✅ Você pode pagar até <strong>${fmt(maxPagar)}</strong> em <strong>${ptDate(data)}</strong>
          <div style="margin-top:4px;font-size:12px;">Mantendo saldo acima da reserva mínima (${fmt(reservaMinima)})</div>
        </div>` + renderPlanilhaSimulador(maxPagar, data);
        return;
      }
      
      // Caso 3: Valor + data → verificar viabilidade
      if(valor > 0 && data){
        const det = simularDetalhado(valor, data);
        const viavel = det.minSaldo >= reservaMinima;
        const diff = Math.abs(det.minSaldo - reservaMinima);

        const badge = viavel
          ? `<div class="alert alert-info">✅ Compra VIÁVEL! Menor saldo no período: <strong class="text-success">${fmt(det.minSaldo)}</strong> (em ${ptDate(det.dataCritica)})</div>`
          : `<div class="alert alert-warning">⚠️ Compra ARRISCADA. Saldo mais baixo: <strong class="text-danger">${fmt(det.minSaldo)}</strong> em ${ptDate(det.dataCritica)}<div style="margin-top:4px;font-size:11px;">Reserva mínima: ${fmt(reservaMinima)} · Faltam ${fmt(diff)} para cobrir a reserva</div></div>`;

        resultado.innerHTML = badge + renderPlanilhaSimulador(valor, data);
        return;
      }
      
      resultado.innerHTML = `<div class="alert alert-warning">Preencha pelo menos um campo (valor ou data)</div>`;
    }

    function simularParcelado(valor){
      const txt = (document.getElementById('sim-parcelas-txt').value || '').trim();
      const offsetDias = txt.split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n >= 0);
      if(offsetDias.length === 0){
        document.getElementById('sim-resultado').innerHTML = '<div class="alert alert-warning">Informe os intervalos das parcelas (ex: 30 60 90).</div>';
        return;
      }
      const n = offsetDias.length;
      const valorParcela = Math.round(valor / n * 100) / 100;
      const hoje = getToday();

      _simTotalOriginal = valor;
      _simParcelasState = offsetDias.map(d => ({
        offset: d,
        valor: valorParcela,
        data: addDias(hoje, d)
      }));

      renderSimParcelado(valor);
    }

    function renderSimParcelado(valorTotal){
      const resultado = document.getElementById('sim-resultado');
      if(!resultado) return;
      const hoje = getToday();

      // Compras acumuladas por data
      const comprasPorData = {};
      _simParcelasState.forEach(p => {
        comprasPorData[p.data] = (comprasPorData[p.data] || 0) + p.valor;
      });

      // Calcular range de dias necessário
      let maxOffset = 0;
      _simParcelasState.forEach(p => {
        const d = diasDif(hoje, p.data);
        if(d > maxOffset) maxOffset = d;
      });
      const nDias = Math.min(Math.max(simDias, maxOffset + 14), 90);

      // Simulação acumulada completa considerando TODAS as parcelas
      let saldo = saldoAtual;
      let minSaldo = saldo;
      let dataCritica = hoje;
      const saldoAcum = {};

      for(let i = 0; i < nDias; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        const entrada = simModoProj === 'conf' ? e.conf : (e.conf + e.proj);
        saldo += entrada - getPag(data) - (comprasPorData[data] || 0);
        saldoAcum[data] = saldo;
        if(saldo < minSaldo){ minSaldo = saldo; dataCritica = data; }
      }

      // Preencher simPlanilhaDados com todas as parcelas marcadas
      simPlanilhaDados = [];
      for(let i = 0; i < nDias; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        simPlanilhaDados.push({ data, conf:e.conf, proj:e.proj, pag:getPag(data), compra: comprasPorData[data] || 0 });
      }

      const viavel = minSaldo >= reservaMinima;
      const badge = viavel
        ? `<div class="alert alert-info">✅ Compra VIÁVEL — saldo mínimo: <strong>${fmt(minSaldo)}</strong> em ${ptDate(dataCritica)}</div>`
        : `<div class="alert alert-warning">⚠️ Fluxo ARRISCADO — saldo mínimo: <strong style="color:var(--danger)">${fmt(minSaldo)}</strong> em ${ptDate(dataCritica)} · Reserva: ${fmt(reservaMinima)}</div>`;

      const th2 = 'padding:6px 8px;background:#f9fafb;border:1px solid #e5e5e5;font-size:11px;text-align:left;';
      const td2 = 'padding:5px 8px;border:1px solid #e5e5e5;font-size:12px;';

      const totalAtual = _simParcelasState.reduce((s, p) => s + p.valor, 0);
      const totalInfo = _simTotalOriginal > 0
        ? `Total original: <strong>${fmt(_simTotalOriginal)}</strong> · Total atual: <strong style="color:${Math.abs(totalAtual-_simTotalOriginal)>0.05?'var(--warning)':'var(--success)'};">${fmt(totalAtual)}</strong>`
        : `Total: <strong>${fmt(totalAtual)}</strong>`;

      let tabelaHtml = `<div style="margin:12px 0;">
        <div style="font-size:12px;color:#666;margin-bottom:6px;">${totalInfo} · Altere um valor para redistribuir automaticamente as demais parcelas:</div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="${th2}">Parcela</th>
            <th style="${th2}">Data</th>
            <th style="${th2}">Valor (R$)</th>
            <th style="${th2}">Saldo após</th>
            <th style="${th2}">Status</th>
          </tr></thead><tbody>`;

      _simParcelasState.forEach((p, idx) => {
        const saldoApos = saldoAcum[p.data] !== undefined ? saldoAcum[p.data] : minSaldo;
        const pViavel = saldoApos >= reservaMinima;
        tabelaHtml += `<tr style="${!pViavel?'background:#fff5f5;':''}">
          <td style="${td2};font-weight:600;">${idx+1}/${_simParcelasState.length}</td>
          <td style="${td2};padding:2px 4px;">
            <input type="date" value="${p.data}" style="border:1px solid #e5e5e5;border-radius:4px;padding:3px 6px;font-size:12px;"
              onchange="setSimParcelaData(${idx},this.value)">
          </td>
          <td style="${td2};padding:2px 4px;">
            <input type="text" value="${fmtMoney(p.valor)}" style="border:1px solid #e5e5e5;border-radius:4px;padding:3px 6px;font-size:12px;width:110px;"
              oninput="onMoneyInput(this)"
              onblur="this.value=fmtMoney(parseMoney(this.value)||0)"
              onchange="setSimParcelaValor(${idx},this.value)">
          </td>
          <td style="${td2};font-weight:600;color:${pViavel?'var(--success)':'var(--danger)'};">${fmt(saldoApos)}</td>
          <td style="${td2};">${pViavel?'<span style="color:var(--success);font-size:11px;">✅ ok</span>':'<span style="color:var(--danger);font-size:11px;">⚠️ risco</span>'}</td>
        </tr>`;
      });

      tabelaHtml += `</tbody></table>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button class="btn-out btn-sm" onclick="recalcularSimParcelado()">↺ Recalcular</button>
          <button class="btn-out btn-sm" onclick="distribuirIgualParcelado()">= Distribuir igual</button>
        </div>
      </div>`;

      resultado.innerHTML = badge + tabelaHtml + gerarHTMLPlanilhaSimulador();
    }

    function recalcularSimParcelado(){
      if(_simParcelasState.length === 0) return;
      const total = _simParcelasState.reduce((s, p) => s + p.valor, 0);
      renderSimParcelado(total);
    }

    function distribuirIgualParcelado(){
      if(_simParcelasState.length === 0) return;
      const total = _simTotalOriginal || _simParcelasState.reduce((s, p) => s + p.valor, 0);
      const eq = Math.round(total / _simParcelasState.length * 100) / 100;
      _simParcelasState.forEach(p => { p.valor = eq; });
      renderSimParcelado(total);
    }

    function encontrarMelhorData(valor){
      const hoje = getToday();
      
      for(let i=0; i<30; i++){
        const data = addDias(hoje, i);
        const saldo = simularSaldo(valor, data);
        if(saldo >= reservaMinima){
          return data;
        }
      }
      
      return null;
    }
    
    function calcularMaxPagar(data){
      let min = 0, max = 100000, resultado = 0;
      
      while(min <= max){
        const meio = Math.floor((min + max) / 2);
        const saldo = simularSaldo(meio, data);
        
        if(saldo >= reservaMinima){
          resultado = meio;
          min = meio + 1;
        } else {
          max = meio - 1;
        }
      }
      
      return resultado;
    }
    
    function simularSaldo(valor, dataPag){
      return simularDetalhado(valor, dataPag).minSaldo;
    }

    // Retorna {minSaldo, dataCritica} — pior saldo e o dia em que ocorre
    function simularDetalhado(valor, dataPag){
      const hoje = getToday();
      let saldo = saldoAtual;
      let minSaldo = saldo;
      let dataCritica = hoje;

      for(let i=0; i<30; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        const pagDia = getPag(data) + (data === dataPag ? valor : 0);
        saldo += e.total - pagDia;
        if(saldo < minSaldo){ minSaldo = saldo; dataCritica = data; }
      }

      return {minSaldo, dataCritica};
    }
    
    function renderSKUs(){
      const tbody = document.getElementById('tbody-skus');
      const busca = document.getElementById('filtro-sku').value.toLowerCase();
      const vazio = document.getElementById('skus-vazio');

      const _kitSkus = new Set(composicaoKit.map(c => c.sku_comercial));
      let filtrados = skus.filter(s => !_kitSkus.has(s.sku) && (!busca || s.sku.toLowerCase().includes(busca) || (s.titulo||'').toLowerCase().includes(busca)));

      if(filtrados.length === 0){
        tbody.innerHTML = '';
        vazio.style.display = 'block';
        document.getElementById('sku-sel-count').textContent = '';
        return;
      }

      vazio.style.display = 'none';

      let html = '';
      filtrados.forEach((s) => {
        const idx = skus.indexOf(s);
        const total = s.custo + (s.custo * s.imposto / 100);
        // Título: próprio > vendasSku > componentes > estoqueGalpao
        const titulo = s.titulo
          || (vendasSku.find(v => v.sku === s.sku)||{}).titulo
          || (componentes.find(c => c.codigo === s.sku)||{}).descricao
          || (estoqueGalpao.find(e => e.sku === s.sku)||{}).descricao
          || '';
        html += `<tr onclick="editarSKU(${idx})" style="cursor:pointer;" title="Clique para editar">
          <td style="text-align:center;" onclick="event.stopPropagation()"><input type="checkbox" class="sku-cb" data-idx="${idx}" onchange="atualizarContSKUSel()"></td>
          <td style="font-family:monospace;font-weight:600;white-space:nowrap;">${s.sku}</td>
          <td style="font-size:12px;color:#555;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${titulo}">${titulo||'—'}</td>
          <td>${fmt(s.custo)}</td>
          <td>${s.imposto.toFixed(2)}%</td>
          <td>${fmt(total)}</td>
          <td style="text-align:center;">
            <button class="btn-out btn-sm" onclick="editarSKU(${idx})">✏️</button>
          </td>
        </tr>`;
      });

      tbody.innerHTML = html;
      makeSortable('tbody-skus', [3]);
      initResizableCols('tbody-skus');
      const selAll = document.getElementById('sku-sel-all');
      if(selAll) selAll.checked = false;
      document.getElementById('sku-sel-count').textContent = '';
      makeResizableCols(tbody.closest('table'));
    }

    let skuCurrentTab = 'lista';
    function setSkuTab(tab){
      skuCurrentTab = tab;
      ['lista','composicoes'].forEach(t => {
        const btn = document.getElementById('sku-tab-' + t);
        const view = document.getElementById('sku-view-' + t);
        if(btn) btn.classList.toggle('active', t === tab);
        if(view) view.style.display = t === tab ? '' : 'none';
      });
      const btnLista = document.getElementById('sku-header-btns-lista');
      const btnComp = document.getElementById('sku-header-btns-composicoes');
      if(btnLista) btnLista.style.display = tab === 'lista' ? '' : 'none';
      if(btnComp) btnComp.style.display = tab === 'composicoes' ? '' : 'none';
      if(tab === 'lista') renderSKUs();
      else if(tab === 'composicoes') renderComposicoesTab();
    }

    function abrirModalSKU(){
      editandoIdxSKU = null;
      document.getElementById('modal-sku-title').textContent = 'Novo SKU';
      document.getElementById('btn-del-sku').style.display = 'none';
      document.getElementById('sku-codigo').value = '';
      document.getElementById('sku-titulo').value = '';
      document.getElementById('sku-custo').value = '';
      document.getElementById('sku-imposto').value = '6.18';
      document.getElementById('modal-sku').classList.add('open');
    }

    function editarSKU(idx){
      const s = skus[idx];
      if(!s){ console.error('[editarSKU] SKU indefinido no índice', idx, '— skus.length=', skus.length); return; }
      editandoIdxSKU = idx;
      document.getElementById('modal-sku-title').textContent = 'Editar SKU';
      const btnDel = document.getElementById('btn-del-sku');
      btnDel.style.display = 'block';
      btnDel.onclick = deletarSKU;
      document.getElementById('sku-codigo').value = s.sku;
      document.getElementById('sku-titulo').value = s.titulo || '';
      document.getElementById('sku-custo').value = s.custo;
      document.getElementById('sku-imposto').value = s.imposto;
      document.getElementById('modal-sku').classList.add('open');
    }

    function salvarSKU(){
      const sku = {
        sku: document.getElementById('sku-codigo').value.trim(),
        titulo: document.getElementById('sku-titulo').value.trim(),
        custo: parseFloat(document.getElementById('sku-custo').value) || 0,
        imposto: parseFloat(document.getElementById('sku-imposto').value) || 6.18
      };

      if(!sku.sku || !sku.custo){
        alert('Preencha SKU e Custo');
        return;
      }
      
      if(editandoIdxSKU !== null){
        skus[editandoIdxSKU] = sku;
      } else {
        skus.push(sku);
      }
      
      salvar();
      fecharModal('modal-sku');
      renderSKUs();
    }
    
    function deletarSKU(){
      try {
        if(!confirm('Deletar este SKU?')) return;
        const codigo = document.getElementById('sku-codigo').value.trim();
        const idx = skus.findIndex(function(s){ return s.sku === codigo; });
        if(idx < 0){ alert('SKU não encontrado: "' + codigo + '"'); return; }
        skus.splice(idx, 1);
        salvar();
        fecharModal('modal-sku');
        renderSKUs();
      } catch(e) {
        console.error('[deletarSKU] Erro:', e);
        alert('Erro ao deletar SKU: ' + e.message);
      }
    }
    
    function abrirModalImpostoLote(){ abrirModalLoteSKU(); }
    function abrirModalLoteSKU(){
      document.getElementById('custo-lote').value = '';
      document.getElementById('imposto-lote').value = '';
      const sel = getSKUsSelecionados();
      const selRadio = document.getElementById('lote-alvo-sel');
      if(selRadio) selRadio.checked = true;
      const prev = document.getElementById('lote-preview');
      if(prev) prev.textContent = sel.length > 0 ? `${sel.length} SKU(s) selecionado(s)` : 'Nenhum SKU selecionado — escolha "Filtrados" ou "Todos"';
      document.getElementById('modal-imposto-lote').classList.add('open');
    }

    function aplicarImpostoLote(){
      const novoCusto = document.getElementById('custo-lote').value !== '' ? parseFloat(document.getElementById('custo-lote').value) : null;
      const novoImposto = document.getElementById('imposto-lote').value !== '' ? parseFloat(document.getElementById('imposto-lote').value) : null;
      if(novoCusto === null && novoImposto === null){ alert('Preencha ao menos Custo ou Imposto'); return; }
      const alvo = document.querySelector('input[name="lote-alvo"]:checked')?.value || 'todos';
      let alvos = [];
      if(alvo === 'selecionados'){
        const idxs = getSKUsSelecionados();
        if(idxs.length === 0){ alert('Nenhum SKU selecionado na tabela. Marque os checkboxes primeiro.'); return; }
        alvos = idxs.map(i => skus[i]).filter(Boolean);
      } else if(alvo === 'filtrados'){
        const busca = document.getElementById('filtro-sku').value.toLowerCase();
        alvos = skus.filter(s => !busca || s.sku.toLowerCase().includes(busca) || (s.titulo||'').toLowerCase().includes(busca));
      } else {
        alvos = skus;
      }
      alvos.forEach(s => {
        if(novoCusto !== null) s.custo = novoCusto;
        if(novoImposto !== null) s.imposto = novoImposto;
      });
      salvar();
      fecharModal('modal-imposto-lote');
      renderSKUs();
      alert(`✅ ${alvos.length} SKU(s) atualizados.`);
    }
    
    function exportarSKUs(){
      let csv = 'sku;titulo;custo;imposto\n';

      if(skus.length === 0){
        csv += 'SKU-EXEMPLO-001;Produto Exemplo A;15,50;6,18\n';
        csv += 'SKU-EXEMPLO-002;Produto Exemplo B;28,90;6,18\n';
        csv += 'SKU-EXEMPLO-003;;42,00;6,18\n';
        csv += '\n# INSTRUCOES:\n';
        csv += '# - sku: codigo do produto\n';
        csv += '# - titulo: nome/descricao (opcional)\n';
        csv += '# - custo: custo em reais (use ponto ou virgula)\n';
        csv += '# - imposto: % de imposto (padrao 6.18)\n';
        csv += '# - Apague os exemplos e preencha com seus SKUs\n';
      } else {
        csv += skus.map(s => `${s.sku};${s.titulo||''};${s.custo.toFixed(2).replace('.',',')};${s.imposto.toFixed(2).replace('.',',')}`).join('\n');
      }
      
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'skus_' + getToday() + '.csv';
      a.click();
    }
    
    function importarSKUs(){
      const file = document.getElementById('import-skus-csv').files[0];
      if(!file) return;
      
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const lines = e.target.result.split('\n');
          let count = 0;
          
          for(let i = 1; i < lines.length; i++){
            const line = lines[i].trim();
            if(!line || line.startsWith('#')) continue;
            
            // Suporta separador ; ou , (alguns relatórios usam vírgula como separador de coluna)
            const sep = line.includes(';') ? ';' : ',';
            const parts = line.split(sep);
            if(parts.length < 2) continue;

            const sku = parts[0].trim();
            // Detecta se linha tem campo titulo (4 colunas: sku;titulo;custo;imposto) ou 3 (sku;custo;imposto)
            const normDec = s => {
              if(!s) return '';
              s = s.trim();
              if(s.includes('.') && s.includes(',')) return s.replace(/\./g,'').replace(',','.');
              if(s.includes(',')) return s.replace(',','.');
              return s;
            };
            let titulo = '', custo, imposto;
            if(parts.length >= 4){
              titulo = parts[1].trim();
              custo = parseFloat(normDec(parts[2]));
              imposto = parts[3] ? parseFloat(normDec(parts[3])) : 6.18;
            } else {
              custo = parseFloat(normDec(parts[1]));
              imposto = parts[2] ? parseFloat(normDec(parts[2])) : 6.18;
            }

            if(!sku || isNaN(custo)) continue;

            const idx = skus.findIndex(s => s.sku === sku);
            if(idx >= 0){
              skus[idx] = {sku, titulo, custo, imposto};
            } else {
              skus.push({sku, titulo, custo, imposto});
            }
            count++;
          }
          
          salvar();
          renderSKUs();
          alert(count + ' SKU(s) importado(s)/atualizados!');
        } catch(err){
          alert('Erro ao importar: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
