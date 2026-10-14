// ===== DRE NO MODO SIMPLIFICADO =====
// Para quem ainda não usa Contas a pagar: as despesas são lançadas aqui só com descrição, categoria, valor, mês e
// tipo (custo fixo ou custo variável). Com o modo ligado (comprasCfg.dreSimples), o DRE, o fechamento do mês e o
// ponto de equilíbrio usam estes lançamentos NO LUGAR de Contas a pagar e dos empréstimos. As vendas, o custo dos
// produtos, o imposto, a tarifa, o frete e a fatura do Mercado Livre continuam vindo sozinhos.
// Tabela dre_simples, um lançamento por linha. recorrencia:
//   'unico'     → vale só no mês "mes"
//   'sempre'    → vale todo mês a partir de "mes", até "fim" (vazio = sem data para acabar)
//   'parcelado' → "valor" é o total, dividido em "parcelas" meses a partir de "mes"
    let ds = { itens: [], carregado: false, carregando: null, mes: null, resumo: null };
    const DS_CATS = ['Aluguel', 'Contabilidade', 'Embalagens e insumos', 'Frete', 'Funcionários', 'Juros', 'Logística', 'Marketing', 'Pró-labore', 'Sistemas', 'Utilidades (luz, água, internet)', 'Outros'];
    const DS_TIPO = { fixo: 'Custo fixo', variavel: 'Custo variável' };
    const DS_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const dsIdx = ym => Number(String(ym).slice(0, 4)) * 12 + Number(String(ym).slice(5, 7)) - 1;
    const dsYm = i => Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
    const dsMesNome = ym => DS_MESES[Number(String(ym).slice(5, 7)) - 1] + ' de ' + String(ym).slice(0, 4);
    const dsE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const dsR = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // "1.234,56" ou "1234.56" → número
    const dsNum = t => { t = String(t == null ? '' : t).trim().replace(/[R$\s]/g, ''); if(t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const n = Number(t); return isFinite(n) ? n : 0; };

    function dsAtivo(){ return typeof comprasCfg !== 'undefined' && !!(comprasCfg && comprasCfg.dreSimples); }

    async function dsCarregar(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      if(ds.carregado && !forcar) return;
      if(!ds.carregando) ds.carregando = (async () => {
        const r = await supa.from('dre_simples').select('*').eq('usuario_id', usuarioAtual.id).order('id');
        if(!r.error){ ds.itens = r.data || []; ds.carregado = true; }
        ds.carregando = null;
      })();
      return ds.carregando;
    }

    // quanto um lançamento pesa num mês 'AAAA-MM'
    function dsValorNoMes(x, ym){
      const i = dsIdx(ym) - dsIdx(x.mes), v = Number(x.valor) || 0;
      if(i < 0 || (x.fim && ym > x.fim)) return 0;
      if(x.recorrencia === 'sempre') return v;
      if(x.recorrencia === 'parcelado'){ const n = Math.max(1, Number(x.parcelas) || 1); return i < n ? v / n : 0; }
      return i === 0 ? v : 0;
    }
    // despesas do ano no mesmo formato de dreDespesas(): { variavel: { nome: { mês: valor } }, fixo: { ... } }
    function dsDespesas(ano){
      const out = { variavel: {}, fixo: {} };
      ds.itens.forEach(x => {
        const g = x.tipo === 'fixo' ? 'fixo' : 'variavel', n = x.descricao || 'Sem descrição';
        for(let m = 1; m <= 12; m++){
          const v = dsValorNoMes(x, ano + '-' + String(m).padStart(2, '0')); if(!v) continue;
          (out[g][n] = out[g][n] || {})[m] = (out[g][n][m] || 0) + v;
        }
      });
      return out;
    }
    // no DRE as linhas ficam agrupadas pela categoria do lançamento
    function dsGrupo(nome){ const x = ds.itens.find(i => (i.descricao || 'Sem descrição') === nome); return (x && x.categoria) || ''; }

    // liga ou desliga o modo (vale para a conta toda, em todos os aparelhos)
    async function dsLigar(on){
      if(typeof comprasCfg === 'undefined') return;
      comprasCfg.dreSimples = !!on;
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
      if(on) await dsCarregar();
      ds.resumo = null;
      if(typeof gf !== 'undefined'){ gf.chave = null; gf.html = null; }
      if(typeof toast === 'function') toast(on ? 'Modo simplificado ligado: o DRE passa a usar só as despesas lançadas aqui.' : 'Modo simplificado desligado: o DRE voltou a usar Contas a pagar.');
      dsRender(); dsRenderCard();
      if(typeof cfgMontarAbas === 'function' && document.getElementById('view-config') && document.getElementById('view-config').classList.contains('active')) cfgMontarAbas();
    }
    const dsAvisoHtml = () => `No modo simplificado o DRE, o fechamento do mês e o ponto de equilíbrio consideram <b>somente as despesas lançadas em “Despesas simples”</b>. Contas a pagar e empréstimos <b>não entram</b> na conta (continuam guardados e voltam a valer se você desligar o modo). Vendas, custo dos produtos, imposto, tarifa, frete e a fatura do Mercado Livre continuam entrando sozinhos.`;

    // bloco em Configurações → Financeiro
    function dsRenderCard(){
      const view = document.getElementById('view-config'); if(!view) return;
      let card = document.getElementById('cfg-ds-card');
      if(!card){ card = document.createElement('div'); card.id = 'cfg-ds-card'; card.className = 'card'; card.dataset.cfgAba = 'fin'; view.appendChild(card); }
      const on = dsAtivo();
      card.innerHTML = `<div class="card-header"><div class="card-title">Modo do DRE</div></div>
        <div class="card-body">
          <div class="seg">${[[false, 'Completo (Contas a pagar)'], [true, 'Simplificado']].map(([v, r]) => `<button type="button" class="btn-toggle ${on === v ? 'active' : ''}" onclick="dsLigar(${v})">${r}</button>`).join('')}</div>
          <div class="text-muted" style="font-size:12.5px;line-height:1.6;margin-top:12px;"><b>Completo:</b> as despesas do DRE vêm de Contas a pagar, pelas categorias configuradas. Indicado para quem já lança todas as contas.<br>
            <b>Simplificado:</b> você lança as despesas do mês numa lista curta (descrição, valor e se é custo fixo ou variável). Indicado para quem está começando.</div>
          <div class="alert alert-${on ? 'warning' : 'info'}" style="margin-top:12px;line-height:1.55;">${dsAvisoHtml()}</div>
          <button class="btn-out btn btn-sm" style="margin-top:4px;" onclick="nav('resultado');setTimeout(() => setResultadoTab('simples'), 50)">Abrir Despesas simples →</button>
        </div>`;
    }

    // ---------- aba "Despesas simples" (DRE e resultado) ----------
    function dsRender(){
      const el = document.getElementById('res-simples-view'); if(!el || el.style.display === 'none') return;
      if(!ds.mes) ds.mes = getToday().slice(0, 7);
      if(!ds.carregado){ el.innerHTML = '<div class="vazio"><b>Carregando…</b></div>'; dsCarregar().then(() => { if(ds.carregado) dsRender(); else el.innerHTML = '<div class="alert alert-danger">Não consegui ler as despesas. Recarregue a página.</div>'; }); return; }
      const on = dsAtivo(), ym = ds.mes;
      const doMes = ds.itens.map(x => ({ x, v: dsValorNoMes(x, ym) })).filter(r => r.v).sort((a, b) => a.x.tipo.localeCompare(b.x.tipo) || String(a.x.descricao).localeCompare(String(b.x.descricao)));
      const tot = t => doMes.filter(r => r.x.tipo === t).reduce((s, r) => s + r.v, 0);
      const cats = [...new Set(DS_CATS.concat(ds.itens.map(x => x.categoria).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
      const rec = x => x.recorrencia === 'sempre' ? `<span class="badge badge-info" title="Repete todo mês desde ${dsMesNome(x.mes)}${x.fim ? ' até ' + dsMesNome(x.fim) : ''}">todo mês</span>`
        : x.recorrencia === 'parcelado' ? `<span class="badge badge-info" title="Total de ${dsR(x.valor)} dividido em ${x.parcelas} meses">${dsIdx(ym) - dsIdx(x.mes) + 1}/${x.parcelas}</span>` : '';
      el.innerHTML = `
        <div class="card"><div class="card-body" style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;justify-content:space-between;">
          <div style="flex:1 1 420px;min-width:0;">
            <div style="font-weight:700;font-size:14px;">Modo simplificado ${on ? '<span class="badge badge-success">ligado</span>' : '<span class="badge">desligado</span>'}</div>
            <div class="text-muted" style="font-size:12.5px;line-height:1.6;margin-top:6px;">${on ? dsAvisoHtml() : 'Hoje o DRE usa <b>Contas a pagar</b>. Se você ainda não lança todas as contas por lá, ligue o modo simplificado e informe aqui só as despesas do mês: descrição, valor e se é custo fixo ou variável. ' + dsAvisoHtml()}</div>
          </div>
          <button class="${on ? 'btn-out btn' : 'btn'}" onclick="dsLigar(${!on})">${on ? 'Desligar e voltar a usar Contas a pagar' : 'Ligar modo simplificado'}</button>
        </div></div>
        <div class="ds-grid">
          <div class="card" style="overflow:visible;">
            <div class="card-header"><div class="card-title">Lançar despesa</div></div>
            <div class="card-body">
              <div class="filtros">
                <div><label>Tipo</label><select id="ds-tipo"><option value="fixo">Custo fixo</option><option value="variavel">Custo variável</option></select></div>
                <div style="grid-column:span 2;"><label>Descrição</label><input type="text" id="ds-desc" placeholder="Ex.: Contador, Aluguel, Embalagens"></div>
                <div><label>Categoria</label><input type="text" id="ds-cat" list="ds-cats" placeholder="Escolha ou digite"><datalist id="ds-cats">${cats.map(c => `<option value="${dsE(c)}">`).join('')}</datalist></div>
                <div><label>Valor (R$)</label><input type="text" id="ds-valor" inputmode="decimal" placeholder="0,00"></div>
                <div><label>Mês</label><input type="month" id="ds-mes" value="${ym}"></div>
                <div><label>Repetição</label><select id="ds-rec" onchange="document.getElementById('ds-parc-w').style.display=this.value==='parcelado'?'':'none'"><option value="unico">Só neste mês</option><option value="sempre">Todo mês (sempre)</option><option value="parcelado">Parcelar o valor</option></select></div>
                <div id="ds-parc-w" style="display:none;"><label>Em quantos meses</label><input type="number" id="ds-parc" min="2" max="120" value="2"></div>
                <div><button class="btn" style="width:100%;" onclick="dsCadastrar(this)">+ Cadastrar</button></div>
              </div>
              <div class="text-muted" style="font-size:12px;margin-top:10px;line-height:1.55;"><b>Custo fixo</b> existe mesmo sem vender (aluguel, contador, pró-labore, sistemas). <b>Custo variável</b> cresce com as vendas (embalagem, frete de envio, comissão). Não lance aqui custo dos produtos, imposto, tarifa, frete do vendedor nem publicidade do Mercado Livre: esses já entram sozinhos.</div>
            </div>
            <div class="dre-mes-nav" style="border-top:1px solid var(--border);">
              <button class="ico-btn" title="Mês anterior" onclick="dsMesIr(-1)">‹</button><b>${dsMesNome(ym)}</b><button class="ico-btn" title="Próximo mês" onclick="dsMesIr(1)">›</button>
            </div>
            <div style="overflow-x:auto;"><table class="ds-tab">
              <thead><tr><th>Descrição</th><th>Categoria</th><th>Tipo</th><th class="num">Valor no mês</th><th></th></tr></thead>
              <tbody>${doMes.map(({ x, v }) => `<tr><td><b>${dsE(x.descricao)}</b> ${rec(x)}</td><td>${dsE(x.categoria || '—')}</td><td>${DS_TIPO[x.tipo] || x.tipo}</td><td class="num">${dsR(v)}</td>
                <td class="num" style="white-space:nowrap;"><button class="btn-out btn btn-sm" onclick="dsEditar(${x.id})">Editar</button> <button class="btn-out btn btn-sm" onclick="dsExcluir(${x.id})">Excluir</button></td></tr>`).join('')
                || '<tr><td colspan="5"><div class="vazio"><b>Nenhuma despesa lançada neste mês</b>Use o formulário acima.</div></td></tr>'}</tbody>
              ${doMes.length ? `<tfoot><tr><td colspan="3"><b>Total do mês</b> <span class="text-muted">· fixo ${dsR(tot('fixo'))} · variável ${dsR(tot('variavel'))}</span></td><td class="num"><b>${dsR(tot('fixo') + tot('variavel'))}</b></td><td></td></tr></tfoot>` : ''}
            </table></div>
          </div>
          <div class="card"><div class="card-header"><div class="card-title">DRE resumido ${ym.slice(0, 4)}</div><a class="fx-link" style="cursor:pointer;font-size:12.5px;" onclick="setResultadoTab('anual')">Ver DRE completo →</a></div>
            <div id="ds-resumo">${on ? '<div class="vazio">Calculando…</div>' : '<div class="text-muted" style="padding:16px 18px;font-size:12.5px;line-height:1.6;">Ligue o modo simplificado para ver aqui o resultado de cada mês com as despesas desta lista.</div>'}</div>
          </div>
        </div>`;
      if(on) dsResumo(Number(ym.slice(0, 4)));
    }
    function dsMesIr(n){ ds.mes = dsYm(dsIdx(ds.mes) + n); dsRender(); }

    // resultado mês a mês (mesma conta do DRE)
    async function dsResumo(ano){
      const alvo = document.getElementById('ds-resumo'); if(!alvo || typeof gfAno !== 'function' || typeof gfDre !== 'function') return;
      try {
        await gfAno(ano, typeof contaParam === 'function' ? contaParam() : null);
        const D = gfDre(ano), mAtual = Number(ds.mes.slice(5, 7)), cor = v => v < 0 ? 'color:var(--danger);' : (v > 0 ? 'color:var(--success,#16a34a);' : '');
        const lin = D.meses.map(x => ({ m: x.m, e: x.validas, c: x.validas - x.lucro, r: x.lucro })), T = lin.reduce((a, l) => ({ e: a.e + l.e, c: a.c + l.c, r: a.r + l.r }), { e: 0, c: 0, r: 0 });
        const a2 = document.getElementById('ds-resumo'); if(!a2) return;
        a2.innerHTML = `<div style="overflow-x:auto;"><table class="ds-tab"><thead><tr><th>Mês</th><th class="num" title="Vendas válidas: faturamento sem as canceladas">Vendas</th><th class="num">Custos</th><th class="num">Resultado</th></tr></thead>
          <tbody>${lin.map(l => `<tr class="${l.m === mAtual ? 'ds-atual' : ''}" style="cursor:pointer;" onclick="ds.mes='${ano}-${String(l.m).padStart(2, '0')}';dsRender()"><td>${DS_MESES[l.m - 1].slice(0, 3)}</td><td class="num">${dsR(l.e)}</td><td class="num">${dsR(l.c)}</td><td class="num" style="font-weight:700;${cor(l.r)}">${dsR(l.r)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td><b>Total</b></td><td class="num"><b>${dsR(T.e)}</b></td><td class="num"><b>${dsR(T.c)}</b></td><td class="num" style="font-weight:800;${cor(T.r)}">${dsR(T.r)}</td></tr></tfoot></table></div>
          <div class="text-muted" style="font-size:11.5px;padding:10px 16px;line-height:1.5;">Vendas = vendas válidas do Mercado Livre. Custos = custos das vendas + as despesas desta lista. Clique num mês para ver as despesas dele.</div>`;
      } catch(e){ alvo.innerHTML = '<div class="text-muted" style="padding:16px;">Não consegui calcular o resumo agora.</div>'; }
    }

    function dsLer(pref){
      const g = id => document.getElementById(pref + id), rec = g('rec') ? g('rec').value : 'unico';
      const o = { tipo: g('tipo').value === 'variavel' ? 'variavel' : 'fixo', descricao: g('desc').value.trim(), categoria: g('cat').value.trim(), valor: dsNum(g('valor').value), mes: g('mes') ? g('mes').value : null,
        recorrencia: rec, parcelas: rec === 'parcelado' ? Math.max(2, Math.round(Number(g('parc').value) || 0)) : null };
      if(!o.descricao) return 'Informe a descrição.';
      if(!(o.valor > 0)) return 'Informe o valor.';
      if(g('mes') && !/^\d{4}-\d{2}$/.test(o.mes || '')) return 'Informe o mês.';
      return o;
    }
    async function dsCadastrar(bt){
      const o = dsLer('ds-'); if(typeof o === 'string'){ if(typeof toast === 'function') toast(o); return; }
      if(bt) bt.disabled = true;
      const r = await supa.from('dre_simples').insert({ ...o, usuario_id: usuarioAtual.id }).select();
      if(bt) bt.disabled = false;
      if(r.error){ if(typeof toast === 'function') toast('Não consegui gravar: ' + r.error.message); return; }
      if(r.data && r.data[0]) ds.itens.push(r.data[0]); else await dsCarregar(true);
      ds.mes = o.mes; ds.resumo = null; dsMudou(); dsRender();
      if(typeof toast === 'function') toast('Despesa lançada.');
    }
    function dsMudou(){ if(typeof gf !== 'undefined'){ gf.html = null; } }

    function dsEditar(id){
      const x = ds.itens.find(i => Number(i.id) === Number(id)); if(!x || typeof vmlModal !== 'function') return;
      const semp = x.recorrencia === 'sempre', depois = semp && ds.mes > x.mes;
      vmlModal('Editar despesa', `
        <div class="form-row">
          <div class="form-group"><label class="form-label">Tipo</label><select id="dse-tipo"><option value="fixo" ${x.tipo === 'fixo' ? 'selected' : ''}>Custo fixo</option><option value="variavel" ${x.tipo !== 'fixo' ? 'selected' : ''}>Custo variável</option></select></div>
          <div class="form-group"><label class="form-label">${x.recorrencia === 'parcelado' ? 'Valor total (R$)' : 'Valor (R$)'}</label><input type="text" id="dse-valor" inputmode="decimal" value="${(Number(x.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}"></div>
        </div>
        <div class="form-group"><label class="form-label">Descrição</label><input type="text" id="dse-desc" value="${dsE(x.descricao)}"></div>
        <div class="form-group"><label class="form-label">Categoria</label><input type="text" id="dse-cat" list="ds-cats" value="${dsE(x.categoria)}"></div>
        ${depois ? `<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:13px;line-height:1.45;margin-top:6px;"><input type="checkbox" id="dse-apartir" style="width:auto;margin-top:3px;" checked> <span>Valer só de <b>${dsMesNome(ds.mes)}</b> em diante <span class="text-muted">(os meses anteriores ficam como estavam)</span></span></label>` : ''}
        <div id="dse-msg" style="margin-top:10px;"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="dsEditarOk(${x.id}, this)">Salvar</button>`);
    }
    async function dsEditarOk(id, bt){
      const x = ds.itens.find(i => Number(i.id) === Number(id)); if(!x) return;
      const o = dsLer('dse-'), msg = t => { const m = document.getElementById('dse-msg'); if(m) m.innerHTML = `<div class="alert alert-danger">${dsE(t)}</div>`; };
      if(typeof o === 'string') return msg(o);
      const novo = { tipo: o.tipo, descricao: o.descricao, categoria: o.categoria, valor: o.valor }, ap = document.getElementById('dse-apartir');
      if(bt) bt.disabled = true;
      let r;
      if(ap && ap.checked){
        // recorrente alterado a partir de um mês: encerra o antigo no mês anterior e abre um novo
        r = await supa.from('dre_simples').update({ fim: dsYm(dsIdx(ds.mes) - 1) }).eq('id', x.id).eq('usuario_id', usuarioAtual.id);
        if(!r.error) r = await supa.from('dre_simples').insert({ ...novo, usuario_id: usuarioAtual.id, mes: ds.mes, recorrencia: 'sempre', fim: x.fim || null });
      } else r = await supa.from('dre_simples').update(novo).eq('id', x.id).eq('usuario_id', usuarioAtual.id);
      if(bt) bt.disabled = false;
      if(r.error) return msg('Não consegui gravar: ' + r.error.message);
      await dsCarregar(true); dsMudou(); fecharModal('modal-vml'); dsRender();
    }
    function dsExcluir(id){
      const x = ds.itens.find(i => Number(i.id) === Number(id)); if(!x || typeof vmlModal !== 'function') return;
      const semp = x.recorrencia === 'sempre', depois = semp && ds.mes > x.mes;
      vmlModal('Excluir despesa', `<div style="line-height:1.6;">Excluir <b>${dsE(x.descricao)}</b> (${dsR(x.valor)}${x.recorrencia === 'parcelado' ? ' em ' + x.parcelas + ' meses' : (semp ? ' todo mês' : '')})?
        ${x.recorrencia !== 'unico' ? '<div class="text-muted" style="margin-top:8px;font-size:12.5px;">É um lançamento que se repete. Escolha se quer tirar só daqui para frente ou de todos os meses.</div>' : ''}</div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button>
         ${depois ? `<button class="btn-out btn" onclick="dsExcluirOk(${x.id}, true, this)">Encerrar a partir de ${dsMesNome(ds.mes)}</button>` : ''}
         <button class="btn" style="background:var(--danger);border-color:var(--danger);" onclick="dsExcluirOk(${x.id}, false, this)">${x.recorrencia !== 'unico' ? 'Excluir de todos os meses' : 'Excluir'}</button>`);
    }
    async function dsExcluirOk(id, soDaqui, bt){
      if(bt) bt.disabled = true;
      const q = supa.from('dre_simples'), r = soDaqui ? await q.update({ fim: dsYm(dsIdx(ds.mes) - 1) }).eq('id', id).eq('usuario_id', usuarioAtual.id) : await q.delete().eq('id', id).eq('usuario_id', usuarioAtual.id);
      if(r.error){ if(bt) bt.disabled = false; if(typeof toast === 'function') toast('Não consegui excluir: ' + r.error.message); return; }
      await dsCarregar(true); dsMudou(); fecharModal('modal-vml'); dsRender();
    }
