// ===== PÓS-VENDA COM IA =====
// Página "posvenda": reclamações, mediações e mensagens do Mercado Livre, lidas pela API e analisadas por IA
// com as regras da loja (Edge Function pos-venda). O que a regra manda passar direto a IA executa sozinha
// (se o usuário liberou); o resto fica na FILA para aprovar, corrigir ou recusar.
//   Fila            casos que esperam decisão, ordenados pelo prazo
//   Histórico       tudo que já foi resolvido (substitui o registro em planilha)
//   Regras e textos orientação da IA (postura, regras por produto, textos prontos) + imagens de apoio
// Banco: pos_venda_cfg, pos_venda_casos, pos_venda_log (supabase/migrations/20261012_pos_venda.sql)

    let pv = { aba: 'fila', cfg: null, casos: [], hist: [], imagens: [], carregado: false, rodando: false, erro: '', aviso: '', ocupado: {} };
    const pvE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const PV_ACOES = { mensagem_comprador: 'Enviar mensagem ao comprador', mensagem_mediador: 'Responder ao Mercado Livre (mediação)', reembolso_total: 'Reembolso total, sem devolução', reembolso_parcial: 'Reembolso parcial', liberar_devolucao: 'Liberar a devolução', manual: 'Ação manual no Mercado Livre', nenhuma: 'Nenhuma ação' };
    const PV_EXIGE = { mensagem_comprador: ['send_message_to_complainant'], mensagem_mediador: ['send_message_to_mediator'], reembolso_total: ['refund'], reembolso_parcial: ['allow_partial_refund', 'partial_refund'], liberar_devolucao: ['allow_return'] };
    const PV_SIT = { executado: 'Resolvido', recusado: 'Recusado', manual_feito: 'Feito à mão', sem_acao: 'Aguardando o Mercado Livre', encerrado: 'Encerrado no ML', erro: 'Erro', fila: 'Na fila' };

    async function pvChamar(corpo){
      const sd = await supa.auth.getSession(), s = sd && sd.data && sd.data.session;
      if(!s) return { error: 'Sessão expirada: entre de novo.' };
      try {
        const r = await fetch(SUPA_URL + '/functions/v1/pos-venda', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        return await r.json().catch(() => ({ error: 'resposta inesperada (http ' + r.status + ')' }));
      } catch(e){ return { error: 'sem conexão com o servidor' }; }
    }

    async function pvCarregar(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const uid = usuarioAtual.id;
      const [cfg, fila, hist, imgs] = await Promise.all([
        supa.from('pos_venda_cfg').select('*').eq('usuario_id', uid).maybeSingle(),
        supa.from('pos_venda_casos').select('*').eq('usuario_id', uid).in('situacao', ['fila', 'erro']).order('prazo', { ascending: true, nullsFirst: false }).limit(300),
        supa.from('pos_venda_casos').select('*').eq('usuario_id', uid).not('situacao', 'in', '(fila,erro)').order('analisado_em', { ascending: false }).limit(300),
        supa.storage.from('pos-venda').list(uid, { limit: 100 })
      ]);
      if(cfg.error || fila.error){ pv.erro = (cfg.error || fila.error).message; return; }
      pv.cfg = cfg.data || { usuario_id: uid, ativo: false, regras: '', auto_msg: false, auto_dinheiro: false, limite: 150, novo: true };
      pv.casos = fila.data || []; pv.hist = hist.data || [];
      pv.imagens = (imgs.data || []).map(x => x.name).filter(n => /\.(png|jpe?g|webp)$/i.test(n));
      pv.carregado = true; pv.erro = '';
      pvSelo();
    }
    // número de casos na fila no menu
    function pvSelo(){
      const el = document.getElementById('nav-pv-n'); if(!el) return;
      const n = pvDaLoja(pv.casos).length;
      el.textContent = n ? String(n) : ''; el.style.display = n ? '' : 'none';
    }
    function pvDaLoja(lista){ const l = typeof lojaAtiva === 'function' ? lojaAtiva() : ''; return l ? lista.filter(c => String(c.ml_user_id) === l) : lista; }

    async function renderPosVenda(){
      const el = document.getElementById('view-posvenda'); if(!el) return;
      if(!pv.carregado){ el.innerHTML = '<div class="vazio"><b>Carregando o pós-venda…</b></div>'; await pvCarregar(); }
      pvDesenhar();
    }
    async function pvAtualizar(){ await pvCarregar(); pvDesenhar(); }

    async function pvRodada(){
      if(pv.rodando) return;
      pv.rodando = true; pv.aviso = ''; pvDesenhar();
      const j = await pvChamar({ acao: 'rodada' });
      pv.rodando = false;
      if(j.error) pv.aviso = 'Não consegui rodar a análise: ' + j.error;
      else { const r = j.resumo || {}; pv.aviso = `Rodada feita: ${r.abertas || 0} casos abertos no Mercado Livre, ${r.exigem || 0} pedem ação nossa, ${r.analisados || 0} analisados agora (${r.diretos || 0} resolvidos direto, ${r.fila || 0} na fila).` + ((r.erros || []).length ? ' Avisos: ' + r.erros.slice(0, 3).join(' · ') : ''); }
      await pvAtualizar();
    }

    async function pvSalvarCfg(campos){
      Object.assign(pv.cfg, campos);
      const reg = { usuario_id: usuarioAtual.id, ativo: !!pv.cfg.ativo, regras: pv.cfg.regras || '', auto_msg: !!pv.cfg.auto_msg, auto_dinheiro: !!pv.cfg.auto_dinheiro, limite: Number(pv.cfg.limite) || 0, atualizado_em: new Date().toISOString() };
      const r = await supa.from('pos_venda_cfg').upsert(reg);
      if(r.error){ toast('Não consegui salvar: ' + r.error.message); return false; }
      delete pv.cfg.novo; return true;
    }

    function pvPrazo(c){
      if(!c.prazo) return { t: 'sem prazo', cls: '' };
      const h = (new Date(c.prazo) - Date.now()) / 3600000, d = new Date(c.prazo);
      const quando = d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      if(h < 0) return { t: 'prazo vencido (' + quando + ')', cls: 'pv-venc' };
      if(h < 24) return { t: 'vence em ' + Math.max(1, Math.round(h)) + ' h (' + quando + ')', cls: 'pv-venc' };
      if(h < 48) return { t: 'vence amanhã (' + quando + ')', cls: 'pv-perto' };
      return { t: 'vence ' + quando, cls: '' };
    }
    const pvLink = c => c.venda ? `https://www.mercadolivre.com.br/vendas/${encodeURIComponent(c.venda)}/detalhe` : 'https://www.mercadolivre.com.br/vendas/omni/lista';

    function pvDesenhar(){
      const el = document.getElementById('view-posvenda'); if(!el || !el.classList.contains('active')) return;
      if(pv.erro){ el.innerHTML = `<div class="alert alert-danger">Não consegui carregar o pós-venda: ${pvE(pv.erro)}</div>`; return; }
      const c = pv.cfg || {}, fila = pvDaLoja(pv.casos), hist = pvDaLoja(pv.hist);
      const hojeFim = new Date(); hojeFim.setHours(23, 59, 59);
      const urg = fila.filter(x => x.prazo && new Date(x.prazo) <= new Date(Date.now() + 24 * 3600000)).length;
      const sete = Date.now() - 7 * 86400000, diretos = hist.filter(x => x.decisao === 'DIRETO' && new Date(x.executado_em || 0) > sete).length, resolv = hist.filter(x => ['executado', 'manual_feito'].includes(x.situacao) && new Date(x.executado_em || 0) > sete).length;
      const ult = c.ultima_rodada ? new Date(c.ultima_rodada).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
      el.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Pós-venda</div><div class="pg-sub">A IA lê cada reclamação, mediação e mensagem, segue as suas regras e responde pelo Mercado Livre. O que precisa da sua decisão fica na fila.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;align-items:center;"><span class="text-muted" style="font-size:12px;">${ult ? 'Última análise: ' + ult : 'Ainda não analisou'}</span><button class="btn btn-sm" onclick="pvRodada()" ${pv.rodando ? 'disabled' : ''}>${pv.rodando ? 'Analisando… (até 2 min)' : 'Analisar agora'}</button></div>
        </div>
        ${pv.aviso ? `<div class="alert alert-info">${pvE(pv.aviso)}</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi ${fila.length ? 'k-hoje' : 'k-neutro'}"><div class="kpi-label">Esperando você</div><div class="kpi-value">${fila.length}</div><div class="kpi-sub">casos na fila</div></div>
          <div class="kpi ${urg ? 'k-atraso' : 'k-neutro'}"><div class="kpi-label">Vencem em 24 h</div><div class="kpi-value">${urg}</div><div class="kpi-sub">prazo do Mercado Livre</div></div>
          <div class="kpi k-mc"><div class="kpi-label">Resolvidos em 7 dias</div><div class="kpi-value">${resolv}</div><div class="kpi-sub">${diretos} direto pela IA</div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Modo</div><div class="kpi-value" style="font-size:17px;">${c.ativo ? (c.auto_msg || c.auto_dinheiro ? 'Automático' : 'Só fila') : 'Desligado'}</div><div class="kpi-sub">${c.ativo ? 'analisa sozinha a cada 30 min' : 'só analisa quando você clica'}</div></div>
        </div>
        <div class="chips" style="margin-bottom:14px;">${[['fila', 'Fila (' + fila.length + ')'], ['hist', 'Histórico'], ['regras', 'Regras e textos'], ['modo', 'Automação']].map(([k, t]) => `<button class="chip ${pv.aba === k ? 'active' : ''}" onclick="pv.aba='${k}';pvDesenhar();">${t}</button>`).join('')}</div>
        ${pv.aba === 'fila' ? pvFila(fila) : pv.aba === 'hist' ? pvHist(hist) : pv.aba === 'regras' ? pvRegras() : pvModo()}`;
    }

    // ----- fila -----
    function pvFila(fila){
      if(!fila.length) return `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>Nada esperando você</b>${pv.cfg && pv.cfg.ultima_rodada ? 'A IA não encontrou caso que precise da sua decisão.' : 'Clique em "Analisar agora" para a IA ler as reclamações e mensagens abertas.'}</div></div>`;
      return fila.map(pvCartao).join('');
    }
    function pvCartao(c){
      const p = pvPrazo(c), d = c.acao_dados || {}, disp = d.disponiveis || [];
      const pode = Object.keys(PV_EXIGE).filter(a => c.tipo === 'mensagem' ? a === 'mensagem_comprador' && !d.bloqueada : PV_EXIGE[a].some(x => disp.includes(x)));
      const manual = c.acao === 'manual' || c.acao === 'nenhuma' || !pode.length;
      const est = c.tipo === 'mensagem' ? 'Mensagem' : c.estagio === 'dispute' ? 'Mediação' : 'Reclamação';
      const oc = pv.ocupado[c.id];
      const acaoSel = pode.includes(c.acao) ? c.acao : (pode[0] || '');
      return `<div class="card pv-caso ${p.cls}" id="pv-caso-${c.id}">
        <div class="pv-topo">
          <span class="pv-est pv-${c.tipo === 'mensagem' ? 'msg' : c.estagio === 'dispute' ? 'med' : 'rec'}">${est}</span>
          ${typeof lojaNome === 'function' && lojaNome(c.ml_user_id) ? `<span class="loja-tag" style="margin-left:0;">${pvE(lojaNome(c.ml_user_id))}</span>` : ''}
          <b>#${pvE(c.venda || c.ref)}</b>
          <span class="pv-prod">${pvE(c.produto || '')}${c.sku ? ' · ' + pvE(c.sku) : ''}${c.valor ? ' · ' + fmt(Number(c.valor)) : ''}</span>
          <span class="pv-prazo ${p.cls}">${p.t}</span>
        </div>
        <div class="pv-corpo">
          <div class="pv-col">
            <div class="pv-rot">O problema</div><div>${pvE(c.motivo || '—')}</div>
            <div class="pv-rot">Leitura da IA</div><div>${pvE(c.resumo || (c.situacao === 'erro' ? 'A análise falhou: ' + (c.resultado || '') : '—'))}</div>
            ${c.evidencia ? `<div class="pv-rot">Evidência${d.fotos ? ' (' + d.fotos + ' foto' + (d.fotos > 1 ? 's' : '') + ')' : ''}</div><div>${pvE(c.evidencia)}</div>` : ''}
            ${c.motivo_caminho ? `<div class="pv-rot">Por que está na fila</div><div class="text-muted">${pvE(c.motivo_caminho)}</div>` : ''}
            ${c.resultado && c.situacao !== 'erro' ? `<div class="pv-rot">Última tentativa</div><div class="text-danger">${pvE(c.resultado)}</div>` : ''}
          </div>
          <div class="pv-col">
            <div class="pv-rot">Ação sugerida</div>
            ${manual ? `<div class="pf-aviso" style="margin:0 0 8px;">${pvE(d.manual || 'Resolva este caso direto no Mercado Livre.')}${c.acao_texto ? '<br><br><b>Texto sugerido:</b> ' + pvE(c.acao_texto) : ''}</div>` : `
              <select id="pv-ac-${c.id}" onchange="pvTrocaAcao(${c.id})">${pode.map(a => `<option value="${a}" ${a === acaoSel ? 'selected' : ''}>${PV_ACOES[a]}</option>`).join('')}</select>
              <div id="pv-pct-box-${c.id}" style="margin-top:8px;${acaoSel === 'reembolso_parcial' ? '' : 'display:none;'}"><label class="text-muted" style="font-size:12px;">Percentual devolvido ao comprador</label> <input type="number" id="pv-pct-${c.id}" min="10" max="90" step="10" value="${d.percentual || 50}" style="width:90px;"> %</div>
              <textarea id="pv-tx-${c.id}" rows="5" maxlength="350" placeholder="${acaoSel.startsWith('mensagem') ? 'Mensagem' : 'Mensagem ao comprador antes da ação (opcional)'}" oninput="document.getElementById('pv-ct-${c.id}').textContent = this.value.length + '/350'">${pvE(c.acao_texto || '')}</textarea>
              <div class="pv-linha"><span id="pv-ct-${c.id}" class="text-muted" style="font-size:11.5px;">${String(c.acao_texto || '').length}/350</span>
                ${pv.imagens.length ? `<select id="pv-im-${c.id}" style="max-width:240px;"><option value="">Sem imagem anexa</option>${pv.imagens.map(n => `<option ${d.imagem === n ? 'selected' : ''}>${pvE(n)}</option>`).join('')}</select>` : ''}</div>
              ${d.manual ? `<div class="pf-aviso" style="margin:8px 0 0;"><b>Também precisa ser feito à mão:</b> ${pvE(d.manual)}</div>` : ''}`}
            <input type="text" id="pv-rg-${c.id}" placeholder="Corrigiu algo? Escreva aqui como prefere: vira regra nova" style="margin-top:8px;">
            <div class="pv-botoes">
              <a class="btn-out btn-sm" href="${pvLink(c)}" target="_blank" rel="noopener">Abrir no Mercado Livre</a>
              <button class="btn-out btn-sm" onclick="pvDecidir(${c.id}, 'recusar')" ${oc ? 'disabled' : ''}>Recusar</button>
              ${manual ? `<button class="btn btn-sm" onclick="pvDecidir(${c.id}, 'feito')" ${oc ? 'disabled' : ''}>Já resolvi no ML</button>` : `<button class="btn btn-sm" onclick="pvDecidir(${c.id}, 'aprovar')" ${oc ? 'disabled' : ''}>${oc ? 'Executando…' : 'Aprovar e executar'}</button>`}
            </div>
          </div>
        </div>
      </div>`;
    }
    function pvTrocaAcao(id){
      const a = document.getElementById('pv-ac-' + id).value;
      document.getElementById('pv-pct-box-' + id).style.display = a === 'reembolso_parcial' ? '' : 'none';
      document.getElementById('pv-tx-' + id).placeholder = a.startsWith('mensagem') ? 'Mensagem' : 'Mensagem ao comprador antes da ação (opcional)';
    }

    async function pvDecidir(id, decisao){
      const c = pv.casos.find(x => x.id === id); if(!c || pv.ocupado[id]) return;
      const v = k => { const e = document.getElementById('pv-' + k + '-' + id); return e ? e.value : undefined; };
      const regra = (v('rg') || '').trim();
      const corpo = { acao: 'decidir', caso: id, decisao, correcao: regra || undefined };
      if(decisao === 'aprovar'){
        corpo.nova_acao = v('ac'); corpo.texto = v('tx'); corpo.imagem = v('im') || null;
        if(corpo.nova_acao === 'reembolso_parcial') corpo.percentual = Number(v('pct'));
        const dinheiro = ['reembolso_total', 'reembolso_parcial', 'liberar_devolucao'].includes(corpo.nova_acao);
        // ação com dinheiro pede um segundo clique
        const bt = event && event.target;
        if(dinheiro && bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar: ' + PV_ACOES[corpo.nova_acao].toLowerCase(); return; }
      }
      pv.ocupado[id] = true; pvDesenhar();
      const j = await pvChamar(corpo);
      delete pv.ocupado[id];
      if(j.error) pv.aviso = 'Venda #' + (c.venda || c.ref) + ': ' + j.error;
      else pv.aviso = 'Venda #' + (c.venda || c.ref) + ': ' + (j.resultado || (decisao === 'recusar' ? 'recusado, nada foi feito' : 'marcado como resolvido'));
      // correção escrita vira regra nova
      if(regra && !j.error){
        const marca = 'REGRAS APRENDIDAS';
        let txt = pv.cfg.regras || '';
        if(!txt.includes(marca)) txt += '\n\n' + marca + ' (correções do dono)';
        txt += '\n- ' + (c.produto ? '[' + String(c.produto).slice(0, 60) + '] ' : '') + regra;
        await pvSalvarCfg({ regras: txt });
      }
      await pvAtualizar();
    }

    // ----- histórico -----
    function pvHist(hist){
      if(!hist.length) return `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>Nenhum caso resolvido ainda</b></div></div>`;
      const dt = d => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      return `<div class="card"><div class="card-header"><div class="card-title">Histórico</div><button class="btn-out btn-sm" onclick="pvExportar()">Exportar</button></div><div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Quando</th><th>Venda</th><th>Produto</th><th>Tipo</th><th>O que foi feito</th><th>Decisão</th><th>Resultado</th></tr></thead><tbody>
        ${hist.map(c => `<tr style="cursor:pointer;" onclick="pvVer(${c.id})"><td style="white-space:nowrap;">${dt(c.executado_em || c.analisado_em)}</td>
          <td style="white-space:nowrap;"><b>#${pvE(c.venda || c.ref)}</b>${typeof lojasVarias === 'function' && lojasVarias() && !lojaAtiva() ? '<div class="cp-sub">' + pvE(lojaNome(c.ml_user_id)) + '</div>' : ''}</td>
          <td class="cp-prod" style="max-width:240px;"><b>${pvE(c.produto || '—')}</b><span>${pvE(c.motivo || '')}</span></td>
          <td>${pvE(c.categoria || (c.tipo === 'mensagem' ? 'mensagem' : 'reclamação'))}</td>
          <td style="max-width:260px;">${pvE(PV_ACOES[c.acao] || c.acao || '—')}</td>
          <td>${c.decisao === 'DIRETO' ? '<span class="badge badge-success">Direto pela IA</span>' : c.decisao ? pvE(c.decisao.charAt(0) + c.decisao.slice(1).toLowerCase()) : '—'}</td>
          <td style="max-width:280px;"><span class="${c.situacao === 'erro' ? 'text-danger' : ''}">${pvE(c.resultado || PV_SIT[c.situacao] || '')}</span></td></tr>`).join('')}
      </tbody></table></div></div>`;
    }
    async function pvVer(id){
      const c = pv.hist.concat(pv.casos).find(x => x.id === id); if(!c) return;
      const { data } = await supa.from('pos_venda_log').select('*').eq('caso_id', id).order('quando');
      const dt = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      vmlModal('Venda #' + pvE(c.venda || c.ref), `
        <div class="text-muted" style="margin-bottom:10px;">${pvE(c.produto || '')}${c.sku ? ' · ' + pvE(c.sku) : ''}</div>
        <div class="pv-rot">O problema</div><div>${pvE(c.motivo || '—')}</div>
        <div class="pv-rot">Leitura da IA</div><div>${pvE(c.resumo || '—')}</div>
        ${c.evidencia ? `<div class="pv-rot">Evidência</div><div>${pvE(c.evidencia)}</div>` : ''}
        ${c.acao_texto ? `<div class="pv-rot">Texto enviado ou sugerido</div><div>${pvE(c.acao_texto)}</div>` : ''}
        ${c.correcao ? `<div class="pv-rot">Sua correção</div><div>${pvE(c.correcao)}</div>` : ''}
        ${c.aprendizado ? `<div class="pv-rot">Aprendizado</div><div>${pvE(c.aprendizado)}</div>` : ''}
        <div class="pv-rot">Passo a passo</div>
        ${(data || []).map(l => `<div class="pv-log"><span>${dt(l.quando)}</span><b>${l.quem === 'ia' ? 'IA' : l.quem === 'usuario' ? 'Você' : 'Sistema'}</b><span>${pvE(l.o_que)}</span></div>`).join('') || '<div class="text-muted">Sem registros.</div>'}`,
        `<a class="btn-out btn" href="${pvLink(c)}" target="_blank" rel="noopener">Abrir no Mercado Livre</a><button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>`);
    }
    function pvExportar(){
      const linhas = pvDaLoja(pv.hist).map(c => ({ data_hora: c.executado_em || c.analisado_em, conta: (typeof lojaNome === 'function' && lojaNome(c.ml_user_id)) || c.ml_user_id, venda: c.venda || c.ref, produto: c.produto, tipo: c.categoria || c.tipo, motivo: c.motivo, evidencia: c.evidencia, acao_sugerida: (PV_ACOES[c.acao] || c.acao || '') + (c.acao_texto ? ': ' + c.acao_texto : ''), caminho: c.decisao === 'DIRETO' ? 'direto' : 'fila', decisao: c.decisao, correcao: c.correcao, resultado: c.resultado, aprendizado: c.aprendizado }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Pós-venda');
      XLSX.writeFile(wb, 'registro_pos_venda_' + getToday() + '.xlsx');
    }

    // ----- regras e textos -----
    function pvRegras(){
      const c = pv.cfg || {};
      return `<div class="card"><div class="card-header"><div class="card-title">Regras e textos prontos</div><span class="text-muted" style="font-size:12px;">É a orientação que a IA segue. Escreva como falaria com um atendente novo.</span></div>
        <div class="card-body">
          <textarea id="pv-regras" rows="26" style="width:100%;font-family:inherit;font-size:13px;line-height:1.55;" placeholder="Postura, o que passa direto, o que vai para a fila, regras por produto e textos prontos (R1, R2...).">${pvE(c.regras || '')}</textarea>
          <div class="d-flex gap-1" style="margin-top:10px;align-items:center;flex-wrap:wrap;"><button class="btn" onclick="pvSalvarRegras(this)">Salvar regras</button><span class="text-muted" style="font-size:12px;">As correções que você escreve na fila entram sozinhas no fim deste texto, em "Regras aprendidas".</span></div>
        </div></div>
        <div class="card"><div class="card-header"><div class="card-title">Imagens de apoio</div><button class="btn-out btn-sm" onclick="pvEnviarImagem()">Enviar imagem</button></div>
          <div class="card-body">
            <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">Imagens que a IA pode anexar numa resposta (um passo a passo, por exemplo). Cite o <b>nome exato do arquivo</b> na regra, como em: anexar "Imagem de Modelagem do Buquê.png".</div>
            ${pv.imagens.length ? pv.imagens.map(n => `<div class="pv-img"><span>${pvE(n)}</span><button class="btn-out btn-sm" onclick="pvVerImagem('${pvE(n).replace(/'/g, '&#39;')}')">Ver</button><button class="btn-out btn-sm" style="color:var(--danger);" onclick="pvExcluirImagem('${pvE(n).replace(/'/g, '&#39;')}', this)">Excluir</button></div>`).join('') : '<div class="text-muted">Nenhuma imagem enviada.</div>'}
          </div></div>`;
    }
    async function pvSalvarRegras(bt){
      const ok = await pvSalvarCfg({ regras: document.getElementById('pv-regras').value });
      if(ok) toast('Regras salvas. Valem a partir da próxima análise.');
    }
    function pvEnviarImagem(){
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp'; inp.id = 'pv-img-input';
      inp.onchange = async () => { const f = inp.files[0]; if(!f) return;
        if(f.size > 4 * 1024 * 1024){ toast('A imagem tem mais de 4 MB. Envie uma menor.'); return; }
        const r = await supa.storage.from('pos-venda').upload(usuarioAtual.id + '/' + f.name, f, { upsert: true, contentType: f.type });
        if(r.error){ toast('Não consegui enviar: ' + r.error.message); return; }
        await pvAtualizar(); };
      inp.click();
    }
    async function pvVerImagem(nome){
      const r = await supa.storage.from('pos-venda').createSignedUrl(usuarioAtual.id + '/' + nome, 300);
      if(r.data) window.open(r.data.signedUrl, '_blank');
    }
    async function pvExcluirImagem(nome, bt){
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar'; return; }
      await supa.storage.from('pos-venda').remove([usuarioAtual.id + '/' + nome]);
      await pvAtualizar();
    }

    // ----- automação -----
    function pvModo(){
      const c = pv.cfg || {};
      const chave = (campo, titulo, texto, extra) => `<label class="pv-chave"><input type="checkbox" ${c[campo] ? 'checked' : ''} onchange="pvChave('${campo}', this.checked)" ${extra || ''}><div><b>${titulo}</b><span>${texto}</span></div></label>`;
      return `<div class="card"><div class="card-header"><div class="card-title">O que a IA pode fazer sozinha</div></div><div class="card-body">
        ${chave('ativo', 'Analisar sozinha a cada 30 minutos', 'Sem depender do computador ligado. Desligado, a análise só roda quando você clica em "Analisar agora".')}
        ${chave('auto_msg', 'Enviar mensagens sem aprovação quando a regra manda passar direto', 'Vale para resposta ao comprador e ao Mercado Livre. Tudo que a regra manda para a fila continua esperando você.', c.ativo ? '' : '')}
        ${chave('auto_dinheiro', 'Reembolsar e liberar devolução sem aprovação quando a regra manda passar direto', 'Envolve dinheiro. Só ligue depois de ver a IA acertando na fila.')}
        <div class="pv-chave"><div style="margin-left:34px;"><b>Limite de valor</b><span>Venda acima deste valor sempre vai para a fila, mesmo que a regra mande passar direto.</span>
          <div style="margin-top:6px;">R$ <input type="number" min="0" step="10" value="${Number(c.limite) || 0}" style="width:120px;" onchange="pvSalvarCfg({ limite: Number(this.value) || 0 }).then(pvDesenhar)"></div></div></div>
        <div class="alert alert-warning" style="margin-top:14px;">Enquanto a tarefa agendada de pós-venda do Claude no computador estiver ativa, os dois vão olhar os mesmos casos. Quando ligar a automação aqui, pause aquela tarefa para não responder em dobro.</div>
      </div></div>`;
    }
    async function pvChave(campo, valor){ if(await pvSalvarCfg({ [campo]: valor })) pvDesenhar(); }
