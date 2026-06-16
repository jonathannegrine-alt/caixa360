// ===== IMPORT/EXPORT =====
    function exportarCSV(){
      const esc = s => (String(s||'')).replace(/;/g,'|');
      const n2 = v => (Number(v)||0).toFixed(2).replace('.',',');
      const header = 'data;desc;forn;val;cat;pago;tipo;parcela;valorPago;data_paga;desconto;juros';
      const linhas = pagamentos.map(p => [
        p.data||'', esc(p.desc), esc(p.forn),
        n2(p.val), esc(p.cat), p.pago?'sim':'nao',
        p.tipo||'unico', p.parcela||'',
        n2(p.valorPago), p.data_paga||'',
        n2(p.desconto), n2(p.juros)
      ].join(';'));
      const csv = header + '\n' + linhas.join('\n');
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'contas_a_pagar_' + getToday() + '.csv';
      a.click();
    }
    
    function exportarTudo(){
      const dados = {
        pagamentos,
        liberacoes,
        categorias,
        cfg: {cfgDelay, cfgPct, reservaMinima, periodoHistorico}
      };
      
      const json = JSON.stringify(dados, null, 2);
      const blob = new Blob([json], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'backup_mk_' + getToday() + '.json';
      a.click();
    }
    
    function importarTudo(){
      const file = document.getElementById('import-json').files[0];
      if(!file) return;
      
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const dados = JSON.parse(e.target.result);
          
          pagamentos = dados.pagamentos || [];
          liberacoes = dados.liberacoes || [];
          categorias = dados.categorias || [];
          
          if(dados.cfg){
            cfgDelay = dados.cfg.cfgDelay || 12;
            cfgPct = dados.cfg.cfgPct || 0.85;
            reservaMinima = dados.cfg.reservaMinima || 15000;
            periodoHistorico = dados.cfg.periodoHistorico || 30;
          }
          
          salvar();
          init();
          alert('Dados importados com sucesso!');
        } catch(err){
          alert('Erro ao importar: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
    
    // ===== A RECEBER ML =====
    function renderCardHoje(){
      const raw = localStorage.getItem('mk_liberacoes_hoje');
      const card = document.getElementById('card-hoje-ml');
      if(!card) return;
      if(!raw){ card.style.display='none'; return; }
      const itens = JSON.parse(raw);
      if(!itens || itens.length === 0){ card.style.display='none'; return; }

      const agora = new Date();
      const horaAtual = agora.getHours();
      const total = itens.reduce((s,i) => s + i.val, 0);

      document.getElementById('hoje-ml-total').textContent = 'R$ ' + fmt(total);

      const lista = document.getElementById('hoje-ml-lista');
      lista.innerHTML = itens.map(i => {
        const hora = parseInt(i.hora);
        const passou = hora < horaAtual;
        const cor = passou ? 'var(--text-muted)' : 'var(--success)';
        const icone = passou ? '✅' : '🕐';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
          <span style="color:${cor};font-size:.95rem;">${icone} ${i.hora}</span>
          <span style="font-weight:600;color:${cor};">R$ ${fmt(i.val)}</span>
        </div>`;
      }).join('');

      card.style.display = 'block';
    }

    function renderReceber(){
      const hoje = getToday();

      // hojeTotal = apenas horas futuras (não creditadas ainda)
      const hojeTotal = getHojeTotal();

      // Resumo stats — excluir hoje de liberacoes (evita double-count com hojeTotal)
      const totalFut = liberacoes.filter(l => l.data > hoje).reduce((s,l) => s + l.val, 0);
      const total = totalFut + hojeTotal;
      const p7  = liberacoes.filter(l => diasDif(hoje, l.data) <= 7  && l.data > hoje).reduce((s,l) => s + l.val, 0);
      const p30 = liberacoes.filter(l => diasDif(hoje, l.data) <= 30 && l.data > hoje).reduce((s,l) => s + l.val, 0);

      document.getElementById('rec-total').textContent = fmt(total);
      document.getElementById('rec-7d').textContent = fmt(p7);
      document.getElementById('rec-30d').textContent = fmt(p30);

      // Lista
      const tbody = document.getElementById('tbody-receber');
      const futuras = liberacoes.filter(l => l.data > hoje).sort((a,b) => a.data.localeCompare(b.data));

      const hojeRow = hojeTotal > 0 ? `
        <tr onclick="abrirModalHoje()" style="cursor:pointer;background:rgba(var(--accent-rgb),.07);">
          <td><strong>${ptDate(hoje)}</strong></td>
          <td>${nomeDia(hoje)} <span style="font-size:.75rem;background:var(--accent);color:#fff;padding:1px 6px;border-radius:10px;margin-left:4px;">hoje ⏰</span></td>
          <td style="text-align:right;font-weight:700;color:var(--accent);">${fmt(hojeTotal)}</td>
        </tr>` : '';

      if(!hojeRow && futuras.length === 0){
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:30px;color:#999;">Nenhuma liberação importada. Conecte o Mercado Livre ou use a importação manual.</td></tr>';
        return;
      }

      tbody.innerHTML = hojeRow + futuras.map(l => `
        <tr>
          <td>${ptDate(l.data)}</td>
          <td>${nomeDia(l.data)}</td>
          <td style="text-align:right;font-weight:600;color:var(--success);">${fmt(l.val)}</td>
        </tr>
      `).join('');
      makeSortable('tbody-receber');
      initResizableCols('tbody-receber');
    }

    function abrirModalHoje(){
      const hojeItens = JSON.parse(localStorage.getItem('mk_liberacoes_hoje') || '[]');
      if(!hojeItens.length){ alert('Nenhum dado de hoje disponível. Clique em "Atualizar dados agora".'); return; }

      if(!document.getElementById('modal-hoje')){
        const m = document.createElement('div');
        m.className = 'modal';
        m.id = 'modal-hoje';
        // stopPropagation no modal-content evita que cliques dentro subam para o pai (calendário/lista)
        m.innerHTML = `<div class="modal-content" style="max-width:380px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">⏰ A receber hoje — por hora</div>
            <button class="btn-out btn-sm" onclick="fecharModal('modal-hoje')">✕</button>
          </div>
          <div class="modal-body" id="modal-hoje-body"></div>
          <div class="modal-footer"><button class="btn-out" onclick="fecharModal('modal-hoje')">Fechar</button></div>
        </div>`;
        // Fechar ao clicar no backdrop
        m.addEventListener('click', e => { if(e.target === m) fecharModal('modal-hoje'); });
        document.body.appendChild(m);
      }

      const horaAtual = new Date().getHours();
      const totalFuturo = hojeItens.filter(i => parseInt(i.hora) >= horaAtual).reduce((s,i) => s + i.val, 0);
      const rows = hojeItens.map(i => {
        const hora = parseInt(i.hora);
        const passou = hora < horaAtual;
        return `<tr>
          <td style="padding:6px 0;color:${passou?'var(--text-muted)':'var(--text)'};">${passou?'✅':'🕐'} ${i.hora}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:${passou?'var(--text-muted)':'var(--success)'};">${fmt(i.val)}</td>
        </tr>`;
      }).join('');
      document.getElementById('modal-hoje-body').innerHTML = `
        <p style="margin:0 0 10px;color:var(--text-muted);font-size:.85rem;">🕐 = ainda será creditado hoje &nbsp;·&nbsp; ✅ = já passou</p>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <span style="color:var(--text-muted);">Ainda a receber hoje</span>
          <strong style="color:var(--success);font-size:1.1rem;">${fmt(totalFuturo)}</strong>
        </div>`;
      document.getElementById('modal-hoje').classList.add('open');
    }

    // ===== ML OAUTH — CONEXÃO AUTOMÁTICA =====
    const ML_CLIENT_ID = '98776212333714';
    const ML_REDIRECT = 'https://jonathannegrine-alt.github.io/caixa360/';

    function conectarML(){
      const url = 'https://auth.mercadolivre.com.br/authorization?response_type=code'
        + '&client_id=' + ML_CLIENT_ID
        + '&redirect_uri=' + encodeURIComponent(ML_REDIRECT)
        + '&scope=' + encodeURIComponent('offline_access read write');
      window.location.href = url;
    }

    async function handleMLCallback(code){
      const statusEl = document.getElementById('ml-status');
      if(statusEl){ statusEl.className='ml-status-info'; statusEl.textContent='⏳ Conectando ao Mercado Livre...'; }
      try {
        const { data, error } = await supa.functions.invoke('ml-callback', {
          body: { code, user_id: usuarioAtual.id }
        });
        window.history.replaceState({}, '', window.location.pathname);
        if(error || data?.error){
          const erroML = (data?.error || error?.message || 'Erro desconhecido')
            + (data?.detail ? ' — ' + data.detail : '');
          if(statusEl){ statusEl.className='ml-status-err'; statusEl.textContent='❌ ' + erroML; }
          return;
        }
        // Outra conta ML tentou conectar — ignora, continua com a conta já conectada
        if(data?.ignored){
          if(statusEl){ statusEl.className='ml-status-info'; statusEl.textContent='✅ Conectado! Buscando histórico (pode levar ~30s)...'; }
          await capturarSnapshotML();
          await sincronizarML();
          return;
        }
        if(statusEl){ statusEl.className='ml-status-info'; statusEl.textContent='✅ Conectado! Buscando histórico (pode levar ~30s)...'; }
        await capturarSnapshotML();
        await sincronizarML();
      } catch(e){
        if(statusEl){ statusEl.className='ml-status-err'; statusEl.textContent='❌ ' + e.message; }
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    async function capturarSnapshotML(){
      const { data: sessao } = await supa.auth.getSession();
      const jwt = sessao?.session?.access_token;
      const { data: fnData, error: fnErr } = await supa.functions.invoke('ml-snapshot', {
        headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}
      });
      if(fnErr) throw new Error('Snapshot ML: ' + fnErr.message);
      if(fnData?.snapshot_erro) console.warn('Snapshot insert erro:', fnData.snapshot_erro);
      // Recarregar extrato histórico e contagem de snapshots
      const corte = addDias(getToday(), -90);
      const { data: ext } = await supa.from('extrato_historico')
        .select('data,val_liquido,qtd_pedidos')
        .eq('usuario_id', usuarioAtual.id)
        .gte('data', corte)
        .order('data', {ascending:false});
      if(ext) extratoHistorico = ext.map(e => ({data:e.data, val_liquido:e.val_liquido, qtd_pedidos:e.qtd_pedidos}));
      const { data: snapRows } = await supa.from('snapshots_ml').select('data_captura').eq('usuario_id', usuarioAtual.id).limit(9999);
      diasPipeline = new Set((snapRows || []).map(r => r.data_captura)).size;
      return fnData;
    }

    async function sincronizarML(){
      const statusEl = document.getElementById('ml-status');
      if(statusEl){ statusEl.className='ml-status-info'; statusEl.textContent='⏳ Buscando dados do ML...'; }
      try {
        const { data: sessao } = await supa.auth.getSession();
        const jwt = sessao?.session?.access_token;
        const { data, error } = await supa.functions.invoke('ml-sync', {
          headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}
        });
        if(error || data?.error){
          if(statusEl){ statusEl.className='ml-status-err'; statusEl.textContent='❌ ' + (data?.error || error?.message); }
          return;
        }
        // Recarregar liberações
        const { data: libs } = await supa.from('liberacoes').select('*').eq('usuario_id', usuarioAtual.id);
        if(libs) liberacoes = libs.map(l => ({ data: l.data, val: l.val }));
        localStorage.setItem('mk_liberacoes', JSON.stringify(liberacoes));

        // Atualizar saldo MP se veio da API
        if(data.saldoMP !== null && data.saldoMP !== undefined){
          saldoMP = data.saldoMP;
          saldoAtual = saldoMP + saldoOutros;
          const mpInput = document.getElementById('saldo-mp');
          if(mpInput) mpInput.value = fmtMoney(saldoMP);
          salvarCfg();
        }

        localStorage.setItem('mk_ultimo_sync_ml', Date.now().toString());
        if(data.liberacoesHoje) localStorage.setItem('mk_liberacoes_hoje', JSON.stringify(data.liberacoesHoje));
        const msg = '✅ ' + data.liberacoes + ' liberações importadas'
          + (data.saldoMP ? ' · Saldo MP: R$ ' + fmt(data.saldoMP) : '');
        if(statusEl){ statusEl.className='ml-status-ok'; statusEl.textContent=msg; }

        await verificarConexaoML();
        renderReceber();
        recalc();
      } catch(e){
        if(statusEl){ statusEl.className='ml-status-err'; statusEl.textContent='❌ ' + e.message; }
      }
    }

    async function autoSyncML(){
      if(!usuarioAtual) return;
      const ultimo = parseInt(localStorage.getItem('mk_ultimo_sync_ml') || '0');
      const THROTTLE_MS = 2 * 60 * 1000; // 2 minutos (evita duplo-sync em F5 rápido)
      if(Date.now() - ultimo < THROTTLE_MS) return;
      const { data } = await supa.from('ml_tokens').select('usuario_id').eq('usuario_id', usuarioAtual.id).maybeSingle();
      if(!data) return;
      sincronizarML(); // fire-and-forget, atualiza em background
    }

    async function verificarConexaoML(){
      if(!usuarioAtual) return;
      const naoConectado = document.getElementById('ml-nao-conectado');
      const conectado   = document.getElementById('ml-conectado');
      const infoEl      = document.getElementById('ml-info');
      if(!naoConectado) return;
      try {
        // maybeSingle() não dá erro para 0 rows (diferente de .single())
        const { data } = await supa.from('ml_tokens').select('ml_user_id,updated_at').eq('usuario_id', usuarioAtual.id).maybeSingle();
        if(data){
          naoConectado.style.display = 'none';
          conectado.style.display = 'block';
          if(infoEl){
            const dt = data.updated_at ? new Date(data.updated_at).toLocaleString('pt-BR') : '';
            infoEl.textContent = '✅ Conectado' + (dt ? ' — última sync: ' + dt : '');
          }
        } else {
          naoConectado.style.display = 'block';
          conectado.style.display = 'none';
          if(infoEl) infoEl.textContent = '';
        }
      } catch(e){
        // Em caso de erro de rede, exibir botão de conectar como segurança
        naoConectado.style.display = 'block';
        conectado.style.display = 'none';
      }
    }

    async function atualizarStatusMLConfig(){
      const statusEl = document.getElementById('cfg-ml-status');
      const btnDesc  = document.getElementById('cfg-btn-desconectar');
      if(!statusEl) return;
      if(!usuarioAtual){ statusEl.textContent = 'Faça login para ver o status.'; return; }
      try {
        const { data } = await supa.from('ml_tokens').select('ml_user_id,updated_at').eq('usuario_id', usuarioAtual.id).maybeSingle();
        if(data){
          const dt = data.updated_at ? new Date(data.updated_at).toLocaleString('pt-BR') : '';
          statusEl.innerHTML = '<span style="color:var(--success);font-weight:600;">✅ Conectado</span>' + (dt ? ' — última sync: ' + dt : '');
          if(btnDesc) btnDesc.style.display = 'inline-flex';
        } else {
          statusEl.innerHTML = '<span style="color:var(--danger);font-weight:600;">❌ Não conectado</span> — clique em "Conectar / Reconectar" abaixo.';
          if(btnDesc) btnDesc.style.display = 'none';
        }
      } catch(e){
        statusEl.textContent = 'Erro ao verificar conexão.';
      }
    }

    function setPeriodoML(dias){
      periodoHistoricoML = dias;
      salvarCfg();
      recalc();
      renderPipelineMaturidade();
    }

    function renderPipelineMaturidade(){
      const el = document.getElementById('pipeline-maturidade');
      const label = document.getElementById('periodo-ml-label');
      const btns = document.getElementById('btns-periodo-ml');
      if(label) label.textContent = 'Período ativo: ' + periodoHistoricoML + ' dias';

      // Destacar botão ativo
      if(btns){
        btns.querySelectorAll('button').forEach(b => {
          const v = parseInt(b.textContent);
          b.classList.toggle('btn', v === periodoHistoricoML);
          b.classList.toggle('btn-out', v !== periodoHistoricoML);
        });
      }

      if(!el) return;
      let badge, texto;
      if(diasPipeline >= 90){
        badge = '🟢 Pipeline Maduro';
        texto = 'Pipeline com ' + diasPipeline + ' dias de histórico. Curva de maturação confiável.';
      } else if(diasPipeline >= 60){
        badge = '🟡 Pipeline Base';
        texto = 'Pipeline com ' + diasPipeline + '/90 dias. Projeção ativa com boa confiança.';
      } else if(diasPipeline >= 30){
        badge = '🔵 Pipeline Assistido';
        texto = 'Pipeline com ' + diasPipeline + '/90 dias. Projeção ativa com fallback no extrato.';
      } else if(diasPipeline >= 15){
        badge = '⚪ Modo Híbrido';
        texto = 'Pipeline com ' + diasPipeline + '/90 dias. Baixa confiança — extrato como base principal.';
      } else if(diasPipeline > 0){
        badge = '📊 Iniciando Pipeline';
        texto = diasPipeline + '/14 dias de snapshot acumulados. Usando extrato realizado como base.';
      } else {
        badge = '📊 Sem pipeline ainda';
        texto = 'Nenhum snapshot ainda. O cron roda às 06h BRT. Projeção usa extrato dos últimos ' + periodoHistoricoML + ' dias.';
        if(extratoHistorico.length === 0) texto += ' Conecte o Mercado Livre para começar.';
      }
      el.innerHTML = '<strong>' + badge + '</strong><br><span style="font-size:12px;color:var(--text-muted);">' + texto + '</span>';
      if(extratoHistorico.length > 0){
        const limiteDisp = addDias(getToday(), -periodoHistoricoML);
        const extDisp = extratoHistorico.filter(e => e.data >= limiteDisp);
        const aviso = extDisp.length < periodoHistoricoML * 0.8
          ? ' ⚠️ API do ML limitada a ~' + extDisp.length + ' dias' : '';
        el.innerHTML += '<br><span style="font-size:11px;color:var(--text-muted);">Extrato: ' + extDisp.length + ' dias disponíveis (período ' + periodoHistoricoML + 'd)' + aviso + '</span>';
      }

      // Atualizar badge compacto na tela "A receber"
      const badgeEl = document.getElementById('ml-pipeline-badge');
      if(badgeEl) badgeEl.textContent = badge_texto(diasPipeline, extratoHistorico.length, periodoHistoricoML);
    }

    function badge_texto(dias, extDias, periodo){
      if(dias >= 90) return '📈 Pipeline maduro (' + dias + ' dias) · Projeção: extrato ' + periodo + 'd';
      if(dias >= 60) return '📈 Pipeline base (' + dias + '/90 dias) · Projeção: extrato ' + periodo + 'd';
      if(dias >= 30) return '📈 Pipeline assistido (' + dias + '/90 dias) · Projeção: extrato ' + periodo + 'd';
      if(dias >= 15) return '📊 Modo híbrido (' + dias + '/90 dias) · Projeção: extrato ' + periodo + 'd';
      if(dias > 0)   return '📊 Iniciando pipeline (' + dias + '/14 dias) · Projeção: extrato ' + periodo + 'd';
      if(extDias > 0) return '📊 Sem pipeline · Projeção: extrato ' + extDias + ' dias disponíveis';
      return '📊 Sem dados históricos · Conecte o ML para começar';
    }

    async function atualizarHistoricoML(){
      if(!usuarioAtual){ alert('Faça login primeiro.'); return; }
      const btn = document.getElementById('btn-atualizar-hist');
      const st = document.getElementById('hist-status');
      if(btn) btn.disabled = true;
      if(st){ st.style.color='#666'; st.textContent='⏳ Buscando histórico...'; }
      try {
        const fnData = await capturarSnapshotML();
        const snap = fnData?.snapshot_datas ?? '?';
        if(st){ st.style.color='var(--success)'; st.textContent='✅ Extrato: ' + extratoHistorico.length + ' dias · Pipeline: ' + diasPipeline + ' entradas capturadas (' + snap + ' do ML).'; }
        renderPipelineMaturidade();
        recalc();
      } catch(e){
        if(st){ st.style.color='var(--danger)'; st.textContent='❌ ' + e.message; }
      }
      if(btn) btn.disabled = false;
    }

    async function desconectarML(){
      if(!confirm('Desconectar o Mercado Livre desta conta?')) return;
      await supa.from('ml_tokens').delete().eq('usuario_id', usuarioAtual.id);
      document.getElementById('ml-nao-conectado').style.display = 'block';
      document.getElementById('ml-conectado').style.display = 'none';
      const st = document.getElementById('ml-status');
      if(st) st.textContent = '';
      atualizarStatusMLConfig();
    }

    // Receptor legado (PowerShell via servidor local — mantido como fallback)
    window.importarMLData = function(dados){
      if(dados && dados.liberacoes){
        liberacoes = dados.liberacoes;
        salvar();
        if(document.getElementById('view-receber').classList.contains('active')) renderReceber();
        recalc();
        alert('✅ ' + liberacoes.length + ' liberações importadas do ML!');
      }
    };
