// ===== ORDENS DE COMPRA CRIADAS NO CAIXA 360 + PREVISÃO DE CHEGADA =====
// Complementa src/compras-ordens.js. Além das ordens que vêm do Olist, dá para criar uma ordem aqui
// (fica na mesma tabela olist_ordens, com id negativo e origem 'caixa360') e para informar a previsão de
// chegada de qualquer ordem (data_prevista_local), que vale quando o Olist não tem a data.
// Ordem criada aqui NÃO gera contas a pagar: enquanto o financeiro vier do Olist, é lá que a conta nasce.

    const ocPrev = o => o.data_prevista_local || o.data_prevista || null;
    let ocNova = null;

    async function ocSalvarPrevisao(id, valor){
      const r = await supa.from('olist_ordens').update({ data_prevista_local: valor || null }).eq('usuario_id', usuarioAtual.id).eq('id', id);
      if(r.error){ alert('Não consegui guardar a previsão: ' + r.error.message); return; }
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(o) o.data_prevista_local = valor || null;
      ocDesenhar();
    }

    function ocCriar(){
      ocNova = { fornecedor: '', data: getToday(), prev: '', itens: [{ sku: '', qtd: '', valor: '' }] };
      ocCriarDesenhar();
    }
    function ocCriarLer(){
      if(!ocNova) return;
      ocNova.fornecedor = document.getElementById('ocn-forn')?.value || ''; ocNova.data = document.getElementById('ocn-data')?.value || getToday(); ocNova.prev = document.getElementById('ocn-prev')?.value || '';
      ocNova.itens = [...document.querySelectorAll('.ocn-linha')].map(l => ({ sku: l.querySelector('.ocn-sku').value.trim(), qtd: l.querySelector('.ocn-qtd').value, valor: l.querySelector('.ocn-val').value }));
    }
    function ocCriarLinha(){ ocCriarLer(); ocNova.itens.push({ sku: '', qtd: '', valor: '' }); ocCriarDesenhar(); }
    function ocCriarTirar(n){ ocCriarLer(); ocNova.itens.splice(n, 1); if(!ocNova.itens.length) ocNova.itens.push({ sku: '', qtd: '', valor: '' }); ocCriarDesenhar(); }
    function ocCriarTotal(){ ocCriarLer(); const t = ocNova.itens.reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(String(i.valor).replace(',', '.')) || 0), 0); const el = document.getElementById('ocn-total'); if(el) el.textContent = fmt(t); }
    function ocCriarDesenhar(){
      const n = ocNova, forn = [...new Set(oc.ordens.map(o => o.fornecedor).filter(Boolean))].sort();
      const prods = [...new Set([...skus.map(s => s.sku), ...estoqueGalpao.map(e => e.sku)])].sort();
      vmlModal('Nova ordem de compra', `
        <div class="alert alert-info">A ordem criada aqui controla o que está a caminho e a conferência de chegada. Ela <b>&nbsp;não gera contas a pagar</b>: enquanto o financeiro vier do Olist, lance a conta por lá.</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Fornecedor</label><input type="text" id="ocn-forn" list="ocn-forns" value="${ocEsc(n.fornecedor)}"><datalist id="ocn-forns">${forn.map(f => `<option value="${ocEsc(f)}">`).join('')}</datalist></div>
          <div class="form-group"><label class="form-label">Data da compra</label><input type="date" id="ocn-data" value="${n.data}"></div>
          <div class="form-group"><label class="form-label">Previsão de chegada</label><input type="date" id="ocn-prev" value="${n.prev}"></div>
        </div>
        <datalist id="ocn-prods">${prods.map(p => `<option value="${ocEsc(p)}">`).join('')}</datalist>
        <table class="cp-tab"><thead><tr><th>Produto (SKU)</th><th class="num">Quantidade</th><th class="num">Preço unitário</th><th></th></tr></thead><tbody>
          ${n.itens.map((i, k) => `<tr class="ocn-linha"><td><input type="text" class="ocn-sku" list="ocn-prods" value="${ocEsc(i.sku)}" placeholder="Ex.: J-2010-Branco" style="min-width:240px;"></td>
            <td class="num"><input type="number" class="ocn-qtd" value="${ocEsc(i.qtd)}" min="0" style="width:120px;text-align:right;" oninput="ocCriarTotal()"></td>
            <td class="num"><input type="text" class="ocn-val" value="${ocEsc(i.valor)}" placeholder="0,00" style="width:120px;text-align:right;" oninput="ocCriarTotal()"></td>
            <td><button class="ico-btn" title="Tirar esta linha" onclick="ocCriarTirar(${k})">✕</button></td></tr>`).join('')}
        </tbody></table>
        <div class="d-flex" style="justify-content:space-between;align-items:center;margin-top:10px;"><button class="btn-out btn-sm" onclick="ocCriarLinha()">+ Adicionar produto</button><div>Total da ordem: <b id="ocn-total">R$ 0,00</b></div></div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="ocCriarSalvar(this)">Salvar ordem</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
      ocCriarTotal();
    }
    async function ocCriarSalvar(btn){
      ocCriarLer();
      const itens = ocNova.itens.map(i => ({ sku: i.sku, descricao: (skus.find(s => ocN(s.sku) === ocN(i.sku)) || {}).titulo || '', qtd: Number(i.qtd) || 0, valor: Number(String(i.valor).replace(',', '.')) || 0 })).filter(i => i.sku && i.qtd > 0);
      if(!ocNova.fornecedor.trim()){ alert('Informe o fornecedor.'); return; }
      if(!itens.length){ alert('Inclua pelo menos um produto com quantidade.'); return; }
      const locais = oc.ordens.filter(o => Number(o.id) < 0).length;
      const reg = { usuario_id: usuarioAtual.id, id: -Date.now(), numero: 'C' + String(locais + 1).padStart(3, '0'), data: ocNova.data, data_prevista_local: ocNova.prev || null, situacao: 0, fornecedor: ocNova.fornecedor.trim(),
        total: itens.reduce((s, i) => s + i.qtd * i.valor, 0), itens, origem: 'caixa360' };
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      const r = await supa.from('olist_ordens').insert(reg);
      if(r.error){ alert('Não consegui salvar a ordem: ' + r.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Salvar ordem'; } return; }
      oc.ordens.unshift(reg); ocNova = null;
      fecharModal('modal-vml'); ocDesenhar();
    }
    async function ocExcluirLocal(id){
      const o = oc.ordens.find(x => Number(x.id) === Number(id)); if(!o || Number(o.id) >= 0) return;
      if(oc.receb.some(r => Number(r.ordem_id) === Number(id))){ alert('Esta ordem já tem chegada lançada. Desfaça as chegadas antes de excluir.'); return; }
      if(!confirm('Excluir a ordem ' + o.numero + ' de ' + o.fornecedor + '?')) return;
      const r = await supa.from('olist_ordens').delete().eq('usuario_id', usuarioAtual.id).eq('id', id);
      if(r.error){ alert('Não consegui excluir: ' + r.error.message); return; }
      oc.ordens = oc.ordens.filter(x => Number(x.id) !== Number(id));
      fecharModal('modal-vml'); ocDesenhar();
    }
