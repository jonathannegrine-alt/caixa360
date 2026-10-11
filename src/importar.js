// ===== IMPORTAÇÃO COM RECONHECIMENTO DO ARQUIVO =====
// 1) TRAVA: todo campo de importação confere, antes de processar, se o arquivo é do tipo que aquele lugar espera.
//    Arquivo de outro tipo (ou não reconhecido, onde o formato é conhecido) é recusado e NADA é alterado.
// 2) BOTÃO ÚNICO "Importar documento": o usuário escolhe o arquivo, o sistema diz o que é e leva para o lugar certo.
// O reconhecimento é pelo conteúdo: títulos das colunas (planilhas), chaves (JSON) ou extensão (PDF, imagem).

    const IMP_TIPOS = {
      upseller_estoque:  { nome: 'Lista de Estoque da UpSeller',            onde: 'Estoque → depósito do galpão → Contagem de estoque' },
      upseller_kits:     { nome: 'Lista de Kits da UpSeller',               onde: 'Produtos → Kits → Importar da UpSeller' },
      upseller_compras:  { nome: 'Relatório de Compras da UpSeller',        onde: 'Sugestão de compras → Importar relatório de compras' },
      contagem_modelo:   { nome: 'Planilha de contagem de estoque',         onde: 'Estoque → Contagem de estoque → Importar planilha' },
      ml_vendas:         { nome: 'Relatório de Vendas do Mercado Livre',    onde: 'Estoque (motor de reposição) → Vendas do Mercado Livre' },
      ml_full:           { nome: 'Relatório de estoque do Full',            onde: 'Estoque → Full → importar planilha' },
      mt_financeiro:     { nome: 'Resumo Financeiro do Mercado Turbo',      onde: '' },
      tiny_contas:       { nome: 'Contas a pagar do Olist (Tiny)',          onde: 'Contas a pagar → Importar do Tiny' },
      backup_json:       { nome: 'Cópia de segurança do Caixa 360 (JSON)',  onde: 'Configurações → Dados → Restaurar' },
      pdf:               { nome: 'Arquivo PDF',                             onde: '' },
      imagem:            { nome: 'Imagem',                                  onde: '' },
    };
    // o que cada campo de importação aceita. estrito = recusa também o arquivo que não foi reconhecido
    const IMP_CAMPOS = {
      'import-upseller-estoque': { tipos: ['upseller_estoque'], estrito: true },
      'import-estoque-upseller': { tipos: ['upseller_estoque'], estrito: true },
      'import-galpao-only':      { tipos: ['upseller_estoque'], estrito: true },
      'import-upseller-kits':    { tipos: ['upseller_kits'], estrito: true },
      'import-kit-upseller':     { tipos: ['upseller_kits'], estrito: true },
      'import-json':             { tipos: ['backup_json'], estrito: true },
      'import-vendas-ml-est':    { tipos: ['ml_vendas'] },
      'import-estoque-full-ml':  { tipos: ['ml_full'] },
      'input-full-xls':          { tipos: ['ml_full'] },
      'import-tiny-pagar':       { tipos: ['tiny_contas'] },
      'tiny-xls':                { tipos: ['tiny_contas'] },
      'import-pagar-csv':        { tipos: [] }, 'import-skus-csv': { tipos: [] }, 'import-csv-kit': { tipos: [] }, 'import-galpao-csv': { tipos: [] },
    };

    function impLer(file){ return new Promise((ok, erro) => { const r = new FileReader(); r.onload = e => ok(e.target.result); r.onerror = () => erro(new Error('não consegui abrir o arquivo')); r.readAsArrayBuffer(file); }); }

    // devolve { tipo, linhas, detalhe } — tipo null quando não reconhece
    async function impIdentificar(file){
      const nome = String(file.name || '').toLowerCase();
      if(/\.pdf$/.test(nome) || file.type === 'application/pdf') return { tipo: 'pdf', linhas: 0 };
      if(/^image\//.test(file.type || '') || /\.(png|jpe?g|webp|gif)$/.test(nome)) return { tipo: 'imagem', linhas: 0 };
      const buf = await impLer(file);
      if(/\.json$/.test(nome)){
        try { const j = JSON.parse(new TextDecoder().decode(buf)); if(j && typeof j === 'object' && (Array.isArray(j.pagamentos) || Array.isArray(j.liberacoes) || j.cfg)) return { tipo: 'backup_json', linhas: (j.pagamentos || []).length, detalhe: (j.pagamentos || []).length + ' contas a pagar' }; } catch(e){}
        return { tipo: null, linhas: 0 };
      }
      if(typeof XLSX === 'undefined') return { tipo: null, linhas: 0 };
      let rows = [];
      try { const wb = XLSX.read(buf, { type: 'array' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); } catch(e){ return { tipo: null, linhas: 0 }; }
      // títulos: as 12 primeiras linhas (alguns relatórios têm cabeçalho antes da tabela)
      const cab = rows.slice(0, 12).map(r => r.map(c => String(c).trim().toLowerCase()));
      const tem = (...ts) => ts.every(t => cab.some(r => r.some(c => t instanceof RegExp ? t.test(c) : c === t)));
      const linhaCab = cab.findIndex(r => r.filter(Boolean).length >= 3), linhas = Math.max(0, rows.length - 1 - Math.max(0, linhaCab));
      let tipo = null;
      if(tem('kit sku')) tipo = 'upseller_kits';
      else if(tem('sku', 'estoque atual')) tipo = 'upseller_estoque';
      else if(tem('sku', /^quantidade contada$/)) tipo = 'contagem_modelo';
      else if(tem('fornecedores', /^data de cria/)) tipo = 'upseller_compras';
      else if(tem('id da venda', /^margem contrib/)) tipo = 'mt_financeiro';
      else if(tem(/^(n\.º|#) de venda$/)) tipo = 'ml_vendas';
      else if(tem(/apt[ao]s (para|à) venda|unidades aptas/)) tipo = 'ml_full';
      else if(tem('fornecedor', 'vencimento', /^situa/)) tipo = 'tiny_contas';
      return { tipo, linhas, detalhe: linhas ? linhas.toLocaleString('pt-BR') + ' linhas' : '' };
    }

    function impRecusa(titulo, texto){
      vmlModal(titulo, `<div class="alert alert-warning" style="line-height:1.55;">${texto}</div><div class="text-muted" style="font-size:13px;margin-top:10px;"><b style="color:var(--text)">Nada foi alterado.</b> Confira o arquivo e tente de novo.</div>`,
        `<button class="btn" onclick="fecharModal('modal-vml')">Entendi</button>`);
    }

    // confere o arquivo de um campo. Devolve true quando pode seguir.
    async function impGuarda(file, tipos, estrito){
      if(!file) return false;
      let id; try { id = await impIdentificar(file); } catch(e){ id = { tipo: null }; }
      const esperado = (tipos || []).map(t => IMP_TIPOS[t].nome).join(' ou ');
      if(id.tipo && tipos && !tipos.includes(id.tipo)){
        const t = IMP_TIPOS[id.tipo];
        impRecusa('Arquivo no lugar errado', `O arquivo <b>${impE(file.name)}</b> é: <b>${t.nome}</b>.${esperado ? '<br>Aqui se importa: <b>' + esperado + '</b>.' : ''}${t.onde ? '<br>O lugar dele é: <b>' + t.onde + '</b>. Ou use o botão <b>Importar documento</b>, no menu, que leva para o lugar certo.' : ''}`);
        return false;
      }
      if(!id.tipo && estrito && tipos && tipos.length){
        impRecusa('Não reconheci este arquivo', `O arquivo <b>${impE(file.name)}</b> não tem as colunas de: <b>${esperado}</b>.<br>Baixe o relatório de novo, sem mexer nas colunas, ou use a planilha modelo quando houver.`);
        return false;
      }
      return true;
    }
    const impE = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // TRAVA nos campos que já existem na página: segura o evento, confere e só então deixa a importação seguir
    document.addEventListener('change', function(ev){
      const inp = ev.target;
      if(!inp || inp.tagName !== 'INPUT' || inp.type !== 'file') return;
      const regra = IMP_CAMPOS[inp.id]; if(!regra) return;
      if(inp._impOk){ inp._impOk = false; return; }          // segunda passagem: já conferido
      const file = inp.files && inp.files[0]; if(!file) return;
      ev.stopImmediatePropagation(); ev.stopPropagation();
      impGuarda(file, regra.tipos, regra.estrito).then(ok => {
        if(!ok){ inp.value = ''; return; }
        inp._impOk = true; inp.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }, true);

    // ---------- botão único ----------
    function impAbrir(){
      vmlModal('Importar documento', `
        <div class="text-muted" style="line-height:1.55;margin-bottom:14px;">Escolha o arquivo. O sistema reconhece o que é e leva para o lugar certo; se não reconhecer, nada é alterado.</div>
        <label class="btn" style="cursor:pointer;">Escolher arquivo<input type="file" aria-label="Documento para importar" accept=".xlsx,.xls,.csv,.json,.pdf" style="display:none" onchange="impEscolhido(this)"></label>
        <div id="imp-res" style="margin-top:16px;"></div>
        <details style="margin-top:14px;"><summary style="cursor:pointer;font-size:13px;font-weight:650;">Documentos que o sistema reconhece</summary>
          <div style="margin-top:8px;font-size:13px;line-height:1.7;">${Object.keys(IMP_TIPOS).filter(k => IMP_TIPOS[k].onde).map(k => '<b>' + IMP_TIPOS[k].nome + '</b> <span class="text-muted">— ' + IMP_TIPOS[k].onde + '</span>').join('<br>')}<br><b>Fatura do transportador do Flex (PDF)</b> <span class="text-muted">— Conferência Flex</span></div></details>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button>`);
    }
    let impArq = null;
    async function impEscolhido(inp){
      const file = inp.files && inp.files[0]; inp.value = ''; if(!file) return;
      const res = document.getElementById('imp-res'); res.innerHTML = '<div class="text-muted">Lendo o arquivo…</div>';
      let id; try { id = await impIdentificar(file); } catch(e){ id = { tipo: null }; }
      impArq = { file, id };
      const acoes = { upseller_estoque: 'Conferir e importar no estoque do galpão', upseller_kits: 'Importar os kits', upseller_compras: 'Importar os fornecedores', contagem_modelo: 'Abrir a conferência da contagem',
        ml_vendas: 'Importar as vendas', ml_full: 'Importar o estoque do Full', tiny_contas: 'Importar as contas a pagar', backup_json: 'Restaurar esta cópia', pdf: 'Conferir como fatura do Flex' };
      if(!id.tipo){ res.innerHTML = `<div class="alert alert-warning"><b>Não reconheci o arquivo ${impE(file.name)}.</b><br>Nada foi alterado. Veja abaixo os documentos aceitos; se for uma planilha sua, use a planilha modelo do lugar onde ela será importada.</div>`; return; }
      const t = IMP_TIPOS[id.tipo];
      res.innerHTML = `<div class="alert alert-info" style="line-height:1.6;"><b>${impE(file.name)}</b><br>Reconheci como: <b>${t.nome}</b>${id.detalhe ? ' (' + id.detalhe + ')' : ''}.${t.onde ? '<br>Vai para: <b>' + t.onde + '</b>.' : ''}</div>
        ${id.tipo === 'backup_json' ? '<div class="alert alert-danger">Restaurar uma cópia <b>substitui</b> as contas a pagar, os recebíveis e as categorias atuais.</div>' : ''}
        ${id.tipo === 'pdf' ? '<div class="text-muted" style="font-size:13px;margin-bottom:10px;">PDF de contrato de empréstimo ou de envio ao Full se importa na própria tela (Empréstimos / Envios ao Full).</div>' : ''}
        ${acoes[id.tipo] ? `<button class="btn" onclick="impSeguir()">${acoes[id.tipo]}</button>` : '<div class="alert alert-warning">Ainda não existe importação para este documento. Nada foi alterado.</div>'}`;
    }
    // entrega o arquivo ao importador certo
    function impNoCampo(idCampo, file){
      const inp = document.getElementById(idCampo); if(!inp) return false;
      try { const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; } catch(e){ return false; }
      inp._impOk = true; inp.dispatchEvent(new Event('change', { bubbles: true })); return true;
    }
    async function impSeguir(){
      if(!impArq) return; const { file, id } = impArq; fecharModal('modal-vml');
      const galpao = async () => { if(typeof estCarregar === 'function') await estCarregar(false); const d = typeof estDepProprio === 'function' ? estDepProprio() : null; if(d) est.dep = d.id; return d; };
      if(id.tipo === 'upseller_estoque'){ nav('estoque'); const d = await galpao(); if(d && typeof estCargaPlanilha === 'function') estCargaPlanilha(file); }
      else if(id.tipo === 'contagem_modelo'){ nav('estoque'); const d = await galpao(); if(d && typeof esoContagemPlanilha === 'function'){ esoCtDep = d.id; esoContagemPlanilha(file); } }
      else if(id.tipo === 'upseller_compras'){ nav('compras'); if(typeof comprasImportarPO === 'function') comprasImportarPO(file); }
      else if(id.tipo === 'pdf'){ nav('flex'); if(typeof fxArquivo === 'function') fxArquivo(file); }
      else if(id.tipo === 'upseller_kits'){ nav('skus'); impNoCampo('import-upseller-kits', file); }
      else if(id.tipo === 'ml_vendas'){ nav('estoque'); impNoCampo('import-vendas-ml-est', file); }
      else if(id.tipo === 'ml_full'){ nav('estoque'); impNoCampo('import-estoque-full-ml', file) || impNoCampo('input-full-xls', file); }
      else if(id.tipo === 'tiny_contas'){ nav('pagar'); impNoCampo('import-tiny-pagar', file); }
      else if(id.tipo === 'backup_json'){ nav('config'); impNoCampo('import-json', file); }
    }
