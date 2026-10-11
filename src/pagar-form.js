// ===== CONTAS A PAGAR — FORMULÁRIO (modelo do Olist) =====
// Substitui o modal antigo de lançamento (abrirModalLanc / editarLanc / abrirModalSerie).
// Campos: loja, forma de pagamento, fornecedor, vencimento, valor, emissão, nº do documento, histórico,
// categoria, competência e ocorrência (única, parcelada "3" ou "15 30 45", ou recorrente).
// Ao abrir uma parcela, mostra o parcelamento inteiro para conferir e alterar.
// Conta que vem do Olist pode ser alterada aqui: o campo alterado fica travado (p.travas) e deixa de seguir o Olist;
// "Voltar a seguir o Olist" destrava. Excluir uma conta do Olist só a esconde (p.oculta), para não voltar na sincronização.

    const PF_FORMAS = ['Boleto', 'Pix', 'Cartão de crédito', 'Cartão de débito', 'Transferência bancária', 'Débito automático', 'Dinheiro', 'Depósito', 'Cheque', 'Outros'];
    const PF_OCORR = [['unica', 'Única'], ['parcelada', 'Parcelada'], ['semanal', 'Semanal'], ['quinzenal', 'Quinzenal'], ['mensal', 'Mensal'], ['trimestral', 'Trimestral'], ['semestral', 'Semestral'], ['anual', 'Anual']];
    let pf = { idx: null, parcelas: [], serie: [] };
    const PF_ROT = { desc: 'histórico', forn: 'fornecedor', val: 'valor', data: 'vencimento', cat: 'categoria', competencia: 'competência', pago: 'situação (pago/em aberto)' };

    const pfE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pfGrupo = p => (p && (p.grupo_id || p.grupoId)) || null;
    const pfV = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const pfR2 = n => Math.round(n * 100) / 100;
    function pfSomaMeses(data, n){
      const d = parseDate(data), dia = d.getDate(), r = new Date(d.getFullYear(), d.getMonth() + n, 1);
      r.setDate(Math.min(dia, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
      return dateStr(r);
    }

    function pfCampos(p, travado){
      const dis = travado ? 'disabled' : '';
      const forns = [...new Set((typeof pagTodos === 'function' ? pagTodos() : pagamentos).map(x => x.forn).filter(Boolean))].sort().slice(0, 400);
      const cats = categorias.map(c => c.nome);
      if(p.cat && !cats.includes(p.cat)) cats.push(p.cat);
      const loja = typeof lojaSelect === 'function' ? lojaSelect('pf-loja', p.loja || (typeof lojaDe === 'function' && pf.idx !== null ? lojaDe(p) : '')) : '';
      return `
        ${p.fonte === 'olist' ? `<div class="pf-aviso">Esta conta vem do <b>Olist</b>. Você pode alterar o que quiser aqui: <b>o campo que você mudar passa a valer daqui</b> e não é mais sobrescrito pelo Olist; o resto continua chegando de lá.${Array.isArray(p.travas) && p.travas.length ? `<br>Alterado aqui: <b>${p.travas.map(k => PF_ROT[k] || k).join(', ')}</b>. <a class="fx-link" style="color:var(--primary);cursor:pointer;" onclick="pfVoltarOlist()">Voltar a seguir o Olist</a>` : ''}</div>` : ''}
        <div class="pf-grid">
          ${loja ? `<label class="pf-c"><span>Loja</span>${loja}</label>` : ''}
          <label class="pf-c"><span>Forma de pagamento</span>
            <select id="pf-forma" ${dis}><option value="">Selecione</option>${PF_FORMAS.map(f => `<option ${p.formaPgto === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
          <label class="pf-c pf-larg"><span>Fornecedor</span>
            <input id="pf-forn" list="pf-forn-lista" value="${pfE(p.forn || '')}" placeholder="Nome do fornecedor" ${dis}>
            <datalist id="pf-forn-lista">${forns.map(f => `<option value="${pfE(f)}">`).join('')}</datalist></label>
          <label class="pf-c"><span>Vencimento</span><input type="date" id="pf-venc" value="${p.data || ''}" onchange="pfMontarParcelas()" ${dis}></label>
          <label class="pf-c"><span id="pf-val-rot">Valor</span><input id="pf-val" class="money-input" inputmode="decimal" placeholder="0,00" value="${p.val ? fmtMoney(Number(p.val)) : ''}" oninput="onMoneyInput(this);pfMontarParcelas()" ${dis}></label>
          <label class="pf-c"><span>Data de emissão</span><input type="date" id="pf-emis" value="${p.emissao || (pf.idx === null ? getToday() : '')}" onchange="pfMontarParcelas()" ${dis}></label>
          <label class="pf-c"><span>Nº do documento</span><input id="pf-doc" value="${pfE(p.doc || '')}" ${dis}></label>
          <label class="pf-c pf-larg"><span>Histórico</span><input id="pf-desc" value="${pfE(p.desc || '')}" placeholder="O que é esta conta" ${dis}></label>
          <label class="pf-c"><span>Categoria</span>
            <select id="pf-cat" onchange="document.getElementById('pf-cat-nova').style.display = this.value === '__nova' ? '' : 'none'" ${dis}>
              <option value="">Sem categoria</option>${cats.map(c => `<option ${p.cat === c ? 'selected' : ''}>${pfE(c)}</option>`).join('')}<option value="__nova">+ Nova categoria…</option></select>
            <input id="pf-cat-nova" placeholder="Nome da nova categoria" style="display:none;margin-top:6px;"></label>
          <label class="pf-c"><span>Competência</span><input type="month" id="pf-comp" value="${pfE((p.competencia || '').slice(0, 7))}" ${dis}></label>
        </div>`;
    }

    // ----- nova conta -----
    function abrirModalLanc(){
      pf = { idx: null, parcelas: [], serie: [] };
      vmlModal('Nova conta a pagar', pfCampos({}, false) + `
        <div class="pf-grid" style="margin-top:14px;">
          <label class="pf-c"><span>Ocorrência</span>
            <select id="pf-ocorr" onchange="pfMontarParcelas()">${PF_OCORR.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select></label>
          <label class="pf-c" id="pf-qtd-box" style="display:none;"><span id="pf-qtd-rot">Parcelas</span>
            <div style="display:flex;gap:8px;"><input id="pf-qtd" placeholder="3  ou  15 30 45" onkeydown="if(event.key==='Enter'){event.preventDefault();pfMontarParcelas(true);}"><button type="button" class="btn btn-sm" style="white-space:nowrap;" onclick="pfMontarParcelas(true)">Gerar parcelas</button></div></label>
        </div>
        <div id="pf-ajuda" class="text-muted" style="font-size:12px;margin-top:6px;"></div>
        <div id="pf-parc"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="pfSalvarNova()">Salvar</button>`);
      const m = document.querySelector('#modal-vml .modal-content'); if(m) m.style.maxWidth = '760px';
    }

    // gerar = true: clique em "Gerar parcelas" (avisa o que falta). Sem isso só atualiza rótulos e mantém a tabela já editada.
    function pfMontarParcelas(gerar){
      const oc = pfV('pf-ocorr'), box = document.getElementById('pf-qtd-box'), host = document.getElementById('pf-parc'), ajuda = document.getElementById('pf-ajuda');
      if(!host) return;
      const total = parseMoney(pfV('pf-val')), venc = pfV('pf-venc'), emis = pfV('pf-emis') || getToday();
      document.getElementById('pf-val-rot').textContent = oc === 'parcelada' ? 'Valor total' : oc === 'unica' ? 'Valor' : 'Valor de cada conta';
      if(oc === 'unica'){ box.style.display = 'none'; host.innerHTML = ''; ajuda.textContent = ''; pf.parcelas = []; return; }
      box.style.display = '';
      if(!gerar){ if(oc !== pf.ocGerada){ pf.parcelas = []; host.innerHTML = ''; }
        document.getElementById('pf-qtd-rot').textContent = oc === 'parcelada' ? 'Parcelas' : 'Quantas vezes';
        document.getElementById('pf-qtd').placeholder = oc === 'parcelada' ? '3  ou  15 30 45' : '12';
        ajuda.textContent = oc === 'parcelada' ? 'Digite a quantidade de parcelas (ex.: 3, uma por mês a partir do vencimento) ou os prazos em dias a contar da emissão (ex.: 15 30 45) e clique em Gerar parcelas. Depois altere o que quiser em cada uma.' : 'Informe quantas vezes a conta se repete e clique em Gerar parcelas.';
        return; }
      if(!total || !venc){ toast('Preencha o valor e o vencimento antes de gerar as parcelas.'); return; }
      pf.ocGerada = oc;
      const qEl = document.getElementById('pf-qtd');
      let datas = [];
      if(oc === 'parcelada'){
        document.getElementById('pf-qtd-rot').textContent = 'Parcelas';
        qEl.placeholder = '3  ou  15 30 45';
        const nums = String(qEl.value || '').split(/[^\d]+/).filter(Boolean).map(Number);
        if(nums.length === 1 && nums[0] >= 1 && nums[0] <= 120){ if(venc) for(let i = 0; i < nums[0]; i++) datas.push(pfSomaMeses(venc, i)); }
        else if(nums.length > 1) datas = nums.slice(0, 120).map(d => addDias(emis, d));
      } else {
        document.getElementById('pf-qtd-rot').textContent = 'Quantas vezes';
        qEl.placeholder = '12';
        const n = Math.min(120, Math.max(1, parseInt(qEl.value) || 12));
        if(venc) for(let i = 0; i < n; i++){
          datas.push(oc === 'semanal' ? addDias(venc, 7 * i) : oc === 'quinzenal' ? addDias(venc, 15 * i) : pfSomaMeses(venc, i * ({ mensal: 1, trimestral: 3, semestral: 6, anual: 12 })[oc]));
        }
      }
      if(!datas.length || !total){ host.innerHTML = ''; pf.parcelas = []; toast(oc === 'parcelada' ? 'Informe a quantidade (ex.: 3) ou os prazos (ex.: 15 30 45).' : 'Informe quantas vezes.'); return; }
      const n = datas.length;
      let vals;
      if(oc === 'parcelada'){ const base = Math.floor(total / n * 100) / 100; vals = datas.map(() => base); vals[n - 1] = pfR2(total - base * (n - 1)); }
      else vals = datas.map(() => total);
      pf.parcelas = datas.map((d, i) => ({ data: d, val: vals[i], doc: '', desc: '' }));
      pfDesenharParcelas();
    }
    function pfDesenharParcelas(){
      const host = document.getElementById('pf-parc'); if(!host) return;
      const soma = pf.parcelas.reduce((s, x) => s + (Number(x.val) || 0), 0), total = parseMoney(pfV('pf-val')), parc = pfV('pf-ocorr') === 'parcelada';
      const dif = parc ? pfR2(soma - total) : 0;
      host.innerHTML = `<div class="pf-tab"><table><thead><tr><th>#</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Nº do documento</th><th>Observação</th><th></th></tr></thead><tbody>
        ${pf.parcelas.map((x, i) => `<tr><td>${i + 1}/${pf.parcelas.length}</td>
          <td><input type="date" value="${x.data}" onchange="pf.parcelas[${i}].data = this.value"></td>
          <td style="text-align:right;"><input class="money-input" style="text-align:right;max-width:120px;" value="${fmtMoney(Number(x.val) || 0)}" oninput="onMoneyInput(this)" onchange="pf.parcelas[${i}].val = parseMoney(this.value); pfDesenharParcelas()"></td>
          <td><input style="max-width:130px;" value="${pfE(x.doc || '')}" onchange="pf.parcelas[${i}].doc = this.value"></td>
          <td><input style="min-width:120px;" value="${pfE(x.desc || '')}" placeholder="opcional" onchange="pf.parcelas[${i}].desc = this.value"></td>
          <td><button type="button" class="ico-btn" title="Tirar esta parcela" onclick="pf.parcelas.splice(${i}, 1); pfDesenharParcelas()">✕</button></td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2">${pf.parcelas.length} ${parc ? 'parcelas' : 'contas'} · <a class="fx-link" style="color:var(--primary);cursor:pointer;" onclick="pfParcelaNova()">+ incluir uma</a></td><td style="text-align:right;"><b>${fmt(soma)}</b></td><td colspan="3">${dif ? `<span class="text-danger">${dif > 0 ? 'sobra' : 'falta'} ${fmt(Math.abs(dif))} em relação ao valor total</span>` : ''}</td></tr></tfoot></table></div>`;
    }
    function pfParcelaNova(){
      const u = pf.parcelas[pf.parcelas.length - 1];
      pf.parcelas.push({ data: u ? pfSomaMeses(u.data, 1) : (pfV('pf-venc') || getToday()), val: u ? u.val : 0, doc: '', desc: '' });
      pfDesenharParcelas();
    }

    function pfLer(){
      let cat = pfV('pf-cat');
      if(cat === '__nova'){
        cat = pfV('pf-cat-nova').trim();
        if(cat && !categorias.some(c => String(c.nome).toLowerCase() === cat.toLowerCase())) categorias.push({ nome: cat, impactaDRE: true, tipoPassivo: 'operacional' });
      }
      return {
        desc: pfV('pf-desc').trim(), forn: pfV('pf-forn').trim(), val: parseMoney(pfV('pf-val')), data: pfV('pf-venc'),
        cat, formaPgto: pfV('pf-forma') || null, doc: pfV('pf-doc').trim() || null, emissao: pfV('pf-emis') || null,
        competencia: pfV('pf-comp') || null, loja: pfV('pf-loja') || null
      };
    }
    function pfDepois(){
      salvar();
      if(typeof lojasAbsorver === 'function'){ lojasAbsorver(); lojasRecortar(); }
      fecharModal('modal-vml');
      if(typeof setPagarView === 'function' && typeof pagarViewMode !== 'undefined' && document.getElementById('view-pagar').classList.contains('active')) setPagarView(pagarViewMode);
      else if(typeof renderPagar === 'function') renderPagar();
      recalc();
    }

    function pfSalvarNova(){
      const b = pfLer(), oc = pfV('pf-ocorr');
      if(!b.desc && b.forn) b.desc = b.forn;
      if(!b.desc || !b.val || !b.data){ toast('Preencha o histórico (ou o fornecedor), o valor e o vencimento.'); return; }
      const base = { desc: b.desc, forn: b.forn, cat: b.cat, formaPgto: b.formaPgto, doc: b.doc, emissao: b.emissao, competencia: b.competencia, pago: false };
      if(b.loja) base.loja = b.loja;
      if(oc === 'unica') pagamentos.push({ ...base, val: b.val, data: b.data, tipo: 'unico' });
      else {
        if(!pf.parcelas.length){ toast('Clique em "Gerar parcelas" antes de salvar.'); return; }
        const parc = oc === 'parcelada', grupo = (parc ? 'g_' : 'r_') + Date.now();
        pf.parcelas.forEach((x, i) => {
          const l = { ...base, val: Number(x.val) || 0, data: x.data, tipo: parc ? 'parcelado' : 'recorrente', grupo_id: grupo };
          if(x.doc) l.doc = x.doc; if(x.desc) l.desc = base.desc + ' — ' + x.desc;
          if(parc) l.parcela = (i + 1) + '/' + pf.parcelas.length;
          else if(b.competencia) l.competencia = pfSomaMesesComp(b.competencia, b.data, x.data);
          pagamentos.push(l);
        });
      }
      pfDepois();
    }
    // competência das recorrentes anda junto com o vencimento
    function pfSomaMesesComp(comp, venc0, venc){
      const a = parseDate(venc0), b = parseDate(venc), meses = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
      const [y, m] = comp.split('-').map(Number), d = new Date(y, m - 1 + meses, 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    // ----- editar -----
    function editarLanc(idx){
      const p = pagamentos[idx]; if(!p) return;
      editandoIdx = idx;
      const travado = false, doOlist = p.fonte === 'olist';
      const g = pfGrupo(p);
      const serie = g ? pagamentos.filter(x => pfGrupo(x) === g).sort((a, b) => String(a.data).localeCompare(String(b.data))) : [];
      pf = { idx, parcelas: [], serie };
      const hoje = getToday();
      const sit = x => x.pago ? '<span class="badge badge-success">Pago</span>' : x.data < hoje ? '<span class="badge badge-danger">Atrasado</span>' : '<span class="badge badge-warning">Em aberto</span>';
      const totalS = serie.reduce((s, x) => s + (Number(x.val) || 0), 0), abertoS = serie.filter(x => !x.pago).reduce((s, x) => s + (Number(x.val) || 0), 0);
      const blocoSerie = serie.length > 1 ? `
        <div class="pf-serie-topo"><b>${p.tipo === 'recorrente' ? 'Todas as contas desta recorrência' : 'Todas as parcelas'}</b>
          <span class="text-muted">${serie.filter(x => x.pago).length} de ${serie.length} pagas · total ${fmt(totalS)} · em aberto ${fmt(abertoS)}</span></div>
        <div class="pf-tab"><table><thead><tr><th>#</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Situação</th></tr></thead><tbody>
          ${serie.map((x, k) => {
            const fixo = travado || x.pago;
            return `<tr class="${x === p ? 'pf-atual' : ''}"><td>${pfE(x.parcela || (k + 1) + '/' + serie.length)}</td>
              <td>${fixo ? ptDate(x.data) : `<input type="date" id="pf-s-d-${k}" value="${x.data}">`}</td>
              <td style="text-align:right;">${fixo ? fmt(Number(x.val) || 0) : `<input class="money-input" id="pf-s-v-${k}" style="text-align:right;max-width:130px;" value="${fmtMoney(Number(x.val) || 0)}" oninput="onMoneyInput(this)">`}</td>
              <td>${sit(x)}</td></tr>`;
          }).join('')}
        </tbody></table></div>
        ${travado ? '' : `<label class="pf-check"><input type="checkbox" id="pf-todas" ${doOlist ? '' : 'checked'}> Aplicar histórico, fornecedor, categoria e forma de pagamento a todas as parcelas em aberto</label>`}` : '';
      const pagoInfo = p.pago ? `<div class="pf-aviso pf-ok">Paga${p.dataPaga ? ' em ' + ptDate(p.dataPaga) : ''}${p.valorPago ? ' · ' + fmt(Number(p.valorPago)) : ''}${p.desconto > 0 ? ' · desconto ' + fmt(p.desconto) : ''}${p.juros > 0 ? ' · juros ' + fmt(p.juros) : ''}</div>` : '';
      const botoes = [
        `<button class="btn-out btn" style="color:var(--danger);margin-right:auto;" title="${doOlist ? 'A conta some daqui (e não volta na sincronização). No Olist ela continua existindo.' : ''}" onclick="pfExcluir()">${doOlist ? 'Excluir daqui' : 'Excluir'}</button>`,
        !travado && serie.filter(x => !x.pago).length > 1 ? `<button class="btn-out btn" style="color:var(--danger);" onclick="pfExcluir(true)">Excluir as em aberto</button>` : '',
        !p.pago && !travado ? `<button class="btn-out btn" onclick="fecharModal('modal-vml');abrirModalBaixa([${idx}])">Dar baixa</button>` : '',
        p.pago && !travado ? `<button class="btn-out btn" onclick="pfReabrir()">Reabrir</button>` : '',
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>`,
        `<button class="btn" onclick="pfSalvarEdicao()">Salvar</button>`
      ].join('');
      vmlModal('Editar conta a pagar' + (p.parcela ? ' · parcela ' + pfE(p.parcela) : ''), pagoInfo + pfCampos(p, travado) + blocoSerie, botoes);
      const m = document.querySelector('#modal-vml .modal-content'); if(m) m.style.maxWidth = '760px';
    }
    function abrirModalSerie(grupoId){
      const i = pagamentos.findIndex(x => pfGrupo(x) === grupoId);
      if(i >= 0) editarLanc(i);
    }

    function pfSalvarEdicao(){
      const p = pagamentos[pf.idx]; if(!p) return;
      const loja = pfV('pf-loja');
      const b = pfLer();
      const antes = new Map((pf.serie.length ? pf.serie : [p]).map(x => [x, { desc: x.desc, forn: x.forn || '', val: Number(x.val), data: x.data, cat: x.cat || '', competencia: (x.competencia || '').slice(0, 7) }]));
      if(!b.desc || !b.val || !b.data){ toast('Preencha o histórico, o valor e o vencimento.'); return; }
      // parcelas da série (lidas antes de mexer na conta aberta)
      pf.serie.forEach((x, k) => {
        if(x === p || x.pago) return;
        const d = pfV('pf-s-d-' + k), v = pfV('pf-s-v-' + k);
        if(d) x.data = d;
        if(v !== '') x.val = parseMoney(v);
      });
      const kAtual = pf.serie.indexOf(p);
      // a linha da conta aberta na tabela vale se foi alterada lá e não nos campos de cima
      if(kAtual >= 0 && !p.pago){
        const d = pfV('pf-s-d-' + kAtual), v = pfV('pf-s-v-' + kAtual);
        if(d && d !== p.data && b.data === p.data) b.data = d;
        if(v !== '' && parseMoney(v) !== Number(p.val) && b.val === Number(p.val)) b.val = parseMoney(v);
      }
      Object.assign(p, { desc: b.desc, forn: b.forn, val: b.val, data: b.data, cat: b.cat, formaPgto: b.formaPgto, doc: b.doc, emissao: b.emissao, competencia: b.competencia });
      if(loja) p.loja = loja;
      const todas = document.getElementById('pf-todas');
      pf.serie.forEach(x => {
        if(loja) x.loja = loja;
        if(x === p || x.pago || !todas || !todas.checked) return;
        Object.assign(x, { desc: b.desc, forn: b.forn, cat: b.cat, formaPgto: b.formaPgto });
      });
      // conta do Olist: o que mudou aqui fica travado (o Olist não sobrescreve mais)
      antes.forEach((a, x) => {
        if(x.fonte !== 'olist') return;
        const agora = { desc: x.desc, forn: x.forn || '', val: Number(x.val), data: x.data, cat: x.cat || '', competencia: (x.competencia || '').slice(0, 7) };
        const mud = Object.keys(a).filter(k => a[k] !== agora[k]);
        if(mud.length) x.travas = [...new Set([...(Array.isArray(x.travas) ? x.travas : []), ...mud])];
      });
      pfDepois();
    }
    function pfExcluir(abertas){
      const p = pagamentos[pf.idx]; if(!p) return;
      const alvo = abertas ? pf.serie.filter(x => !x.pago) : [p];
      const bt = event && event.target;
      // confirmação em dois cliques, sem janela do navegador
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = abertas ? 'Confirmar: excluir ' + alvo.length + ' contas' : 'Confirmar exclusão'; return; }
      // conta do Olist: só esconde (se fosse apagada, voltaria na próxima sincronização)
      alvo.forEach(x => { if(x.fonte === 'olist'){ x.oculta = true; return; } const i = pagamentos.indexOf(x); if(i >= 0) pagamentos.splice(i, 1); });
      pfDepois();
    }
    function pfReabrir(){
      const p = pagamentos[pf.idx]; if(!p) return;
      p.pago = false; p.valorPago = null; p.dataPaga = null; p.desconto = 0; p.juros = 0;
      if(p.fonte === 'olist'){ p.travas = Array.isArray(p.travas) ? p.travas : []; if(!p.travas.includes('pago')) p.travas.push('pago'); }
      pfDepois();
    }
    // destrava: a conta volta a seguir o Olist (os valores de lá chegam na próxima sincronização)
    function pfVoltarOlist(){
      const p = pagamentos[pf.idx]; if(!p) return;
      p.travas = null;
      pfDepois();
      if(typeof olistSincronizar === 'function') olistSincronizar(false);
      toast('A conta voltou a seguir o Olist.');
    }
    // contas do Olist excluídas aqui: lista para restaurar
    function pfOcultas(){
      const l = (typeof pagTodos === 'function' ? pagTodos() : pagamentos).filter(x => x.oculta);
      vmlModal('Contas do Olist excluídas aqui', l.length ? `<div class="text-muted" style="margin-bottom:10px;">Continuam existindo no Olist. Restaurar faz a conta voltar a aparecer aqui.</div><div class="pf-tab" style="max-height:55vh;"><table><thead><tr><th>Vencimento</th><th>Histórico</th><th>Fornecedor</th><th style="text-align:right;">Valor</th><th></th></tr></thead><tbody>${l.map(x => `<tr><td>${ptDate(x.data)}</td><td>${pfE(x.desc)}${x.parcela ? ' (' + pfE(x.parcela) + ')' : ''}</td><td>${pfE(x.forn || '—')}</td><td style="text-align:right;">${fmt(Number(x.val) || 0)}</td><td><button class="btn-out btn-sm" onclick="pfRestaurar('${pfE(x.tiny_key || '')}')">Restaurar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="text-muted">Nenhuma conta escondida.</div>');
    }
    function pfRestaurar(chave){
      const x = (typeof pagTodos === 'function' ? pagTodos() : pagamentos).find(y => y.oculta && (y.tiny_key || '') === chave); if(!x) return;
      x.oculta = false; salvar();
      if(typeof lojasAbsorver === 'function'){ lojasAbsorver(); lojasRecortar(); }
      if(typeof renderPagar === 'function') renderPagar();
      pfOcultas();
    }
