// ===== FORNECEDORES =====
// Página do grupo Compras. Cadastro por loja (fornecedores.loja = ml_user_id; vazio = loja padrão), como as contas a
// pagar: com uma loja escolhida na barra lateral, só os dela; em "Todas", todos com a etiqueta da loja.
// O fornecedor junta o que já existe espalhado: contas a pagar (pagamentos.forn) e ordens de compra (olist_ordens),
// casando pelo nome, razão social, nome fantasia ou "outros nomes" (apelidos), sem acento e sem pontuação.
// Nomes que aparecem nas contas/ordens e ainda não têm cadastro ficam numa lista à parte, para cadastrar ou juntar.
// CNPJ: consulta pública da Receita pela BrasilAPI (razão social, situação, endereço, CNAE, sócios, capital…) e a
// inscrição estadual pela publica.cnpj.ws (limite de 3 consultas por minuto; se falhar, o resto continua).
// Grupo: vários CNPJs do mesmo fornecedor (ex.: QX Flores) somam juntos com "Agrupar por grupo"; a ficha do grupo junta
// contas, ordens e produtos de todos. Fator da nota (fator_nf): custo real = valor na nota × fator, para fornecedor que
// emite a nota abaixo do valor pago (usado ao importar a compra pela nota).

    let fn = { lista: [], ordens: [], lidoEm: 0, busca: '', aba: 'cadastrados', ed: null, agrupar: true };
    const fnEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // chave para casar nomes: minúsculo, sem acento, sem pontuação e sem o tipo da empresa no fim
    const fnChave = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\b(ltda|me|epp|eireli|s ?a|mei)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const fnDig = s => String(s || '').replace(/\D/g, '');
    const fnCnpjFmt = s => { const d = fnDig(s); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (s || ''); };
    const fnLojaPad = () => typeof lojaPadraoId === 'function' ? lojaPadraoId() : '';
    const fnLojaDe = f => (f && f.loja) || fnLojaPad();
    const fnLojaVez = () => typeof lojaAtiva === 'function' ? lojaAtiva() : '';
    const fnVarias = () => typeof lojasVarias === 'function' && lojasVarias();
    const fnLojaTag = id => fnVarias() && !fnLojaVez() && typeof lojaNome === 'function' && lojaNome(id) ? ' <span class="loja-tag">' + fnEsc(lojaNome(id)) + '</span>' : '';

    async function fnLer(forcar){
      if(!forcar && fn.lidoEm && Date.now() - fn.lidoEm < 60000) return;
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const [a, b] = await Promise.all([
        supa.from('fornecedores').select('*').eq('usuario_id', usuarioAtual.id).order('nome'),
        supa.from('olist_ordens').select('id,numero,data,situacao,fornecedor,total,itens,extra').eq('usuario_id', usuarioAtual.id).order('data', { ascending: false }).limit(2000)
      ]);
      if(a.error){ fn.erro = a.error.message; return; }
      fn.erro = ''; fn.lista = a.data || []; fn.ordens = (b.data || []).filter(o => Number(o.situacao) !== 2 && !(o.extra && o.extra.excluida)); fn.lidoEm = Date.now();
    }

    // contas e ordens da loja da vez (ou de todas), já com a loja de cada uma
    function fnBase(){
      const vez = fnLojaVez();
      const contas = (typeof pagTodos === 'function' ? pagTodos() : pagamentos).filter(p => p.forn && !p.oculta)
        .map(p => ({ p, loja: typeof lojaDe === 'function' ? lojaDe(p) : fnLojaPad() })).filter(x => !vez || x.loja === vez);
      const ordens = fn.ordens.map(o => ({ o, loja: (o.extra && o.extra.loja) || fnLojaPad() })).filter(x => !vez || x.loja === vez);
      const forns = fn.lista.filter(f => !vez || fnLojaDe(f) === vez);
      return { contas, ordens, forns };
    }
    // nome escrito → fornecedor cadastrado (da mesma loja)
    function fnIndice(forns){
      const m = new Map();
      forns.forEach(f => [f.nome, f.razao_social, f.fantasia, ...(f.apelidos || [])].map(fnChave).filter(Boolean).forEach(k => { const c = fnLojaDe(f) + '|' + k; if(!m.has(c)) m.set(c, f); }));
      return (nome, loja) => m.get(loja + '|' + fnChave(nome)) || null;
    }
    function fnResumo(){
      const B = fnBase(), acha = fnIndice(B.forns), hoje = getToday(), ano = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const por = new Map(B.forns.map(f => [f.id, { f, pago12: 0, aberto: 0, vencido: 0, contas: [], ordens: [], ultima: '' }]));
      const sem = new Map();
      const semDe = (nome, loja) => { const k = loja + '|' + fnChave(nome); if(!sem.has(k)) sem.set(k, { nome, loja, pago12: 0, aberto: 0, contas: 0, ordens: 0 }); return sem.get(k); };
      B.contas.forEach(({ p, loja }) => {
        const f = acha(p.forn, loja), v = Number(p.val) || 0, pagoV = Number(p.valorPago) || v, dp = String(p.dataPaga || p.data || '');
        if(f){ const r = por.get(f.id); r.contas.push(p); if(p.pago){ if(dp >= ano) r.pago12 += pagoV; } else { r.aberto += v; if(String(p.data) < hoje) r.vencido += v; } }
        else { const s = semDe(p.forn, loja); s.contas++; if(p.pago){ if(dp >= ano) s.pago12 += pagoV; } else s.aberto += v; }
      });
      B.ordens.forEach(({ o, loja }) => {
        if(!o.fornecedor) return;
        const f = acha(o.fornecedor, loja);
        if(f){ const r = por.get(f.id); r.ordens.push(o); if(String(o.data || '') > r.ultima) r.ultima = String(o.data || ''); }
        else semDe(o.fornecedor, loja).ordens++;
      });
      return { linhas: [...por.values()], sem: [...sem.values()].sort((a, b) => (b.pago12 + b.aberto) - (a.pago12 + a.aberto)) };
    }

    async function fnRender(){
      const el = document.getElementById('view-fornecedores'); if(!el) return;
      if(!fn.lidoEm) el.innerHTML = '<div class="pg-head"><div><div class="pg-title">Fornecedores</div></div></div><div class="vazio"><b>Carregando…</b></div>';
      await fnLer();
      fnDesenhar();
    }
    function fnDesenhar(){
      const el = document.getElementById('view-fornecedores'); if(!el || !el.classList.contains('active')) return;
      const R = fnResumo(), q = fnChave(fn.busca), vez = fnLojaVez();
      const filtra = x => !q || fnChave([x.nome, x.grupo, x.razao_social, x.fantasia, x.cnpj, ...(x.apelidos || [])].join(' ')).includes(q) || fnDig(x.cnpj).includes(fnDig(fn.busca) || '#');
      const lin = R.linhas.filter(r => filtra(r.f)).sort((a, b) => (b.pago12 + b.aberto) - (a.pago12 + a.aberto) || String(a.f.nome).localeCompare(String(b.f.nome)));
      const sem = R.sem.filter(s => !q || fnChave(s.nome).includes(q));
      const tot = k => lin.reduce((s, r) => s + r[k], 0);
      const lojaTxt = vez && typeof lojaNome === 'function' ? ' da ' + fnEsc(lojaNome(vez)) : fnVarias() ? ' de todas as lojas' : '';
      el.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Fornecedores</div><div class="pg-sub">Cadastro${lojaTxt}, com o que foi comprado e pago de cada um. Digite o CNPJ para puxar os dados da Receita.</div></div>
          <div class="d-flex gap-1"><button class="btn btn-sm" onclick="fnEditar()">+ Novo fornecedor</button></div></div>
        ${fn.erro ? `<div class="alert alert-danger">${fnEsc(fn.erro)}</div>` : ''}
        <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="kpi k-neutro"><div class="kpi-label">Fornecedores cadastrados</div><div class="kpi-value">${lin.length}</div><div class="kpi-sub"><span>${R.sem.length} nome${R.sem.length === 1 ? '' : 's'} sem cadastro</span></div></div>
          <div class="kpi k-venda"><div class="kpi-label">Pago em 12 meses</div><div class="kpi-value">${fmt(tot('pago12'))}</div><div class="kpi-sub"><span>dos cadastrados</span></div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Em aberto</div><div class="kpi-value">${fmt(tot('aberto'))}</div><div class="kpi-sub"><span>contas a pagar</span></div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Vencido</div><div class="kpi-value">${fmt(tot('vencido'))}</div><div class="kpi-sub"><span>em aberto e já venceu</span></div></div>
        </div>
        <div class="card"><div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <div class="chips"><button class="chip ${fn.aba === 'cadastrados' ? 'active' : ''}" onclick="fn.aba='cadastrados';fnDesenhar()">Cadastrados<span class="n">${lin.length}</span></button><button class="chip ${fn.aba === 'sem' ? 'active' : ''}" onclick="fn.aba='sem';fnDesenhar()">Sem cadastro<span class="n">${sem.length}</span></button></div>
          <input type="search" id="fn-busca" placeholder="Buscar por nome, grupo ou CNPJ" value="${fnEsc(fn.busca)}" oninput="fnBuscar(this.value)" style="max-width:280px;">
          ${fn.aba === 'cadastrados' ? `<label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" ${fn.agrupar ? 'checked' : ''} onchange="fn.agrupar=this.checked;fnDesenhar()"> Agrupar por grupo</label>` : ''}
        </div></div>
        <div class="card"><div style="overflow-x:auto;">${fn.aba === 'sem' ? fnTabelaSem(sem) : fnTabela(lin)}</div></div>`;
    }
    let fnBuscaT = null;
    function fnBuscar(v){ fn.busca = v; clearTimeout(fnBuscaT); fnBuscaT = setTimeout(() => { fnDesenhar(); const i = document.getElementById('fn-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }

    // várias linhas (CNPJs de um grupo) viram uma só, com os totais somados
    function fnJuntarLinhas(L){
      return { f: L[0].f, membros: L, pago12: L.reduce((s, r) => s + r.pago12, 0), aberto: L.reduce((s, r) => s + r.aberto, 0), vencido: L.reduce((s, r) => s + r.vencido, 0),
        contas: L.flatMap(r => r.contas), ordens: L.flatMap(r => r.ordens), ultima: L.map(r => r.ultima).sort().pop() || '' };
    }
    function fnTabela(lin){
      const dt = d => d ? ptDate(String(d).slice(0, 10)) : '—';
      if(fn.agrupar && lin.length){
        const g = new Map(), soltos = [];
        lin.forEach(r => { const k = String(r.f.grupo || '').trim(); if(!k){ soltos.push(r); return; } const c = fnLojaDe(r.f) + '|' + k.toLowerCase(); if(!g.has(c)) g.set(c, []); g.get(c).push(r); });
        const grupos = [...g.values()].map(fnJuntarLinhas);
        lin = [...grupos, ...soltos].sort((a, b) => (b.pago12 + b.aberto) - (a.pago12 + a.aberto) || String(a.f.grupo || a.f.nome).localeCompare(String(b.f.grupo || b.f.nome)));
      }
      if(!lin.length) return '<div class="vazio"><b>Nenhum fornecedor cadastrado' + (fn.busca ? ' com essa busca' : '') + '</b>Use "+ Novo fornecedor" ou a aba "Sem cadastro", que mostra os nomes que já aparecem nas contas e nas ordens.</div>';
      return `<table class="cp-tab"><thead><tr><th>Fornecedor</th><th>CNPJ</th><th>Cidade</th><th>Condição / prazo</th><th class="num">Pago 12 meses</th><th class="num">Em aberto</th><th class="num">Ordens</th><th>Última compra</th><th></th></tr></thead><tbody>
        ${lin.map(r => { const f = r.f;
          if(r.membros){ const ref = "'g:" + encodeURIComponent(fnLojaDe(f) + '|' + f.grupo).replace(/'/g, '%27') + "'";
            return `<tr><td class="cp-prod"><a href="#" onclick="event.preventDefault();fnVer(${ref})"><b>${fnEsc(f.grupo)}</b></a>${fnLojaTag(fnLojaDe(f))} <span class="badge badge-info" style="font-size:10.5px;">grupo</span><span>${r.membros.map(m => fnEsc(m.f.nome)).join(' · ')}</span></td>
              <td>${r.membros.length} CNPJ${r.membros.length === 1 ? '' : 's'}</td><td>${fnEsc([...new Set(r.membros.map(m => [m.f.cidade, m.f.uf].filter(Boolean).join('/')).filter(Boolean))].join(', ')) || '<span class="text-muted">—</span>'}</td><td><span class="text-muted">—</span></td>
              <td class="num">${fmt(r.pago12)}</td><td class="num ${r.vencido ? 'text-danger' : ''}">${r.aberto ? fmt(r.aberto) : '<span class="text-muted">—</span>'}</td><td class="num">${r.ordens.length || '<span class="text-muted">—</span>'}</td><td>${dt(r.ultima)}</td>
              <td style="text-align:right;"><button class="btn-out btn-sm" onclick="fnVer(${ref})">Ver</button></td></tr>`; }
          return `<tr><td class="cp-prod"><a href="#" onclick="event.preventDefault();fnVer(${f.id})"><b>${fnEsc(f.nome)}</b></a>${fnLojaTag(fnLojaDe(f))}${f.grupo ? ' <span class="text-muted" style="font-size:11.5px;">(' + fnEsc(f.grupo) + ')</span>' : ''}<span>${fnEsc(f.razao_social && f.razao_social !== f.nome ? f.razao_social : (f.contato || ''))}</span></td>
          <td style="white-space:nowrap;">${fnEsc(fnCnpjFmt(f.cnpj)) || '<span class="text-muted">—</span>'}${f.situacao && !/ativa/i.test(f.situacao) ? ' <span class="badge badge-warning">' + fnEsc(f.situacao) + '</span>' : ''}</td>
          <td>${fnEsc([f.cidade, f.uf].filter(Boolean).join('/')) || '<span class="text-muted">—</span>'}</td>
          <td>${fnEsc(f.condicao || '')}${f.prazo_dias ? (f.condicao ? ' · ' : '') + f.prazo_dias + ' dias' : ''}${!f.condicao && !f.prazo_dias ? '<span class="text-muted">—</span>' : ''}</td>
          <td class="num">${fmt(r.pago12)}</td><td class="num ${r.vencido ? 'text-danger' : ''}">${r.aberto ? fmt(r.aberto) : '<span class="text-muted">—</span>'}</td>
          <td class="num">${r.ordens.length || '<span class="text-muted">—</span>'}</td><td>${dt(r.ultima)}</td>
          <td style="text-align:right;white-space:nowrap;"><button class="btn-out btn-sm" onclick="fnVer(${f.id})">Ver</button> <button class="btn-out btn-sm" onclick="fnEditar(${f.id})">Editar</button></td></tr>`; }).join('')}
      </tbody></table>`;
    }
    function fnTabelaSem(sem){
      if(!sem.length) return '<div class="vazio"><b>Todos os nomes têm cadastro</b>Os fornecedores que aparecem nas contas a pagar e nas ordens de compra já estão cadastrados.</div>';
      const R = fnResumo(), forns = R.linhas.map(r => r.f);
      fn.semLista = sem;
      return `<div class="text-muted" style="font-size:12.5px;padding:12px 16px 0;">Nomes que aparecem nas contas a pagar ou nas ordens de compra e ainda não têm cadastro. Cadastre, ou junte a um fornecedor que já existe (quando é o mesmo escrito de outro jeito).</div>
        <table class="cp-tab"><thead><tr><th>Nome como aparece</th><th class="num">Contas</th><th class="num">Ordens</th><th class="num">Pago 12 meses</th><th class="num">Em aberto</th><th></th></tr></thead><tbody>
        ${sem.map((s, i) => `<tr><td><b>${fnEsc(s.nome)}</b>${fnLojaTag(s.loja)}</td><td class="num">${s.contas || '—'}</td><td class="num">${s.ordens || '—'}</td><td class="num">${fmt(s.pago12)}</td><td class="num">${s.aberto ? fmt(s.aberto) : '—'}</td>
          <td style="text-align:right;white-space:nowrap;"><button class="btn btn-sm" onclick="fnCadastrarSem(${i})">Cadastrar</button>
            ${forns.filter(f => fnLojaDe(f) === s.loja).length ? `<select onchange="if(this.value)fnJuntar(${i}, Number(this.value))" style="width:auto;"><option value="">Juntar a…</option>${forns.filter(f => fnLojaDe(f) === s.loja).map(f => `<option value="${f.id}">${fnEsc(f.nome)}</option>`).join('')}</select>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    }
    function fnCadastrarSem(i){ const s = (fn.semLista || [])[i]; if(s) fnEditar(null, { nome: s.nome, loja: s.loja === fnLojaPad() ? '' : s.loja }); }
    async function fnJuntar(i, id){
      const s = (fn.semLista || [])[i], f = fn.lista.find(x => x.id === id); if(!s || !f) return;
      const ap = [...new Set([...(f.apelidos || []), s.nome])];
      const r = await supa.from('fornecedores').update({ apelidos: ap, atualizado_em: new Date().toISOString() }).eq('id', id);
      if(r.error){ alert('Não consegui juntar: ' + r.error.message); return; }
      if(typeof toast === 'function') toast('"' + s.nome + '" agora conta como ' + f.nome + '.');
      await fnLer(true); fnDesenhar();
    }

    // ---------- cadastro ----------
    function fnEditar(id, base){
      const f = id ? fn.lista.find(x => x.id === id) : null;
      fn.ed = f ? JSON.parse(JSON.stringify(f)) : { id: null, nome: '', apelidos: [], loja: fnLojaVez() && fnLojaVez() !== fnLojaPad() ? fnLojaVez() : '', ...(base || {}) };
      fnEdDesenhar();
    }
    function fnEdDesenhar(){
      const e = fn.ed, v = x => fnEsc(x == null ? '' : x), R = e.receita || null;
      const campo = (id, rot, val, extra) => `<label class="pf-c"><span>${rot}</span><input id="fne-${id}" value="${v(val)}" ${extra || ''}></label>`;
      const loja = typeof lojaSelect === 'function' ? lojaSelect('fne-loja', e.loja || fnLojaPad()) : '';
      vmlModal(e.id ? 'Editar fornecedor' : 'Novo fornecedor', `
        <div class="pf-grid" style="grid-template-columns:1.3fr auto 1fr;align-items:end;">
          ${campo('cnpj', 'CNPJ', fnCnpjFmt(e.cnpj), 'placeholder="00.000.000/0000-00" onkeydown="if(event.key===\'Enter\'){event.preventDefault();fnReceita(this)}"')}
          <button class="btn-out" id="fne-bt-receita" onclick="fnReceita(this)" style="margin-bottom:2px;">Buscar na Receita</button>
          ${loja ? `<label class="pf-c"><span>Loja</span>${loja}</label>` : '<span></span>'}
        </div>
        <div id="fne-receita-msg" class="text-muted" style="font-size:12px;margin:-4px 0 8px;"></div>
        <div class="pf-grid" style="grid-template-columns:1fr 1fr;">
          ${campo('nome', 'Nome (como aparece nas contas e nas ordens)', e.nome)}
          ${campo('razao_social', 'Razão social', e.razao_social)}
          ${campo('fantasia', 'Nome fantasia', e.fantasia)}
          ${campo('ie', 'Inscrição estadual', e.ie)}
          ${campo('contato', 'Pessoa de contato', e.contato)}
          ${campo('telefone', 'Telefone', e.telefone)}
          ${campo('email', 'E-mail', e.email)}
          ${campo('situacao', 'Situação na Receita', e.situacao, 'readonly')}
          ${campo('endereco', 'Endereço', e.endereco)}
          <div class="pf-grid" style="grid-template-columns:2fr 0.7fr 1fr;margin:0;">${campo('cidade', 'Cidade', e.cidade)}${campo('uf', 'UF', e.uf)}${campo('cep', 'CEP', e.cep)}</div>
          ${campo('condicao', 'Condição de pagamento', e.condicao, 'placeholder="Ex.: 30/60/90 dias"')}
          ${campo('prazo_dias', 'Prazo de entrega (dias)', e.prazo_dias, 'type="number" min="0"')}
        </div>
        <div class="pf-grid" style="grid-template-columns:1fr 1fr;">
          <label class="pf-c"><span>Grupo ${typeof dica === 'function' ? dica('Para fornecedor com vários CNPJs (ex.: QX Flores): dê o mesmo nome de grupo a todos. Na lista, com "Agrupar por grupo", eles somam juntos.', true) : ''}</span><input id="fne-grupo" list="fne-grupos" value="${v(e.grupo)}" placeholder="Ex.: QX Flores"><datalist id="fne-grupos">${[...new Set(fn.lista.map(x => x.grupo).filter(Boolean))].sort().map(x => `<option value="${v(x)}">`).join('')}</datalist></label>
          <label class="pf-c"><span>Fator da nota ${typeof dica === 'function' ? dica('Quando o fornecedor emite a nota com valor menor do que você paga. O custo real dos produtos é o valor da nota multiplicado por este número (ex.: 2,5). Em branco ou 1 = o valor da nota já é o real. Usado ao importar a compra pela nota.', true) : ''}</span><input id="fne-fator_nf" type="number" min="0" step="0.01" value="${v(e.fator_nf)}" placeholder="1"></label>
        </div>
        <label class="pf-c"><span>Outros nomes ${typeof dica === 'function' ? dica('Outros jeitos de escrever este fornecedor nas contas a pagar e nas ordens de compra, separados por vírgula. As contas e ordens com esses nomes passam a contar para este cadastro.', true) : ''}</span><input id="fne-apelidos" value="${v((e.apelidos || []).join(', '))}" placeholder="Ex.: Fornecedor X, FORNECEDOR X LTDA"></label>
        <label class="pf-c"><span>Observações</span><input id="fne-obs" value="${v(e.obs)}"></label>
        ${R ? fnReceitaHtml(R, e.receita_em) : ''}`,
        `${e.id ? `<button class="btn-out" style="margin-right:auto;color:var(--danger);" onclick="fnExcluir(${e.id})">Excluir</button>` : ''}<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="fnSalvar(this)">Salvar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '820px';
    }
    // bloco só de leitura com o que veio da Receita
    function fnReceitaHtml(R, quando){
      const d = s => s ? ptDate(String(s).slice(0, 10)) : '—';
      const socios = (R.qsa || []).map(s => fnEsc(s.nome_socio) + (s.qualificacao_socio ? ' <span class="text-muted">(' + fnEsc(s.qualificacao_socio) + ')</span>' : '')).join('<br>') || '—';
      const lin = (r, x) => `<tr><td class="text-muted" style="width:180px;">${r}</td><td>${x}</td></tr>`;
      return `<details style="margin-top:10px;" open><summary style="cursor:pointer;font-weight:600;">Dados da Receita${quando ? ' <span class="text-muted" style="font-weight:400;">consultados em ' + d(quando) + '</span>' : ''}</summary>
        <table class="cp-tab" style="margin-top:6px;"><tbody>
          ${lin('Situação', fnEsc(R.descricao_situacao_cadastral || '—') + (R.data_situacao_cadastral ? ' desde ' + d(R.data_situacao_cadastral) : ''))}
          ${lin('Abertura', d(R.data_inicio_atividade))}
          ${lin('Atividade principal', fnEsc((R.cnae_fiscal ? R.cnae_fiscal + ' · ' : '') + (R.cnae_fiscal_descricao || '—')))}
          ${lin('Natureza jurídica', fnEsc(R.natureza_juridica || '—'))}
          ${lin('Porte', fnEsc(R.porte || '—') + (R.opcao_pelo_simples ? ' · Simples Nacional' : '') + (R.opcao_pelo_mei ? ' · MEI' : ''))}
          ${lin('Capital social', R.capital_social != null ? fmt(Number(R.capital_social) || 0) : '—')}
          ${lin('Matriz ou filial', fnEsc(R.descricao_identificador_matriz_filial || '—'))}
          ${lin('Sócios', socios)}
        </tbody></table></details>`;
    }
    function fnLerForm(){
      const e = fn.ed, g = id => { const el = document.getElementById('fne-' + id); return el ? el.value.trim() : undefined; };
      ['nome', 'razao_social', 'fantasia', 'ie', 'contato', 'telefone', 'email', 'situacao', 'endereco', 'cidade', 'uf', 'cep', 'condicao', 'obs'].forEach(k => { const x = g(k); if(x !== undefined) e[k] = x; });
      const c = g('cnpj'); if(c !== undefined) e.cnpj = fnDig(c);
      const p = g('prazo_dias'); if(p !== undefined) e.prazo_dias = p === '' ? null : Math.max(0, Math.round(Number(p) || 0));
      const gr = g('grupo'); if(gr !== undefined) e.grupo = gr;
      const fa = g('fator_nf'); if(fa !== undefined) e.fator_nf = fa === '' || Number(fa) === 1 ? null : (Number(String(fa).replace(',', '.')) > 0 ? Number(String(fa).replace(',', '.')) : null);
      const ap = g('apelidos'); if(ap !== undefined) e.apelidos = [...new Set(ap.split(',').map(x => x.trim()).filter(Boolean))];
      const lj = document.getElementById('fne-loja'); if(lj) e.loja = lj.value === fnLojaPad() ? '' : lj.value;
    }
    async function fnReceita(bt){
      fnLerForm();
      const e = fn.ed, cnpj = fnDig(e.cnpj), msg = t => { const m = document.getElementById('fne-receita-msg'); if(m) m.innerHTML = t; };
      if(cnpj.length !== 14){ msg('<span class="text-danger">Digite os 14 números do CNPJ.</span>'); return; }
      const b = document.getElementById('fne-bt-receita'); if(b){ b.disabled = true; b.textContent = 'Buscando…'; }
      try {
        const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj);
        if(r.status === 404) throw new Error('CNPJ não encontrado na Receita.');
        if(!r.ok) throw new Error('a consulta da Receita não respondeu agora (erro ' + r.status + '). Tente de novo em instantes.');
        const R = await r.json(), cap = s => String(s || '').toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());
        const tel = String(R.ddd_telefone_1 || '').replace(/\D/g, '');
        Object.assign(e, {
          razao_social: R.razao_social || e.razao_social, fantasia: R.nome_fantasia || e.fantasia,
          situacao: cap(R.descricao_situacao_cadastral) || e.situacao,
          endereco: [cap([R.descricao_tipo_de_logradouro, R.logradouro].filter(Boolean).join(' ')), R.numero, cap(R.complemento), cap(R.bairro)].filter(Boolean).join(', ') || e.endereco,
          cidade: cap(R.municipio) || e.cidade, uf: R.uf || e.uf, cep: String(R.cep || '').replace(/^(\d{5})(\d{3})$/, '$1-$2') || e.cep,
          telefone: e.telefone || (tel.length >= 10 ? '(' + tel.slice(0, 2) + ') ' + tel.slice(2) : ''), email: e.email || String(R.email || '').toLowerCase(),
          receita: R, receita_em: new Date().toISOString()
        });
        if(!e.nome) e.nome = cap(R.nome_fantasia || R.razao_social);
        // inscrição estadual (outra fonte, limite de 3 por minuto): a ativa do estado do endereço
        try {
          const w = await fetch('https://publica.cnpj.ws/cnpj/' + cnpj);
          if(w.ok){ const j = await w.json(), ies = ((j.estabelecimento || {}).inscricoes_estaduais || []).filter(x => x.ativo);
            const ie = ies.find(x => x.estado && x.estado.sigla === R.uf) || ies[0]; if(ie && !e.ie) e.ie = ie.inscricao_estadual; }
        } catch(err){}
        fnEdDesenhar();
        msg('Dados preenchidos com a consulta da Receita. Confira e salve.' + (/ativa/i.test(R.descricao_situacao_cadastral || '') ? '' : ' <b class="text-danger">Atenção: a situação na Receita não é "Ativa".</b>'));
      } catch(err){ msg('<span class="text-danger">' + fnEsc(err.message || 'Não consegui consultar.') + '</span>'); if(b){ b.disabled = false; b.textContent = 'Buscar na Receita'; } }
    }
    async function fnSalvar(bt){
      fnLerForm();
      const e = fn.ed;
      if(!e.nome){ alert('Preencha o nome do fornecedor.'); return; }
      const loja = e.loja || null, cnpj = e.cnpj || null;
      if(cnpj && fn.lista.some(f => f.id !== e.id && fnDig(f.cnpj) === cnpj && (f.loja || null) === loja)){ alert('Já existe um fornecedor com este CNPJ nesta loja.'); return; }
      const reg = { usuario_id: usuarioAtual.id, loja, nome: e.nome, apelidos: e.apelidos || [], cnpj, razao_social: e.razao_social || null, fantasia: e.fantasia || null, ie: e.ie || null,
        situacao: e.situacao || null, contato: e.contato || null, telefone: e.telefone || null, email: e.email || null, endereco: e.endereco || null, cidade: e.cidade || null, uf: e.uf || null,
        cep: e.cep || null, grupo: e.grupo || null, fator_nf: e.fator_nf || null, condicao: e.condicao || null, prazo_dias: e.prazo_dias == null ? null : e.prazo_dias, obs: e.obs || null, receita: e.receita || null, receita_em: e.receita_em || null,
        atualizado_em: new Date().toISOString() };
      if(bt){ bt.disabled = true; bt.textContent = 'Salvando…'; }
      const r = e.id ? await supa.from('fornecedores').update(reg).eq('id', e.id) : await supa.from('fornecedores').insert(reg);
      if(r.error){ alert('Não consegui salvar: ' + r.error.message); if(bt){ bt.disabled = false; bt.textContent = 'Salvar'; } return; }
      fecharModal('modal-vml'); if(typeof toast === 'function') toast('Fornecedor salvo.');
      await fnLer(true); fnDesenhar(); if(typeof nfeDesenhar === 'function') nfeDesenhar();
    }
    async function fnExcluir(id){
      const f = fn.lista.find(x => x.id === id); if(!f) return;
      if(!confirm('Excluir o cadastro de "' + f.nome + '"? As contas a pagar e as ordens de compra não são apagadas; só o cadastro.')) return;
      const r = await supa.from('fornecedores').delete().eq('id', id);
      if(r.error){ alert('Não consegui excluir: ' + r.error.message); return; }
      fecharModal('modal-vml'); await fnLer(true); fnDesenhar();
    }

    // ---------- ficha: contas, ordens e produtos ----------
    function fnVer(id, aba){
      const todas = fnResumo().linhas, grp = typeof id === 'string' && id.startsWith('g:') ? decodeURIComponent(id.slice(2)) : null;
      const r = grp ? (() => { const L = todas.filter(x => x.f.grupo && fnLojaDe(x.f) + '|' + x.f.grupo === grp); return L.length ? fnJuntarLinhas(L) : null; })() : todas.find(x => x.f.id === id);
      if(!r) return;
      const ref = grp ? "'g:" + encodeURIComponent(grp).replace(/'/g, '%27') + "'" : id;
      const f = r.f, a = aba || 'contas', dt = d => d ? ptDate(String(d).slice(0, 10)) : '—', hoje = getToday();
      let corpo = '';
      if(a === 'contas'){
        const L = r.contas.slice().sort((x, y) => String(y.data).localeCompare(String(x.data)));
        corpo = L.length ? `<table class="cp-tab"><thead><tr><th>Vencimento</th><th>Descrição</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>${L.map(p => `<tr><td>${dt(p.data)}</td><td>${fnEsc(p.desc || '')}${p.parcela ? ' <span class="text-muted">' + fnEsc(p.parcela) + '</span>' : ''}</td><td class="num">${fmt(Number(p.val) || 0)}</td><td>${p.pago ? '<span class="cp-sit cp-ok">Paga' + (p.dataPaga ? ' em ' + dt(p.dataPaga) : '') + '</span>' : String(p.data) < hoje ? '<span class="cp-sit cp-urgente">Vencida</span>' : '<span class="cp-sit cp-comprar">Em aberto</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio"><b>Nenhuma conta a pagar com este fornecedor</b></div>';
      }
      if(a === 'ordens'){
        corpo = r.ordens.length ? `<table class="cp-tab"><thead><tr><th>Ordem</th><th>Data</th><th>Itens</th><th class="num">Total</th></tr></thead><tbody>${r.ordens.map(o => `<tr><td><b>${fnEsc(o.numero || '')}</b></td><td>${dt(o.data)}</td><td style="white-space:normal;">${(o.itens || []).slice(0, 4).map(i => fnEsc(i.sku) + ' × ' + (Number(i.qtd) || 0).toLocaleString('pt-BR')).join(', ')}${(o.itens || []).length > 4 ? '…' : ''}</td><td class="num">${fmt(Number(o.total) || 0)}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio"><b>Nenhuma ordem de compra com este fornecedor</b></div>';
      }
      if(a === 'produtos'){
        const m = new Map();
        r.ordens.slice().sort((x, y) => String(x.data || '').localeCompare(String(y.data || ''))).forEach(o => (o.itens || []).forEach(i => {
          if(!i.sku) return; const k = String(i.sku).toLowerCase(), x = m.get(k) || { sku: i.sku, desc: i.descricao || '', qtd: 0, preco: 0, data: '' };
          x.qtd += Number(i.qtd) || 0; if(Number(i.valor) > 0){ x.preco = Number(i.valor); x.data = o.data; } if(i.descricao) x.desc = i.descricao; m.set(k, x); }));
        const L = [...m.values()].sort((x, y) => String(y.data).localeCompare(String(x.data)));
        corpo = L.length ? `<table class="cp-tab"><thead><tr><th>Produto</th><th class="num">Comprado</th><th class="num">Último preço</th><th>Em</th></tr></thead><tbody>${L.map(x => `<tr><td class="cp-prod">${typeof fotoLinha === 'function' ? fotoLinha(x.sku, '<b>' + fnEsc(x.sku) + '</b><span>' + fnEsc(x.desc) + '</span>') : '<b>' + fnEsc(x.sku) + '</b><span>' + fnEsc(x.desc) + '</span>'}</td><td class="num">${x.qtd.toLocaleString('pt-BR')}</td><td class="num">${x.preco ? fmt(x.preco) : '—'}</td><td>${dt(x.data)}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio"><b>Nenhum produto comprado nas ordens</b></div>';
      }
      const linha = grp ? r.membros.map(m => '<a href="#" onclick="event.preventDefault();fnVer(' + m.f.id + ')">' + fnEsc(m.f.nome) + '</a>' + (m.f.cnpj ? ' <span class="text-muted">' + fnEsc(fnCnpjFmt(m.f.cnpj)) + '</span>' : '')).join(' · ')
        : [fnCnpjFmt(f.cnpj), [f.cidade, f.uf].filter(Boolean).join('/'), f.telefone, f.email, f.contato].filter(Boolean).map(fnEsc).join(' · ');
      vmlModal((grp ? 'Grupo ' + fnEsc(f.grupo) : fnEsc(f.nome)) + fnLojaTag(fnLojaDe(f)), `
        <div class="text-muted" style="margin-bottom:8px;">${linha || 'Sem dados de contato'}${!grp && f.fator_nf ? '<br>Fator da nota: <b>' + String(f.fator_nf).replace('.', ',') + '</b>' : ''}${!grp && (f.condicao || f.prazo_dias) ? '<br>Condição: <b>' + fnEsc(f.condicao || '—') + '</b>' + (f.prazo_dias ? ' · prazo de entrega <b>' + f.prazo_dias + ' dias</b>' : '') : ''}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="kpi k-venda"><div class="kpi-label">Pago em 12 meses</div><div class="kpi-value">${fmt(r.pago12)}</div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Em aberto</div><div class="kpi-value">${fmt(r.aberto)}</div></div>
          <div class="kpi k-atraso"><div class="kpi-label">Vencido</div><div class="kpi-value">${fmt(r.vencido)}</div></div>
        </div>
        <div class="chips" style="margin-bottom:10px;">${[['contas', 'Contas a pagar', r.contas.length], ['ordens', 'Ordens de compra', r.ordens.length], ['produtos', 'Produtos', null]].map(([k, t, n]) => `<button class="chip ${a === k ? 'active' : ''}" onclick="fnVer(${ref}, '${k}')">${t}${n != null ? '<span class="n">' + n + '</span>' : ''}</button>`).join('')}</div>
        <div style="overflow-x:auto;max-height:46vh;">${corpo}</div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button>${grp ? '' : `<button class="btn" onclick="fnEditar(${f.id})">Editar cadastro</button>`}`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }
