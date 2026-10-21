// ===== PENDÊNCIAS COM O TRANSPORTADOR DO FLEX =====
// Cada envio marcado numa conferência de fatura (flex-conf.js) vira uma pendência (tabela flex_pendencias, uma por
// envio). Ela fica aberta até o produto voltar (devolvido), o valor ser abatido numa fatura ou você desistir (perdoado).
// O prazo padrão é o vencimento da fatura + 15 dias (a próxima fatura), que é quando dá para cobrar.
// Ao conferir a próxima fatura do mesmo transportador, as pendências abertas aparecem para abater.

    let fp = { lista: null, ver: 'aberto' };
    const FP_SIT = { aguardando: ['Aguardando devolução', 'cp-comprar'], devolvido: ['Devolvido', 'cp-ok'], abatido: ['Abatido na fatura', 'cp-ok'], perdoado: ['Encerrado sem cobrar', 'cp-excesso'] };
    const fpHoje = () => getToday();
    const fpVencida = p => p.situacao === 'aguardando' && p.prazo && p.prazo < fpHoje();

    async function fpCarregar(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const r = await supa.from('flex_pendencias').select('*').eq('usuario_id', usuarioAtual.id).order('criado_em', { ascending: false }).limit(1000);
      fp.lista = r.error ? (fp.lista || []) : (r.data || []); fp.lidoEm = Date.now();
    }

    // chamada ao guardar a conferência: cria as pendências dos envios marcados (o que já existe não é mexido)
    async function fpGerar(F, linhas){
      const venc = F.venc || F.emitida || fpHoje(), prazo = dateStr(new Date(new Date(venc + 'T12:00:00').getTime() + 15 * 86400000));
      const reg = linhas.map(l => { const v = (l.vendas || [])[0] || {};
        return { usuario_id: usuarioAtual.id, envio: String(l.envio), codigo: l.codigo || null, fatura: F.numero || null, transportador: F.transportador || null, conta: l.conta || null,
          pedido: v.pedido || null, sku: (l.vendas || []).map(x => x.sku).filter(Boolean).join(', ') || null, titulo: v.titulo || null, qtd: (l.vendas || []).reduce((s, x) => s + (Number(x.qtd) || 1), 0) || 1,
          cat: l.cat || null, pedir: (typeof FX_PEDIDO !== 'undefined' && FX_PEDIDO[l.cat]) || null, frete: typeof fxFreteQ === 'function' ? fxFreteQ(l) : l.frete, valor: typeof fxProdutoQ === 'function' ? fxProdutoQ(l) : 0, prazo }; });
      if(!reg.length) return 0;
      const r = await supa.from('flex_pendencias').upsert(reg, { onConflict: 'usuario_id,envio', ignoreDuplicates: true });
      if(r.error){ toast('Conferência guardada, mas não consegui criar as pendências: ' + r.error.message); return 0; }
      fp.lista = null; return reg.length;
    }

    function fpDe(id){ return (fp.lista || []).find(p => p.id === id); }
    async function fpGravar(id, campos){
      const r = await supa.from('flex_pendencias').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('usuario_id', usuarioAtual.id).eq('id', id);
      if(r.error){ toast('Não consegui gravar: ' + r.error.message); return false; }
      const p = fpDe(id); if(p) Object.assign(p, campos);
      return true;
    }
    function fpRedesenhar(){ if(typeof fxDesenhar === 'function') fxDesenhar(); }

    // ---------- quadro na página da conferência (sem fatura aberta) ----------
    function fpPainel(){
      if(fp.lista === null){ fpCarregar().then(fpRedesenhar); return ''; }
      const L = fp.lista; if(!L.length) return '';
      const ab = L.filter(p => p.situacao === 'aguardando'), venc = ab.filter(fpVencida), aCobrar = ab.reduce((s, p) => s + (Number(p.valor) || 0) + (p.frete_estornado ? 0 : Number(p.frete) || 0), 0);
      const lista = fp.ver === 'aberto' ? ab : fp.ver === 'todas' ? L : L.filter(p => p.situacao !== 'aguardando');
      const chip = (k, t, n) => `<button class="chip ${fp.ver === k ? 'active' : ''}" onclick="fp.ver='${k}';fpRedesenhar()">${t} ${n}</button>`;
      const btn = (t, f, extra) => `<button class="btn-out btn-sm" ${extra || ''} onclick="${f}">${t}</button>`;
      return `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px;"><div><div class="card-title">Pendências com o transportador</div><div class="pg-sub">Envios questionados nas faturas, até o produto voltar ou o valor ser abatido. ${ab.length ? `<b>${ab.length}</b> em aberto · <b style="color:var(--danger)">${fmt(aCobrar)}</b> a recuperar${venc.length ? ` · <b style="color:var(--danger)">${venc.length} com prazo vencido</b>` : ''}` : 'Nada em aberto.'}</div></div>
          <div class="chips">${chip('aberto', 'Em aberto', ab.length)}${chip('fechadas', 'Resolvidas', L.length - ab.length)}${chip('todas', 'Todas', L.length)}</div></div>
        <div style="overflow-x:auto;"><table class="cp-tab" data-sem-ordem><thead><tr><th>Envio</th><th>Produto</th><th>O que foi pedido</th><th class="num">Frete</th><th class="num">Produto</th><th>Prazo</th><th>Situação / ações</th></tr></thead><tbody>
        ${lista.length ? lista.map(p => { const s = FP_SIT[p.situacao] || [p.situacao, ''], aberta = p.situacao === 'aguardando';
          return `<tr><td><b>${fxE(p.envio)}</b><br><small class="text-muted">fatura ${fxE(p.fatura || '—')}${p.pedido ? ` · <a class="fx-link" style="color:var(--primary);" href="https://www.mercadolivre.com.br/vendas/${fxE(p.pedido)}/detalhe" target="_blank" rel="noopener">venda #${fxE(p.pedido)}</a>` : ''}${p.conta && typeof contaNome === 'function' && contaNome(p.conta) ? ' · ' + fxE(contaNome(p.conta)) : ''}</small></td>
            <td class="cp-prod" style="max-width:220px;"><b>${fxE(p.sku || '—')}</b><span>${fxE(p.titulo || '')}${Number(p.qtd) > 1 ? ' · ' + p.qtd + ' un.' : ''}</span></td>
            <td style="white-space:normal;min-width:260px;max-width:360px;font-size:12px;line-height:1.45;">${fxE(p.pedir || '')}${p.obs ? `<br><i class="text-muted" style="display:block;margin-top:4px;">${fxE(p.obs)}</i>` : ''}</td>
            <td class="num">${Number(p.frete) ? fmt(Number(p.frete)) + (p.frete_estornado ? '<br><small style="color:var(--success,#16a34a);font-weight:700;">estornado</small>' : '') : '<small class="text-muted">não contestado</small>'}</td>
            <td class="num">${Number(p.valor) ? fmt(Number(p.valor)) : '—'}</td>
            <td>${p.prazo ? `<span style="${fpVencida(p) ? 'color:var(--danger);font-weight:700;' : ''}">${ptDate(p.prazo)}</span>${fpVencida(p) ? '<br><small style="color:var(--danger)">vencido</small>' : ''}` : '—'}</td>
            <td><span class="cp-sit ${s[1]}">${s[0]}</span>${p.situacao === 'devolvido' ? `<br><small class="text-muted">${p.devolvido_em ? ptDate(p.devolvido_em) : ''}${p.conferido_por ? ' · ' + fxE(p.conferido_por) : ''}${p.estado_produto ? ' · ' + (p.estado_produto === 'bom' ? 'bom' : 'avariado') : ''}${p.entrou_estoque ? ' · no estoque' : ''}</small>` : ''}${p.situacao === 'abatido' ? `<br><small class="text-muted">fatura ${fxE(p.abatido_fatura || '—')}${p.abatido_valor ? ' · ' + fmt(Number(p.abatido_valor)) : ''}</small>` : ''}<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-width:200px;max-width:260px;">${aberta ? btn('Devolvido', `fpDevolvido(${p.id})`) + ' ' + btn('Abatido', `fpAbatido(${p.id})`) + (Number(p.frete) && !p.frete_estornado ? ' ' + btn('Frete estornado', `fpFrete(${p.id}, true)`, 'title="O transportador estornou o frete deste envio (o produto continua pendente)"') : '') + ' ' + btn('Mais', `fpMais(${p.id})`) : btn('Reabrir', `fpReabrir(${p.id})`)}</div></td></tr>`; }).join('')
          : `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:22px;">${fp.ver === 'aberto' ? 'Nenhuma pendência em aberto.' : 'Nada nesta lista.'}</td></tr>`}
        </tbody></table></div>
        <div class="text-muted" style="font-size:12px;padding:12px 18px;line-height:1.5;">As pendências nascem ao guardar a conferência de uma fatura (um por envio marcado). O prazo padrão é o vencimento da fatura + 15 dias, quando chega a próxima: se o produto não voltou até lá, abata o valor dela.</div></div>`;
    }

    // ---------- ações ----------
    async function fpDevolvido(id){
      const p = fpDe(id); if(!p) return;
      const dep = await supa.from('estoque_depositos').select('id,nome').eq('usuario_id', usuarioAtual.id).eq('tipo', 'proprio').eq('ativo', true).limit(1);
      fp._dep = (dep.data || [])[0] || null;
      vmlModal('Produto devolvido', `<div style="line-height:1.5;margin-bottom:12px;">Envio <b>${fxE(p.envio)}</b> · ${fxE(p.sku || '')} ${fxE(p.titulo || '')}${Number(p.qtd) > 1 ? ' · <b>' + p.qtd + ' unidades</b>' : ''}</div>
        <div class="form-row"><div class="form-group"><label class="form-label" for="fp-dt">Chegou em</label><input type="date" id="fp-dt" value="${fpHoje()}"></div>
          <div class="form-group"><label class="form-label" for="fp-quem">Conferido por</label><input type="text" id="fp-quem" placeholder="Nome de quem conferiu"></div></div>
        <div class="form-group"><label class="form-label">Como voltou</label><div style="display:flex;gap:18px;">
          <label style="display:flex;gap:6px;align-items:center;margin:0;"><input type="radio" name="fp-est" value="bom" checked style="width:auto;" onchange="document.getElementById('fp-ent-box').style.display=''"> Voltou bom</label>
          <label style="display:flex;gap:6px;align-items:center;margin:0;"><input type="radio" name="fp-est" value="avariado" style="width:auto;" onchange="document.getElementById('fp-ent-box').style.display='none'"> Voltou avariado</label></div></div>
        <div id="fp-ent-box">${fp._dep && p.sku && !p.sku.includes(',') ? `<label style="display:flex;gap:8px;align-items:center;margin:0;cursor:pointer;"><input type="checkbox" id="fp-ent" checked style="width:auto;"> Dar entrada de ${p.qtd} un. no estoque (${fxE(fp._dep.nome)})</label>` : '<small class="text-muted">Entrada no estoque: faça na página Estoque' + (p.sku && p.sku.includes(',') ? ' (envio com mais de um produto)' : '') + '.</small>'}</div>
        <div class="form-group" style="margin-top:12px;"><label class="form-label" for="fp-obs">Observação (opcional)</label><input type="text" id="fp-obs" value="${fxE(p.obs || '')}"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="fpDevolvidoOk(${id}, this)">Confirmar devolução</button>`);
    }
    async function fpDevolvidoOk(id, bt){
      const p = fpDe(id), v = i => (document.getElementById(i) || {}).value || '', quem = v('fp-quem').trim(), est = (document.querySelector('input[name="fp-est"]:checked') || {}).value || 'bom';
      if(!quem){ toast('Informe quem conferiu o produto.'); return; }
      if(bt){ bt.disabled = true; bt.textContent = 'Gravando…'; }
      let entrou = false; const ent = document.getElementById('fp-ent');
      if(est === 'bom' && ent && ent.checked && fp._dep){
        const partes = typeof esoAbrir === 'function' ? esoAbrir(p.sku, Number(p.qtd) || 1) : [{ sku: p.sku, qtd: Number(p.qtd) || 1 }];
        const r = await supa.from('estoque_mov').insert(partes.map(x => ({ usuario_id: usuarioAtual.id, deposito_id: fp._dep.id, sku: x.sku, qtd: x.qtd, motivo: 'devolucao', ref: 'flex:' + p.envio, obs: 'Devolvido pelo transportador do Flex (fatura ' + (p.fatura || '') + ')' })));
        if(r.error){ toast('Não consegui dar entrada no estoque: ' + r.error.message); if(bt){ bt.disabled = false; bt.textContent = 'Confirmar devolução'; } return; }
        entrou = true;
      }
      if(await fpGravar(id, { situacao: 'devolvido', devolvido_em: v('fp-dt') || fpHoje(), conferido_por: quem, estado_produto: est, entrou_estoque: entrou, obs: v('fp-obs').trim() || null })){
        fecharModal('modal-vml'); toast(entrou ? 'Devolução registrada e produto lançado no estoque.' : 'Devolução registrada.'); fpRedesenhar();
      }
    }
    function fpAbatido(id, fatura){
      const p = fpDe(id); if(!p) return;
      const tot = (Number(p.valor) || 0) + (p.frete_estornado ? 0 : Number(p.frete) || 0);
      vmlModal('Abatido na fatura', `<div style="line-height:1.5;margin-bottom:12px;">Envio <b>${fxE(p.envio)}</b> · ${fxE(p.sku || '')}. O transportador abateu o valor numa fatura (o produto não volta).</div>
        <div class="form-row"><div class="form-group"><label class="form-label" for="fp-fat">Nº da fatura</label><input type="text" id="fp-fat" value="${fxE(fatura || '')}"></div>
          <div class="form-group"><label class="form-label" for="fp-val">Valor abatido (R$)</label><input type="text" inputmode="decimal" id="fp-val" value="${tot ? fmtMoney(tot) : ''}"></div></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="fpAbatidoOk(${id})">Confirmar</button>`);
    }
    async function fpAbatidoOk(id){
      const fat = ((document.getElementById('fp-fat') || {}).value || '').trim(), val = parseMoney((document.getElementById('fp-val') || {}).value || '') || 0;
      if(!fat){ toast('Informe o número da fatura em que o valor foi abatido.'); return; }
      if(await fpGravar(id, { situacao: 'abatido', abatido_fatura: fat, abatido_valor: val || null, frete_estornado: true })){ fecharModal('modal-vml'); toast('Pendência encerrada: abatida na fatura ' + fat + '.'); fpRedesenhar(); }
    }
    async function fpFrete(id, on){ if(await fpGravar(id, { frete_estornado: !!on })){ toast(on ? 'Frete marcado como estornado. O produto continua pendente.' : 'Estorno do frete desfeito.'); fpRedesenhar(); } }
    function fpMais(id){
      const p = fpDe(id); if(!p) return;
      vmlModal('Pendência do envio ' + fxE(p.envio), `<div class="form-row"><div class="form-group"><label class="form-label" for="fp-prazo">Prazo</label><input type="date" id="fp-prazo" value="${p.prazo || ''}"></div>
          <div class="form-group"><label class="form-label" for="fp-vp">Valor do produto a recuperar (R$)</label><input type="text" inputmode="decimal" id="fp-vp" value="${Number(p.valor) ? fmtMoney(Number(p.valor)) : ''}"></div></div>
        <div class="form-group"><label class="form-label" for="fp-obs2">Observação</label><input type="text" id="fp-obs2" value="${fxE(p.obs || '')}" placeholder="Ex.: transportador disse que devolve na próxima coleta"></div>
        ${p.frete_estornado ? '<label style="display:flex;gap:8px;align-items:center;margin:0 0 10px;"><input type="checkbox" id="fp-fr" checked style="width:auto;"> Frete já estornado</label>' : ''}
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:6px;"><label class="form-label" for="fp-mot">Encerrar sem cobrar (motivo)</label><div style="display:flex;gap:8px;"><input type="text" id="fp-mot" placeholder="Ex.: produto achado no galpão" style="flex:1;"><button class="btn-out btn" style="color:var(--danger);" onclick="fpPerdoar(${id})">Encerrar</button></div></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="fpMaisOk(${id})">Salvar</button>`);
    }
    async function fpMaisOk(id){
      const p = fpDe(id), c = { prazo: (document.getElementById('fp-prazo') || {}).value || null, valor: parseMoney((document.getElementById('fp-vp') || {}).value || '') || 0, obs: ((document.getElementById('fp-obs2') || {}).value || '').trim() || null };
      const fr = document.getElementById('fp-fr'); if(fr) c.frete_estornado = fr.checked;
      if(await fpGravar(id, c)){ fecharModal('modal-vml'); fpRedesenhar(); }
    }
    async function fpPerdoar(id){
      const m = ((document.getElementById('fp-mot') || {}).value || '').trim(); if(!m){ toast('Escreva o motivo para encerrar sem cobrar.'); return; }
      const p = fpDe(id);
      if(await fpGravar(id, { situacao: 'perdoado', obs: (p.obs ? p.obs + ' · ' : '') + 'Encerrado: ' + m })){ fecharModal('modal-vml'); fpRedesenhar(); }
    }
    async function fpReabrir(id){
      const p = fpDe(id); if(!p) return;
      if(p.entrou_estoque && !confirm('Este produto já entrou no estoque como devolvido. Reabrir não tira ele do estoque (ajuste na página Estoque, se for o caso). Continuar?')) return;
      if(await fpGravar(id, { situacao: 'aguardando', devolvido_em: null, conferido_por: null, estado_produto: null, abatido_fatura: null, abatido_valor: null })) fpRedesenhar();
    }

    // ---------- aviso dentro da conferência de uma fatura: pendências abertas do mesmo transportador ----------
    function fpAvisoFatura(F){
      if(fp.lista === null){ fpCarregar().then(fpRedesenhar); return ''; }
      const t = typeof fxN === 'function' ? fxN(F.transportador) : '';
      const ab = fp.lista.filter(p => p.situacao === 'aguardando' && (!t || !p.transportador || fxN(p.transportador) === t));
      if(!ab.length) return '';
      const tot = ab.reduce((s, p) => s + (Number(p.valor) || 0) + (p.frete_estornado ? 0 : Number(p.frete) || 0), 0);
      return `<div class="alert alert-warning"><b>${ab.length} pendência${ab.length > 1 ? 's' : ''} em aberto com este transportador · ${fmt(tot)} a recuperar.</b> Se o produto não voltou, abata nesta fatura. Se o valor veio como estorno aqui, marque como abatido:
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">${ab.map(p => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px;"><span><b>${fxE(p.envio)}</b> · ${fxE(p.sku || '')} · fatura ${fxE(p.fatura || '—')} · ${Number(p.valor) ? 'produto ' + fmt(Number(p.valor)) : ''}${Number(p.frete) && !p.frete_estornado ? ' + frete ' + fmt(Number(p.frete)) : ''}${p.prazo ? ' · prazo ' + ptDate(p.prazo) : ''}</span>
          <button class="btn-out btn-sm" onclick="fpAbatido(${p.id}, '${fxE(F.numero || '')}')">Abatido nesta fatura</button>${Number(p.frete) && !p.frete_estornado ? `<button class="btn-out btn-sm" onclick="fpFrete(${p.id}, true)">Só o frete foi estornado</button>` : ''}<button class="btn-out btn-sm" onclick="fpDevolvido(${p.id})">Produto devolvido</button></div>`).join('')}</div></div>`;
    }

    // ---------- alerta no Início: pendência com prazo vencido ----------
    function fpAlertaInicio(){
      if(fp.lista === null || Date.now() - (fp.lidoEm || 0) > 600000){ if(!fp._lendo){ fp._lendo = true; fpCarregar().then(() => { fp._lendo = false; const v = document.getElementById('view-inicio'); if(v && v.classList.contains('active') && (fp.lista || []).some(fpVencida) && typeof renderInicio === 'function') renderInicio(); }).catch(() => { fp._lendo = false; }); } if(fp.lista === null) return null; }
      const v = fp.lista.filter(fpVencida); if(!v.length) return null;
      const tot = v.reduce((s, p) => s + (Number(p.valor) || 0) + (p.frete_estornado ? 0 : Number(p.frete) || 0), 0);
      return { t: 'warning', i: '📦', tx: `<b>${v.length} produto${v.length > 1 ? 's' : ''} do Flex sem devolução</b> com o prazo vencido · ${fmt(tot)} a cobrar do transportador.`, ac: "fp.ver='aberto';nav('flex')", la: 'Ver pendências' };
    }
