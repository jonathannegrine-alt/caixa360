// ===== DASHBOARD RESUMO COM FILTRO =====
    function atualizarResumo(){
      const periodo = document.getElementById('resumo-periodo').value;
      const customDiv = document.getElementById('resumo-custom');
      customDiv.style.display = periodo === 'custom' ? 'flex' : 'none';

      const hoje = getToday();
      let dataIni, dataFim;

      if(periodo === 'dia'){
        dataIni = dataFim = hoje;
      } else if(periodo === 'semana'){
        dataIni = hoje;
        dataFim = addDias(hoje, 7);
      } else if(periodo === 'mes'){
        dataIni = hoje;
        dataFim = addDias(hoje, 30);
      } else {
        dataIni = document.getElementById('resumo-de').value || hoje;
        dataFim = document.getElementById('resumo-ate').value || addDias(hoje, 30);
      }

      let conf = 0, proj = 0, pagar = 0;
      let d = dataIni;

      while(d <= dataFim){
        const e = getEntrada(d);
        conf += e.conf;
        proj += e.proj;
        pagar += getPag(d);
        d = addDias(d, 1);
      }

      const saldo = conf + proj - pagar;

      document.getElementById('resumo-entrada').textContent = fmt(conf);
      document.getElementById('resumo-proj').textContent = fmt(proj);
      document.getElementById('resumo-pagar').textContent = fmt(pagar);
      const saldoEl = document.getElementById('resumo-saldo');
      saldoEl.textContent = fmt(saldo);
      saldoEl.className = saldo >= 0 ? 'text-success' : 'text-danger';
    }

    // ===== CALENDÁRIO - CLIQUE NO DIA =====
    function abrirDia(data){
      const e = getEntrada(data);
      const pag = getPag(data);
      const pagList = pagamentos.filter(p => p.data === data && !p.pago);
      const saldo = e.total - pag;

      const itens = pagList.length > 0
        ? pagList.map(p => {
            const idx = pagamentos.indexOf(p);
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;gap:8px;">
              <span style="font-size:12px;flex:1;">${p.desc}${p.forn ? ' · '+p.forn : ''}</span>
              <span style="color:var(--danger);font-weight:600;font-size:12px;white-space:nowrap;">${fmt(p.val)}</span>
              <button class="btn-out btn-sm" style="font-size:11px;padding:3px 8px;white-space:nowrap;" onclick="fecharModal('modal-dia');abrirModalBaixa([${idx}])">✓ Baixar</button>
            </div>`;
          }).join('')
        : '<div style="font-size:12px;color:#999;padding:8px 0;">Nenhuma conta a pagar</div>';

      // Usar um alert estilizado via modal reutilizável
      if(!document.getElementById('modal-dia')){
        const m = document.createElement('div');
        m.className = 'modal';
        m.id = 'modal-dia';
        m.innerHTML = `<div class="modal-content" style="max-width:400px;">
          <div class="modal-header">
            <div class="modal-title" id="modal-dia-title">Detalhes do dia</div>
            <button class="btn-out btn-sm" onclick="fecharModal('modal-dia')">✕</button>
          </div>
          <div class="modal-body" id="modal-dia-body"></div>
          <div class="modal-footer"><button class="btn-out" onclick="fecharModal('modal-dia')">Fechar</button></div>
        </div>`;
        document.body.appendChild(m);
      }

      document.getElementById('modal-dia-title').textContent = ptDate(data) + ' (' + nomeDia(data) + ')';
      document.getElementById('modal-dia-body').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px;">
          <div style="padding:10px;background:#f0fdf4;border-radius:6px;">
            <div style="font-size:10px;color:#666;">Entrada ML</div>
            <div style="font-weight:600;color:var(--success);">${fmt(e.conf)}</div>
            ${e.proj > 0 ? `<div style="font-size:10px;color:#0891b2;">+ proj: ${fmt(e.proj)}</div>` : ''}
          </div>
          <div style="padding:10px;background:#fef2f2;border-radius:6px;">
            <div style="font-size:10px;color:#666;">A Pagar</div>
            <div style="font-weight:600;color:var(--danger);">${fmt(pag)}</div>
          </div>
        </div>
        <div style="padding:10px;background:${saldo>=0?'#f0fdf4':'#fef2f2'};border-radius:6px;margin-bottom:15px;">
          <div style="font-size:10px;color:#666;">Saldo do dia</div>
          <div style="font-weight:700;font-size:18px;color:${saldo>=0?'var(--success)':'var(--danger)'};">${fmt(saldo)}</div>
        </div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Contas a pagar:</div>
        ${itens}
      `;

      document.getElementById('modal-dia').classList.add('open');
    }

    // ===== IMPORTAR CSV CONTAS A PAGAR =====
    function importarCSV(){
      const file = document.getElementById('import-pagar-csv').files[0];
      if(!file) return;

      const reader = new FileReader();
      reader.onload = e => {
        try {
          const lines = e.target.result.replace(/\uFEFF/,'').split('\n');
          const hdr = lines[0].toLowerCase().split(';');
          const col = nm => { const i = hdr.indexOf(nm); return i >= 0 ? i : null; };
          const get2 = (p, nm, fb) => { const i = col(nm); return i !== null && p[i] !== undefined ? p[i].trim() : fb; };
          const getN = (p, nm) => parseFloat((get2(p,nm,'0')||'0').replace(',','.')) || 0;
          let adicionados = 0, atualizados = 0;

          for(let i = 1; i < lines.length; i++){
            const line = lines[i].trim();
            if(!line) continue;
            const p = line.split(';');
            if(p.length < 4) continue;

            const dataVal = (get2(p,'data', p[0]||'')||'').trim();
            const descVal = (get2(p,'desc', p[1]||'')||'').trim();
            const fornVal = (get2(p,'forn', p[2]||'')||'').trim();
            const val = parseFloat((get2(p,'val', p[3]||'0')||'0').replace(',','.'));
            if(isNaN(val)) continue;

            const existing = pagamentos.find(x =>
              x.data === dataVal && x.desc === descVal && (x.forn||'') === fornVal && Math.abs(x.val - val) < 0.01
            );

            if(existing){
              const catV = get2(p,'cat',''); if(catV) existing.cat = catV;
              const pagoV = get2(p,'pago',''); if(pagoV) existing.pago = pagoV === 'sim';
              const vp = getN(p,'valorpago'); if(vp) existing.valorPago = vp;
              const dp = get2(p,'data_paga',''); if(dp) existing.data_paga = dp;
              const desc2 = getN(p,'desconto'); if(desc2) existing.desconto = desc2;
              const jr = getN(p,'juros'); if(jr) existing.juros = jr;
              atualizados++;
            } else {
              pagamentos.push({
                data: dataVal, desc: descVal, forn: fornVal, val,
                cat: get2(p,'cat','Fornecedor') || 'Fornecedor',
                pago: get2(p,'pago','nao') === 'sim',
                tipo: get2(p,'tipo','unico') || 'unico',
                parcela: get2(p,'parcela','') || null,
                valorPago: getN(p,'valorpago'), data_paga: get2(p,'data_paga','') || null,
                desconto: getN(p,'desconto'), juros: getN(p,'juros')
              });
              adicionados++;
            }
          }

          salvar();
          renderPagar();
          alert(adicionados + ' adicionado(s) · ' + atualizados + ' atualizado(s).');
        } catch(err){
          alert('Erro ao importar: ' + err.message);
        }
      };
      reader.readAsText(file, 'UTF-8');
    }


    // ===== PARCELADO/RECORRENTE =====
    function calcularParcelas(){
      const total = parseFloat(document.getElementById('parc-val-total').value) || 0;
      const num = parseInt(document.getElementById('parc-num').value) || 2;
      const data1 = document.getElementById('parc-data1').value;
      const intervaloSel = document.getElementById('parc-intervalo').value;
      const intervalos = intervaloSel.split(',').map(Number);
      const valParcela = total / num;
      const preview = document.getElementById('parc-preview');
      if(!total || !data1){ preview.innerHTML = ''; return; }

      let linhas = '';
      for(let i = 0; i < num; i++){
        const dias = i === 0 ? 0 : (intervalos[i-1] || intervalos[intervalos.length-1] * i);
        const dataParc = addDias(data1, dias);
        linhas += `<div>${i+1}/${num} — ${ptDate(dataParc)} — ${fmt(valParcela)}</div>`;
      }
      preview.innerHTML = `<strong>Parcelas geradas:</strong>${linhas}`;
    }

    function salvarParcelado(){
      const desc = document.getElementById('parc-desc').value.trim();
      const forn = document.getElementById('parc-forn').value.trim();
      const total = parseFloat(document.getElementById('parc-val-total').value);
      const num = parseInt(document.getElementById('parc-num').value);
      const data1 = document.getElementById('parc-data1').value;
      const intervaloSel = document.getElementById('parc-intervalo').value;
      const cat = document.getElementById('parc-cat').value;
      const intervalos = intervaloSel.split(',').map(Number);

      if(!desc || !total || !data1){ alert('Preencha descrição, valor e data'); return; }

      const grupoId = 'g_' + Date.now();
      const valParcela = total / num;

      for(let i = 0; i < num; i++){
        const dias = i === 0 ? 0 : (intervalos[i-1] || intervalos[intervalos.length-1] * i);
        const dataParc = addDias(data1, dias);
        pagamentos.push({
          desc, forn, cat,
          val: valParcela,
          data: dataParc,
          pago: false,
          tipo: 'parcelado',
          grupoId,
          parcela: (i+1) + '/' + num
        });
      }

      salvar();
      fecharModal('modal-lanc');
      renderPagar();
      recalc();
    }

    function salvarRecorrente(){
      const desc = document.getElementById('rec-lanc-desc').value.trim();
      const forn = document.getElementById('rec-lanc-forn').value.trim();
      const val = parseFloat(document.getElementById('rec-lanc-val').value);
      const dia = parseInt(document.getElementById('rec-lanc-dia').value);
      const inicio = document.getElementById('rec-lanc-inicio').value;
      const meses = parseInt(document.getElementById('rec-lanc-meses').value);
      const cat = document.getElementById('rec-lanc-cat').value;

      if(!desc || !val || !inicio){ alert('Preencha descrição, valor e início'); return; }

      const grupoId = 'r_' + Date.now();
      const dataBase = parseDate(inicio);

      for(let i = 0; i < meses; i++){
        const d = new Date(dataBase.getFullYear(), dataBase.getMonth() + i, dia);
        pagamentos.push({
          desc, forn, cat, val,
          data: dateStr(d),
          pago: false,
          tipo: 'recorrente',
          grupoId
        });
      }

      salvar();
      fecharModal('modal-lanc');
      renderPagar();
      recalc();
    }

    // ===== OVERRIDE salvarLanc para rotear pelos tipos =====
    const _salvarLancOriginal = salvarLanc;
    salvarLanc = function(){
      if(tabAtual === 'parcelado') return salvarParcelado();
      if(tabAtual === 'recorrente') return salvarRecorrente();
      _salvarLancOriginal();
    };

    // ===== HISTÓRICO FORNECEDOR =====
    function abrirHistoricoFornecedor(forn){
      if(!forn) return;
      const todos = pagamentos.filter(p => p.forn === forn).sort((a,b) => b.data.localeCompare(a.data));
      const pendentes = todos.filter(p => !p.pago);
      const pagos = todos.filter(p => p.pago);

      const hoje = getToday();
      const itens = todos.map((p, i) => {
        const idx = pagamentos.indexOf(p);
        const atrasado = !p.pago && p.data < hoje;
        const cor = p.pago ? 'var(--success)' : atrasado ? 'var(--danger)' : 'var(--warning)';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;" onclick="fecharModal('modal-hist-forn');editarLanc(${idx})">
          <div>
            <div style="font-size:12px;font-weight:500;">${p.desc} ${p.parcela ? '('+p.parcela+')' : ''}</div>
            <div style="font-size:11px;color:#666;">${ptDate(p.data)} · ${p.cat}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:600;color:${cor};">${fmt(p.val)}</div>
            <div style="font-size:10px;color:${cor};">${p.pago ? 'pago' : atrasado ? 'atrasado' : 'em aberto'}</div>
          </div>
        </div>`;
      }).join('');

      // Criar modal se não existe
      if(!document.getElementById('modal-hist-forn')){
        const m = document.createElement('div');
        m.className = 'modal';
        m.id = 'modal-hist-forn';
        m.innerHTML = `<div class="modal-content" style="max-width:500px;">
          <div class="modal-header">
            <div class="modal-title" id="hist-forn-title">Histórico</div>
            <button class="btn-out btn-sm" onclick="fecharModal('modal-hist-forn')">✕</button>
          </div>
          <div class="modal-body">
            <div id="hist-forn-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:15px;"></div>
            <div id="hist-forn-lista" style="max-height:350px;overflow-y:auto;"></div>
          </div>
        </div>`;
        document.body.appendChild(m);
      }

      document.getElementById('hist-forn-title').textContent = 'Histórico: ' + forn;
      document.getElementById('hist-forn-stats').innerHTML = `
        <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:6px;">
          <div style="font-size:10px;color:#666;">Total</div>
          <div style="font-weight:700;">${todos.length}</div>
        </div>
        <div style="text-align:center;padding:8px;background:#fef2f2;border-radius:6px;">
          <div style="font-size:10px;color:#666;">Pendente</div>
          <div style="font-weight:700;color:var(--danger);">${fmt(pendentes.reduce((s,p)=>s+p.val,0))}</div>
        </div>
        <div style="text-align:center;padding:8px;background:#f0fdf4;border-radius:6px;">
          <div style="font-size:10px;color:#666;">Pago</div>
          <div style="font-weight:700;color:var(--success);">${fmt(pagos.reduce((s,p)=>s+(p.valorPago||p.val),0))}</div>
        </div>`;
      document.getElementById('hist-forn-lista').innerHTML = itens || '<div style="text-align:center;padding:20px;color:#999;">Nenhum lançamento</div>';
      document.getElementById('modal-hist-forn').classList.add('open');
    }

    // ===== MODAL SÉRIE DE PARCELAS =====
    function abrirModalSerie(grupoId){
      const serie = pagamentos.filter(p => p.grupoId === grupoId).sort((a,b) => a.data.localeCompare(b.data));
      if(!serie.length) return;

      if(!document.getElementById('modal-serie')){
        const m = document.createElement('div');
        m.className = 'modal';
        m.id = 'modal-serie';
        m.innerHTML = `<div class="modal-content" style="max-width:450px;">
          <div class="modal-header">
            <div class="modal-title">Série de parcelas</div>
            <button class="btn-out btn-sm" onclick="fecharModal('modal-serie')">✕</button>
          </div>
          <div class="modal-body">
            <div id="serie-lista" style="max-height:350px;overflow-y:auto;"></div>
          </div>
        </div>`;
        document.body.appendChild(m);
      }

      const total = serie.reduce((s,p) => s+p.val, 0);
      const pagas = serie.filter(p => p.pago).length;
      const hoje = getToday();

      document.getElementById('serie-lista').innerHTML =
        `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e5e5e5;">
          <span><strong>${serie[0].desc}</strong> · ${serie[0].forn||''}</span>
          <span>Total: <strong>${fmt(total)}</strong></span>
        </div>
        <div style="font-size:11px;color:#666;margin-bottom:8px;">${pagas}/${serie.length} parcelas pagas</div>` +
        serie.map(p => {
          const idx = pagamentos.indexOf(p);
          const atrasado = !p.pago && p.data < hoje;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;margin:4px 0;border-radius:6px;background:${p.pago?'#f0fdf4':atrasado?'#fef2f2':'#fafafa'};cursor:pointer;" onclick="fecharModal('modal-serie');editarLanc(${idx})">
            <div>
              <div style="font-size:12px;font-weight:600;">${p.parcela||''}</div>
              <div style="font-size:11px;color:#666;">${ptDate(p.data)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:600;">${fmt(p.val)}</div>
              <div style="font-size:10px;color:${p.pago?'var(--success)':atrasado?'var(--danger)':'var(--warning)'};">${p.pago?'✓ pago':atrasado?'atrasado':'em aberto'}</div>
            </div>
          </div>`;
        }).join('');

      document.getElementById('modal-serie').classList.add('open');
    }

    // ===== DELAY CALCULADO REAL =====
    function calcularDelayReal(){
      const hoje = getToday();
      const futuras = liberacoes.filter(l => l.data > hoje);
      if(futuras.length === 0) return null;
      const diffs = futuras.map(l => diasDif(hoje, l.data));
      return (diffs.reduce((s,d) => s+d, 0) / diffs.length).toFixed(1);
    }

    // ===== A RECEBER - PROCESSAR JSON COLADO =====
    function processarJSONColado(){
      const texto = document.getElementById('ml-json-input').value.trim();
      if(!texto){ alert('Cole o JSON primeiro'); return; }
      try {
        const dados = JSON.parse(texto);
        let novas = [];
        // Formato 1: {"liberacoes":[{"data":"...","val":...}]}
        if(dados.liberacoes && Array.isArray(dados.liberacoes)){
          novas = dados.liberacoes;
        // Formato 2: array direto [{"Name":"2026-05-20","Total":1234}]
        } else if(Array.isArray(dados)){
          novas = dados.map(item => ({
            data: (item.Name || item.data || item.date || '').substring(0,10),
            val:  parseFloat(item.Total || item.val || item.value || 0)
          })).filter(l => l.data && l.val > 0);
        }
        if(!novas.length){ alert('Nenhuma liberação encontrada no JSON'); return; }
        liberacoes = novas;

        // Se vier saldoMP no JSON, atualizar automaticamente
        if(dados.saldoMP !== undefined){
          saldoMP = parseFloat(dados.saldoMP) || 0;
          const mpInput = document.getElementById('saldo-mp');
          if(mpInput) mpInput.value = fmtMoney(saldoMP);
          atualizarSaldoTotal();
          document.getElementById('ml-status').textContent =
            '✅ ' + liberacoes.length + ' liberações + saldo MP R$ ' + fmt(saldoMP) + ' importados!';
        } else {
          document.getElementById('ml-status').textContent = '✅ ' + liberacoes.length + ' liberações importadas!';
        }

        document.getElementById('ml-status').style.color = 'var(--success)';
        salvar(); renderReceber(); recalc();
        document.getElementById('ml-json-input').value = '';
      } catch(err){
        alert('Erro no JSON: ' + err.message);
      }
    }

    // ===== RESIZE DE COLUNAS =====
    function makeResizableCols(table){
      if(!table) return;
      const ths = table.querySelectorAll('thead th');
      ths.forEach(th => {
        if(th.querySelector('.col-rsz')) return;
        th.style.position = 'relative';
        const h = document.createElement('div');
        h.className = 'col-rsz';
        h.addEventListener('mousedown', ev => {
          ev.preventDefault(); ev.stopPropagation();
          h.classList.add('rsz-active');
          const x0 = ev.clientX;
          const w0 = th.getBoundingClientRect().width;
          const onMove = e => { th.style.width = Math.max(40, w0 + e.clientX - x0) + 'px'; };
          const onUp = () => {
            h.classList.remove('rsz-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        th.appendChild(h);
      });
    }

    // ===== SKUs - SELEÇÃO MÚLTIPLA =====
    function toggleTodosSKUs(checked){
      document.querySelectorAll('.sku-cb').forEach(cb => cb.checked = checked);
      atualizarContSKUSel();
    }

    function atualizarContSKUSel(){
      const sel = document.querySelectorAll('.sku-cb:checked').length;
      const cont = document.getElementById('sku-sel-count');
      if(cont) cont.textContent = sel > 0 ? sel + ' selecionado(s)' : '';
    }

    function getSKUsSelecionados(){
      return Array.from(document.querySelectorAll('.sku-cb:checked')).map(cb => parseInt(cb.dataset.idx));
    }

    function deletarSKUsSelecionados(){
      const idxs = getSKUsSelecionados();
      if(idxs.length === 0){ alert('Selecione ao menos 1 SKU'); return; }
      if(!confirm('Deletar ' + idxs.length + ' SKU(s)?')) return;

      // Deletar em ordem decrescente para não bagunçar índices
      idxs.sort((a,b) => b - a).forEach(i => skus.splice(i, 1));
      salvar();
      renderSKUs();
    }
