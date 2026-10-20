// ===== LISTA DE COMPRAS EM PDF =====
// Na Sugestão de compras o usuário marca os produtos e gera uma lista para mandar ao fornecedor ou a quem compra:
// SKU, nome do produto, quantidade e o último preço pago. Sem dados da empresa.
// Último preço pago = item da ordem de compra mais recente que tem o produto (Olist ou criada aqui);
// sem ordem, usa o custo cadastrado e avisa.
// O PDF é montado no navegador com jsPDF (carregado só na hora de gerar).

    let comprasSel = {};          // { chave do produto: true }
    let clItens = [];             // linhas da lista em edição
    const clE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function comprasMarcar(k, v){ if(v) comprasSel[k] = true; else delete comprasSel[k]; comprasSelBarra(); }
    function comprasMarcarTodos(v){
      document.querySelectorAll('#tbody-compras .cp-check').forEach(c => { c.checked = v; if(v) comprasSel[c.dataset.k] = true; else delete comprasSel[c.dataset.k]; });
      comprasSelBarra();
    }
    function comprasSelBarra(){
      if(typeof comprasKpisAtualizar === 'function') comprasKpisAtualizar();   // quadros do topo somam os marcados
      const el = document.getElementById('cp-sel-barra'); if(!el) return;
      const ks = Object.keys(comprasSel), linhas = (comprasCalc ? comprasCalc.linhas : []).filter(l => comprasSel[l.k]);
      if(!ks.length){ el.style.display = 'none'; return; }
      el.style.display = '';
      el.innerHTML = `<span><b>${linhas.length}</b> ${linhas.length === 1 ? 'produto marcado' : 'produtos marcados'} · ${Math.round(linhas.reduce((s, l) => s + l.sug, 0)).toLocaleString('pt-BR')} unidades sugeridas</span>
        <span style="display:flex;gap:8px;"><button class="btn-out btn-sm" onclick="comprasSel={};comprasDesenhar();">Desmarcar</button><button class="btn btn-sm" onclick="comprasListaAbrir()">Gerar lista de compras</button></span>`;
    }

    // último preço pago por SKU, a partir das ordens de compra
    function clUltimosPrecos(){
      const m = new Map();
      const ordens = (typeof oc !== 'undefined' && oc.ordens) || [];
      ordens.filter(o => Number(o.situacao) !== 2).slice().sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))).forEach(o => {
        (o.itens || []).forEach(i => { const v = Number(i.valor) || 0; if(v > 0 && i.sku) m.set(String(i.sku).trim().toLowerCase(), { valor: v, data: o.data, ordem: o.numero }); });
      });
      return m;
    }

    async function comprasListaAbrir(){
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      const precos = clUltimosPrecos();
      clItens = (comprasCalc ? comprasCalc.linhas : []).filter(l => comprasSel[l.k]).map(l => {
        const p = precos.get(String(l.it.sku).trim().toLowerCase());
        return { sku: l.it.sku, nome: l.it.nome || '', forn: l.it.forn || '', qtd: Math.max(0, Math.round(l.sug)) || 0, preco: p ? p.valor : (Number(l.custo) || 0), origem: p ? 'ordem ' + (p.ordem || '') + (p.data ? ' de ' + ptDate(String(p.data).slice(0, 10)) : '') : (l.custo ? 'custo cadastrado (sem ordem de compra)' : 'sem preço') };
      }).sort((a, b) => a.forn.localeCompare(b.forn) || a.sku.localeCompare(b.sku));
      if(!clItens.length){ toast('Marque pelo menos um produto na tabela.'); return; }
      clListaId = null; clListaNome = '';   // lista nova (vinda das marcações), ainda não salva
      comprasListaDesenhar();
    }
    // redesenha a lista sem a tabela voltar ao começo
    function clRedesenhar(){ if(typeof cpSemPular === 'function') cpSemPular(comprasListaDesenhar, document.getElementById('modal-vml'), ['.pf-tab', '.modal-body']); else comprasListaDesenhar(); }
    function comprasListaDesenhar(){
      const total = clItens.reduce((s, x) => s + x.qtd * x.preco, 0), un = clItens.reduce((s, x) => s + x.qtd, 0);
      const forns = [...new Set(clItens.map(x => x.forn).filter(Boolean))];
      vmlModal(clListaNome ? 'Lista de compras — ' + clE(clListaNome) : 'Lista de compras', `
        <div class="pf-grid" style="margin-bottom:12px;">
          <label class="pf-c"><span>Título da lista</span><input id="cl-titulo" value="${clE(window._clTitulo || 'Lista de compras')}" oninput="window._clTitulo=this.value"></label>
          <label class="pf-c"><span>Para (opcional)</span><input id="cl-para" value="${clE(window._clPara || (forns.length === 1 ? forns[0] : ''))}" placeholder="Fornecedor ou pessoa" oninput="window._clPara=this.value"></label>
          <label class="pf-c pf-larg"><span>Observação (opcional)</span><input id="cl-obs" value="${clE(window._clObs || '')}" placeholder="Prazo, condição de pagamento, recado..." oninput="window._clObs=this.value"></label>
        </div>
        <label class="pf-check" style="margin:0 0 10px;"><input type="checkbox" id="cl-preco" ${window._clSemPreco ? '' : 'checked'} onchange="window._clSemPreco=!this.checked"> Mostrar o último preço pago e o total no PDF</label>
        <div class="pf-tab" style="max-height:44vh;"><table><thead><tr><th>SKU</th><th>Produto</th><th style="text-align:right;">Quantidade</th><th style="text-align:right;">Último preço pago</th><th style="text-align:right;">Subtotal</th><th></th></tr></thead><tbody>
          ${clItens.map((x, i) => `<tr><td>${typeof fotoLinha === 'function' ? fotoLinha(x.sku, `<b>${clE(x.sku)}</b>`) : `<b>${clE(x.sku)}</b>`}</td><td style="max-width:230px;">${clE(x.nome || '—')}${x.forn ? `<div class="text-muted" style="font-size:11.5px;">${clE(x.forn)}</div>` : ''}</td>
            <td style="text-align:right;"><input type="number" min="0" value="${x.qtd}" style="width:90px;text-align:right;" onchange="clItens[${i}].qtd = Math.max(0, Math.round(Number(this.value) || 0)); clRedesenhar()"></td>
            <td style="text-align:right;" title="${clE(x.origem)}"><input class="money-input" value="${fmtMoney(x.preco)}" style="width:100px;text-align:right;" oninput="onMoneyInput(this)" onchange="clItens[${i}].preco = parseMoney(this.value); clItens[${i}].origem = 'digitado'; clRedesenhar()"><div class="text-muted" style="font-size:11px;">${clE(x.origem)}</div></td>
            <td style="text-align:right;white-space:nowrap;">${fmt(x.qtd * x.preco)}</td>
            <td><button class="ico-btn" title="Tirar da lista" onclick="clItens.splice(${i}, 1); clRedesenhar()">✕</button></td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2">${clItens.length} produtos</td><td style="text-align:right;"><b>${un.toLocaleString('pt-BR')}</b></td><td></td><td style="text-align:right;"><b>${fmt(total)}</b></td><td></td></tr></tfoot></table></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn-out btn" onclick="clSalvar(this)">${clListaId ? 'Salvar lista' : 'Salvar lista'}</button><button class="btn-out btn" onclick="comprasListaPlanilha()">Baixar planilha</button><button class="btn-out btn" title="Abre uma ordem de compra nova com estes itens" onclick="comprasListaOrdem()">Criar ordem de compra</button><button class="btn" onclick="comprasListaPdf(this)">Baixar PDF</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }

    function clScript(src){ return new Promise((ok, erro) => { if(document.querySelector('script[src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => erro(new Error('não consegui carregar ' + src)); document.head.appendChild(s); }); }

    async function comprasListaPdf(bt){
      const itens = clItens.filter(x => x.qtd > 0);
      if(!itens.length){ toast('Nenhum produto com quantidade.'); return; }
      if(bt){ bt.disabled = true; bt.textContent = 'Gerando…'; }
      try {
        await clScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await clScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        const comPreco = !window._clSemPreco;
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        const titulo = (document.getElementById('cl-titulo').value || 'Lista de compras').trim(), para = (document.getElementById('cl-para').value || '').trim(), obs = (document.getElementById('cl-obs').value || '').trim();
        const n2 = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(titulo, 40, 50);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
        let y = 68;
        doc.text('Data: ' + ptDate(getToday()) + (para ? '     Para: ' + para : ''), 40, y);
        if(obs){ y += 15; doc.text(doc.splitTextToSize('Obs.: ' + obs, 515), 40, y); y += 12 * (doc.splitTextToSize('Obs.: ' + obs, 515).length - 1); }
        const total = itens.reduce((s, x) => s + x.qtd * x.preco, 0), un = itens.reduce((s, x) => s + x.qtd, 0);
        // foto do produto na 2ª coluna (mesma rotina da folha de contagem)
        if(bt) bt.textContent = 'Buscando fotos…';
        const fotos = typeof fotosParaPdf === 'function' ? await fotosParaPdf(itens.map(x => x.sku)) : new Map();
        const fotoDe = i => itens[i] ? fotos.get(String(itens[i].sku).trim().toLowerCase()) : null;
        // para o fornecedor o SKU é só a variação (J-2010-Azul → Azul; J-2012-Branco-2 → Branco 2); sem variação fica em branco
        const varDe = sku => String(sku || '').trim().replace(/^[A-Za-z]+-[A-Za-z]?\d+(-|$)/, '').replace(/-/g, ' ').trim();
        doc.autoTable({
          rowPageBreak: 'avoid',
          startY: y + 14, margin: { left: 40, right: 40 },
          head: [comPreco ? ['#', 'Foto', 'SKU', 'Produto', 'Qtd.', 'Preço', 'Subtotal'] : ['#', 'Foto', 'SKU', 'Produto', 'Qtd.']],
          body: itens.map((x, i) => comPreco ? [i + 1, '', varDe(x.sku), x.nome || '', x.qtd.toLocaleString('pt-BR'), x.preco ? 'R$ ' + n2(x.preco) : '—', x.preco ? 'R$ ' + n2(x.qtd * x.preco) : '—'] : [i + 1, '', varDe(x.sku), x.nome || '', x.qtd.toLocaleString('pt-BR')]),
          foot: [comPreco ? ['', '', '', itens.length + ' produtos', un.toLocaleString('pt-BR'), '', 'R$ ' + n2(total)] : ['', '', '', itens.length + ' produtos', un.toLocaleString('pt-BR')]],
          styles: { fontSize: 9.5, cellPadding: 5, overflow: 'linebreak', valign: 'middle' },
          headStyles: { fillColor: [40, 44, 60], textColor: 255 }, footStyles: { fillColor: [235, 237, 243], textColor: 20, fontStyle: 'bold' },
          columnStyles: comPreco ? { 0: { cellWidth: 22 }, 1: { cellWidth: 52 }, 2: { cellWidth: 80, fontStyle: 'bold' }, 4: { halign: 'right', cellWidth: 52 }, 5: { halign: 'right', cellWidth: 64 }, 6: { halign: 'right', cellWidth: 78 } } : { 0: { cellWidth: 22 }, 1: { cellWidth: 52 }, 2: { cellWidth: 100, fontStyle: 'bold' }, 4: { halign: 'right', cellWidth: 60 } },
          didParseCell: d => { if(d.section === 'body') d.cell.styles.minCellHeight = 48; if(d.section !== 'body' && d.column.index >= 4) d.cell.styles.halign = 'right'; },
          // foto centralizada; linha partida entre páginas chega aqui sem índice válido: só desenha quando o produto existe
          didDrawCell: d => { if(d.section === 'body' && d.column.index === 1){ const fo = fotoDe(d.row.index); if(fo){ try { doc.addImage(fo, 'JPEG', d.cell.x + (d.cell.width - 40) / 2, d.cell.y + (d.cell.height - 40) / 2, 40, 40); } catch(err){} } } },
        });
        doc.save(titulo.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '_').replace(/^_|_$/g, '') + '_' + getToday() + '.pdf');
      } catch(e){ toast('Não consegui gerar o PDF: ' + (e.message || e)); }
      finally { if(bt){ bt.disabled = false; bt.textContent = 'Baixar PDF'; } }
    }
    function comprasListaPlanilha(){
      const linhas = clItens.filter(x => x.qtd > 0).map(x => ({ 'SKU': x.sku, 'Produto': x.nome, 'Fornecedor': x.forn, 'Quantidade': x.qtd, 'Último preço pago': Math.round(x.preco * 100) / 100, 'Subtotal': Math.round(x.qtd * x.preco * 100) / 100 }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Lista de compras');
      XLSX.writeFile(wb, 'lista_de_compras_' + getToday() + '.xlsx');
    }

    // leva os itens da lista para uma ordem de compra nova (página Ordens de compra)
    async function comprasListaOrdem(){
      const itens = clItens.filter(x => x.qtd > 0).map(x => ({ sku: x.sku, qtd: x.qtd, valor: x.preco }));
      if(!itens.length){ toast('Nenhum produto com quantidade.'); return; }
      const forns = [...new Set(clItens.map(x => x.forn).filter(Boolean))];
      fecharModal('modal-vml'); nav('ordens-compra');
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      if(typeof ocCriar !== 'function') return;
      ocCriar(itens);
      if(forns.length === 1){ ocNova.fornecedor = forns[0]; ocCriarDesenhar(); }
    }

    // ---------- listas salvas (tabela listas_compra) ----------
    // "Salvar lista" grava os itens e os campos do PDF; a lista aberta (clListaId) é atualizada por cima.
    // Sugestão de compras → "Listas salvas" abre, gera PDF/ordem ou exclui.
    let clListaId = null, clListaNome = '';
    async function clSalvar(bt){
      const titulo = (document.getElementById('cl-titulo') || {}).value || '', para = (document.getElementById('cl-para') || {}).value || '', obs = (document.getElementById('cl-obs') || {}).value || '';
      let nome = clListaNome;
      if(!clListaId){
        const sug = (para ? para + ' · ' : '') + ptDate(getToday());
        nome = prompt('Nome da lista:', sug); if(!nome || !nome.trim()) return; nome = nome.trim();
      }
      if(bt){ bt.disabled = true; bt.textContent = 'Salvando…'; }
      const reg = { usuario_id: usuarioAtual.id, nome, itens: clItens, titulo: titulo || null, para: para || null, obs: obs || null, atualizado_em: new Date().toISOString() };
      const r = clListaId ? await supa.from('listas_compra').update(reg).eq('id', clListaId).select().single() : await supa.from('listas_compra').insert(reg).select().single();
      if(bt){ bt.disabled = false; bt.textContent = 'Salvar lista'; }
      if(r.error){ alert('Não consegui salvar a lista: ' + r.error.message); return; }
      clListaId = r.data.id; clListaNome = nome; clRedesenhar();
      if(typeof toast === 'function') toast('Lista "' + nome + '" salva.');
    }
    async function clListasAbrir(){
      const r = await supa.from('listas_compra').select('*').eq('usuario_id', usuarioAtual.id).order('atualizado_em', { ascending: false });
      if(r.error){ alert('Não consegui ler as listas: ' + r.error.message); return; }
      const L = r.data || [];
      window._clListas = L;
      vmlModal('Listas de compra salvas', L.length ? `<div class="pf-tab" style="max-height:56vh;"><table><thead><tr><th>Lista</th><th>Para</th><th style="text-align:right;">Produtos</th><th style="text-align:right;">Unidades</th><th style="text-align:right;">Total</th><th>Salva em</th><th></th></tr></thead><tbody>
        ${L.map(x => { const it = x.itens || [], un = it.reduce((s, i) => s + (Number(i.qtd) || 0), 0), tot = it.reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);
          return `<tr><td><b>${clE(x.nome)}</b></td><td>${clE(x.para || '—')}</td><td style="text-align:right;">${it.length}</td><td style="text-align:right;">${un.toLocaleString('pt-BR')}</td><td style="text-align:right;">${fmt(tot)}</td><td>${new Date(x.atualizado_em).toLocaleDateString('pt-BR')}</td>
            <td style="text-align:right;white-space:nowrap;"><button class="btn btn-sm" onclick="clListaAbrir(${x.id})">Abrir</button> <button class="btn-out btn-sm" style="color:var(--danger);" onclick="clListaExcluir(${x.id})">Excluir</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="vazio"><b>Nenhuma lista salva</b>Marque produtos na Sugestão de compras, gere a lista e clique em "Salvar lista".</div>');
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }
    function clListaAbrir(id){
      const x = (window._clListas || []).find(z => z.id === id); if(!x) return;
      clItens = JSON.parse(JSON.stringify(x.itens || [])); clListaId = x.id; clListaNome = x.nome;
      window._clTitulo = x.titulo || ''; window._clPara = x.para || ''; window._clObs = x.obs || '';
      comprasListaDesenhar();
    }
    async function clListaExcluir(id){
      const x = (window._clListas || []).find(z => z.id === id); if(!x) return;
      if(!confirm('Excluir a lista "' + x.nome + '"?')) return;
      const r = await supa.from('listas_compra').delete().eq('id', id);
      if(r.error){ alert('Não consegui excluir: ' + r.error.message); return; }
      if(clListaId === id){ clListaId = null; clListaNome = ''; }
      clListasAbrir();
    }
