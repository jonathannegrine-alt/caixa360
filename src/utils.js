// ===== TABLE SORTING =====
    let _sortState = {};
    function parseSortNum(s){
      const c = s.replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.');
      const n = parseFloat(c);
      return isNaN(n) ? null : n;
    }
    function _applySortDOM(tbody, colIdx, dir){
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a,b) => {
        const at = a.cells[colIdx] ? a.cells[colIdx].textContent.trim() : '';
        const bt = b.cells[colIdx] ? b.cells[colIdx].textContent.trim() : '';
        const an = parseSortNum(at), bn = parseSortNum(bt);
        let cmp = (an !== null && bn !== null) ? an - bn : at.localeCompare(bt, 'pt-BR');
        return dir === 'asc' ? cmp : -cmp;
      });
      rows.forEach(r => tbody.appendChild(r));
      const ths = tbody.closest('table')?.querySelectorAll('thead th');
      if(ths) ths.forEach((th,i) => {
        const arr = th.querySelector('.sort-arrow');
        if(!arr) return;
        if(i === colIdx){ arr.textContent = dir === 'asc' ? ' ▲' : ' ▼'; arr.style.opacity='1'; }
        else { arr.textContent = ' ⇅'; arr.style.opacity='0.35'; }
      });
    }
    function sortTableByCol(tbodyId, colIdx){
      const tbody = document.getElementById(tbodyId);
      if(!tbody) return;
      const st = _sortState[tbodyId] || {col:-1, dir:'asc'};
      const dir = (st.col === colIdx && st.dir === 'asc') ? 'desc' : 'asc';
      _sortState[tbodyId] = {col:colIdx, dir};
      _applySortDOM(tbody, colIdx, dir);
    }
    function _reapplySort(tbodyId){
      const st = _sortState[tbodyId];
      if(!st || st.col < 0) return;
      const tbody = document.getElementById(tbodyId);
      if(!tbody) return;
      _applySortDOM(tbody, st.col, st.dir);
    }
    const _savedColWidths = {};
    function initResizableCols(tbodyId){
      var tbody = document.getElementById(tbodyId);
      if(!tbody) return;
      var table = tbody.closest('table');
      if(!table) return;
      var thead = table.querySelector('thead');
      if(!thead) return;
      var ths = thead.querySelectorAll('th');
      var key = 'cw_'+tbodyId;
      var saved = _savedColWidths[key];
      if(!saved){ try{ saved=JSON.parse(localStorage.getItem(key)||'null'); }catch(e){} }
      ths.forEach(function(th,i){
        if(saved && saved[i]) th.style.minWidth=saved[i]+'px';
        if(th.querySelector('.crh')) return;
        th.style.position='relative';
        var handle=document.createElement('div');
        handle.className='crh';
        handle.title='Arrastar para redimensionar';
        handle.addEventListener('mousedown',function(e){
          if(table.style.tableLayout!=='fixed'){
            ths.forEach(function(t){ t.style.width=t.getBoundingClientRect().width+'px'; });
            table.style.tableLayout='fixed';
            table.style.width='100%';
          }
          var startX=e.clientX, startW=th.getBoundingClientRect().width;
          function onMove(e2){ th.style.width=Math.max(1,startW+e2.clientX-startX)+'px'; }
          function onUp(){
            document.removeEventListener('mousemove',onMove);
            document.removeEventListener('mouseup',onUp);
            var widths=[...ths].map(function(t){return Math.round(t.getBoundingClientRect().width);});
            _savedColWidths[key]=widths;
            try{localStorage.setItem(key,JSON.stringify(widths));}catch(er){}
          }
          document.addEventListener('mousemove',onMove);
          document.addEventListener('mouseup',onUp);
          e.preventDefault(); e.stopPropagation();
        });
        th.appendChild(handle);
      });
    }
    function makeSortable(tbodyId, skipCols){
      const skip = new Set(skipCols || []);
      const tbody = document.getElementById(tbodyId);
      if(!tbody) return;
      const table = tbody.closest('table');
      if(!table) return;
      const ths = table.querySelectorAll('thead th');
      ths.forEach((th,i) => {
        if(skip.has(i)) return;
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        if(!th.querySelector('.sort-arrow')){
          const sp = document.createElement('span');
          sp.className = 'sort-arrow';
          sp.style.cssText = 'font-size:9px;opacity:0.35;';
          sp.textContent = ' ⇅';
          th.appendChild(sp);
        }
        th.onclick = () => sortTableByCol(tbodyId, i);
      });
      makeResizableCols(table);
      _reapplySort(tbodyId);
    }

    // ===== UTILS =====
    function getToday(){
      const d = new Date();
      return dateStr(d);
    }
    
    function dateStr(d){
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }
    
    function parseDate(str){
      const [y,m,d] = str.split('-').map(Number);
      return new Date(y, m-1, d);
    }
    
    function ptDate(str){
      const [y,m,d] = str.split('-');
      return `${d}/${m}/${y}`;
    }
    
    function fmt(n){
      return 'R$ ' + n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    }
    
    function diasDif(data1, data2){
      const d1 = parseDate(data1);
      const d2 = parseDate(data2);
      return Math.floor((d2 - d1) / 86400000);
    }
    
    function addDias(data, dias){
      const d = parseDate(data);
      d.setDate(d.getDate() + dias);
      return dateStr(d);
    }
    
    function nomeDia(data){
      const d = parseDate(data);
      const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      return dias[d.getDay()];
    }
    
    function atualizarSaldoTotal(){
      saldoAtual = saldoMP + saldoOutros;
      const label = document.getElementById('saldo-total-label');
      if(label) label.textContent = fmt(saldoAtual);
      salvarCfg();
      recalc();
    }

    // Retorna somente as horas futuras de hoje (para não incluir o que já foi creditado)
    function getHojeTotal(){
      const horaAtual = new Date().getHours();
      const itens = JSON.parse(localStorage.getItem('mk_liberacoes_hoje') || '[]');
      return itens.filter(i => parseInt(i.hora) >= horaAtual).reduce((s,i) => s + i.val, 0);
    }

    // ===== CÁLCULOS =====
    function getEntrada(data){
      const hoje = getToday();
      // liberacoes contém apenas datas a partir de amanhã; para hoje, soma as horas pendentes
      let conf = liberacoes.filter(l => l.data === data).reduce((s,l) => s + l.val, 0);
      if(data === hoje) conf += getHojeTotal();

      let proj = 0;
      const diasAteData = diasDif(hoje, data);

      // D+1 a D+7: usar SOMENTE confirmado ML (sem projeção)
      // D+8 em diante: MAX(confirmado, projeção prudencial)
      if(diasAteData >= 8){
        let totalBase = 0;
        let diasBase = periodoHistoricoML;

        // Fonte primária: extrato histórico (released=yes) — creditados reais
        const limiteExt = addDias(hoje, -periodoHistoricoML);
        const extFiltrado = extratoHistorico.filter(e => e.data >= limiteExt && e.data < hoje);
        if(extFiltrado.length > 0){
          // Trimmed mean: remove os 10% maiores para evitar que picos pontuais (ex: aporte/empréstimo)
          // inflacionem a média histórica e distorçam a projeção D+8+
          let baseDados = extFiltrado;
          if(extFiltrado.length > 5){
            const sorted = [...extFiltrado].sort((a,b) => a.val_liquido - b.val_liquido);
            const trim = Math.max(1, Math.floor(sorted.length * 0.10));
            baseDados = sorted.slice(0, sorted.length - trim);
          }
          totalBase = baseDados.reduce((s,e) => s + e.val_liquido, 0);
          const dataMin = baseDados.reduce((m,e) => e.data < m ? e.data : m, baseDados[0].data);
          const dataMax = baseDados.reduce((m,e) => e.data > m ? e.data : m, baseDados[0].data);
          const spanReal = diasDif(dataMin, dataMax) + 1;
          diasBase = Math.min(periodoHistoricoML, Math.max(spanReal, baseDados.length));
        } else if(liberacoes.length > 0){
          // Fallback offline: usa liberações futuras como proxy da média diária
          const limFut = addDias(hoje, periodoHistorico);
          const libFut = liberacoes.filter(l => l.data >= hoje && l.data <= limFut);
          totalBase = libFut.reduce((s,l) => s + l.val, 0);
          diasBase = periodoHistorico;
        }

        let media;
        if(regressaoAtual && regressaoAtual.b > 0){
          // P1: projetar com regressão linear — valor esperado para a data alvo
          const xAlvo = regressaoAtual.xUltimo + diasDif(regressaoAtual.dataUltimo, data) + 1;
          const projecaoTendencia = Math.max(0, regressaoAtual.a + regressaoAtual.b * xAlvo);
          const mediaSimples = totalBase / diasBase;
          // Sanidade: tendência não pode ser <30% nem >300% da média simples
          media = (projecaoTendencia >= mediaSimples * 0.3 && projecaoTendencia <= mediaSimples * 3)
            ? projecaoTendencia : mediaSimples;
        } else {
          media = totalBase / diasBase;
        }
        const projPrudencial = media * cfgPct;
        // Complemento = MAX(0, projPrudencial - conf) → nunca diminui o confirmado
        proj = Math.max(0, projPrudencial - conf);
      }

      return {conf, proj, total: conf + proj};
    }
    
    function getPag(data){
      return pagamentos.filter(p => p.data === data && !p.pago).reduce((s,p) => s + p.val, 0);
    }
    
    function calcMediaGastoDia(){
      const hoje = getToday();
      const limite = addDias(hoje, -30);
      const pagos = pagamentos.filter(p => p.pago && p.data >= limite && p.data <= hoje);
      if(pagos.length > 0){
        return pagos.reduce((s,p) => s + (p.valorPago || p.val), 0) / 30;
      }
      // Fallback: usar pendentes dos próximos 30 dias como proxy
      const limite30 = addDias(hoje, 30);
      const pendentes = pagamentos.filter(p => !p.pago && p.data >= hoje && p.data <= limite30);
      return pendentes.reduce((s,p) => s + p.val, 0) / 30;
    }

    function calcScore(){
      const mediaGasto = calcMediaGastoDia();
      const dias = mediaGasto > 0 ? saldoAtual / mediaGasto : 30;
      return Math.min(100, Math.max(0, Math.round((dias / 30) * 100)));
    }

    function calcMaxCompra(){
      return calcularMaxPagar(getToday());
    }

    function calcPiorSaldo(){
      const hoje = getToday();
      let saldo = saldoAtual;
      let pior = saldo;

      for(let i=0; i<30; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        const entrada = planilhaMode === 'confirmado' ? e.conf : e.total;
        saldo += entrada - getPag(data);
        if(saldo < pior) pior = saldo;
      }

      return pior;
    }
    
    // ===== P3 — CENTRO DE DECISÃO =====
    function calcDataCritica(horizonte){
      const hoje = getToday();
      let saldo = saldoAtual, pior = saldo, dataPior = hoje, diasPior = 0;
      for(let i = 0; i < horizonte; i++){
        const data = addDias(hoje, i);
        saldo += getEntrada(data).total - getPag(data);
        if(saldo < pior){ pior = saldo; dataPior = data; diasPior = i + 1; }
      }
      return { saldo: pior, data: dataPior, dias: diasPior };
    }

    function calcCobertura7d(){
      const hoje = getToday();
      let apagar = 0, entrada = 0;
      for(let i = 0; i < 7; i++){
        const data = addDias(hoje, i);
        apagar  += getPag(data);
        entrada += getEntrada(data).conf;
      }
      return { apagar, entrada };
    }

    function renderCentroDecisao(){
      const el = document.getElementById('centro-decisao-body');
      if(!el) return;

      const hoje    = getToday();
      const horizonte = 30;
      const insights  = [];

      // 1. Capacidade de compra
      const maxCompra = calcMaxCompra();
      if(maxCompra > 0){
        insights.push({ tipo:'ok', icon:'✅',
          texto:`Você pode comprometer até <strong>${fmt(maxCompra)}</strong> hoje sem romper a reserva mínima nos próximos ${horizonte} dias.`,
          sub: reservaMinima > 0 ? `Reserva mínima protegida: ${fmt(reservaMinima)}` : 'Configure a reserva mínima em Configurações para uma análise mais precisa.'
        });
      } else {
        insights.push({ tipo:'danger', icon:'🔴',
          texto:`Caixa sem margem para novos compromissos nos próximos ${horizonte} dias.`,
          sub: reservaMinima > 0 ? `Reserva mínima de ${fmt(reservaMinima)} em risco.` : 'Saldo projetado insuficiente para cobrir as saídas previstas.'
        });
      }

      // 2. Data crítica / pior saldo
      const critica = calcDataCritica(horizonte);
      if(critica.saldo < 0){
        insights.push({ tipo:'danger', icon:'🔴',
          texto:`Risco de déficit de <strong>${fmt(Math.abs(critica.saldo))}</strong> em <strong>${ptDate(critica.data)}</strong> (${critica.dias} dias).`,
          sub:'Revise saídas ou antecipe recebimentos para esse período.'
        });
      } else if(reservaMinima > 0 && critica.saldo < reservaMinima){
        insights.push({ tipo:'aviso', icon:'⚠️',
          texto:`Saldo mínimo projetado: <strong>${fmt(critica.saldo)}</strong> em <strong>${ptDate(critica.data)}</strong>.`,
          sub:`Abaixo da reserva mínima (${fmt(reservaMinima)}). Atenção nesse período.`
        });
      } else if(critica.dias > 0){
        insights.push({ tipo:'ok', icon:'📉',
          texto:`Pior saldo projetado: <strong>${fmt(critica.saldo)}</strong> em <strong>${ptDate(critica.data)}</strong>.`,
          sub:'Caixa mantém-se positivo e acima da reserva mínima no horizonte de 30 dias.'
        });
      }

      // 3. Cobertura nos próximos 7 dias
      const cob = calcCobertura7d();
      if(cob.apagar > 0 && cob.entrada < cob.apagar){
        insights.push({ tipo:'aviso', icon:'⚠️',
          texto:`Próximos 7 dias: <strong>${fmt(cob.apagar)}</strong> a pagar, <strong>${fmt(cob.entrada)}</strong> confirmado. Gap de <strong>${fmt(cob.apagar - cob.entrada)}</strong>.`,
          sub:'Entradas confirmadas não cobrem as saídas desta semana. Saldo atual absorve a diferença.'
        });
      }

      // 4. Tendência de crescimento (P1)
      if(regressaoAtual && regressaoAtual.b > 0){
        const crescMensal = regressaoAtual.b * 30;
        insights.push({ tipo:'info', icon:'📈',
          texto:`Tendência de crescimento: <strong>+${fmt(Math.round(regressaoAtual.b))}/dia</strong> (+${fmt(Math.round(crescMensal))} no mês).`,
          sub:`Mantenha capital de giro de pelo menos ${fmt(Math.round(crescMensal * 0.5))} adicional para sustentar esse ritmo.`
        });
      }

      // 5. Contas em atraso
      const atrasadas = pagamentos.filter(p => !p.pago && p.data < hoje);
      if(atrasadas.length > 0){
        const totalAtrasado = atrasadas.reduce((s,p) => s + p.val, 0);
        const nomes = atrasadas.slice(0,3).map(p => p.desc).join(', ') + (atrasadas.length > 3 ? '...' : '');
        insights.push({ tipo:'danger', icon:'🔴',
          texto:`${atrasadas.length} conta${atrasadas.length > 1 ? 's' : ''} em atraso: <strong>${fmt(totalAtrasado)}</strong>. <span style="font-size:11px;text-decoration:underline;cursor:pointer;">Ver contas →</span>`,
          sub: nomes,
          onclick: 'irParaAtrasadas()'
        });
      }

      const cores = {
        ok:     {bg:'#f0fdf4', borda:'#16a34a', txt:'#14532d'},
        aviso:  {bg:'#fefce8', borda:'#ca8a04', txt:'#713f12'},
        danger: {bg:'#fef2f2', borda:'#dc2626', txt:'#7f1d1d'},
        info:   {bg:'#eff6ff', borda:'#2563eb', txt:'#1e3a8a'}
      };

      el.innerHTML = insights.slice(0, 5).map(ins => {
        const c = cores[ins.tipo] || cores.info;
        const clickStyle = ins.onclick ? 'cursor:pointer;' : '';
        const clickAttr  = ins.onclick ? `onclick="${ins.onclick}"` : '';
        return `<div ${clickAttr} style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:8px;background:${c.bg};border-left:3px solid ${c.borda};${clickStyle}">
          <span style="font-size:18px;flex-shrink:0;line-height:1.4;">${ins.icon}</span>
          <div>
            <div style="font-size:13px;color:${c.txt};line-height:1.5;">${ins.texto}</div>
            ${ins.sub ? `<div style="font-size:11px;color:#666;margin-top:3px;">${ins.sub}</div>` : ''}
          </div>
        </div>`;
      }).join('');
    }

    function irParaAtrasadas(){
      nav('pagar');
      const sel = document.getElementById('filtro-status');
      if(sel){ sel.value = 'atrasado'; renderPagar(); }
    }

    // ===== P1 — REGRESSÃO LINEAR =====
    function atualizarRegressao(){
      const hoje = getToday();
      const limiteExt = addDias(hoje, -periodoHistoricoML);
      const ext = extratoHistorico.filter(e => e.data >= limiteExt && e.data < hoje);

      if(ext.length < 14){ regressaoAtual = null; modoProjecaoAtivo = 'media'; return; }

      // Ordenar cronologicamente (array vem desc do Supabase)
      const dados = [...ext].sort((a,b) => a.data.localeCompare(b.data));
      const n = dados.length;
      const dataBase = dados[0].data;

      let sumX=0, sumY=0, sumXY=0, sumX2=0;
      dados.forEach(d => {
        const x = diasDif(dataBase, d.data);
        const y = d.val_liquido;
        sumX+=x; sumY+=y; sumXY+=x*y; sumX2+=x*x;
      });

      const denom = n*sumX2 - sumX*sumX;
      if(denom === 0){ regressaoAtual = null; modoProjecaoAtivo = 'media'; return; }

      const b = (n*sumXY - sumX*sumY) / denom;  // inclinação (R$/dia)
      const a = (sumY - b*sumX) / n;             // intercepto
      const dataUltimo = dados[n-1].data;
      const xUltimo = diasDif(dataBase, dataUltimo);

      regressaoAtual = { a, b, xUltimo, dataUltimo };
      modoProjecaoAtivo = b >= 0 ? 'tendencia' : 'media';
    }
