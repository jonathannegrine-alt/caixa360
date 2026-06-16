// ===== UTILS MONETÁRIOS =====
    function onMoneyInput(el){
      const old = el.value;
      const pos = el.selectionStart;
      let v = old.replace(/[^\d,]/g, '');
      const parts = v.split(',');
      let intPart = (parts[0] || '').replace(/^0+/, '') || '';
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const result = parts.length > 1 ? intPart + ',' + parts[1].substring(0, 2) : intPart;
      el.value = result;
      const diff = result.length - old.length;
      el.setSelectionRange(Math.max(0, pos + diff), Math.max(0, pos + diff));
    }

    function parseMoney(str){
      if(!str) return 0;
      // Aceita "1.234,56" ou "1.234" (milhar) ou "1234" ou "1234,56"
      const s = String(str).trim().replace(/[R$\s]/g,'');
      // Ponto como separador de milhar: "30.000" ou "1.234.567"
      if(s.includes('.') && !s.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(s)){
        return parseFloat(s.replace(/\./g,'')) || 0;
      }
      if(s.includes(',') && s.includes('.')){
        // Formato pt-BR: 1.234,56
        return parseFloat(s.replace(/\./g,'').replace(',','.')) || 0;
      } else if(s.includes(',')){
        return parseFloat(s.replace(',','.')) || 0;
      }
      return parseFloat(s) || 0;
    }

    function fmtMoney(n){
      if(!n && n !== 0) return '';
      return n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    }

    // ===== IMPORTAR MODAL =====
    function abrirModalImportar(){
      document.getElementById('modal-importar').classList.add('open');
    }

    function baixarPlanilhaModelo(){
      const csv = '﻿' +
        'data;descricao;fornecedor;valor;categoria;pago\n' +
        '# Instruções: data no formato AAAA-MM-DD, valor com vírgula, pago: sim ou nao\n' +
        '2026-06-10;Fornecedor ABC;Fornecedor ABC;1500,00;Fornecedor;nao\n' +
        '2026-06-15;Aluguel galpão;Locadora XYZ;3200,00;Aluguel;nao\n' +
        '2026-06-20;Imposto DAS;Receita Federal;890,50;Imposto;sim\n';
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'modelo_contas_pagar.csv';
      a.click();
      fecharModal('modal-importar');
    }

    // ===== SPRINT 2 — ALERTAS INTERNOS =====
    function renderAlertasDashboard(){
      const el = document.getElementById('dash-alertas');
      if(!el) return;
      const hoje = getToday();
      const alertas = [];

      // 1. Contas em atraso
      const atrasadas = pagamentos.filter(p => !p.pago && p.data < hoje);
      if(atrasadas.length > 0){
        const total = atrasadas.reduce((s,p) => s + p.val, 0);
        alertas.push({tipo:'danger', icone:'🔴', msg:`<strong>${atrasadas.length} conta(s) em atraso</strong> — ${fmt(total)} não pago(s). Regularize para evitar juros e problemas com fornecedores.`});
      }

      // 2. Saldo abaixo da reserva mínima
      if(reservaMinima > 0 && saldoAtual < reservaMinima){
        alertas.push({tipo:'danger', icone:'⚠️', msg:`<strong>Saldo abaixo da reserva mínima.</strong> Atual: ${fmt(saldoAtual)} · Reserva: ${fmt(reservaMinima)}. Evite novos compromissos.`});
      }

      // 3. Gap de cobertura nos próximos 7 dias
      const cob = calcCobertura7d();
      if(cob.apagar > 0 && cob.entrada < cob.apagar * 0.6){
        const gap = cob.apagar - cob.entrada;
        alertas.push({tipo:'warning', icone:'📉', msg:`<strong>Próximos 7 dias:</strong> ${fmt(cob.apagar)} a pagar, apenas ${fmt(cob.entrada)} confirmado. Gap de ${fmt(gap)} — o saldo atual precisa cobrir a diferença.`});
      }

      // 4. Pior saldo projeta negativo
      const critica = calcDataCritica(30);
      if(critica.saldo < 0){
        alertas.push({tipo:'danger', icone:'🚨', msg:`<strong>Alerta crítico:</strong> saldo projetado negativo de ${fmt(Math.abs(critica.saldo))} em ${ptDate(critica.data)} (${critica.dias} dias). Revise saídas urgentemente.`});
      } else if(reservaMinima > 0 && critica.saldo < reservaMinima){
        alertas.push({tipo:'warning', icone:'⚠️', msg:`<strong>Reserva em risco:</strong> saldo mínimo projetado de ${fmt(critica.saldo)} em ${ptDate(critica.data)} — abaixo da reserva mínima.`});
      }

      if(alertas.length === 0){
        el.innerHTML = '';
        return;
      }
      el.innerHTML = alertas.map(a =>
        `<div class="alerta-banner ${a.tipo}"><span style="font-size:16px;flex-shrink:0;">${a.icone}</span><div>${a.msg}</div></div>`
      ).join('');
    }

    // ===== P5 — DRE SIMPLIFICADO =====
    function setResultadoTab(tab){
      document.getElementById('res-dre-view').style.display  = tab === 'dre'         ? '' : 'none';
      document.getElementById('res-comp-view').style.display = tab === 'comparativo' ? '' : 'none';
      document.getElementById('res-tab-dre').className  = 'resultado-tab' + (tab === 'dre'         ? ' active' : '');
      document.getElementById('res-tab-comp').className = 'resultado-tab' + (tab === 'comparativo' ? ' active' : '');
      if(tab === 'dre') renderDRE();
      else renderComparativo();
    }

    function renderDRE(){
      const el = document.getElementById('dre-body');
      if(!el) return;
      const dias = parseInt(document.getElementById('dre-periodo')?.value || 30);
      const hoje = getToday();
      const limite = addDias(hoje, -dias);

      // Receita: extrato histórico (creditados reais)
      const extFiltrado = extratoHistorico.filter(e => e.data >= limite && e.data <= hoje);
      const receitaTotal = extFiltrado.reduce((s,e) => s + (e.val_liquido || 0), 0);

      // Despesas: pagamentos marcados como pagos com impactaDRE=true
      const pagFiltrados = pagamentos.filter(p => p.pago && p.data >= limite && p.data <= hoje);
      const catsDRE = new Set(categorias.filter(c => c.impactaDRE).map(c => c.nome));
      const despesasDRE = pagFiltrados.filter(p => catsDRE.has(p.cat));
      const despesasNaoDRE = pagFiltrados.filter(p => !catsDRE.has(p.cat));

      // Agrupar despesas por categoria
      const porCat = {};
      despesasDRE.forEach(p => { porCat[p.cat] = (porCat[p.cat] || 0) + (p.valorPago || p.val); });

      const totalDespesas = Object.values(porCat).reduce((s,v) => s + v, 0);
      const resultado = receitaTotal - totalDespesas;
      const margem = receitaTotal > 0 ? (resultado / receitaTotal * 100) : 0;

      if(extFiltrado.length === 0 && pagFiltrados.length === 0){
        el.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">Sem dados suficientes para o período.<br><small>Conecte o ML e aguarde o extrato histórico acumular.</small></div>';
        return;
      }

      let html = `<div style="max-width:560px;">`;

      // Receita
      html += `<div class="dre-linha header">Receita</div>`;
      if(extFiltrado.length > 0){
        html += `<div class="dre-linha"><span>Recebimentos ML (${extFiltrado.length} dias)</span><span style="color:var(--success);font-weight:600;">${fmt(receitaTotal)}</span></div>`;
      } else {
        html += `<div class="dre-linha dre-cat"><span>Sem extrato histórico no período</span><span>—</span></div>`;
      }
      html += `<div class="dre-linha subtotal"><span><strong>Total Receita</strong></span><span style="color:var(--success);font-weight:700;">${fmt(receitaTotal)}</span></div>`;

      // Despesas
      html += `<div class="dre-linha header" style="margin-top:16px;">Despesas (impactam DRE)</div>`;
      if(Object.keys(porCat).length > 0){
        Object.entries(porCat).sort((a,b) => b[1]-a[1]).forEach(([cat,val]) => {
          html += `<div class="dre-linha dre-cat"><span>${cat}</span><span style="color:var(--danger);">(${fmt(val)})</span></div>`;
        });
      } else {
        html += `<div class="dre-linha dre-cat"><span>Nenhuma despesa paga com impacto no DRE</span><span>—</span></div>`;
      }
      html += `<div class="dre-linha subtotal"><span><strong>Total Despesas</strong></span><span style="color:var(--danger);font-weight:700;">(${fmt(totalDespesas)})</span></div>`;

      // Resultado
      const corRes = resultado >= 0 ? 'var(--success)' : 'var(--danger)';
      html += `<div class="dre-linha total" style="margin-top:12px;"><span>Resultado do Período</span><span style="color:${corRes};font-size:18px;">${resultado >= 0 ? '+' : ''}${fmt(resultado)}</span></div>`;
      html += `<div style="margin-top:8px;display:flex;gap:20px;font-size:12px;color:#666;">
        <span>Margem: <strong style="color:${corRes};">${margem.toFixed(1)}%</strong></span>
        <span>Período: ${ptDate(limite)} a ${ptDate(hoje)}</span>
        ${despesasNaoDRE.length > 0 ? `<span style="color:#999;">${despesasNaoDRE.length} pagamento(s) não impactam DRE</span>` : ''}
      </div>`;

      html += `</div>`;
      el.innerHTML = html;
    }

    // ===== P6 — COMPARATIVO MENSAL =====
    function renderComparativo(){
      const el = document.getElementById('comp-body');
      if(!el) return;

      // Agrupar extrato histórico por mês
      const receitaPorMes = {};
      extratoHistorico.forEach(e => {
        const mes = e.data.substring(0, 7); // YYYY-MM
        receitaPorMes[mes] = (receitaPorMes[mes] || 0) + (e.val_liquido || 0);
      });

      // Agrupar despesas pagas por mês (apenas impactaDRE)
      const catsDRE = new Set(categorias.filter(c => c.impactaDRE).map(c => c.nome));
      const despesaPorMes = {};
      pagamentos.filter(p => p.pago && catsDRE.has(p.cat)).forEach(p => {
        const mes = p.data.substring(0, 7);
        despesaPorMes[mes] = (despesaPorMes[mes] || 0) + (p.valorPago || p.val);
      });

      // Unir todos os meses
      const meses = [...new Set([...Object.keys(receitaPorMes), ...Object.keys(despesaPorMes)])].sort().reverse().slice(0, 12);

      if(meses.length === 0){
        el.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">Sem dados suficientes.<br><small>Conecte o ML e aguarde o extrato histórico acumular.</small></div>';
        return;
      }

      const nomeMes = m => {
        const [y, mo] = m.split('-');
        const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return nomes[parseInt(mo)-1] + '/' + y.slice(2);
      };

      let html = `<table class="comp-table">
        <thead><tr>
          <th>Mês</th>
          <th style="text-align:right;">Receita ML</th>
          <th style="text-align:right;">Despesas DRE</th>
          <th style="text-align:right;">Resultado</th>
          <th style="text-align:right;">Margem</th>
        </tr></thead><tbody>`;

      let antReceit = null;
      meses.forEach(mes => {
        const rec = receitaPorMes[mes] || 0;
        const desp = despesaPorMes[mes] || 0;
        const res = rec - desp;
        const margem = rec > 0 ? (res / rec * 100) : 0;
        const corRes = res >= 0 ? 'var(--success)' : 'var(--danger)';
        const varMes = antReceit !== null && antReceit > 0 ? ((rec - antReceit) / antReceit * 100) : null;
        const varStr = varMes !== null ? `<span style="font-size:11px;color:${varMes>=0?'var(--success)':'var(--danger)'};">${varMes>=0?'▲':'▼'}${Math.abs(varMes).toFixed(0)}%</span>` : '';
        antReceit = rec;

        html += `<tr>
          <td style="font-weight:600;">${nomeMes(mes)}</td>
          <td style="text-align:right;color:var(--success);">${rec > 0 ? fmt(rec) : '—'} ${varStr}</td>
          <td style="text-align:right;color:var(--danger);">${desp > 0 ? '('+fmt(desp)+')' : '—'}</td>
          <td style="text-align:right;font-weight:600;color:${corRes};">${rec>0||desp>0 ? (res>=0?'+':'')+fmt(res) : '—'}</td>
          <td style="text-align:right;color:${corRes};">${rec > 0 ? margem.toFixed(1)+'%' : '—'}</td>
        </tr>`;
      });

      html += '</tbody></table>';
      el.innerHTML = html;
    }

    // ===== P12 — SAÚDE PATRIMONIAL =====
    let patCfg = { markup: 0.20, desconto: 0.10, estoque_full_manual: 0, estoque_galp_manual: 0 };

    function calcPatrimonio(){
      const hoje = getToday();
      const periodoEl = document.getElementById('pat-rec-periodo');
      const periodo = periodoEl ? periodoEl.value : 'all';
      const libFiltradas = periodo === 'all'
        ? liberacoes.filter(l => l.data >= hoje)
        : liberacoes.filter(l => l.data >= hoje && diasDif(hoje, l.data) <= parseInt(periodo));
      const recConf = libFiltradas.reduce((s,l) => s + l.val, 0);

      // Projetado (informativo)
      let recProj = 0;
      for(let i=1;i<=30;i++){
        const d = addDias(hoje, i);
        const e = getEntrada(d);
        recProj += e.proj || 0;
      }

      // Estoque a custo (P11 automático ou manual)
      // Usa estoqueGalpao como fonte primária; custo vem de componentes[].custo_unitario
      // ou fallback para estoqueGalpao[].custo_medio (importado do Upseller)
      let estFull = 0, estGalpao = 0;
      const temP11 = estoqueGalpao.length > 0;
      if(temP11){
        estoqueGalpao.forEach(eg => {
          const comp = componentes.find(c => c.codigo === eg.sku);
          const custo = (comp && comp.custo_unitario > 0)
            ? comp.custo_unitario
            : (eg.custo_medio || 0);
          estFull   += (eg.qtd_full   || 0) * custo;
          estGalpao += (eg.qtd_galpao || 0) * custo;
        });
      } else {
        estFull = patCfg.estoque_full_manual || 0;
        estGalpao = patCfg.estoque_galp_manual || 0;
      }
      const estCusto = estFull + estGalpao;

      // Ativos
      const caixaAtual = saldoAtual;
      const ativos = caixaAtual + recConf + estCusto;

      // Passivos — separar dívidas reais de custos operacionais
      const catsDivida = new Set(
        categorias.filter(c => !c.tipoPassivo || c.tipoPassivo === 'divida').map(c => c.nome)
      );
      const catsOp = new Set(
        categorias.filter(c => c.tipoPassivo === 'operacional').map(c => c.nome)
      );
      const pagsAbertos = pagamentos.filter(p => !p.pago);
      const passivosDivida = pagsAbertos
        .filter(p => catsDivida.has(p.cat) || !p.cat)
        .reduce((s,p) => s + p.val, 0);
      const passivosOp = pagsAbertos
        .filter(p => catsOp.has(p.cat))
        .reduce((s,p) => s + p.val, 0);
      const passivos = passivosDivida; // cálculos patrimoniais usam só dívidas reais

      // Indicadores
      const patrimonio = ativos - passivos;
      const indiceCobertura = passivos > 0 ? ativos / passivos : Infinity;
      const endivLiquido = passivos - caixaAtual - recConf;

      // Cenários
      const markup = patCfg.markup;
      const desconto = patCfg.desconto;
      const cenCons = caixaAtual + recConf + estCusto - passivos;
      const cenReal = caixaAtual + recConf + estCusto * (1 + markup) - passivos;
      const cenEst  = caixaAtual + recConf + estCusto * (1 - desconto) - passivos;

      return { caixaAtual, recConf, recProj, estFull, estGalpao, estCusto, ativos, passivos, passivosDivida, passivosOp, patrimonio, indiceCobertura, endivLiquido, cenCons, cenReal, cenEst, temP11 };
    }

    function renderPatrimonio(){
      const d = calcPatrimonio();
      const markup = parseFloat(document.getElementById('pat-markup')?.value || 20);
      const desconto = parseFloat(document.getElementById('pat-desconto')?.value || 10);
      patCfg.markup = markup / 100;
      patCfg.desconto = desconto / 100;

      // Score
      const ic = d.indiceCobertura;
      let scoreIcon, scoreLabel, scoreColor;
      if(ic < 1){ scoreIcon='🔴'; scoreLabel='Crítico'; scoreColor='var(--danger)'; }
      else if(ic < 1.5){ scoreIcon='🟡'; scoreLabel='Atenção'; scoreColor='var(--warning)'; }
      else if(ic < 2){ scoreIcon='🟠'; scoreLabel='Regular'; scoreColor='#f97316'; }
      else { scoreIcon='🟢'; scoreLabel='Saudável'; scoreColor='var(--success)'; }

      const el = id => document.getElementById(id);
      if(el('pat-score-icon')) el('pat-score-icon').textContent = scoreIcon;
      if(el('pat-score-label')){ el('pat-score-label').textContent = scoreLabel; el('pat-score-label').style.color = scoreColor; }
      if(el('pat-cob-val')) el('pat-cob-val').textContent = ic === Infinity ? '∞' : ic.toFixed(2)+'×';
      if(el('pat-cob-bar')){ const pct = Math.min(100, ic/3*100); el('pat-cob-bar').style.width = pct+'%'; el('pat-cob-bar').style.background = scoreColor; }

      if(el('pat-ativos')) el('pat-ativos').textContent = fmt(d.ativos);
      if(el('pat-passivos')) el('pat-passivos').textContent = fmt(d.passivosDivida);
      if(el('pat-passivos-op')){
        if(d.passivosOp > 0){
          el('pat-passivos-op').textContent = `+${fmt(d.passivosOp)} operac.`;
          el('pat-passivos-op').style.display = '';
        } else {
          el('pat-passivos-op').style.display = 'none';
        }
      }
      if(el('pat-patrimonio')){ el('pat-patrimonio').textContent = (d.patrimonio>=0?'+':'')+fmt(d.patrimonio); el('pat-patrimonio').style.color = d.patrimonio>=0?'var(--success)':'var(--danger)'; }
      if(el('pat-endiv')){ el('pat-endiv').textContent = (d.endivLiquido<=0?'Coberto':'') || fmt(d.endivLiquido); el('pat-endiv').style.color = d.endivLiquido<=0?'var(--success)':'var(--danger)'; }

      if(el('pat-rec-conf')) el('pat-rec-conf').textContent = fmt(d.recConf);
      if(el('pat-rec-proj')) el('pat-rec-proj').textContent = fmt(d.recProj);

      // Tabela Ativos
      const tbA = el('pat-tbody-ativos');
      if(tbA) tbA.innerHTML = [
        ['Caixa Atual (MP + Bancos)', d.caixaAtual, false],
        ['Recebíveis Confirmados ML', d.recConf, false],
        ['Estoque FULL a Custo', d.estFull, false],
        ['Estoque Galpão a Custo', d.estGalpao, false],
        ['<strong>Total de Ativos</strong>', d.ativos, true],
      ].map(([label, val, bold]) => `<tr style="border-bottom:1px solid var(--gray-100);">
        <td style="padding:8px 12px;font-size:12px;${bold?'font-weight:700;':''}">${label}</td>
        <td style="padding:8px 12px;text-align:right;font-size:12px;${bold?'font-weight:700;':''}color:var(--success);">${fmt(val)}</td>
      </tr>`).join('');

      // Tabela Passivos
      const tbP = el('pat-tbody-passivos');
      if(tbP){
        const rowsP = [];
        if(d.passivosDivida > 0) rowsP.push(['Dívidas reais (fornecedor, imposto, empréstimo)', d.passivosDivida, false, 'var(--danger)']);
        if(d.passivosOp > 0) rowsP.push(['Custos operacionais em aberto <span style="font-size:10px;color:#999;">(não contam na liquidação)</span>', d.passivosOp, false, '#999']);
        rowsP.push([`<strong>Total Dívidas Reais</strong>`, d.passivosDivida, true, 'var(--danger)']);
        tbP.innerHTML = rowsP.map(([label, val, bold, color]) => `<tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:8px 12px;font-size:12px;${bold?'font-weight:700;':''}">${label}</td>
          <td style="padding:8px 12px;text-align:right;font-size:12px;${bold?'font-weight:700;':''}color:${color};">${fmt(val)}</td>
        </tr>`).join('');
      }

      // Cenários
      const fmtCen = v => `<span style="color:${v>=0?'var(--success)':'var(--danger)'};font-weight:700;">${v>=0?'+':''}${fmt(v)}</span>`;
      if(el('pat-cen-cons')) el('pat-cen-cons').innerHTML = fmtCen(d.cenCons);
      if(el('pat-cen-real')){ el('pat-cen-real').innerHTML = fmtCen(d.cenReal); }
      if(el('pat-cen-real-label')) el('pat-cen-real-label').textContent = `Markup: ${markup}%`;
      if(el('pat-cen-est')){ el('pat-cen-est').innerHTML = fmtCen(d.cenEst); }
      if(el('pat-cen-est-label')) el('pat-cen-est-label').textContent = `Desconto: ${desconto}%`;

      // Card manual (só aparece se P11 não tem dados)
      if(el('pat-estoque-manual-card')) el('pat-estoque-manual-card').style.display = d.temP11 ? 'none' : '';

      // Alertas
      renderAlertasPatrimonio(d, ic);
    }

    function renderAlertasPatrimonio(d, ic){
      const el = document.getElementById('pat-alertas');
      if(!el) return;
      const alertas = [];
      if(d.cenCons < 0){
        alertas.push({ tipo:'danger', msg:'🔴 Crítico: mesmo vendendo o estoque a custo, os ativos não cobrem as dívidas.' });
      }
      if(d.estCusto > 0 && d.ativos > 0 && d.estCusto / d.ativos > 0.70){
        alertas.push({ tipo:'warning', msg:'⚠️ Atenção: grande parte da sua solvência depende da venda do estoque ('+Math.round(d.estCusto/d.ativos*100)+'% dos ativos).' });
      }
      if(saldoAtual < reservaMinima && ic >= 2){
        alertas.push({ tipo:'info', msg:'ℹ️ Caixa pressionado, mas operação patrimonialmente saudável. O problema é liquidez, não solvência.' });
      }
      if(saldoAtual >= reservaMinima && ic < 1.5){
        alertas.push({ tipo:'warning', msg:'⚠️ Caixa atual parece confortável, mas a cobertura patrimonial está baixa. Evite novas dívidas sem recompor margem de segurança.' });
      }
      el.innerHTML = alertas.map(a => {
        const bg = a.tipo==='danger'?'#fef2f2;border-color:var(--danger)':a.tipo==='warning'?'#fffbeb;border-color:var(--warning)':'#eff6ff;border-color:var(--primary)';
        return `<div style="padding:10px 14px;border-radius:8px;border:1px solid;border-left:4px solid;background:${bg};margin-bottom:8px;font-size:13px;">${a.msg}</div>`;
      }).join('');
    }

    function salvarCfgPatrimonio(){
      const manual_full = parseMoney(document.getElementById('pat-est-full-manual')?.value || '0');
      const manual_galp = parseMoney(document.getElementById('pat-est-galp-manual')?.value || '0');
      patCfg.estoque_full_manual = manual_full;
      patCfg.estoque_galp_manual = manual_galp;
      const cfg = JSON.parse(localStorage.getItem('mk_config') || '{}');
      cfg.patCfg = patCfg;
      localStorage.setItem('mk_config', JSON.stringify(cfg));
    }

    async function salvarSnapshotPatrimonio(){
      if(!usuarioAtual) return;
      const d = calcPatrimonio();
      const hoje = getToday();
      const snap = {
        usuario_id: usuarioAtual.id,
        data_referencia: hoje,
        ativos_total: d.ativos,
        passivos_total: d.passivos,
        patrimonio: d.patrimonio,
        indice_cobertura: d.indiceCobertura === Infinity ? 999 : d.indiceCobertura,
        caixa: d.caixaAtual,
        recebiveis: d.recConf,
        estoque_custo: d.estCusto
      };
      try {
        await fetch(`${SUPA_URL}/rest/v1/patrimonio_snapshots`, {
          method: 'POST',
          headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session?.access_token, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(snap)
        });
      } catch(e){}
    }

    // ===== CFO CONSELHEIRO =====
    let cfoHistorico = []; // [{role:'user'|'assistant', content:'...'}]
    let cfoOnboardingFeito = false;
    let cfoPerfil = {};
    let cfoAberto = false;

    function toggleCFO(){
      cfoAberto = !cfoAberto;
      const modal = document.getElementById('cfo-modal');
      if(cfoAberto){
        modal.classList.add('open');
        if(cfoHistorico.length === 0) iniciarCFO();
      } else {
        modal.classList.remove('open');
      }
    }

    function iniciarCFO(){
      // Verificar se perfil já foi salvo
      const perfilSalvo = localStorage.getItem('mk_cfo_perfil');
      if(perfilSalvo){
        try { cfoPerfil = JSON.parse(perfilSalvo); cfoOnboardingFeito = true; } catch(e){}
      }
      if(cfoOnboardingFeito){
        adicionarMsgCFO('bot', 'Oi! Antes de olhar os números com você — o que você está pensando em fazer agora?');
      } else {
        iniciarOnboardingCFO();
      }
    }

    function iniciarOnboardingCFO(){
      const el = document.getElementById('cfo-msgs');
      el.innerHTML = '';
      cfoHistorico = [];
      const perguntas = [
        { chave:'nivel', texto:'Como você descreveria sua experiência com finanças?', opcoes:[
          {val:'iniciante',label:'Sou iniciante, aprendo enquanto uso'},
          {val:'intermediario',label:'Tenho conhecimento básico'},
          {val:'avancado',label:'Tenho boa experiência financeira'}
        ]},
        { chave:'risco', texto:'Qual é sua postura em relação ao risco financeiro?', opcoes:[
          {val:'conservador',label:'Prefiro segurança, mesmo crescendo mais devagar'},
          {val:'moderado',label:'Aceito algum risco para crescer'},
          {val:'agressivo',label:'Aceito risco alto para crescer rápido'}
        ]},
        { chave:'fase', texto:'Em que fase está sua operação agora?', opcoes:[
          {val:'sobrevivencia',label:'Estou tentando me estabilizar'},
          {val:'crescimento',label:'Estou crescendo com cuidado'},
          {val:'escala',label:'Estou escalando agressivamente'},
          {val:'estabilizacao',label:'Estou consolidando o que construí'}
        ]},
        { chave:'resposta', texto:'Como prefere receber os conselhos?', opcoes:[
          {val:'curta',label:'Curto e direto — só me diz o que fazer'},
          {val:'explicativa',label:'Quero entender o raciocínio'},
          {val:'diretiva',label:'Orientação clara sem muita explicação'}
        ]},
        { chave:'objetivo', texto:'Qual é sua principal prioridade agora?', opcoes:[
          {val:'preservar_caixa',label:'Preservar caixa e reduzir risco'},
          {val:'repor_estoque',label:'Repor estoque e manter as vendas'},
          {val:'crescer',label:'Crescer o máximo possível'},
          {val:'organizar',label:'Organizar as finanças'},
          {val:'reduzir_divida',label:'Reduzir dívidas'}
        ]}
      ];
      cfoPerfil = {};
      let etapa = 0;

      function mostrarPergunta(i){
        if(i >= perguntas.length){
          finalizarOnboardingCFO();
          return;
        }
        const p = perguntas[i];
        adicionarMsgCFO('bot', p.texto);
        const opts = document.createElement('div');
        opts.className = 'cfo-onboarding';
        p.opcoes.forEach(op => {
          const btn = document.createElement('div');
          btn.className = 'cfo-onboarding-opt';
          btn.textContent = op.label;
          btn.onclick = () => {
            cfoPerfil[p.chave] = op.val;
            adicionarMsgCFO('user', op.label);
            opts.remove();
            mostrarPergunta(i + 1);
          };
          opts.appendChild(btn);
        });
        document.getElementById('cfo-msgs').appendChild(opts);
        document.getElementById('cfo-msgs').scrollTop = 9999;
      }

      mostrarPergunta(0);
    }

    function finalizarOnboardingCFO(){
      cfoOnboardingFeito = true;
      localStorage.setItem('mk_cfo_perfil', JSON.stringify(cfoPerfil));
      adicionarMsgCFO('bot', 'Ótimo! Perfil salvo. Oi! Antes de olhar os números com você — o que você está pensando em fazer agora?');
    }

    function adicionarMsgCFO(role, texto){
      const el = document.getElementById('cfo-msgs');
      const div = document.createElement('div');
      div.className = 'cfo-msg ' + role;
      div.innerHTML = texto;
      el.appendChild(div);
      el.scrollTop = 9999;
      if(role !== 'bot' || texto !== '__loading__'){
        cfoHistorico.push({role: role === 'user' ? 'user' : 'assistant', content: texto});
      }
      return div;
    }

    function montarContextoCFO(){
      const hoje = getToday();
      const cob7 = calcCobertura7d();
      const critica = calcDataCritica(30);
      let apagarTotal7 = 0, apagarTotal15 = 0, apagarTotal30 = 0;
      for(let i=0;i<30;i++){
        const d = addDias(hoje,i);
        const v = getPag(d);
        if(i<7) apagarTotal7+=v;
        if(i<15) apagarTotal15+=v;
        apagarTotal30+=v;
      }
      let confTotal7=0, confTotal30=0;
      for(let i=0;i<30;i++){
        const d=addDias(hoje,i);
        const e=getEntrada(d);
        if(i<7) confTotal7+=e.conf;
        confTotal30+=e.total;
      }
      const tendencia = regressaoAtual ? (regressaoAtual.b > 0 ? 'positiva' : 'negativa') : 'indefinida';

      let modoOp = 'equilibrio';
      if(saldoAtual < reservaMinima) modoOp = 'defesa';
      else if(cfoPerfil.risco === 'agressivo' && cfoPerfil.fase === 'escala') modoOp = 'ataque';

      // Contexto do Motor de Reposição
      let estoqueCtx = '';
      if(estoqueGalpao.length > 0 || componentes.length > 0){
        try {
          const ranking = calcRankingReposicao();
          const criticos = ranking.filter(r => r.status === 'critico');
          const atencao = ranking.filter(r => r.status === 'atencao');
          const capitalTotal = ranking.filter(r => r.capital_necessario > 0).reduce((s,r) => s + r.capital_necessario, 0);
          const abaixoMeta = criticos.length + atencao.length;
          estoqueCtx = `\nMotor de Reposição:
  Componentes monitorados: ${ranking.length}
  SKUs críticos (ruptura < ${alertaCriticoDias}d): ${criticos.length}${criticos.length > 0 ? ' — ' + criticos.slice(0,3).map(r=>r.sku).join(', ') : ''}
  SKUs em atenção: ${atencao.length}
  SKUs abaixo da meta: ${abaixoMeta}
  Capital necessário para reposição: ${fmt(capitalTotal)}`;
        } catch(e){}
      }

      // Contexto P12 — Saúde Patrimonial
      let patrimonioCtx = '';
      try {
        const dp = calcPatrimonio();
        const ic = dp.indiceCobertura;
        const statusSolv = ic < 1 ? 'critico' : ic < 1.5 ? 'atencao' : ic < 2 ? 'regular' : 'saudavel';
        patrimonioCtx = `\nSaúde Patrimonial:
  Ativos totais: ${fmt(dp.ativos)}
  Dívidas reais (passivos liquidação): ${fmt(dp.passivosDivida)}
  Custos operacionais em aberto (não contam na liquidação): ${fmt(dp.passivosOp)}
  Patrimônio operacional: ${fmt(dp.patrimonio)}
  Índice de cobertura da dívida: ${ic === Infinity ? '∞' : ic.toFixed(2)}×
  Endividamento líquido: ${fmt(dp.endivLiquido)}
  Estoque a custo: ${fmt(dp.estCusto)}
  Liquidação conservadora: ${fmt(dp.cenCons)}
  Status de solvência: ${statusSolv}`;
      } catch(e){}

      return `[DADOS DO CAIXA 360 - ${ptDate(hoje)}]
Saldo total: ${fmt(saldoAtual)}
  Mercado Pago: ${fmt(saldoMP)}
  Outros bancos: ${fmt(saldoOutros)}
Reserva mínima: ${fmt(reservaMinima)}
Margem acima da reserva: ${fmt(Math.max(0, saldoAtual - reservaMinima))}

Contas a pagar:
  7 dias: ${fmt(apagarTotal7)}
  15 dias: ${fmt(apagarTotal15)}
  30 dias: ${fmt(apagarTotal30)}

Entradas ML:
  Confirmadas 7 dias: ${fmt(confTotal7)}
  Projeção 30 dias: ${fmt(confTotal30)}

Pior saldo projetado: ${fmt(critica.saldo)} em ${ptDate(critica.data)} (${critica.dias} dias)
Tendência: ${tendencia}
Modo de operação: ${modoOp}${estoqueCtx}${patrimonioCtx}

Perfil do usuário:
  Nível financeiro: ${cfoPerfil.nivel || 'intermediario'}
  Perfil de risco: ${cfoPerfil.risco || 'moderado'}
  Fase da operação: ${cfoPerfil.fase || 'crescimento'}
  Objetivo atual: ${cfoPerfil.objetivo || 'crescer'}
  Preferência de resposta: ${cfoPerfil.resposta || 'curta'}
[FIM DOS DADOS]`;
    }

    async function enviarMsgCFO(){
      const input = document.getElementById('cfo-input');
      const texto = input.value.trim();
      if(!texto || !usuarioAtual) return;
      input.value = '';
      input.style.height = 'auto';

      adicionarMsgCFO('user', texto);

      // Indicador de loading
      const loadingEl = document.getElementById('cfo-msgs').lastElementChild;
      const loadDiv = document.createElement('div');
      loadDiv.className = 'cfo-msg bot loading';
      loadDiv.textContent = 'Analisando seus dados...';
      document.getElementById('cfo-msgs').appendChild(loadDiv);
      document.getElementById('cfo-msgs').scrollTop = 9999;

      try {
        const { data: { session } } = await supa.auth.getSession();
        if(!session) throw new Error('Sem sessão');

        const contexto = montarContextoCFO();
        const msgs = [
          {role:'user', content: contexto + '\n\n' + texto}
        ];
        // Adicionar histórico recente (últimas 6 trocas)
        if(cfoHistorico.length > 1){
          const hist = cfoHistorico.slice(-12).filter(m => m.content !== '__loading__');
          msgs.splice(0, 0, ...hist.slice(0, -1).map(m => ({role:m.role, content:m.content})));
          msgs[msgs.length-1] = {role:'user', content: contexto + '\n\n' + texto};
        }

        const resp = await fetch(`${SUPA_URL}/functions/v1/cfo-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + session.access_token
          },
          body: JSON.stringify({ messages: msgs, perfil: cfoPerfil })
        });

        if(!resp.ok) throw new Error('Erro ' + resp.status);
        const result = await resp.json();
        loadDiv.remove();
        adicionarMsgCFO('bot', result.content || 'Sem resposta.');
      } catch(err) {
        loadDiv.remove();
        adicionarMsgCFO('bot', 'Erro ao conectar com o CFO. Verifique sua conexão e tente novamente.');
        console.error('CFO error:', err);
      }
    }
