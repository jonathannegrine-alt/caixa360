// ===== CATEGORIAS =====
// Categorias de despesa organizadas em grupos. Os grupos são do próprio sistema: dá para criar, renomear e excluir
// sem depender do Olist. Quando o grupo é mexido aqui, a categoria fica marcada (grupoManual) e a importação do
// Olist não troca mais o grupo dela.
    const CAT_CORES = ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#9333ea', '#0d9488', '#be185d', '#65a30d', '#475569'];
    const catEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    function catGrupos(){ return [...new Set(categorias.map(c => c.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
    function catDepois(){ salvar(); renderCategorias(); atualizarSelectCategorias(); if(typeof dreDesenhar === 'function'){ try { dreDesenhar(); } catch(e){} } }
    function renderCategorias(){
      const tbody = document.getElementById('tbody-categorias'); if(!tbody) return;
      const DRE = { variavel: 'Custo variável (operacional)', fixo: 'Custo fixo', fora: 'Não entra' };
      const COMP = { vencimento: 'Mês do vencimento', anterior: 'Mês anterior ao vencimento', emissao: 'Mês da emissão' };
      const grupos = catGrupos(), nomes = grupos.concat(categorias.some(c => !c.grupo) ? [''] : []);
      const js = s => catEsc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
      tbody.innerHTML = nomes.map((g, gi) => {
        const cor = g ? CAT_CORES[gi % CAT_CORES.length] : '#94a3b8', lista = categorias.map((c, i) => ({ c, i })).filter(x => (x.c.grupo || '') === g).sort((x, y) => x.c.nome.localeCompare(y.c.nome));
        return `<tr class="cat-grupo" style="--cor:${cor};"><td colspan="3"><span class="cat-bola"></span><b>${catEsc(g || 'Sem grupo')}</b><small>${lista.length} categoria${lista.length === 1 ? '' : 's'}</small></td>
            <td style="text-align:right;white-space:nowrap;"><button class="btn-out btn-sm" onclick="adicionarCategoria('${js(g)}')" title="Nova categoria neste grupo">+ Categoria</button>${g ? ` <button class="btn-out btn-sm" onclick="catRenomearGrupo('${js(g)}')">Renomear</button> <button class="btn-out btn-sm" onclick="catExcluirGrupo('${js(g)}')" title="Exclui o grupo; as categorias dele não são apagadas">Excluir grupo</button>` : ''}</td></tr>` +
          lista.map(({ c, i }) => { const onde = typeof dreGrupoDe === 'function' ? dreGrupoDe(c.nome) : (c.impactaDRE ? 'fixo' : 'fora');
            return `<tr class="cat-linha" style="--cor:${cor};">
              <td style="font-size:13px;">${catEsc(c.nome)}</td>
              <td><span class="v-tag ${onde === 'fora' ? '' : 'conta'}">${DRE[onde] || onde}</span></td>
              <td class="text-muted" style="font-size:12.5px;">${COMP[c.competencia || 'vencimento'] || ''}</td>
              <td style="text-align:right;white-space:nowrap;"><select aria-label="Grupo da categoria ${catEsc(c.nome)}" title="Mover para outro grupo" style="width:auto;max-width:190px;font-size:12px;padding:4px 6px;" onchange="catMover(${i}, this.value)">${[''].concat(grupos).map(o => `<option value="${catEsc(o)}" ${o === g ? 'selected' : ''}>${catEsc(o || 'Sem grupo')}</option>`).join('')}</select>
                <button class="btn-del btn-sm" title="Apagar a categoria" onclick="removerCategoria(${i})">✕</button></td>
            </tr>`; }).join('');
      }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:22px;">Nenhuma categoria cadastrada. Crie um grupo para começar.</td></tr>';
    }
    function catJanela(titulo, corpo, acao, rotulo){
      if(typeof vmlModal !== 'function') return;
      vmlModal(titulo, corpo + '<div id="cat-msg" class="alert alert-danger" style="display:none;margin-top:12px;"></div>', `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="${acao}">${rotulo}</button>`);
      setTimeout(() => { const i = document.querySelector('#modal-vml input, #modal-vml select'); if(i) i.focus(); }, 60);
    }
    function catErro(t){ const m = document.getElementById('cat-msg'); if(m){ m.textContent = t; m.style.display = 'block'; } }
    function catCampo(id, rot, valor, ph){ return `<div class="form-group" style="margin:0 0 12px;"><label for="${id}">${rot}</label><input type="text" id="${id}" value="${catEsc(valor || '')}" placeholder="${catEsc(ph || '')}" maxlength="60" style="width:100%;"></div>`; }

    // nova categoria (opcionalmente já dentro de um grupo)
    function adicionarCategoria(grupo){
      const gs = catGrupos(), g0 = typeof grupo === 'string' ? grupo : '';
      catJanela('Nova categoria', catCampo('cat-nome', 'Nome da categoria', '', 'Ex.: Aluguel') +
        `<div class="form-group" style="margin:0;"><label for="cat-grp">Grupo</label><select id="cat-grp" style="width:100%;">${[''].concat(gs).map(o => `<option value="${catEsc(o)}" ${o === g0 ? 'selected' : ''}>${catEsc(o || 'Sem grupo')}</option>`).join('')}</select></div>`, 'catSalvarNova()', 'Criar categoria');
    }
    function catSalvarNova(){
      const nome = (document.getElementById('cat-nome').value || '').trim(), g = document.getElementById('cat-grp').value;
      if(!nome){ catErro('Dê um nome para a categoria.'); return; }
      if(categorias.find(c => c.nome.toLowerCase() === nome.toLowerCase())){ catErro('Já existe uma categoria com esse nome.'); return; }
      categorias.push({ nome, impactaDRE: true, tipoPassivo: 'divida', grupo: g || null, grupoManual: true });
      fecharModal('modal-vml'); catDepois();
    }
    // novo grupo: nasce com a primeira categoria (um grupo só existe enquanto tem categoria dentro)
    function catNovoGrupo(){
      const soltas = categorias.filter(c => !c.grupo).map(c => c.nome).sort((a, b) => a.localeCompare(b));
      catJanela('Novo grupo de categorias', catCampo('cat-gnome', 'Nome do grupo', '', 'Ex.: Despesas administrativas') + catCampo('cat-gprim', 'Primeira categoria do grupo', '', 'Ex.: Contador') +
        (soltas.length ? `<div class="text-muted" style="font-size:12.5px;line-height:1.5;">Ou deixe o campo acima vazio e escolha uma categoria que está sem grupo:<br><select id="cat-gsolta" style="width:100%;margin-top:6px;"><option value="">— nenhuma —</option>${soltas.map(n => `<option value="${catEsc(n)}">${catEsc(n)}</option>`).join('')}</select></div>` : ''), 'catSalvarGrupo()', 'Criar grupo');
    }
    function catSalvarGrupo(){
      const g = (document.getElementById('cat-gnome').value || '').trim(), prim = (document.getElementById('cat-gprim').value || '').trim(), solta = (document.getElementById('cat-gsolta') || {}).value || '';
      if(!g){ catErro('Dê um nome para o grupo.'); return; }
      if(catGrupos().some(x => x.toLowerCase() === g.toLowerCase())){ catErro('Já existe um grupo com esse nome.'); return; }
      if(!prim && !solta){ catErro('Informe a primeira categoria do grupo (ou escolha uma que está sem grupo).'); return; }
      if(prim){ if(categorias.find(c => c.nome.toLowerCase() === prim.toLowerCase())){ catErro('Já existe uma categoria chamada "' + prim + '". Escolha outro nome ou mova a existente.'); return; } categorias.push({ nome: prim, impactaDRE: true, tipoPassivo: 'divida', grupo: g, grupoManual: true }); }
      else { const c = categorias.find(x => x.nome === solta); if(c){ c.grupo = g; c.grupoManual = true; } }
      fecharModal('modal-vml'); catDepois();
    }
    function catRenomearGrupo(g){ catJanela('Renomear grupo', catCampo('cat-gnome', 'Nome do grupo', g, ''), `catSalvarRenome('${catEsc(String(g).replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')`, 'Guardar'); }
    function catSalvarRenome(antigo){
      const novo = (document.getElementById('cat-gnome').value || '').trim();
      if(!novo){ catErro('Dê um nome para o grupo.'); return; }
      if(novo !== antigo && catGrupos().some(x => x.toLowerCase() === novo.toLowerCase())){ catErro('Já existe um grupo com esse nome. Para juntar os dois, mova as categorias.'); return; }
      categorias.forEach(c => { if(c.grupo === antigo){ c.grupo = novo; c.grupoManual = true; } });
      fecharModal('modal-vml'); catDepois();
    }
    // excluir grupo: as categorias não são apagadas, só mudam de grupo
    function catExcluirGrupo(g){
      const n = categorias.filter(c => c.grupo === g).length, outros = catGrupos().filter(x => x !== g);
      catJanela('Excluir o grupo "' + catEsc(g) + '"', `<div style="font-size:13.5px;line-height:1.55;margin-bottom:12px;">O grupo tem <b>${n} categoria${n === 1 ? '' : 's'}</b>. Elas não são apagadas: escolha para onde vão.</div>
        <div class="form-group" style="margin:0;"><label for="cat-gdest">Mover as categorias para</label><select id="cat-gdest" style="width:100%;"><option value="">Sem grupo</option>${outros.map(o => `<option value="${catEsc(o)}">${catEsc(o)}</option>`).join('')}</select></div>`,
        `catSalvarExclusao('${catEsc(String(g).replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')`, 'Excluir grupo');
    }
    function catSalvarExclusao(g){
      const dest = document.getElementById('cat-gdest').value || null;
      categorias.forEach(c => { if(c.grupo === g){ c.grupo = dest; c.grupoManual = true; } });
      fecharModal('modal-vml'); catDepois();
    }
    function catMover(idx, grupo){ const c = categorias[idx]; if(!c) return; c.grupo = grupo || null; c.grupoManual = true; catDepois(); }

    function removerCategoria(idx){
      if(!confirm('Remover categoria "' + categorias[idx].nome + '"?')) return;
      categorias.splice(idx, 1);
      salvar();
      renderCategorias();
      atualizarSelectCategorias();
    }

    function atualizarSelectCategorias(){
      const opts = categorias.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
      const filtCat = document.getElementById('filtro-cat');
      if(filtCat) filtCat.innerHTML = '<option value="">Todas categorias</option>' + opts;
      const lancCat = document.getElementById('lanc-cat');
      if(lancCat) lancCat.innerHTML = opts;
    }

    // ===== IMPORT TINY XLS =====
    function parseTinyXLS(data){
      const wb = XLSX.read(data, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
      if(rows.length < 2) return {count:0, error:'Arquivo vazio'};

      const header = rows[0].map(h => String(h||'').toLowerCase());
      const colData    = header.findIndex(h => h.includes('venc'));
      const colForn    = header.findIndex(h => h.includes('forn'));
      const colHist    = header.findIndex(h => h.includes('hist') || h.includes('desc'));
      const colVal     = header.findIndex(h => h.includes('valor') && !h.includes('saldo'));
      const colPago    = header.findIndex(h => h.includes('pago'));
      const colEmissao = header.findIndex(h => h.includes('emiss'));

      if(colData < 0 || colVal < 0) return {count:0, error:'Colunas Vencimento/Valor não encontradas'};

      function parseDataBR(s){
        if(!s) return '';
        s = String(s).trim();
        if(/\d{2}\/\d{2}\/\d{4}/.test(s)){
          const[d,m,y] = s.split('/');
          return y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');
        }
        if(/\d{4}-\d{2}-\d{2}/.test(s)) return s;
        return '';
      }

      function calcCat(dl){
        if(dl.includes('imposto') || dl.includes('das ') || dl.includes('simples')) return 'Imposto';
        if(dl.includes('pro-labore') || dl.includes('pró labore') || dl.includes('pro labore')) return 'Pró-labore';
        if(dl.includes('salario') || dl.includes('salário')) return 'Salário';
        if(dl.includes('aluguel') || dl.includes('galpão') || dl.includes('galpao')) return 'Aluguel';
        if(dl.includes('juros')) return 'Capital de Giro - Juros';
        if(dl.includes('capital de giro') || dl.includes('amortiza')) return 'Capital de Giro - Amortização';
        if(dl.includes('ads') || dl.includes('marketing') || dl.includes('fatura mercado livre')) return 'ADS/Marketing';
        return 'Fornecedor';
      }

      // --- Parse todas as linhas do XLS ---
      const grupos = {};
      const novas = [];

      for(let i = 1; i < rows.length; i++){
        const row = rows[i];
        if(!row || !row[colData]) continue;

        const dataVenc = parseDataBR(String(row[colData]));
        if(!dataVenc) continue;
        let valor = parseFloat(String(row[colVal]||'0').replace(',','.'));
        if(isNaN(valor) || valor <= 0) continue;

        const histRaw  = colHist    >= 0 ? String(row[colHist]   ||'').trim() : 'Importado Tiny';
        const forn     = colForn    >= 0 ? String(row[colForn]   ||'').trim() : '';
        const emissao  = colEmissao >= 0 ? parseDataBR(String(row[colEmissao]||'').trim()) : '';
        const pagoRaw  = colPago    >= 0 && row[colPago] > 0;

        // Chave única: histórico completo (inclui "Parcela N/T") + fornecedor + data emissão
        const tinyKey = histRaw + '||' + forn + '||' + emissao;

        // Detectar parcela
        const matchParc = histRaw.match(/[Pp]arcela[\s]+\(?([\d]+)\/([\d]+)\)?/);
        let tipo = 'unico', parcela = '', grupoId = null;
        let descBase = histRaw;

        if(matchParc){
          parcela  = matchParc[1] + '/' + matchParc[2];
          tipo     = 'parcelado';
          descBase = histRaw
            .replace(/\s*-\s*[Pp]arcela\s*\([\d]+\/[\d]+\)/g, '')
            .replace(/\s*\([Pp]arcela\s+[\d]+\/[\d]+\)/g, '')
            .trim();
          const chave = descBase + '||' + forn;
          if(!grupos[chave]) grupos[chave] = 'g_tiny_' + Object.keys(grupos).length;
          grupoId = grupos[chave];
        }

        novas.push({ tinyKey, dataVenc, valor, histRaw, descBase, forn, emissao, pagoRaw, tipo, parcela, grupoId,
          cat: calcCat(descBase.toLowerCase()) });
      }

      if(novas.length === 0) return {count:0, error:'Nenhuma linha válida encontrada'};

      // --- Mapear entradas Tiny existentes por tiny_key ---
      // Migração automática: entradas sem tiny_key que coincidem com o XLS recebem a tag
      const keysXLS = new Set(novas.map(n => n.tinyKey));

      pagamentos.forEach((p, i) => {
        if(p.fonte !== 'tiny' && !p.tiny_key){
          // Tentar identificar se veio de Tiny: mesma desc base + forn + emissão
          // não é possível recuperar emissão sem o campo, então apenas marca se já tinha grupoId g_tiny_
          if(p.grupoId && String(p.grupoId).startsWith('g_tiny_')){
            // Reconstruir key provável para migração
            const candidatos = novas.filter(n =>
              n.descBase === p.desc && n.forn === p.forn && n.parcela === p.parcela
            );
            if(candidatos.length === 1){
              pagamentos[i].fonte    = 'tiny';
              pagamentos[i].tiny_key = candidatos[0].tinyKey;
            }
          }
        }
      });

      // Mapa de existentes Tiny por key → índice
      const existentes = {};
      const idxTiny = [];
      pagamentos.forEach((p, i) => {
        if(p.fonte === 'tiny' && p.tiny_key){
          existentes[p.tiny_key] = i;
          idxTiny.push(i);
        }
      });

      // --- Aplicar sync ---
      const keysEncontradas = new Set();
      let adicionados = 0, atualizados = 0;

      novas.forEach(n => {
        keysEncontradas.add(n.tinyKey);
        if(n.tinyKey in existentes){
          // Atualizar apenas vencimento e valor; preservar pago, cat e outros campos manuais
          const idx = existentes[n.tinyKey];
          pagamentos[idx].data    = n.dataVenc;
          pagamentos[idx].val     = n.valor;
          pagamentos[idx].parcela = n.parcela;
          pagamentos[idx].grupoId = n.grupoId;
          atualizados++;
        } else {
          pagamentos.push({
            desc: n.descBase || n.histRaw,
            forn: n.forn, val: n.valor, data: n.dataVenc,
            cat: n.cat, pago: n.pagoRaw, tipo: n.tipo,
            parcela: n.parcela, grupoId: n.grupoId,
            fonte: 'tiny', tiny_key: n.tinyKey
          });
          adicionados++;
        }
      });

      // Entradas Tiny que desapareceram do relatório → foram pagas
      let marcadasPagas = 0;
      idxTiny.forEach(i => {
        const p = pagamentos[i];
        if(!p.pago && p.tiny_key && !keysEncontradas.has(p.tiny_key)){
          pagamentos[i].pago = true;
          marcadasPagas++;
        }
      });

      return { count: adicionados + atualizados, added: adicionados, updated: atualizados, markedPaid: marcadasPagas };
    }

    function importarTinyXLS(){
      const file = document.getElementById('tiny-xls').files[0];
      if(!file) return;
      const statusEl = document.getElementById('tiny-status');
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const res = parseTinyXLS(new Uint8Array(e.target.result));
          if(res.error){ statusEl.textContent = '❌ ' + res.error; statusEl.style.color = 'var(--danger)'; return; }
          salvar(); renderPagar(); recalc();
          const partes = [];
          if(res.added   > 0) partes.push(res.added   + ' adicionados');
          if(res.updated > 0) partes.push(res.updated + ' atualizados');
          if(res.markedPaid > 0) partes.push(res.markedPaid + ' marcados como pagos');
          statusEl.textContent = '✅ Sync concluído: ' + (partes.length ? partes.join(' · ') : 'nada alterado');
          statusEl.style.color = 'var(--success)';
        } catch(err){
          statusEl.textContent = '❌ Erro: ' + err.message;
          statusEl.style.color = 'var(--danger)';
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function importarTinyXLSPagar(){
      const file = document.getElementById('import-tiny-pagar').files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const res = parseTinyXLS(new Uint8Array(e.target.result));
          if(res.error){ alert('Erro: ' + res.error); return; }
          salvar(); renderPagar(); recalc();
          const partes = [];
          if(res.added   > 0) partes.push(res.added   + ' adicionados');
          if(res.updated > 0) partes.push(res.updated + ' atualizados');
          if(res.markedPaid > 0) partes.push(res.markedPaid + ' marcados como pagos');
          alert('✅ Sync Tiny concluído: ' + (partes.length ? partes.join(' · ') : 'nada alterado'));
        } catch(err){
          alert('❌ Erro: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }
