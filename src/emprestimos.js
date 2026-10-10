// ===== EMPRÉSTIMOS =====
// Um cadastro por contrato. Dois modos:
//   vincular — as parcelas já vêm do sistema financeiro ligado (Olist). O contrato só as reconhece pelo trecho
//              em "vinculo" (ex.: "Sicoob FGI") e mostra pagas, a pagar e saldo devedor. Nada é lançado.
//   gerar    — para quem não usa Olist. O contrato gera as parcelas no Contas a pagar, amortização e juros
//              em linhas separadas (fonte 'emprestimo', tiny_key 'emp:<id>:<n>:a|j').
// O robô lê o PDF do contrato (Edge Function ler-contrato) e preenche o formulário para o usuário conferir.
// Banco: supabase/migrations/20261011_emprestimos.sql

    let emp = { lista: [], carregado: false, erro: '', form: null, lendo: false };
    const emN = s => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const emEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    // aceita "1.234,56", "1234,56" e "1234.56"
    const emNum = v => { let s = String(v == null ? '' : v).trim().replace(/[^\d.,-]/g, ''); if(s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isFinite(n) ? n : 0; };
    const EM_DONO = { empresa: 'Da empresa', socio: 'No nome do sócio', ligada: 'Em empresa ligada' };

    async function empCarregar(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const r = await supa.from('emprestimos').select('*').eq('usuario_id', usuarioAtual.id).order('id');
      if(r.error){ emp.erro = r.error.message; return; }
      emp.lista = r.data || []; emp.carregado = true; emp.erro = '';
    }

    // as contas do Contas a pagar que pertencem a um contrato
    function empContas(c){
      if(c.modo === 'gerar') return pagamentos.filter(p => String(p.tiny_key || '').startsWith('emp:' + c.id + ':'));
      const v = emN(c.vinculo); if(!v) return [];
      return pagamentos.filter(p => emN((p.desc || '') + ' ' + (p.forn || '')).includes(v));
    }
    function empResumo(c){
      const contas = empContas(c), ehJuros = p => /juros/i.test(p.desc || '');
      const am = contas.filter(p => !ehJuros(p)), ju = contas.filter(ehJuros), s = a => a.reduce((t, p) => t + (Number(p.val) || 0), 0);
      const abertas = am.filter(p => !p.pago).sort((a, b) => String(a.data).localeCompare(String(b.data)));
      const prox = abertas[0] || null, jurosProx = prox ? s(ju.filter(p => !p.pago && p.data === prox.data)) : 0;
      return { contas, total: am.length, pagas: am.filter(p => p.pago).length, saldo: s(abertas), jurosAbertos: s(ju.filter(p => !p.pago)),
        pago: contas.filter(p => p.pago).reduce((t, p) => t + (Number(p.valorPago != null ? p.valorPago : p.val) || 0), 0), prox, valorProx: prox ? (Number(prox.val) || 0) + jurosProx : 0,
        atrasadas: contas.filter(p => !p.pago && p.data < getToday()).length, fim: abertas.length ? abertas[abertas.length - 1].data : null };
    }

    // grupos de contas com cara de empréstimo que ainda não pertencem a nenhum contrato
    function empSugestoes(){
      const usados = new Set(); emp.lista.forEach(c => empContas(c).forEach(p => usados.add(p)));
      const g = new Map();
      pagamentos.filter(p => !usados.has(p) && !/juros/i.test(p.desc || '') && /amortiza|empr[eé]stimo|financiamento|capital de giro|pronampe|fgi/i.test((p.cat || '') + ' ' + (p.desc || '')) && p.parcela)
        .forEach(p => { const k = p.desc; const o = g.get(k) || { desc: p.desc, forn: p.forn || '', n: 0, aberto: 0, primeira: p.data, val: 0 }; o.n++; if(!p.pago) o.aberto += Number(p.val) || 0; if(p.data < o.primeira) o.primeira = p.data; o.val = Number(p.val) || o.val; g.set(k, o); });
      return [...g.values()].filter(o => o.n >= 2).sort((a, b) => b.aberto - a.aberto);
    }

    async function renderEmprestimos(){
      const el = document.getElementById('view-emprestimos'); if(!el) return;
      if(!emp.carregado){ el.innerHTML = '<div class="vazio"><b>Carregando os empréstimos…</b></div>'; await empCarregar(); }
      if(typeof olist !== 'undefined' && olist.conectado === null && typeof olistStatus === 'function') try { await olistStatus(); } catch(e){}
      empDesenhar();
    }

    function empDesenhar(){
      const el = document.getElementById('view-emprestimos'); if(!el || !el.classList.contains('active')) return;
      const res = emp.lista.map(c => ({ c, r: empResumo(c) }));
      const saldo = res.reduce((s, x) => s + x.r.saldo, 0), juros = res.reduce((s, x) => s + x.r.jurosAbertos, 0);
      const d30 = addDias(getToday(), 30), mes = res.reduce((s, x) => s + x.r.contas.filter(p => !p.pago && p.data >= getToday() && p.data <= d30).reduce((t, p) => t + (Number(p.val) || 0), 0), 0);
      const sug = empSugestoes();
      const dt = d => d ? ptDate(String(d).substring(0, 10)) : '—';
      el.innerHTML = `
        <div class="pg-head">
          <div><div class="pg-title">Empréstimos</div><div class="pg-sub">Cada contrato com o que já foi pago, o que falta e o saldo devedor.</div></div>
          <div class="d-flex gap-1" style="flex-wrap:wrap;"><button class="btn-out btn-sm" onclick="empLerPdf()">Ler contrato em PDF</button><button class="btn btn-sm" onclick="empNovo()">+ Novo contrato</button></div>
        </div>
        ${emp.erro ? `<div class="alert alert-danger">${emEsc(emp.erro)}</div>` : ''}
        <div class="kpi-grid k4i">
          <div class="kpi k-atraso"><div class="kpi-label">Saldo devedor</div><div class="kpi-value">${fmt(saldo)}</div><div class="kpi-sub">amortização que falta pagar</div></div>
          <div class="kpi k-hoje"><div class="kpi-label">Juros a pagar</div><div class="kpi-value">${fmt(juros)}</div><div class="kpi-sub">das parcelas já lançadas</div></div>
          <div class="kpi k-frete"><div class="kpi-label">Próximos 30 dias</div><div class="kpi-value">${fmt(mes)}</div><div class="kpi-sub">amortização e juros</div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Contratos</div><div class="kpi-value">${emp.lista.length}</div><div class="kpi-sub">${res.filter(x => x.r.total && x.r.pagas === x.r.total).length} quitados</div></div>
        </div>
        ${res.length ? `<div class="card"><div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Contrato</th><th>Parcelas</th><th class="num">Saldo devedor</th><th class="num">Juros a pagar</th><th class="num">Já pago</th><th>Próxima parcela</th><th>Termina em</th><th></th></tr></thead><tbody>
          ${res.map(({ c, r }) => { const pct = r.total ? Math.round(r.pagas / r.total * 100) : 0; return `<tr>
            <td class="cp-prod" style="max-width:300px;"><b>${emEsc(c.nome)}</b><span>${emEsc(c.credor || '')}${c.dono && c.dono !== 'empresa' ? ' · ' + EM_DONO[c.dono] : ''}</span><i>${c.modo === 'gerar' ? 'parcelas geradas aqui' : 'parcelas vindas do Olist'}${r.total ? '' : ' · nenhuma conta encontrada'}</i></td>
            <td><div class="cp-cob"><div class="cp-cob-n"><b>${r.pagas}</b> de ${r.total || c.parcelas} pagas</div><div class="cp-cob-t"><span class="cp-cob-v" style="width:${Math.max(3, pct)}%;"></span></div></div></td>
            <td class="num"><b>${fmt(r.saldo)}</b></td><td class="num">${fmt(r.jurosAbertos)}</td><td class="num">${fmt(r.pago)}</td>
            <td>${r.prox ? `${dt(r.prox.data)}<div class="cp-sub">${fmt(r.valorProx)}${r.atrasadas ? ' · <span class="text-danger">' + r.atrasadas + ' em atraso</span>' : ''}</div>` : '<span class="cp-sit cp-ok">Quitado</span>'}</td>
            <td>${dt(r.fim)}</td>
            <td style="text-align:right;white-space:nowrap;"><button class="btn-out btn-sm" onclick="empVer(${c.id})">Parcelas</button> <button class="btn-out btn-sm" onclick="empEditar(${c.id})">Editar</button></td></tr>`; }).join('')}
        </tbody></table></div></div>` : `<div class="card"><div class="vazio"><div class="vazio-ico"></div><b>Nenhum contrato cadastrado</b>Clique em "Ler contrato em PDF" para o robô preencher, ou use uma das sugestões abaixo.</div></div>`}
        ${sug.length ? `<div class="card"><div class="card-header"><div class="card-title">Contas que parecem empréstimo e ainda não têm contrato</div><span class="text-muted" style="font-size:12px;">Um clique cria o contrato já ligado a essas parcelas</span></div>
          <div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Descrição das parcelas</th><th>Credor</th><th class="num">Parcelas lançadas</th><th class="num">Em aberto</th><th></th></tr></thead><tbody>
          ${sug.slice(0, 25).map((o, i) => `<tr><td><b>${emEsc(o.desc)}</b></td><td class="cp-forn" style="max-width:260px;">${emEsc(o.forn || '—')}</td><td class="num">${o.n}</td><td class="num">${fmt(o.aberto)}</td><td style="text-align:right;"><button class="btn-out btn-sm" onclick="empDeSugestao(${i})">Cadastrar contrato</button></td></tr>`).join('')}
          </tbody></table></div></div>` : ''}`;
    }

    // ----- formulário -----
    function empModoPadrao(){ return typeof olist !== 'undefined' && olist.conectado ? 'vincular' : 'gerar'; }
    function empNovo(dados){
      emp.form = Object.assign({ id: null, nome: '', credor: '', numero_contrato: '', valor: '', taxa_mes: '', parcelas: '', primeira: '', sistema: 'price', dono: 'empresa', modo: empModoPadrao(), vinculo: '', obs: '' }, dados || {});
      empForm();
    }
    function empEditar(id){ const c = emp.lista.find(x => x.id === id); if(c){ emp.form = Object.assign({}, c, { primeira: c.primeira || '' }); empForm(); } }
    function empDeSugestao(i){ const o = empSugestoes()[i]; if(!o) return; empNovo({ nome: o.desc, credor: o.forn, vinculo: o.desc, modo: 'vincular', parcelas: o.n, primeira: o.primeira }); }
    function empFormLer(){
      const f = emp.form; if(!f) return;
      ['nome', 'credor', 'numero_contrato', 'valor', 'taxa_mes', 'parcelas', 'primeira', 'sistema', 'dono', 'modo', 'vinculo', 'obs'].forEach(k => { const el = document.getElementById('emp-' + k); if(el) f[k] = el.value; });
    }
    function empForm(aviso){
      const f = emp.form, opt = (v, t, sel) => `<option value="${v}" ${String(sel) === v ? 'selected' : ''}>${t}</option>`;
      const achadas = f.modo === 'vincular' && f.vinculo ? pagamentos.filter(p => emN((p.desc || '') + ' ' + (p.forn || '')).includes(emN(f.vinculo))).length : 0;
      vmlModal(f.id ? 'Editar contrato' : 'Novo contrato de empréstimo', `
        ${aviso ? `<div class="alert alert-info">${aviso}</div>` : ''}
        <div class="form-row">
          <div class="form-group"><label class="form-label">Nome do contrato</label><input type="text" id="emp-nome" value="${emEsc(f.nome)}" placeholder="Ex.: Pronampe Sicoob"></div>
          <div class="form-group"><label class="form-label">Banco ou credor</label><input type="text" id="emp-credor" value="${emEsc(f.credor || '')}"></div>
          <div class="form-group"><label class="form-label">Nº do contrato</label><input type="text" id="emp-numero_contrato" value="${emEsc(f.numero_contrato || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Valor emprestado (R$)</label><input type="text" id="emp-valor" value="${emEsc(f.valor)}" placeholder="0,00"></div>
          <div class="form-group"><label class="form-label">Juros ao mês (%)</label><input type="text" id="emp-taxa_mes" value="${emEsc(f.taxa_mes)}" placeholder="Ex.: 1,75"></div>
          <div class="form-group"><label class="form-label">Número de parcelas</label><input type="number" id="emp-parcelas" value="${emEsc(f.parcelas)}" min="1"></div>
          <div class="form-group"><label class="form-label">Primeira parcela</label><input type="date" id="emp-primeira" value="${emEsc(f.primeira || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Como as parcelas são calculadas</label><select id="emp-sistema">${opt('price', 'Parcelas iguais (Price)', f.sistema)}${opt('sac', 'Amortização igual, parcela diminui (SAC)', f.sistema)}${opt('outro', 'Outro', f.sistema)}</select></div>
          <div class="form-group"><label class="form-label">De quem é a dívida</label><select id="emp-dono">${Object.entries(EM_DONO).map(([k, t]) => opt(k, t, f.dono)).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">De onde vêm as parcelas</label>
          <select id="emp-modo" onchange="empFormLer();empForm();">${opt('vincular', 'Já estão no Contas a pagar (vêm do Olist): só reconhecer', f.modo)}${opt('gerar', 'Gerar as parcelas aqui, no Contas a pagar', f.modo)}</select></div>
        ${f.modo === 'vincular' ? `<div class="form-group"><label class="form-label">Trecho que identifica as parcelas (aparece na descrição ou no fornecedor)</label>
            <input type="text" id="emp-vinculo" value="${emEsc(f.vinculo || '')}" placeholder="Ex.: Sicoob FGI" onchange="empFormLer();empForm();">
            <div class="text-muted" style="font-size:12px;margin-top:5px;">${f.vinculo ? (achadas ? `<b>${achadas} contas</b> do Contas a pagar têm esse trecho (amortização e juros).` : '<span class="text-danger">Nenhuma conta tem esse trecho.</span> Confira como a parcela está escrita no Contas a pagar.') : 'Digite um trecho que só as parcelas deste contrato tenham. Maiúsculas e acentos não importam.'}</div></div>`
          : `<div class="alert alert-warning">Ao salvar, o sistema cria as parcelas no Contas a pagar: uma linha de amortização e uma de juros por mês. ${typeof olist !== 'undefined' && olist.conectado ? '<b>&nbsp;Atenção:</b>&nbsp;o Olist está conectado; se este empréstimo também for lançado lá, as parcelas ficam em dobro.' : ''}</div>`}
        <div class="form-group"><label class="form-label">Observação</label><input type="text" id="emp-obs" value="${emEsc(f.obs || '')}" placeholder="Carência, indexador, seguro..."></div>`,
        `${f.id ? `<button class="btn-out" style="color:var(--danger);margin-right:auto;" onclick="empExcluir(${f.id})">Excluir contrato</button>` : ''}<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="empSalvar(this)">Salvar contrato</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '900px';
    }

    // tabela de parcelas pelo contrato (Price ou SAC)
    function empTabela(c){
      const pv = emNum(c.valor), i = emNum(c.taxa_mes) / 100, n = Math.max(1, Math.round(emNum(c.parcelas)));
      if(!(pv > 0) || !c.primeira) return [];
      const linhas = []; let saldo = pv;
      const pmt = i > 0 ? pv * i / (1 - Math.pow(1 + i, -n)) : pv / n, amSac = pv / n;
      const [y, m, d] = String(c.primeira).split('-').map(Number);
      for(let k = 1; k <= n; k++){
        const juros = saldo * i, amort = c.sistema === 'sac' ? amSac : (k === n ? saldo : pmt - juros);
        const ult = new Date(y, m - 1 + k, 0).getDate(), data = dateStr(new Date(y, m - 2 + k, Math.min(d, ult)));
        linhas.push({ k, n, data, amort: Math.round(amort * 100) / 100, juros: Math.round(juros * 100) / 100 });
        saldo -= amort;
      }
      return linhas;
    }

    async function empSalvar(btn){
      empFormLer(); const f = emp.form;
      if(!String(f.nome).trim()){ alert('Dê um nome ao contrato.'); return; }
      if(f.modo === 'vincular' && !String(f.vinculo || '').trim()){ alert('Informe o trecho que identifica as parcelas no Contas a pagar.'); return; }
      const reg = { usuario_id: usuarioAtual.id, nome: String(f.nome).trim(), credor: String(f.credor || '').trim() || null, numero_contrato: String(f.numero_contrato || '').trim() || null,
        valor: emNum(f.valor), taxa_mes: emNum(f.taxa_mes), parcelas: Math.max(1, Math.round(emNum(f.parcelas)) || 1), primeira: f.primeira || null, sistema: f.sistema, dono: f.dono, modo: f.modo,
        vinculo: f.modo === 'vincular' ? String(f.vinculo).trim() : null, obs: String(f.obs || '').trim() || null };
      if(f.modo === 'gerar'){
        const tab = empTabela(reg);
        if(!tab.length){ alert('Para gerar as parcelas, informe o valor emprestado e a data da primeira parcela.'); return; }
        const tot = tab.reduce((s, l) => s + l.amort + l.juros, 0);
        if(!confirm('Serão lançadas ' + tab.length + ' parcelas no Contas a pagar, de ' + ptDate(tab[0].data) + ' a ' + ptDate(tab[tab.length - 1].data) + ', somando ' + fmt(tot) + ' (' + fmt(reg.valor) + ' de amortização e ' + fmt(tot - reg.valor) + ' de juros).\n\nParcelas deste contrato que já estavam lançadas e em aberto serão refeitas. Continuar?')) return;
      }
      if(btn){ btn.disabled = true; btn.textContent = 'Salvando…'; }
      const g = f.id ? await supa.from('emprestimos').update(reg).eq('id', f.id).select().single() : await supa.from('emprestimos').insert(reg).select().single();
      if(g.error){ alert('Não consegui salvar: ' + g.error.message); if(btn){ btn.disabled = false; btn.textContent = 'Salvar contrato'; } return; }
      if(reg.modo === 'gerar') empGerar(g.data);
      await empCarregar(); fecharModal('modal-vml'); empDesenhar();
    }

    // cria as parcelas no Contas a pagar (as já pagas ficam como estão)
    function empGerar(c){
      const pref = 'emp:' + c.id + ':', pagas = new Set(pagamentos.filter(p => String(p.tiny_key || '').startsWith(pref) && p.pago).map(p => p.tiny_key));
      pagamentos = pagamentos.filter(p => !String(p.tiny_key || '').startsWith(pref) || p.pago);
      const cat = nome => { if(!categorias.some(x => emN(x.nome) === emN(nome))) categorias.push({ nome, impactaDRE: !/amortiza/i.test(nome), tipoPassivo: /amortiza/i.test(nome) ? 'divida' : 'operacional' }); return nome; };
      empTabela(c).forEach(l => {
        const par = l.k + '/' + l.n, base = { forn: c.credor || '', data: l.data, pago: false, tipo: 'parcelado', parcela: par, grupo_id: 'g_emp_' + c.id, fonte: 'emprestimo', desconto: 0, juros: 0 };
        if(l.amort > 0 && !pagas.has(pref + l.k + ':a')) pagamentos.push({ ...base, desc: c.nome, val: l.amort, cat: cat('Amortização de empréstimo'), tiny_key: pref + l.k + ':a' });
        if(l.juros > 0 && !pagas.has(pref + l.k + ':j')) pagamentos.push({ ...base, desc: 'Juros ' + c.nome, val: l.juros, cat: cat('Juros de empréstimo'), tiny_key: pref + l.k + ':j' });
      });
      salvar(); if(typeof recalc === 'function') try { recalc(); } catch(e){}
    }

    async function empExcluir(id){
      const c = emp.lista.find(x => x.id === id); if(!c) return;
      const ger = c.modo === 'gerar' ? pagamentos.filter(p => String(p.tiny_key || '').startsWith('emp:' + id + ':') && !p.pago).length : 0;
      if(!confirm('Excluir o contrato "' + c.nome + '"?' + (ger ? ' As ' + ger + ' parcelas em aberto geradas por ele saem do Contas a pagar; as já pagas ficam.' : ' As contas do Contas a pagar não são alteradas.'))) return;
      const r = await supa.from('emprestimos').delete().eq('id', id);
      if(r.error){ alert('Não consegui excluir: ' + r.error.message); return; }
      if(ger){ pagamentos = pagamentos.filter(p => !String(p.tiny_key || '').startsWith('emp:' + id + ':') || p.pago); salvar(); }
      await empCarregar(); fecharModal('modal-vml'); empDesenhar();
    }

    function empVer(id){
      const c = emp.lista.find(x => x.id === id); if(!c) return;
      const r = empResumo(c), contas = r.contas.slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || (/juros/i.test(a.desc) ? 1 : -1));
      vmlModal(emEsc(c.nome) + ' — parcelas', `
        <div class="text-muted" style="margin-bottom:10px;">${emEsc(c.credor || '')}${c.numero_contrato ? ' · contrato ' + emEsc(c.numero_contrato) : ''}${emNum(c.valor) ? ' · ' + fmt(emNum(c.valor)) + ' emprestados' : ''}${emNum(c.taxa_mes) ? ' · ' + String(c.taxa_mes).replace('.', ',') + '% ao mês' : ''}${c.obs ? '<br>' + emEsc(c.obs) : ''}</div>
        <div style="overflow-x:auto;max-height:56vh;"><table class="cp-tab"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Parcela</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
          ${contas.length ? contas.map(p => `<tr><td>${ptDate(p.data)}</td><td>${emEsc(p.desc)}</td><td>${emEsc(p.parcela || '')}</td><td class="num"><b>${fmt(Number(p.val) || 0)}</b></td><td>${p.pago ? '<span class="badge badge-success">Pago' + (p.dataPaga ? ' em ' + ptDate(p.dataPaga) : '') + '</span>' : p.data < getToday() ? '<span class="badge badge-danger">Atrasado</span>' : '<span class="badge badge-warning">Em aberto</span>'}</td></tr>`).join('') : '<tr><td colspan="5" class="text-muted" style="padding:18px;text-align:center;">Nenhuma conta ligada a este contrato.</td></tr>'}
        </tbody></table></div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '860px';
    }

    // ----- robô: lê o PDF do contrato e preenche o formulário -----
    function empLerPdf(){
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf'; inp.id = 'emp-pdf';
      inp.onchange = () => { const f = inp.files[0]; if(!f) return;
        if(f.size > 6 * 1024 * 1024){ alert('O PDF tem mais de 6 MB. Envie um arquivo menor ou preencha à mão.'); return; }
        const rd = new FileReader(); rd.onload = () => empLerEnviar(String(rd.result).split(',')[1] || '', f.name); rd.readAsDataURL(f); };
      inp.click();
    }
    async function empLerEnviar(base64, nome){
      vmlModal('Lendo o contrato…', `<div class="vazio"><b>O robô está lendo ${emEsc(nome || 'o contrato')}</b>Leva de 10 a 40 segundos. Depois você confere os dados antes de salvar.</div>`, ' ');
      let j;
      try {
        const sd = await supa.auth.getSession(), s = sd && sd.data && sd.data.session;
        const r = await fetch(SUPA_URL + '/functions/v1/ler-contrato', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ pdf: base64 }) });
        j = await r.json();
      } catch(e){ j = { error: 'sem conexão com o servidor' }; }
      if(!j || j.error || !j.dados){ empNovo(); empForm('Não consegui ler o contrato' + (j && j.error ? ': ' + emEsc(j.error) : '') + '. Preencha à mão.'); return; }
      const d = j.dados;
      empNovo({ nome: d.nome || d.credor || '', credor: d.credor || '', numero_contrato: d.numero_contrato || '', valor: d.valor != null ? String(d.valor).replace('.', ',') : '', taxa_mes: d.taxa_mes != null ? String(Math.round(d.taxa_mes * 10000) / 10000).replace('.', ',') : '',
        parcelas: d.parcelas || '', primeira: d.primeira_parcela || '', sistema: ['price', 'sac', 'outro'].includes(d.sistema) ? d.sistema : 'price', obs: d.observacao || '' });
      empForm('O robô preencheu com o que leu no contrato. <b>&nbsp;Confira cada campo&nbsp;</b> antes de salvar' + (d.valor_parcela ? ': a parcela informada no contrato é ' + fmt(Number(d.valor_parcela) || 0) + '.' : '.'));
    }
