// ===== RENDERS =====
    function renderDashboard(){
      if(typeof renderPainelCaixa === 'function') renderPainelCaixa();
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
      const planKpis = document.getElementById('plan-kpis');
      if(planKpis) planKpis.style.display = mode === 'tabela' ? '' : 'none';
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
        const corAcum = riscoForte ? 'var(--danger)' : riscoLeve ? '#e65c00' : 'var(--info)';
        const confDia = Math.min(e.conf, entrada), projDia = Math.max(0, entrada - confDia);

        html += `<div class="cal-day${isHoje ? ' hoje' : ''}${classeRisco}" title="${ptDate(data)}${confDia > 0 ? ' · confirmado ' + fmt(confDia) : ''}${projDia > 0 ? ' · projetado ' + fmt(projDia) : ''}${pag > 0 ? ' · saiu ' + fmt(pag) : ''} · saldo acumulado ${fmt(saldoAcum)}">
          <div class="cal-day-num">${dia}${typeof feriadoTag === 'function' ? feriadoTag(data) : ''}</div>
          ${confDia > 0 ? `<div class="cal-valor-entrada">+${fmtCal(confDia)}</div>` : ''}
          ${projDia > 0 ? `<div class="cal-valor-proj">+${fmtCal(projDia)}</div>` : ''}
          ${pag > 0     ? `<div class="cal-valor-saida">-${fmtCal(pag)}</div>`     : ''}
          ${(entrada > 0 || pag > 0) ? `<div class="cal-saldo ${saldoDia >= 0 ? 'cal-pos' : 'cal-neg'}">${fmtCal(saldoDia)}</div>` : ''}
          <div class="cal-acum" style="color:${corAcum};">≡ ${fmtCal(saldoAcum)}</div>
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
      document.querySelectorAll('#plan-periodos .chip, #plan-periodos .period-btn').forEach(b => b.classList.remove('active'));
      if(btn) btn.classList.add('active');
      renderPlanilha();
    }

    function togglePlanilhaCustom(){
      planilhaCustomMode = true;
      document.getElementById('plan-custom-range').style.display = 'flex';
      document.querySelectorAll('#plan-periodos .chip, #plan-periodos .period-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('plan-btn-custom').classList.add('active');
      renderPlanilha();
    }

    // Contas que vencem em um dia (aberto pelo valor da coluna "Contas a pagar")
    function planDiaDetalhe(d){
      if(typeof vmlModal !== 'function') return;
      const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const itens = pagamentos.filter(p => p.data === d && !p.pago).sort((a,b) => b.val - a.val);
      const total = itens.reduce((s,p) => s + p.val, 0);
      vmlModal('Contas de ' + ptDate(d) + ' · ' + nomeDia(d), `<table><thead><tr><th>Descrição</th><th>Fornecedor</th><th>Categoria</th><th style="text-align:right;">Valor</th></tr></thead><tbody>
          ${itens.map(p => `<tr><td>${esc(p.desc)}${p.parcela ? ' <span class="ap-parc">' + esc(p.parcela) + '</span>' : ''}</td><td>${esc(p.forn || '—')}</td><td>${esc(p.cat || '—')}</td><td style="text-align:right;font-weight:650;white-space:nowrap;">${fmt(p.val)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="3" style="font-weight:700;">Total do dia</td><td style="text-align:right;font-weight:750;white-space:nowrap;">${fmt(total)}</td></tr></tfoot></table>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="fecharModal('modal-vml');planVerNoPagar('${d}')">Abrir em Contas a pagar</button>`);
    }

    function planVerNoPagar(d){
      nav('pagar');
      const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
      set('filtro-busca', ''); set('filtro-cat', ''); set('filtro-periodo', 'custom'); set('filtro-status', 'abertas');
      set('filtro-de', d); set('filtro-ate', d);
      onFiltroPeridoChange();
    }

    function renderPlanilha(){
      const tbody = document.getElementById('tbody-planilha');
      const hoje = getToday();

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

      // 1) calcula os dias
      const dias = [];
      let saldoAcum = saldoAtual;
      let d = dataIni;
      while(d <= dataFim && dias.length < 800){
        const e = getEntrada(d);
        const entrada = showProj ? e.total : e.conf;
        const pag = getPag(d);
        saldoAcum += entrada - pag;
        // hoje: o que já caiu do Mercado Livre aparece na linha (senão o dia fica zerado e parece negativo no fim da tarde).
        // No saldo acumulado só entra o que ainda falta cair: o que já caiu está no saldo em caixa.
        let jaCaiu = 0;
        if(d === hoje){ try { jaCaiu = typeof hojeRecebido === 'function' ? hojeRecebido(typeof contaAtiva !== 'undefined' ? contaAtiva : '') : 0; } catch(err){} }
        dias.push({ d, e, entrada, pag, jaCaiu, saldoDia: entrada + jaCaiu - pag, saldoAcum });
        d = addDias(d, 1);
      }

      // 2) resumo do período
      const tot = dias.reduce((t, x) => { t.conf += x.e.conf; t.proj += x.e.proj; t.ent += x.entrada; t.pag += x.pag; return t; }, { conf:0, proj:0, ent:0, pag:0 });
      const menor = dias.reduce((m, x) => !m || x.saldoAcum < m.saldoAcum ? x : m, null);
      const final = dias.length ? dias[dias.length - 1].saldoAcum : saldoAtual;
      const risco = v => v < 0 || (reservaMinima > 0 && v < reservaMinima);
      const diasRisco = dias.filter(x => risco(x.saldoAcum)).length;
      const kp = document.getElementById('plan-kpis');
      if(kp){
        const k = (cls, rot, val, sub) => `<div class="kpi ${cls}"><div class="kpi-label">${rot}</div><div class="kpi-value">${val}</div><div class="kpi-sub">${sub}</div></div>`;
        kp.innerHTML =
          k('k-neutro', 'Saldo hoje', fmt(saldoAtual), reservaMinima > 0 ? 'Reserva mínima <b>' + fmt(reservaMinima) + '</b>' : 'Saldo informado em caixa') +
          k('k-mc', 'Entradas no período', fmt(tot.ent), showProj ? 'Confirmado <b>' + fmt(tot.conf) + '</b>' : 'Confirmado pelo Mercado Livre') +
          k('k-atraso', 'Contas a pagar', fmt(tot.pag), dias.filter(x => x.pag > 0).length + ' dias com vencimento') +
          k(risco(final) ? 'k-atraso' : 'k-venda', 'Saldo no fim do período', fmt(final), (final - saldoAtual >= 0 ? '+ ' : '− ') + fmt(Math.abs(final - saldoAtual)) + ' no período') +
          k(menor && risco(menor.saldoAcum) ? 'k-atraso' : 'k-frete', 'Menor saldo', menor ? fmt(menor.saldoAcum) : '—',
            menor ? 'em ' + ptDate(menor.d) + (diasRisco ? ' · <b>' + diasRisco + (diasRisco === 1 ? ' dia' : ' dias') + ' abaixo da reserva</b>' : '') : '');
      }

      // 3) tabela — a barra do saldo acumulado é proporcional ao maior saldo do período
      const maxAbs = Math.max(1, ...dias.map(x => Math.abs(x.saldoAcum)));
      const html = dias.map(x => {
        const emRisco = risco(x.saldoAcum);
        const dow = parseDate(x.d).getDay();
        const cls = (x.d === hoje ? ' fx-hoje' : '') + (dow === 0 || dow === 6 ? ' fx-fds' : '') + (emRisco ? ' fx-risco' : '');
        const larg = Math.round(Math.abs(x.saldoAcum) / maxAbs * 100);
        return `<tr class="fx-row${cls}">
          <td>${ptDate(x.d)}${x.d === hoje ? ' <span class="fx-tag">hoje</span>' : ''}</td>
          <td class="fx-dia">${nomeDia(x.d)}</td>
          <td class="num ${x.e.conf + (x.jaCaiu || 0) > 0 ? 'fx-ent' : 'fx-zero'}" ${x.jaCaiu ? `title="Já recebido hoje: ${fmt(x.jaCaiu)} · ainda a receber hoje: ${fmt(x.e.conf)}"` : ''}>${x.e.conf + (x.jaCaiu || 0) > 0 ? fmt(x.e.conf + (x.jaCaiu || 0)) : '—'}${x.jaCaiu ? `<div class="fx-sub">${fmt(x.jaCaiu)} já recebido</div>` : ''}</td>
          ${showProj ? `<td class="num fx-proj">${x.e.proj > 0 ? fmt(x.e.proj) : '—'}</td><td class="num" style="font-weight:600;">${fmt(x.entrada + (x.jaCaiu || 0))}</td>` : ''}
          <td class="num">${x.pag > 0 ? `<a class="fx-link" onclick="planDiaDetalhe('${x.d}')" title="Ver as contas deste dia">${fmt(x.pag)}</a>` : '—'}</td>
          <td class="num ${x.saldoDia < 0 ? 'text-danger' : x.saldoDia > 0 ? 'text-success' : 'fx-zero'}">${fmt(x.saldoDia)}</td>
          <td class="num fx-acum${emRisco ? ' text-danger' : ''}"><span class="fx-bar" style="width:${larg}%;"></span><span class="fx-acum-v">${fmt(x.saldoAcum)}</span></td>
          <td class="num fx-cob">${x.pag > 0 ? Math.round(x.saldoAcum / x.pag) + 'd' : '—'}</td>
        </tr>`;
      }).join('');

      tbody.innerHTML = html || '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted);">Nenhum dado no período</td></tr>';
      const tfoot = document.getElementById('tfoot-planilha');
      if(tfoot) tfoot.innerHTML = dias.length ? `<tr><td colspan="2">Total do período</td>
          <td class="num fx-ent">${fmt(tot.conf)}</td>
          ${showProj ? `<td class="num fx-proj">${fmt(tot.proj)}</td><td class="num">${fmt(tot.ent)}</td>` : ''}
          <td class="num text-danger">${fmt(tot.pag)}</td>
          <td class="num ${tot.ent - tot.pag < 0 ? 'text-danger' : 'text-success'}">${fmt(tot.ent - tot.pag)}</td>
          <td class="num">${fmt(final)}</td><td></td></tr>` : '';
      makeSortable('tbody-planilha', [8]);
      initResizableCols('tbody-planilha');

      const labelEl = document.getElementById('plan-label-periodo');
      if(labelEl) labelEl.textContent = 'De ' + ptDate(dataIni) + ' até ' + ptDate(dataFim) + ' · ' + (showProj ? 'recebimentos confirmados mais a projeção de vendas' : 'somente recebimentos já confirmados pelo Mercado Livre');
    }

    function onFiltroPeridoChange(){
      const periodo = document.getElementById('filtro-periodo')?.value || '';
      const customRange = document.getElementById('filtro-custom-range');
      if(customRange) customRange.style.display = periodo === 'custom' ? 'flex' : 'none';
      renderPagar();
    }

    // mês escolhido no botão "Mês" de Contas a pagar ("AAAA-MM")
    let pagarMesSel = '';
    function pagarMes(){ return pagarMesSel || getToday().substring(0, 7); }
    function pagarMesAndar(n){
      const [a, m] = pagarMes().split('-').map(Number), d = new Date(a, m - 1 + n, 1);
      pagarMesSel = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      pagarFiltro('mescal', '');
    }
    function pagarMesRotulo(){ const [a, m] = pagarMes().split('-'); return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(m) - 1] + '/' + a.substring(2); }
    // estorno direto na lista: a conta volta a ficar em aberto (dois cliques para confirmar)
    function pagarEstornar(idx, bt){
      const p = pagamentos[idx]; if(!p || !p.pago) return;
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar estorno'; setTimeout(() => { if(bt.isConnected){ bt.dataset.conf = ''; bt.textContent = 'Estornar'; } }, 5000); return; }
      p.pago = false; p.valorPago = null; p.dataPaga = null; p.desconto = 0; p.juros = 0;
      if(p.fonte === 'olist'){ p.travas = Array.isArray(p.travas) ? p.travas : []; if(!p.travas.includes('pago')) p.travas.push('pago'); }
      if(typeof salvar === 'function') salvar();
      if(typeof saldoRecalcular === 'function') saldoRecalcular();
      if(typeof recalc === 'function') recalc();
      renderPagar();
      if(typeof toast === 'function') toast('Pagamento estornado: a conta voltou para "em aberto".');
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
        else if(periodo === 'mescal') labelEl.textContent = (status === 'criadas' ? 'Contas criadas em ' : status === 'pagas' ? 'Contas pagas em ' : 'Contas com vencimento em ') + pagarMesRotulo();
        else labelEl.textContent = '';
      }

      const isPagas = status === 'pagas', isCriadas = status === 'criadas', mesSel = pagarMes();
      return pagamentos.filter(p => {
        // "Criadas": pela data em que a conta foi lançada no sistema, não pelo vencimento
        if(isCriadas){
          if(busca && !p.desc.toLowerCase().includes(busca) && !(p.forn || '').toLowerCase().includes(busca)) return false;
          const c = p.criadoEm || '';
          if(!c) return false;
          if(periodo === 'dia' && c !== hoje) return false;
          if(periodo === 'semana' && (c > hoje || diasDif(c, hoje) > 7)) return false;
          if(periodo === 'mes' && (c > hoje || diasDif(c, hoje) > 30)) return false;
          if(periodo === 'mescal' && c.substring(0, 7) !== mesSel) return false;
          if(periodo === 'custom' && ((customDe && c < customDe) || (customAte && c > customAte))) return false;
          if(cat && p.cat !== cat) return false;
          return true;
        }
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
        if(periodo === 'mescal' && String(dataRef || '').substring(0, 7) !== mesSel) return false;
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

    function apEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // Filtros rápidos (botões e cartões do topo): gravam nos <select> ocultos, que seguem sendo a fonte dos filtros
    function pagarFiltro(periodo, status){
      const sp = document.getElementById('filtro-periodo'), ss = document.getElementById('filtro-status');
      if(periodo && sp) sp.value = periodo;
      if(status && ss) ss.value = status;
      onFiltroPeridoChange();
      if(typeof pagarViewMode !== 'undefined' && pagarViewMode === 'kanban') renderKanbanPagar();
    }

    function pagarLimparFiltros(){
      const b = document.getElementById('filtro-busca'), c = document.getElementById('filtro-cat');
      if(b) b.value = '';
      if(c) c.value = '';
      pagarFiltro('todos', 'todas');
    }

    // Cartões de resumo e botões de filtro (não dependem do filtro aplicado)
    function renderPagarTopo(){
      const hoje = getToday(), d7 = addDias(hoje, 7), d30 = addDias(hoje, 30), mes = hoje.substring(0, 7);
      const g = { atr:[0,0], hoje:[0,0], d7:[0,0], d30:[0,0], pago:[0,0], aberto:[0,0] };
      const soma = (k, v) => { g[k][0] += v; g[k][1]++; };
      pagamentos.forEach(p => {
        const v = Number(p.val) || 0;
        if(p.pago){
          if(String(p.dataPaga || p.data).substring(0, 7) === mes) soma('pago', p.valorPago != null ? Number(p.valorPago) || 0 : v);
          return;
        }
        soma('aberto', v);
        if(p.data < hoje){ soma('atr', v); return; }
        if(p.data === hoje) soma('hoje', v);
        if(p.data <= d7) soma('d7', v);
        if(p.data <= d30) soma('d30', v);
      });
      const qtd = n => n + (n === 1 ? ' conta' : ' contas');
      const card = (cls, rot, k, per, st) => `<div class="kpi ${cls}" onclick="pagarFiltro('${per}','${st}')" title="Mostrar na lista">
          <div class="kpi-label">${rot}</div><div class="kpi-value">${fmt(g[k][0])}</div><div class="kpi-sub">${qtd(g[k][1])}</div></div>`;
      const kp = document.getElementById('pagar-kpis');
      if(kp) kp.innerHTML = card('k-atraso', 'Atrasadas', 'atr', 'todos', 'atrasado') + card('k-hoje', 'Vence hoje', 'hoje', 'dia', 'abertas') +
        card('k-frete', 'Próximos 7 dias', 'd7', 'semana', 'abertas') + card('k-venda', 'Próximos 30 dias', 'd30', 'mes', 'abertas') +
        card('k-mc', 'Pago neste mês', 'pago', 'mes', 'pagas');
      const sub = document.getElementById('pagar-sub');
      if(sub){
        sub.textContent = g.aberto[1] ? qtd(g.aberto[1]) + ' em aberto, somando ' + fmt(g.aberto[0]) : 'Nenhuma conta em aberto';
        const nOc = (typeof pagTodos === 'function' ? pagTodos() : []).filter(x => x.oculta).length;
        if(nOc) sub.innerHTML += ` · <a class="fx-link" style="color:var(--primary);cursor:pointer;" onclick="pfOcultas()">${nOc} do Olist excluída${nOc > 1 ? 's' : ''} aqui</a>`;
      }

      const per = document.getElementById('filtro-periodo')?.value || 'mes', st = document.getElementById('filtro-status')?.value || 'abertas';
      const chips = (id, atual, ops, arg) => {
        const el = document.getElementById(id);
        if(el) el.innerHTML = ops.map(([v, n]) => `<button class="chip ${v === atual ? 'active' : ''}" onclick="pagarFiltro(${arg(v)})">${n}</button>`).join('');
      };
      chips('pagar-chips-periodo', per, [['dia','Hoje'],['semana','7 dias'],['mes','30 dias'],['mescal','Mês'],['todos','Tudo'],['custom','Período']], v => `'${v}',''`);
      // o botão "Mês" ganha o nome do mês e setas para andar
      const elPer = document.getElementById('pagar-chips-periodo'), btMes = elPer && [...elPer.querySelectorAll('.chip')].find(b => b.textContent === 'Mês');
      if(btMes){
        if(per === 'mescal') btMes.outerHTML = `<span class="chip active chip-mes"><button onclick="pagarMesAndar(-1)" title="Mês anterior" aria-label="Mês anterior">‹</button><b>${pagarMesRotulo()}</b><button onclick="pagarMesAndar(1)" title="Próximo mês" aria-label="Próximo mês">›</button></span>`;
        else btMes.title = 'Escolher um mês inteiro (depois use as setas para trocar)';
      }
      chips('pagar-chips-status', st, [['abertas','Em aberto'],['atrasado','Atrasadas'],['pagas','Pagas'],['todas','Todas'],['criadas','Criadas']], v => `'','${v}'`);
      const elSt = document.getElementById('pagar-chips-status'), btCr = elSt && [...elSt.querySelectorAll('.chip')].find(b => b.textContent === 'Criadas');
      if(btCr) btCr.title = 'Contas que você lançou no período escolhido, vençam quando vencerem. Bom para ver o que foi criado no mês.';
    }

    function renderPagar(){
      const lista = document.getElementById('lista-pagar');
      const hoje = getToday();

      const filtrados = getPagamentosFiltrados();
      const sortOpt = document.getElementById('pagar-sort')?.value || 'data';
      const atrasada = p => !p.pago && p.data < hoje;
      // por vencimento: atrasadas primeiro, depois na ordem das datas
      if(sortOpt === 'data') filtrados.sort((a,b) => (atrasada(b) ? 1 : 0) - (atrasada(a) ? 1 : 0) || a.data.localeCompare(b.data));
      else if(sortOpt === 'valor_desc') filtrados.sort((a,b) => b.val - a.val);
      else if(sortOpt === 'valor_asc') filtrados.sort((a,b) => a.val - b.val);
      else if(sortOpt === 'forn') filtrados.sort((a,b) => (a.forn||'').localeCompare(b.forn||'','pt-BR'));
      else if(sortOpt === 'desc') filtrados.sort((a,b) => (a.desc||'').localeCompare(b.desc||'','pt-BR'));
      else if(sortOpt === 'status') filtrados.sort((a,b) => (a.pago?1:0) - (b.pago?1:0) || a.data.localeCompare(b.data));

      renderPagarTopo();

      // Total em aberto do filtro
      const totalFiltro = filtrados.filter(p => !p.pago).reduce((s,p) => s + p.val, 0);
      document.getElementById('total-filtrado').textContent = fmt(totalFiltro);
      const qtdEl = document.getElementById('pagar-qtd');
      if(qtdEl) qtdEl.textContent = filtrados.length + (filtrados.length === 1 ? ' conta' : ' contas');

      if(filtrados.length === 0){
        lista.innerHTML = `<div class="ap-vazio"><b>Nenhuma conta neste filtro</b><span>Mude o vencimento ou a situação acima, ou veja tudo.</span>
          <button class="btn-out btn-sm" onclick="pagarLimparFiltros()">Mostrar todas</button></div>`;
        if(typeof atualizarContPagar === 'function') atualizarContPagar();
        return;
      }

      const valorDe = p => p.valorPago != null && p.pago ? Number(p.valorPago) || 0 : p.val;
      const semana = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
      const dm = d => d.substring(8, 10) + '/' + d.substring(5, 7) + (d.substring(0, 4) !== hoje.substring(0, 4) ? '/' + d.substring(0, 4) : '');
      const quando = p => {
        if(p.pago) return p.dataPaga ? 'pago em ' + dm(p.dataPaga) : 'pago';
        const n = diasDif(hoje, p.data);
        if(n === 0) return 'hoje';
        if(n === 1) return 'amanhã';
        if(n === -1) return 'ontem';
        return n < 0 ? 'há ' + (-n) + ' dias' : 'em ' + n + ' dias';
      };

      const linha = p => {
        const idx = pagamentos.indexOf(p);
        const atr = atrasada(p);
        const badge = p.pago
          ? '<span class="badge badge-success">Pago</span>'
          : atr
            ? '<span class="badge badge-danger">Atrasado</span>'
            : '<span class="badge badge-warning">Em aberto</span>';
        const extra = p.pago && (p.desconto > 0 || p.juros > 0)
          ? `<div class="ap-extra">${p.desconto > 0 ? 'desc. ' + fmt(p.desconto) : ''}${p.desconto > 0 && p.juros > 0 ? ' · ' : ''}${p.juros > 0 ? 'juros ' + fmt(p.juros) : ''}</div>` : '';
        const acao = !p.pago
          ? `<button class="btn-out btn-sm" onclick="event.stopPropagation();abrirModalBaixa([${idx}])">Dar baixa</button>`
          : `<button class="btn-out btn-sm ap-estorno" title="Desfaz a baixa: a conta volta para em aberto e o valor volta para o saldo" onclick="event.stopPropagation();pagarEstornar(${idx}, this)">Estornar</button>`;

        return `<div class="entry ap-row${atr ? ' ap-atr' : ''}${p.pago ? ' ap-pago' : ''}" onclick="editarLanc(${idx})">
          <input type="checkbox" class="cb-pagar" data-idx="${idx}" data-val="${p.val}" onclick="event.stopPropagation();atualizarContPagar()">
          <div class="ap-data"><b>${dm(p.data)}</b><span>${quando(p)}</span></div>
          <div class="entry-main ap-main">
            <div class="entry-title">${apEsc(p.desc)}${p.parcela ? ' <span class="ap-parc">' + apEsc(p.parcela) + '</span>' : ''}${typeof lojaEtiqueta === 'function' ? lojaEtiqueta(p) : ''}${Array.isArray(p.travas) && p.travas.length ? ' <span class="loja-tag" title="Você alterou esta conta aqui; esses campos não seguem mais o Olist">alterada aqui</span>' : ''}</div>
            <div class="entry-meta">${apEsc(p.forn || 'Sem fornecedor')}</div>
          </div>
          <span class="ap-cat">${apEsc(p.cat || 'Sem categoria')}</span>
          <div class="ap-val"><div class="entry-value">${fmt(valorDe(p))}</div>${extra}</div>
          <div class="ap-sit">${badge}</div>
          <div class="ap-acao">${acao}</div>
        </div>`;
      };

      let html = '';
      if(sortOpt === 'data'){
        // agrupado por vencimento, com o total de cada dia
        const grupos = [];
        filtrados.forEach(p => {
          const chave = atrasada(p) ? 'atr' : p.data;
          let g = grupos[grupos.length - 1];
          if(!g || g.chave !== chave){ g = { chave, itens: [] }; grupos.push(g); }
          g.itens.push(p);
        });
        grupos.forEach(g => {
          const n = g.chave === 'atr' ? null : diasDif(hoje, g.chave);
          const nome = g.chave === 'atr' ? 'Atrasadas'
            : n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : semana[parseDate(g.chave).getDay()] + ', ' + dm(g.chave);
          const total = g.itens.reduce((s, p) => s + valorDe(p), 0);
          html += `<div class="ap-grupo${g.chave === 'atr' ? ' ap-g-atr' : n === 0 ? ' ap-g-hoje' : ''}"><span class="ap-g-nome">${nome}</span>
            <span class="ap-g-n">${g.itens.length} ${g.itens.length === 1 ? 'conta' : 'contas'}</span><b>${fmt(total)}</b></div>`;
          html += g.itens.map(linha).join('');
        });
      } else {
        html = filtrados.map(linha).join('');
      }

      lista.innerHTML = html;
      if(typeof atualizarContPagar === 'function') atualizarContPagar();
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
        const corAcum = riscoForte ? 'var(--danger)' : riscoLeve ? '#e65c00' : 'var(--info)';
        const confDia = Math.min(e.conf, entrada), projDia = Math.max(0, entrada - confDia);

        html += `<div class="cal-day${isHoje ? ' hoje' : ''}${classeRisco}" onclick="abrirDia('${data}')" title="${ptDate(data)}${confDia > 0 ? ' · confirmado ' + fmt(confDia) : ''}${projDia > 0 ? ' · projetado ' + fmt(projDia) : ''}${pag > 0 ? ' · saiu ' + fmt(pag) : ''} · saldo acumulado ${fmt(saldoAcum)}">
          <div class="cal-day-num">${dia}${typeof feriadoTag === 'function' ? feriadoTag(data) : ''}</div>
          ${confDia > 0 ? `<div class="cal-valor-entrada">+${fmtCal(confDia)}</div>` : ''}
          ${projDia > 0 ? `<div class="cal-valor-proj">+${fmtCal(projDia)}</div>` : ''}
          ${pag > 0 ? `<div class="cal-valor-saida">-${fmtCal(pag)}</div>` : ''}
          ${entrada > 0 || pag > 0 ? `<div class="cal-saldo ${saldoDia >= 0 ? 'cal-pos' : 'cal-neg'}">${fmtCal(saldoDia)}</div>` : ''}
          <div class="cal-acum" style="color:${corAcum};">≡ ${fmtCal(saldoAcum)}</div>
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
      let min = 0, max = 20000000, resultado = 0;
      
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
    
    let skuFiltroCusto = '';   // '' = todos · 'sem' = sem custo · 'com' = com custo
    function skuFiltrarCusto(v){ skuFiltroCusto = v; renderSKUs(); }

    function renderSKUs(){
      const tbody = document.getElementById('tbody-skus');
      const busca = document.getElementById('filtro-sku').value.toLowerCase();
      const vazio = document.getElementById('skus-vazio');
      const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

      const _kitSkus = new Set(composicaoKit.map(c => c.sku_comercial));
      const produtos = skus.filter(s => !_kitSkus.has(s.sku));
      const semCusto = s => !(Number(s.custo) > 0);

      // Resumo e filtros
      const nSem = produtos.filter(semCusto).length, nCom = produtos.length - nSem;
      const comCusto = produtos.filter(s => !semCusto(s));
      const medio = comCusto.length ? comCusto.reduce((t, s) => t + Number(s.custo), 0) / comCusto.length : 0;
      const kp = document.getElementById('sku-kpis');
      if(kp) kp.innerHTML = `
        <div class="kpi k-venda" onclick="skuFiltrarCusto('')"><div class="kpi-label">Produtos</div><div class="kpi-value">${produtos.length}</div><div class="kpi-sub">${_kitSkus.size} ${_kitSkus.size === 1 ? 'kit cadastrado' : 'kits cadastrados'}</div></div>
        <div class="kpi ${nSem ? 'k-atraso' : 'k-mc'}" onclick="skuFiltrarCusto('sem')"><div class="kpi-label">Sem custo</div><div class="kpi-value">${nSem}</div><div class="kpi-sub">${nSem ? 'A margem destes produtos fica superestimada' : 'Todos os produtos têm custo'}</div></div>
        <div class="kpi k-mc" onclick="skuFiltrarCusto('com')"><div class="kpi-label">Com custo</div><div class="kpi-value">${nCom}</div><div class="kpi-sub">${produtos.length ? Math.round(nCom / produtos.length * 100) : 0}% do cadastro</div></div>
        <div class="kpi k-neutro"><div class="kpi-label">Custo médio</div><div class="kpi-value">${fmt(medio)}</div><div class="kpi-sub">Entre os produtos com custo</div></div>`;
      const ch = document.getElementById('sku-chips');
      if(ch) ch.innerHTML = [['', 'Todos', produtos.length], ['sem', 'Sem custo', nSem], ['com', 'Com custo', nCom]]
        .map(([v, n, q]) => `<button class="chip ${v === skuFiltroCusto ? 'active' : ''}" onclick="skuFiltrarCusto('${v}')">${n}<span class="n">${q}</span></button>`).join('');

      let filtrados = produtos.filter(s => (!busca || s.sku.toLowerCase().includes(busca) || (s.titulo||'').toLowerCase().includes(busca))
        && (skuFiltroCusto === '' || (skuFiltroCusto === 'sem') === semCusto(s)));

      if(filtrados.length === 0){
        tbody.innerHTML = produtos.length ? '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted);">Nenhum produto neste filtro.</td></tr>' : '';
        vazio.style.display = produtos.length ? 'none' : 'block';
        document.getElementById('sku-sel-count').textContent = '';
        return;
      }

      vazio.style.display = 'none';

      let html = '';
      filtrados.forEach((s) => {
        const idx = skus.indexOf(s);
        // Título: próprio > vendasSku > componentes > estoqueGalpao
        const titulo = s.titulo
          || (vendasSku.find(v => v.sku === s.sku)||{}).titulo
          || (componentes.find(c => c.codigo === s.sku)||{}).descricao
          || (estoqueGalpao.find(e => e.sku === s.sku)||{}).descricao
          || '';
        html += `<tr onclick="editarSKU(${idx})" style="cursor:pointer;" title="Clique para editar">
          <td style="text-align:center;" onclick="event.stopPropagation()"><input type="checkbox" class="sku-cb" data-idx="${idx}" onchange="atualizarContSKUSel()"></td>
          <td class="sku-cod">${esc(s.sku)}</td>
          <td class="sku-tit" title="${esc(titulo)}">${esc(titulo) || '—'}</td>
          <td style="text-align:right;white-space:nowrap;">${semCusto(s) ? '<span class="badge badge-danger">Sem custo</span>' : '<b>' + fmt(Number(s.custo)) + '</b>'}</td>
          <td style="text-align:right;white-space:nowrap;">${Number(s.imposto) > 0 ? Number(s.imposto).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : '<span class="text-muted">—</span>'}</td>
          <td style="text-align:center;">
            <button class="btn-out btn-sm" onclick="event.stopPropagation();editarSKU(${idx})">Editar</button>
          </td>
        </tr>`;
      });

      tbody.innerHTML = html;
      makeSortable('tbody-skus', [3, 4]);
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
      { const im = document.getElementById('sku-imposto'); if(im){ const moda = {}; skus.forEach(x => { if(Number(x.imposto) > 0) moda[x.imposto] = (moda[x.imposto] || 0) + 1; }); const m = Object.keys(moda).sort((a, b) => moda[b] - moda[a])[0]; im.value = m || ''; } }   // sugere o imposto mais usado
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
      { const im = document.getElementById('sku-imposto'); if(im) im.value = Number(s.imposto) > 0 ? s.imposto : ''; }
      const infoEl = document.getElementById('sku-created-at-info');
      if(infoEl) infoEl.textContent = s.created_at ? ('Cadastrado em: ' + new Date(s.created_at).toLocaleString('pt-BR')) : '';
      document.getElementById('modal-sku').classList.add('open');
    }

    function salvarSKU(){
      const skuAnterior = editandoIdxSKU !== null ? skus[editandoIdxSKU] : null;
      const sku = {
        sku: document.getElementById('sku-codigo').value.trim(),
        titulo: document.getElementById('sku-titulo').value.trim(),
        custo: parseFloat(document.getElementById('sku-custo').value) || 0,
        imposto: (() => { const im = document.getElementById('sku-imposto'); return im ? (parseFloat(String(im.value).replace(',', '.')) || 0) : (skuAnterior ? (skuAnterior.imposto || 0) : 0); })(),
        id: skuAnterior ? skuAnterior.id : undefined,
        created_at: skuAnterior ? (skuAnterior.created_at || new Date().toISOString()) : new Date().toISOString()
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
    
    // mesmo percentual de imposto para os produtos marcados (ou todos)
    function skuImpostoEmMassa(){
      const marcados = [...document.querySelectorAll('.sku-cb:checked')].map(c => skus[Number(c.dataset.idx)]).filter(Boolean);
      const alvo = marcados.length ? marcados : skus;
      vmlModal('Imposto em massa', `<div style="line-height:1.6;">Aplicar o mesmo percentual de imposto sobre a venda a <b>${marcados.length ? marcados.length + ' produtos marcados' : 'todos os ' + skus.length + ' produtos e kits'}</b>.</div>
        <div class="form-group" style="margin-top:12px;max-width:220px;"><label class="form-label">Imposto (%)</label><input type="number" id="sku-imp-massa" step="0.01" min="0" max="100" placeholder="Ex.: 10,62"></div>
        <div class="text-muted" style="font-size:12.5px;">Vale para as vendas daqui para frente. Para aplicar também em vendas já feitas, use "Reprocessar" no Resumo Financeiro.</div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="skuImpostoAplicar(${marcados.length ? 'true' : 'false'})">Aplicar</button>`);
      window._skuImpAlvo = alvo;
    }
    function skuImpostoAplicar(){
      const v = parseFloat(String(document.getElementById('sku-imp-massa').value).replace(',', '.'));
      if(!(v >= 0 && v <= 100)){ toast('Informe um percentual entre 0 e 100.'); return; }
      (window._skuImpAlvo || []).forEach(s => { s.imposto = v; });
      salvar(); fecharModal('modal-vml'); renderSKUs();
      toast('Imposto de ' + String(v).replace('.', ',') + '% aplicado a ' + (window._skuImpAlvo || []).length + ' produtos.');
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
    
    function abrirModalLoteSKU(){
      document.getElementById('custo-lote').value = '';
      const sel = getSKUsSelecionados();
      const selRadio = document.getElementById('lote-alvo-sel');
      if(selRadio) selRadio.checked = true;
      const prev = document.getElementById('lote-preview');
      if(prev) prev.textContent = sel.length > 0 ? `${sel.length} SKU(s) selecionado(s)` : 'Nenhum SKU selecionado — escolha "Filtrados" ou "Todos"';
      document.getElementById('modal-imposto-lote').classList.add('open');
    }

    function aplicarImpostoLote(){
      const novoCusto = document.getElementById('custo-lote').value !== '' ? parseFloat(document.getElementById('custo-lote').value) : null;
      if(novoCusto === null){ alert('Preencha o novo custo'); return; }
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
      alvos.forEach(s => { s.custo = novoCusto; });
      salvar();
      fecharModal('modal-imposto-lote');
      renderSKUs();
      alert(`✅ ${alvos.length} SKU(s) atualizados.`);
    }
    
    function exportarSKUs(){
      let csv = 'sku;titulo;custo\n';

      if(skus.length === 0){
        csv += 'SKU-EXEMPLO-001;Produto Exemplo A;15,50\n';
        csv += 'SKU-EXEMPLO-002;Produto Exemplo B;28,90\n';
        csv += 'SKU-EXEMPLO-003;;42,00\n';
        csv += '\n# INSTRUCOES:\n';
        csv += '# - sku: codigo do produto\n';
        csv += '# - titulo: nome/descricao (opcional)\n';
        csv += '# - custo: custo em reais (use ponto ou virgula)\n';
        csv += '# - Apague os exemplos e preencha com seus SKUs\n';
      } else {
        csv += skus.map(s => `${s.sku};${s.titulo||''};${s.custo.toFixed(2).replace('.',',')}`).join('\n');
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
            // Detecta se linha tem campo titulo (3+ colunas: sku;titulo;custo[;imposto]) ou 2 (sku;custo)
            const normDec = s => {
              if(!s) return '';
              s = s.trim();
              if(s.includes('.') && s.includes(',')) return s.replace(/\./g,'').replace(',','.');
              if(s.includes(',')) return s.replace(',','.');
              return s;
            };
            let titulo = '', custo, impostoLegado;
            if(parts.length >= 4){
              titulo = parts[1].trim();
              custo = parseFloat(normDec(parts[2]));
              impostoLegado = parts[3] ? parseFloat(normDec(parts[3])) : null;
            } else if(parts.length === 3){
              // pode ser sku;titulo;custo ou sku;custo;imposto
              const v2 = parseFloat(normDec(parts[1]));
              const v3 = parseFloat(normDec(parts[2]));
              if(!isNaN(v2) && !isNaN(v3) && v3 < 100){
                custo = v2; impostoLegado = v3;
              } else {
                titulo = parts[1].trim(); custo = v3;
              }
            } else {
              custo = parseFloat(normDec(parts[1]));
            }

            if(!sku || isNaN(custo)) continue;

            const idx = skus.findIndex(s => s.sku === sku);
            const existing = idx >= 0 ? skus[idx] : null;
            const imposto = impostoLegado !== null && impostoLegado !== undefined ? impostoLegado : (existing ? existing.imposto || 0 : 0);
            if(idx >= 0){
              skus[idx] = {sku, titulo: titulo || existing.titulo || '', custo, imposto};
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
