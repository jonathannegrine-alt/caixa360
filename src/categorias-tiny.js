// ===== CATEGORIAS =====
    function renderCategorias(){
      const tbody = document.getElementById('tbody-categorias');
      tbody.innerHTML = categorias.map((c, i) => {
        const tp = c.tipoPassivo || 'divida';
        return `
        <tr>
          <td style="font-size:13px;">${c.nome}</td>
          <td style="text-align:center;">
            <input type="checkbox" ${c.impactaDRE ? 'checked' : ''} onchange="categorias[${i}].impactaDRE=this.checked;salvar()">
          </td>
          <td style="text-align:center;">
            <select onchange="categorias[${i}].tipoPassivo=this.value;salvar()" style="font-size:11px;padding:3px 5px;border:1px solid var(--gray-200);border-radius:5px;background:#fff;">
              <option value="divida" ${tp==='divida'?'selected':''}>💳 Dívida</option>
              <option value="operacional" ${tp==='operacional'?'selected':''}>🔄 Operacional</option>
            </select>
          </td>
          <td style="text-align:center;">
            <button class="btn-del btn-sm" onclick="removerCategoria(${i})">✕</button>
          </td>
        </tr>`;
      }).join('');
    }

    function adicionarCategoria(){
      const nome = prompt('Nome da nova categoria:');
      if(!nome || !nome.trim()) return;
      if(categorias.find(c => c.nome === nome.trim())){
        alert('Categoria já existe');
        return;
      }
      categorias.push({nome: nome.trim(), impactaDRE: true, tipoPassivo: 'divida'});
      salvar();
      renderCategorias();
      // Atualizar select de filtro e modal
      atualizarSelectCategorias();
    }

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
