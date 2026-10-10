// ===== DRE ANUAL — um mês por coluna, no formato que o Jonathan usa no Mercado Turbo =====
// (+) TOTAL ENTRADA            Faturamento ML (vendas aprovadas + canceladas, valor dos produtos)
// (−) TOTAL CUSTO OPERACIONAL  linhas do ML (canceladas, imposto, frete do vendedor, custo dos produtos,
//                              tarifa de venda) + categorias de despesa marcadas como "custo variável"
// (=) MARGEM DE CONTRIBUIÇÃO   com linha de %
// (−) TOTAL CUSTO FIXO         categorias de despesa marcadas como "custo fixo"
// (=) LUCRO LÍQUIDO            com linha de %
// Linhas do ML: RPC vendas_ml_por_mes (custo e imposto gravados em cada venda).
// Despesas: lançamentos de Contas a pagar, pelo mês do vencimento; a categoria define o grupo (categorias[].dreGrupo).

    let dreAno = new Date().getFullYear();
    let dreSoPagas = false;
    let dreDados = { ano:null, ml:{}, cobertura:{}, carregado:false, erro:null };
    const DRE_MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

    function dreEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    function dreNum(v){ return v ? 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : '–'; }

    // Grupo de uma categoria no DRE: 'variavel' | 'fixo' | 'fora'
    function dreGrupoDe(nomeCat){
      const c = categorias.find(x => x.nome === nomeCat);
      if(c && c.dreGrupo) return c.dreGrupo;
      return (c && c.impactaDRE) ? 'fixo' : 'fora';     // padrão: o que já impactava o DRE entra como fixo
    }

    async function renderDREAnual(){
      const el = document.getElementById('res-anual-view');
      if(!el) return;
      const chave = dreAno + '|' + (typeof contaAtiva !== 'undefined' ? contaAtiva : '');
      if(dreDados.chave !== chave){ dreDados = { chave, ml:{}, cobertura:{}, carregado:false, erro:null }; dreDesenhar(); }
      if(!usuarioAtual){ dreDados.carregado = true; dreDesenhar(); return; }
      const conta = typeof contaParam === 'function' ? contaParam() : null;
      let qDias = supa.from('vendas_ml_dias').select('dia').eq('usuario_id', usuarioAtual.id).gte('dia', dreAno + '-01-01').lte('dia', dreAno + '-12-31').eq('completo', true).limit(2000);
      if(conta) qDias = qDias.eq('ml_user_id', conta);
      const [ml, dias] = await Promise.all([ supa.rpc('vendas_ml_por_mes', { p_ano: dreAno, p_conta: conta }), qDias ]);
      if(dreDados.chave !== chave) return;
      const porMes = {};
      (ml.data || []).forEach(r => { porMes[r.mes] = { fat:Number(r.faturamento), canc:Number(r.canceladas), imp:Number(r.imposto), frete:Number(r.frete_vendedor), custo:Number(r.custo), tarifa:Number(r.tarifa), vendas:Number(r.vendas) }; });
      // dias do mês já importados do ML (para avisar mês incompleto); com várias contas, conta os dias distintos
      const cob = {}; const vistos = new Set();
      (dias.data || []).forEach(d => { const k = String(d.dia).substring(0,10); if(vistos.has(k)) return; vistos.add(k); const m = parseInt(k.substring(5,7)); cob[m] = (cob[m] || 0) + 1; });
      dreDados = { chave, ml: porMes, cobertura: cob, carregado:true, erro: ml.error?.message || null };
      dreDesenhar();
    }

    // Despesas de Contas a pagar por categoria e mês
    function dreDespesas(){
      const out = { variavel:{}, fixo:{} };
      pagamentos.forEach(p => {
        if(!p.data || p.data.substring(0,4) !== String(dreAno)) return;
        if(dreSoPagas && !p.pago) return;
        const g = dreGrupoDe(p.cat);
        if(g !== 'variavel' && g !== 'fixo') return;
        const nome = p.cat || 'Sem categoria', m = parseInt(p.data.substring(5,7));
        if(!out[g][nome]) out[g][nome] = {};
        out[g][nome][m] = (out[g][nome][m] || 0) + (Number(p.pago && p.valorPago ? p.valorPago : p.val) || 0);
      });
      return out;
    }

    function dreMontar(){
      const ml = dreDados.ml, desp = dreDespesas();
      const val = (m, k) => (ml[m] && ml[m][k]) || 0;
      const linhasML = [
        ['Vendas Canceladas ML', 'canc'], ['Imposto ML', 'imp'], ['Frete Vendedor ML', 'frete'],
        ['Custo dos Produtos ML', 'custo'], ['Tarifa de Venda ML', 'tarifa']
      ].map(([nome, k]) => ({ nome, v: Object.fromEntries(DRE_MESES.map((_, i) => [i + 1, val(i + 1, k)])) }));
      const linhasDe = g => Object.keys(desp[g]).sort((a,b) => a.localeCompare(b)).map(nome => ({ nome, v: desp[g][nome] }));
      const variaveis = linhasDe('variavel'), fixas = linhasDe('fixo');
      const soma = (linhas, m) => linhas.reduce((s,l) => s + (l.v[m] || 0), 0);
      const meses = DRE_MESES.map((_, i) => {
        const m = i + 1;
        const entrada = val(m, 'fat');
        const operacional = soma(linhasML, m) + soma(variaveis, m);
        const fixo = soma(fixas, m);
        return { m, entrada, operacional, mc: entrada - operacional, fixo, lucro: entrada - operacional - fixo };
      });
      return { linhasML, variaveis, fixas, meses };
    }

    function dreDesenhar(){
      const el = document.getElementById('res-anual-view');
      if(!el) return;
      const D = dreMontar();
      const mesAtual = new Date().getFullYear() === dreAno ? new Date().getMonth() + 1 : (dreAno < new Date().getFullYear() ? 12 : 0);
      const tot = k => D.meses.reduce((s,x) => s + x[k], 0);
      const cel = (v, cls) => `<td class="num ${cls || ''}">${dreNum(v)}</td>`;
      const linha = (rot, fn, cls, totalV) => `<tr class="${cls || ''}"><td>${rot}</td>${D.meses.map(x => cel(fn(x))).join('')}${cel(totalV)}</tr>`;
      const linhaItem = l => `<tr><td>${dreEsc(l.nome)}</td>${D.meses.map(x => cel(l.v[x.m] || 0)).join('')}${cel(Object.values(l.v).reduce((s,v) => s + v, 0))}</tr>`;
      const pct = (a, b) => b ? (a / b * 100).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%' : '–';
      const linhaPct = k => `<tr class="dre-pct"><td></td>${D.meses.map(x => `<td class="num">${pct(x[k], x.entrada)}</td>`).join('')}<td class="num">${pct(tot(k), tot('entrada'))}</td></tr>`;
      const diasNoMes = m => new Date(dreAno, m, 0).getDate();
      const hoje = new Date();
      const cabMes = (nome, i) => {
        const m = i + 1;
        const futuro = m > mesAtual;
        const esperado = (m === mesAtual && hoje.getFullYear() === dreAno) ? hoje.getDate() : diasNoMes(m);
        const tem = dreDados.cobertura[m] || 0;
        const parcial = !futuro && usuarioAtual && tem < esperado - 1;
        return `<th class="num">${nome}${parcial ? `<span class="dre-parcial" title="Vendas deste mês ainda sendo importadas do Mercado Livre: ${tem} de ${esperado} dias">●</span>` : ''}
          ${futuro ? '' : `<button class="dre-sync" title="Buscar as vendas de ${nome} no Mercado Livre" onclick="dreSincMes(${m}, this)">↻</button>`}</th>`;
      };
      const anos = []; for(let a = new Date().getFullYear(); a >= new Date().getFullYear() - 3; a--) anos.push(a);
      const semCat = !D.variaveis.length && !D.fixas.length;

      el.innerHTML = `
        <div class="card">
          <div class="card-header" style="flex-wrap:wrap;gap:10px;">
            <div>
              <div class="card-title">DRE ${dreAno}</div>
              <div class="pg-sub">Vendas do Mercado Livre + despesas de Contas a pagar, mês a mês.</div>
            </div>
            <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);cursor:pointer;"><input type="checkbox" ${dreSoPagas ? 'checked' : ''} onchange="dreSoPagas=this.checked;dreDesenhar();" style="width:auto;"> Somente despesas pagas</label>
              <button class="btn-out btn btn-sm" onclick="dreConfigurar()">⚙ Configurar categorias</button>
              <button class="btn-out btn btn-sm" onclick="dreExportar()">⬇ Exportar</button>
              <select onchange="dreAno=parseInt(this.value);renderDREAnual();" style="width:auto;">${anos.map(a => `<option ${a === dreAno ? 'selected' : ''}>${a}</option>`).join('')}</select>
            </div>
          </div>
          ${dreDados.erro ? `<div class="alert alert-danger" style="margin:14px 16px 0;">${dreEsc(dreDados.erro)}</div>` : ''}
          ${semCat ? `<div class="alert alert-info" style="margin:14px 16px 0;">Nenhuma categoria de despesa entra no DRE ainda. Clique em <b>&nbsp;Configurar categorias&nbsp;</b> e diga quais são custo variável e quais são custo fixo.</div>` : ''}
          <div style="overflow-x:auto;">
            <table class="dre-tab">
              <thead><tr><th></th>${DRE_MESES.map(cabMes).join('')}<th class="num">Total</th></tr></thead>
              <tbody>
                ${linha('(+) TOTAL ENTRADA', x => x.entrada, 'dre-entrada', tot('entrada'))}
                ${linha('Faturamento ML', x => x.entrada, '', tot('entrada'))}
                ${linha('(−) TOTAL CUSTO OPERACIONAL', x => x.operacional, 'dre-saida', tot('operacional'))}
                ${D.linhasML.map(linhaItem).join('')}
                ${D.variaveis.map(linhaItem).join('')}
                ${linha('(=) MARGEM DE CONTRIBUIÇÃO', x => x.mc, 'dre-res', tot('mc'))}
                ${linhaPct('mc')}
                ${linha('(−) TOTAL CUSTO FIXO', x => x.fixo, 'dre-saida', tot('fixo'))}
                ${D.fixas.length ? D.fixas.map(linhaItem).join('') : `<tr><td colspan="14" class="text-muted" style="font-style:italic;">Nenhuma categoria marcada como custo fixo</td></tr>`}
                ${linha('(=) LUCRO LÍQUIDO', x => x.lucro, 'dre-res dre-lucro', tot('lucro'))}
                ${linhaPct('lucro')}
              </tbody>
            </table>
          </div>
          <div class="text-muted" style="font-size:11.5px;padding:12px 18px;line-height:1.6;">
            Faturamento ML = valor dos produtos das vendas aprovadas e canceladas (as canceladas saem em seguida). Custo e imposto são os gravados em cada venda.
            Despesas entram pelo mês do vencimento em Contas a pagar. ● = mês com vendas ainda sendo importadas do Mercado Livre.
            ${!dreDados.carregado ? ' Carregando vendas…' : ''}
          </div>
        </div>`;
    }

    async function dreSincMes(m, btn){
      if(typeof vmlSincronizar !== 'function') return;
      const de = `${dreAno}-${String(m).padStart(2,'0')}-01`;
      let ate = `${dreAno}-${String(m).padStart(2,'0')}-${String(new Date(dreAno, m, 0).getDate()).padStart(2,'0')}`;
      if(ate > getToday()) ate = getToday();
      if(btn){ btn.disabled = true; btn.textContent = '…'; }
      await vmlSincronizar(de, ate, false, null);
      dreDados.chave = null;
      await renderDREAnual();
    }

    function dreConfigurar(){
      const usadas = [...new Set(pagamentos.map(p => p.cat).filter(Boolean))];
      const nomes = [...new Set(categorias.map(c => c.nome).concat(usadas))].sort((a,b) => a.localeCompare(b));
      vmlModal('Categorias no DRE', `
        <div class="text-muted" style="margin-bottom:12px;line-height:1.55;">Diga onde cada categoria de Contas a pagar entra. <b style="color:var(--text)">Compra de mercadoria e amortização de empréstimo não entram</b>: o custo da mercadoria já vem das vendas (Custo dos Produtos ML) e amortização não é despesa.</div>
        <div style="max-height:52vh;overflow:auto;">
          <table><thead><tr><th>Categoria</th><th style="width:210px;">No DRE</th></tr></thead><tbody>
          ${nomes.map((n,i) => { const g = dreGrupoDe(n); return `<tr><td>${dreEsc(n)}</td><td><select data-cat="${dreEsc(n)}" class="dre-cfg-sel">
              <option value="fora" ${g === 'fora' ? 'selected' : ''}>Não entra</option>
              <option value="variavel" ${g === 'variavel' ? 'selected' : ''}>Custo variável (operacional)</option>
              <option value="fixo" ${g === 'fixo' ? 'selected' : ''}>Custo fixo</option></select></td></tr>`; }).join('') || '<tr><td colspan="2" class="text-muted">Nenhuma categoria cadastrada.</td></tr>'}
          </tbody></table>
        </div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="dreSalvarConfig()">Salvar</button>`);
    }

    function dreSalvarConfig(){
      document.querySelectorAll('.dre-cfg-sel').forEach(sel => {
        const nome = sel.getAttribute('data-cat'), g = sel.value;
        let c = categorias.find(x => x.nome === nome);
        if(!c){ c = { nome, impactaDRE:false, tipoPassivo:'operacional' }; categorias.push(c); }
        c.dreGrupo = g;
        c.impactaDRE = g !== 'fora';
      });
      salvar();
      fecharModal('modal-vml');
      dreDesenhar();
    }

    function dreExportar(){
      const D = dreMontar();
      const linha = (nome, fn) => { const o = { 'Linha': nome }; let t = 0; D.meses.forEach((x,i) => { const v = Math.round(fn(x) * 100) / 100; o[DRE_MESES[i]] = v; t += v; }); o['Total'] = Math.round(t * 100) / 100; return o; };
      const item = l => linha(l.nome, x => l.v[x.m] || 0);
      const linhas = [
        linha('(+) TOTAL ENTRADA', x => x.entrada), linha('Faturamento ML', x => x.entrada),
        linha('(−) TOTAL CUSTO OPERACIONAL', x => x.operacional), ...D.linhasML.map(item), ...D.variaveis.map(item),
        linha('(=) MARGEM DE CONTRIBUIÇÃO', x => x.mc),
        linha('(−) TOTAL CUSTO FIXO', x => x.fixo), ...D.fixas.map(item),
        linha('(=) LUCRO LÍQUIDO', x => x.lucro)
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'DRE ' + dreAno);
      XLSX.writeFile(wb, `dre_${dreAno}.xlsx`);
    }
