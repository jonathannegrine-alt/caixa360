// ===== CUSTO POR LOTE (PEPS: primeiro que entra, primeiro que sai) =====
// Cada produto tem uma fila de lotes: o lote inicial (estoque de quando o controle foi ligado, ao custo do cadastro)
// e depois um lote por chegada de ordem de compra, ao preço da ordem. As vendas consomem a fila na ordem e cada
// venda fica com o custo do lote de onde saiu (kits somam os componentes). O cálculo é feito no banco
// (RPC custo_peps_recalcular, que roda também a cada sincronização de vendas); aqui fica só a tela.

    let peps = { cfg: null, lotes: [], previa: null, busca: '' };
    const ppN = s => String(s == null ? '' : s).trim().toLowerCase();
    const ppE = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const ppI = n => Math.round(Number(n) || 0).toLocaleString('pt-BR');
    const ppDH = t => new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });

    async function pepsCarregar(){
      const [c, l] = await Promise.all([
        supa.from('custo_peps_cfg').select('*').eq('usuario_id', usuarioAtual.id).maybeSingle(),
        supa.rpc('custo_peps_lotes')
      ]);
      peps.cfg = c.data || null;
      peps.lotes = l.data || [];
      return !(c.error || l.error);
    }

    // recalcula o custo das vendas (chamado depois de lançar ou desfazer chegada, e ao mexer nos lotes)
    async function pepsRecalcular(avisar){
      const r = await supa.rpc('custo_peps_recalcular');
      if(avisar && typeof toast === 'function') toast(r.error ? 'Não consegui recalcular: ' + r.error.message : (Number(r.data) || 0).toLocaleString('pt-BR') + ' venda(s) com o custo atualizado.');
      return r;
    }

    async function pepsAbrir(){
      vmlModal('Custo por lote', '<div class="carregando-msg"><span class="carregando-roda"></span><b>Carregando…</b></div>', '');
      const ok = await pepsCarregar();
      if(!ok){ vmlModal('Custo por lote', '<div class="alert alert-danger">Não consegui ler os lotes. Atualize a página e tente de novo.</div>', `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>`); return; }
      pepsDesenhar();
    }

    function pepsDesenhar(){
      const larga = () => { const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '940px'; };
      const como = `<div class="text-muted" style="line-height:1.55;font-size:13px;">Cada produto tem uma fila de lotes. O primeiro é o <b style="color:var(--text)">estoque de hoje</b>, ao custo que está no cadastro de Produtos. Depois, cada <b style="color:var(--text)">chegada de ordem de compra</b> vira um lote, ao preço da ordem. As vendas consomem os lotes na ordem: quando acaba o lote de R$ 19,00 e começa o de R$ 19,95, o custo das vendas muda sozinho. Kits somam o custo dos componentes.</div>`;
      if(!peps.cfg){
        vmlModal('Custo por lote', `${como}
          <div class="alert alert-info" style="margin-top:14px;">Ainda não está ligado. Para começar, o sistema monta o lote inicial com o estoque de agora (galpão + Full). Antes, importe a lista de estoque mais recente da UpSeller na página Estoque, para a quantidade do galpão estar certa.</div>`,
          `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn" onclick="pepsPreparar(this)">Montar lote inicial</button>`);
        larga(); return;
      }
      const b = ppN(peps.busca), grupos = new Map();
      peps.lotes.forEach(l => { if(b && !l.sku_norm.includes(b)) return; if(!grupos.has(l.sku_norm)) grupos.set(l.sku_norm, []); grupos.get(l.sku_norm).push(l); });
      const linhas = [...grupos.values()].map(ls => {
        const atual = ls.find(l => Number(l.restante) > 0) || ls[ls.length - 1], acabou = !ls.some(l => Number(l.restante) > 0);
        return ls.map((l, i) => {
          const eAtual = l === atual, rest = Number(l.restante) || 0;
          return `<tr${eAtual ? ' style="background:color-mix(in srgb,var(--primary) 8%,transparent);"' : ''}>
            <td>${i === 0 ? `<b>${ppE(l.sku)}</b>` : ''}</td>
            <td>${l.origem === 'inicial' ? 'Estoque inicial' : l.origem === 'compra' ? ppE(l.ref || 'Compra') : 'Lote manual'}<br><small class="text-muted">${ppDH(l.data)}</small></td>
            <td class="num">${ppI(l.qtd)}</td><td class="num"><b>${fmt(l.custo)}</b></td>
            <td class="num">${ppI(l.consumido)}</td><td class="num">${rest > 0 ? `<b>${ppI(rest)}</b>` : '<span class="text-muted">acabou</span>'}</td>
            <td>${eAtual ? (acabou ? '<span class="cp-sit cp-excesso">fila acabou: segue neste custo</span>' : '<span class="cp-sit cp-ok">em uso</span>') : (rest > 0 ? '<span class="text-muted">na fila</span>' : '')}</td>
            <td style="text-align:right;white-space:nowrap;">${l.origem === 'compra' ? '' : `<button class="btn-out btn-sm" onclick="pepsEditar(${l.lote_id})">Editar</button>`}</td></tr>`;
        }).join('');
      }).join('');
      vmlModal('Custo por lote', `
        <div class="alert alert-info" style="margin-bottom:12px;"><b>${peps.cfg.ativo ? 'Ligado' : 'Pausado'}</b>&nbsp;desde ${ppDH(peps.cfg.desde)}. As vendas feitas a partir dessa data seguem os lotes; as anteriores ficam como estão.</div>
        <div class="d-flex gap-1" style="flex-wrap:wrap;align-items:center;margin-bottom:10px;">
          <input type="text" placeholder="Buscar SKU" value="${ppE(peps.busca)}" oninput="peps.busca=this.value;clearTimeout(peps.t);peps.t=setTimeout(()=>{pepsDesenhar();const i=document.querySelector('#modal-vml input[type=text]');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}},350)" style="max-width:220px;">
          <button class="btn-out btn-sm" onclick="pepsEditar(0)">+ Lote manual</button>
          <button class="btn-out btn-sm" onclick="pepsRecalcularBotao(this)">Recalcular vendas</button>
        </div>
        <div style="max-height:52vh;overflow:auto;"><table class="cp-tab"><thead><tr><th>Produto</th><th>Lote</th><th class="num">Quantidade</th><th class="num">Custo</th><th class="num">Já vendido</th><th class="num">Resta</th><th></th><th></th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="8" class="text-muted" style="padding:18px;text-align:center;">Nenhum lote.</td></tr>'}</tbody></table></div>
        <details style="margin-top:12px;"><summary style="cursor:pointer;font-size:13px;font-weight:650;">Como funciona</summary><div style="margin-top:8px;">${como}
          <div class="text-muted" style="line-height:1.55;font-size:13px;margin-top:8px;">Chegada lançada com atraso: informe a <b style="color:var(--text)">data em que a mercadoria chegou</b> na conferência da ordem; a fila se reorganiza e as vendas são recalculadas. Custo digitado direto numa venda não é alterado pelos lotes.</div></div></details>`,
        `<button class="btn-out btn" style="margin-right:auto;" onclick="pepsPausar()">${peps.cfg.ativo ? 'Pausar' : 'Ligar de novo'}</button><button class="btn-out btn" onclick="pepsPreparar(this)">Refazer lote inicial</button><button class="btn btn" onclick="fecharModal('modal-vml')">Fechar</button>`);
      larga();
    }

    async function pepsRecalcularBotao(btn){ if(btn){ btn.disabled = true; btn.textContent = 'Recalculando…'; } await pepsRecalcular(true); await pepsCarregar(); pepsDesenhar(); }
    async function pepsPausar(){
      const r = await supa.from('custo_peps_cfg').update({ ativo: !peps.cfg.ativo }).eq('usuario_id', usuarioAtual.id);
      if(r.error){ toast('Não consegui gravar: ' + r.error.message); return; }
      peps.cfg.ativo = !peps.cfg.ativo; if(peps.cfg.ativo) await pepsRecalcular(true); pepsDesenhar();
    }

    // monta a prévia do lote inicial: galpão (controle de estoque) + Full (Mercado Livre), kits abertos em componentes
    async function pepsPreparar(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Lendo o estoque…'; }
      if(typeof estCarregar === 'function') await estCarregar(true);
      const fullOk = typeof comprasFullAPI === 'function' ? await comprasFullAPI() : false;
      const m = new Map(), pega = sku => { const k = ppN(sku); if(!m.has(k)) m.set(k, { sku: String(sku).trim(), galpao: 0, full: 0 }); return m.get(k); };
      const proprios = (typeof est !== 'undefined' ? est.depositos : []).filter(d => d.tipo === 'proprio' && d.ativo).map(d => Number(d.id));
      (typeof est !== 'undefined' ? est.saldo : []).forEach(s => { if(proprios.includes(Number(s.deposito_id)) && Number(s.fisico) > 0) pega(s.sku).galpao += Number(s.fisico); });
      (typeof estoqueFullML !== 'undefined' ? Array.from(estoqueFullML) : []).forEach(i => {
        const un = (Number(i.aptos_venda) || 0) + (Number(i.em_transito) || 0); if(!(un > 0) || !i.sku) return;
        const kit = (typeof composicaoKit !== 'undefined' ? composicaoKit : []).filter(c => ppN(c.sku_comercial) === ppN(i.sku));
        if(kit.length) kit.forEach(c => { pega(c.sku_componente).full += un * (Number(c.qty) || 1); }); else pega(i.sku).full += un;
      });
      const lista = [...m.values()].map(x => { const k = skus.find(s => ppN(s.sku) === ppN(x.sku)); return { ...x, total: x.galpao + x.full, custo: k ? Number(k.custo) || 0 : 0 }; })
        .filter(x => x.total > 0).sort((a, b) => a.sku.localeCompare(b.sku));
      peps.previa = { lista, fullOk, em: new Date().toISOString() };
      const sem = lista.filter(x => !(x.custo > 0));
      vmlModal('Custo por lote — lote inicial', `
        <div class="text-muted" style="line-height:1.55;font-size:13px;margin-bottom:10px;">Este é o estoque de agora, que vira o primeiro lote de cada produto, ao custo do cadastro. As vendas <b style="color:var(--text)">a partir deste momento</b> passam a consumir os lotes.</div>
        ${fullOk ? '' : '<div class="alert alert-warning">Não consegui ler o estoque do Full no Mercado Livre agora; a coluna Full pode estar desatualizada. Tente de novo em instantes.</div>'}
        ${sem.length ? `<div class="alert alert-warning"><b>${sem.length} produto(s) sem custo no cadastro</b>&nbsp;ficam fora dos lotes até você cadastrar o custo: ${sem.map(x => ppE(x.sku)).join(', ')}.</div>` : ''}
        ${peps.cfg ? '<div class="alert alert-warning">Já existe um lote inicial. Gravar de novo <b>substitui</b> o lote inicial e os lotes manuais, e a contagem das vendas recomeça de agora.</div>' : ''}
        <div style="max-height:48vh;overflow:auto;"><table class="cp-tab"><thead><tr><th>Produto</th><th class="num">Galpão</th><th class="num">Full</th><th class="num">Total</th><th class="num">Custo</th><th class="num">Valor</th></tr></thead><tbody>
          ${lista.map(x => `<tr><td><b>${ppE(x.sku)}</b></td><td class="num">${ppI(x.galpao)}</td><td class="num">${ppI(x.full)}</td><td class="num"><b>${ppI(x.total)}</b></td><td class="num">${x.custo > 0 ? fmt(x.custo) : '<span style="color:var(--danger)">sem custo</span>'}</td><td class="num">${fmt(x.total * x.custo)}</td></tr>`).join('') || '<tr><td colspan="6" class="text-muted" style="padding:18px;text-align:center;">Nenhum produto com estoque. Importe a lista de estoque na página Estoque.</td></tr>'}
        </tbody><tfoot><tr><td><b>Total</b></td><td class="num">${ppI(lista.reduce((s, x) => s + x.galpao, 0))}</td><td class="num">${ppI(lista.reduce((s, x) => s + x.full, 0))}</td><td class="num"><b>${ppI(lista.reduce((s, x) => s + x.total, 0))}</b></td><td></td><td class="num"><b>${fmt(lista.reduce((s, x) => s + x.total * x.custo, 0))}</b></td></tr></tfoot></table></div>`,
        `<button class="btn-out btn" onclick="${peps.cfg ? 'pepsDesenhar()' : "fecharModal('modal-vml')"}">Cancelar</button><button class="btn" ${lista.some(x => x.custo > 0) ? '' : 'disabled'} onclick="pepsGravar(this)">Gravar lote inicial e ligar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
    }

    async function pepsGravar(btn){
      const p = peps.previa; if(!p) return;
      if(peps.cfg && !confirm('Substituir o lote inicial e os lotes manuais atuais? A contagem das vendas recomeça de agora.')) return;
      if(btn){ btn.disabled = true; btn.textContent = 'Gravando…'; }
      const uid = usuarioAtual.id, agora = new Date().toISOString();
      const erro = e => { toast('Não consegui gravar: ' + e.message); if(btn){ btn.disabled = false; btn.textContent = 'Gravar lote inicial e ligar'; } };
      let r = await supa.from('custo_lotes').delete().eq('usuario_id', uid); if(r.error) return erro(r.error);
      const linhas = p.lista.filter(x => x.custo > 0).map(x => ({ usuario_id: uid, sku: x.sku, data: agora, qtd: x.total, custo_unit: x.custo, origem: 'inicial', obs: 'Galpão ' + x.galpao + ' + Full ' + x.full }));
      r = await supa.from('custo_lotes').insert(linhas); if(r.error) return erro(r.error);
      r = await supa.from('custo_peps_cfg').upsert({ usuario_id: uid, desde: agora, ativo: true }); if(r.error) return erro(r.error);
      await pepsRecalcular(false); await pepsCarregar(); pepsDesenhar();
      toast('Custo por lote ligado: ' + linhas.length + ' produtos no lote inicial.');
    }

    // lote manual (compra que não passou por ordem) ou correção do lote inicial
    function pepsEditar(id){
      const l = id ? peps.lotes.find(x => Number(x.lote_id) === Number(id) && x.origem !== 'compra') : null;
      const dLocal = t => { const d = new Date(t); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
      vmlModal(l ? 'Editar lote' : 'Lote manual', `
        <div class="text-muted" style="margin-bottom:12px;line-height:1.5;font-size:13px;">${l ? 'Corrija a quantidade ou o custo deste lote.' : 'Use para uma compra que não tem ordem de compra lançada. Compras com ordem entram sozinhas quando você lança a chegada.'}</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">SKU</label><input type="text" id="pp-sku" value="${l ? ppE(l.sku) : ''}" ${l ? 'disabled' : ''} placeholder="Ex.: J-2010-Rosa"></div>
          <div class="form-group"><label class="form-label">Data da entrada</label><input type="datetime-local" id="pp-data" value="${dLocal(l ? l.data : Date.now())}" ${l && l.origem === 'inicial' ? 'disabled' : ''}></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Quantidade</label><input type="number" min="0" step="1" id="pp-qtd" value="${l ? Number(l.qtd) : ''}"></div>
          <div class="form-group"><label class="form-label">Custo unitário (R$)</label><input type="number" min="0" step="0.01" id="pp-custo" value="${l ? Number(l.custo) : ''}"></div>
        </div>`,
        `${l ? `<button class="btn-out btn" style="color:var(--danger);margin-right:auto;" onclick="pepsExcluir(${l.lote_id})">Excluir lote</button>` : ''}<button class="btn-out btn" onclick="pepsDesenhar()">Cancelar</button><button class="btn" onclick="pepsSalvar(${l ? l.lote_id : 0}, this)">Salvar</button>`);
    }
    async function pepsSalvar(id, btn){
      const g = x => document.getElementById(x), sku = g('pp-sku').value.trim(), qtd = Number(g('pp-qtd').value), custo = Number(g('pp-custo').value), data = g('pp-data').value;
      if(!sku || !(qtd > 0) || !(custo > 0) || !data){ toast('Preencha SKU, data, quantidade e custo.'); return; }
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      const r = id ? await supa.from('custo_lotes').update({ qtd, custo_unit: custo, data: new Date(data).toISOString() }).eq('id', id).eq('usuario_id', usuarioAtual.id)
                   : await supa.from('custo_lotes').insert({ usuario_id: usuarioAtual.id, sku, data: new Date(data).toISOString(), qtd, custo_unit: custo, origem: 'manual' });
      if(r.error){ toast('Não consegui gravar: ' + r.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Salvar'; } return; }
      await pepsRecalcular(true); await pepsCarregar(); pepsDesenhar();
    }
    async function pepsExcluir(id){
      if(!confirm('Excluir este lote? As vendas que saíram dele passam para o lote seguinte.')) return;
      const r = await supa.from('custo_lotes').delete().eq('id', id).eq('usuario_id', usuarioAtual.id);
      if(r.error){ toast('Não consegui excluir: ' + r.error.message); return; }
      await pepsRecalcular(true); await pepsCarregar(); pepsDesenhar();
    }
