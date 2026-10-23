// ===== DRE ANUAL — um mês por coluna, no formato que o Jonathan usa no Mercado Turbo =====
// (+) TOTAL ENTRADA            Faturamento ML (vendas aprovadas + canceladas, valor dos produtos)
// (−) TOTAL CUSTO OPERACIONAL  linhas do ML (canceladas, imposto, frete do vendedor, custo dos produtos,
//                              tarifa de venda) + categorias de despesa marcadas como "custo variável"
// (=) MARGEM DE CONTRIBUIÇÃO   com linha de %
// (−) TOTAL CUSTO FIXO         categorias de despesa marcadas como "custo fixo"
// (=) LUCRO LÍQUIDO            com linha de %
// Linhas do ML: RPC vendas_ml_por_mes (custo e imposto gravados em cada venda).
// Despesas: lançamentos de Contas a pagar, pelo mês de competência (sem competência, o do vencimento).
// Onde cada categoria entra: escolha do usuário (categorias[].dreGrupo) ou, sem escolha, o grupo que ela tem
// no plano de contas do Olist (categorias[].grupo, importado por olistImportarCategorias).

    let dreAno = new Date().getFullYear();
    let dreSoPagas = false;
    let dreDados = { ano:null, ml:{}, cobertura:{}, carregado:false, erro:null };
    const DRE_MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

    // nome da linha; com descrição, ganha o ⓘ e a explicação ao passar o mouse
    function dreNomeLinha(l){ return l.desc ? `<span title="${dreEsc(l.desc)}" style="cursor:help;">${dreEsc(l.nome)} <small class="text-muted">ⓘ</small></span>` : dreEsc(l.nome); }
    function dreEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    function dreNum(v){ return v ? 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : '–'; }

    // Grupo de uma categoria no DRE: 'variavel' | 'fixo' | 'fora'
    function dreGrupoDe(nomeCat){
      const c = categorias.find(x => x.nome === nomeCat);
      if(c && c.dreGrupo) return c.dreGrupo;
      if(c && c.grupo) return drePadraoDoGrupo(c.grupo);
      return (c && c.impactaDRE) ? 'fixo' : 'fora';     // padrão: o que já impactava o DRE entra como fixo
    }
    // grupo do plano de contas do Olist → onde entra no DRE
    function drePadraoDoGrupo(g){
      g = String(g || '');
      if(/tribut|imposto/i.test(g)) return 'fora';                       // o imposto já entra por venda (linha Imposto ML)
      if(/estoque|compra|mercadoria/i.test(g)) return 'fora';            // o custo da mercadoria já vem das vendas
      if(/amortiza/i.test(g)) return 'fora';                             // devolver o principal de um empréstimo não é despesa
      if(/distribui|resultado|lucro|investimento/i.test(g)) return 'fora';
      if(/custo/i.test(g)) return 'variavel';
      return 'fixo';
    }
    function dreGrupoOlist(nomeCat){ if(typeof dsAtivo === 'function' && dsAtivo()) return dsGrupo(nomeCat); const c = categorias.find(x => x.nome === nomeCat); return (c && c.grupo) || ''; }

    async function renderDREAnual(){
      const el = document.getElementById('res-anual-view');
      if(!el) return;
      // empréstimo por % das vendas: mantém os juros do mês (retidos nas vendas) no Contas a pagar antes de montar o DRE
      if(typeof empVendasAtualizar === 'function') try { await empVendasAtualizar(); } catch(e){}
      const chave = dreAno + '|' + (typeof contaAtiva !== 'undefined' ? contaAtiva : '');
      if(dreDados.chave !== chave){ dreDados = { chave, ml:{}, cobertura:{}, carregado:false, erro:null }; dreDesenhar(); }
      if(!usuarioAtual){ dreDados.carregado = true; dreDesenhar(); return; }
      const conta = typeof contaParam === 'function' ? contaParam() : null;
      let qDias = supa.from('vendas_ml_dias').select('dia').eq('usuario_id', usuarioAtual.id).gte('dia', dreAno + '-01-01').lte('dia', dreAno + '-12-31').eq('completo', true).limit(2000);
      if(conta) qDias = qDias.eq('ml_user_id', conta);
      const [ml, dias, fat, , cobr] = await Promise.all([ supa.rpc('vendas_ml_por_mes', { p_ano: dreAno, p_conta: conta }), qDias, typeof ftMes === 'function' ? ftMes(dreAno, conta).catch(() => ({})) : null, typeof dsAtivo === 'function' && dsAtivo() ? dsCarregar() : null,
        supa.rpc('vendas_ml_cobr_mes', { p_ano: dreAno, p_conta: conta }).then(r => r, () => ({})) ]);
      if(dreDados.chave !== chave) return;
      const porMes = {};
      (ml.data || []).forEach(r => { porMes[r.mes] = { fat:Number(r.faturamento), canc:Number(r.canceladas), imp:Number(r.imposto), frete:Number(r.frete_vendedor), custo:Number(r.custo), tarifa:Number(r.tarifa), vendas:Number(r.vendas), flex:-(Number(r.flex_repasse) || 0), flexc:Number(r.flex_custo) || 0 }; });
      if(fat && typeof ftJuntar === 'function') ftJuntar(porMes, fat);     // cobranças da fatura do ML, por mês em que aconteceram
      // frete de ida das vendas canceladas e tarifa de devolução (lidos da fatura de cada venda), pelo mês da cobrança
      ((cobr && cobr.data) || []).forEach(r => { const x = porMes[r.mes] = porMes[r.mes] || {}; x.ida = Number(r.ida) || 0; x.dev = Number(r.dev) || 0; });
      // dias do mês já importados do ML (para avisar mês incompleto); com várias contas, conta os dias distintos
      const cob = {}; const vistos = new Set();
      (dias.data || []).forEach(d => { const k = String(d.dia).substring(0,10); if(vistos.has(k)) return; vistos.add(k); const m = parseInt(k.substring(5,7)); cob[m] = (cob[m] || 0) + 1; });
      dreDados = { chave, ml: porMes, cobertura: cob, carregado:true, erro: ml.error?.message || null };
      dreDesenhar();
    }

    // Mês em que a despesa entra quando a conta não traz competência: segue a competência padrão da categoria
    //   vencimento (padrão) | anterior (mês anterior ao vencimento) | emissao (mês em que a conta foi emitida)
    const DRE_COMP = [['vencimento', 'Mês do vencimento'], ['anterior', 'Mês anterior ao vencimento'], ['emissao', 'Mês da emissão']];
    function dreCompetencia(p){
      const c = categorias.find(x => x.nome === p.cat), modo = (c && c.competencia) || 'vencimento';
      if(modo === 'emissao' && /^\d{4}-\d{2}/.test(p.emissao || '')) return p.emissao;
      if(modo === 'anterior' && /^\d{4}-\d{2}/.test(p.data || '')){ const a = Number(p.data.substring(0, 4)), m = Number(p.data.substring(5, 7)), x = new Date(a, m - 2, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-01'; }
      return p.data;
    }
    // grupos abertos no DRE (fechados mostram só o total do grupo)
    let dreAbertos = new Set();
    function dreAbrirGrupo(k){ if(dreAbertos.has(k)) dreAbertos.delete(k); else dreAbertos.add(k); dreDesenhar(); }
    function dreAbrirTodos(abrir){ dreAbertos = new Set(); if(abrir){ const D = dreMontar(); D.variaveis.forEach(l => dreAbertos.add('v|' + (l.grupo || 'Sem grupo'))); D.fixas.forEach(l => dreAbertos.add('f|' + (l.grupo || 'Sem grupo'))); } dreDesenhar(); }

    // Despesas de Contas a pagar por categoria e mês
    function dreDespesas(){
      if(typeof dsAtivo === 'function' && dsAtivo()) return dsDespesas(dreAno);   // modo simplificado: despesas da lista curta, não de Contas a pagar
      const out = { variavel:{}, fixo:{} };
      pagamentos.forEach(p => {
        const ref = /^\d{4}-\d{2}/.test(p.competencia || '') ? p.competencia : dreCompetencia(p);
        if(!ref || ref.substring(0,4) !== String(dreAno)) return;
        if(dreSoPagas && !p.pago) return;
        let g = dreGrupoDe(p.cat);
        const m = parseInt(ref.substring(5,7));
        // pagamento da fatura do ML: sai do DRE nos meses em que a própria fatura já entrou; nos outros vale o lançamento
        if(g === 'fatura'){ if(typeof ftVale === 'function' && ftVale(dreDados.ml, m)) return; g = 'variavel'; }
        if(g !== 'variavel' && g !== 'fixo') return;
        const nome = p.cat || 'Sem categoria';
        if(!out[g][nome]) out[g][nome] = {};
        out[g][nome][m] = (out[g][nome][m] || 0) + (Number(p.pago && p.valorPago ? p.valorPago : p.val) || 0);
      });
      return out;
    }

    // linhas das vendas canceladas depois de enviadas (vendas_ml_cobr, lidas da fatura de cada venda pela função ml-fatura)
    const DRE_COBR = [
      ['ida', 'Frete de ida de vendas canceladas (ML)', 'Venda cancelada depois de enviada: o Mercado Livre estorna a tarifa de venda e devolve o valor ao comprador, mas continua cobrando a tarifa de envio cheia (a sua parte e a que o comprador pagou e recebeu de volta). Já descontados os estornos de envio. Entra no mês da cobrança.'],
      ['dev', 'Tarifa de devolução (ML)', 'Frete de volta cobrado pelo Mercado Livre quando o comprador devolve o produto. Já descontados os estornos de devolução. Entra no mês da cobrança.']
    ];
    const DRE_FLEX_RX = /\bflex\b/i;   // categoria de Contas a pagar que é o pagamento do transportador do Flex
    function dreMontar(){
      const ml = dreDados.ml, desp = dreDespesas();
      const val = (m, k) => (ml[m] && ml[m][k]) || 0;
      const linhasML = [
        ['Vendas Canceladas ML', 'canc'], ['Imposto ML', 'imp'], ['Frete Vendedor ML', 'frete'],
        ['Custo dos Produtos ML', 'custo'], ['Tarifa de Venda ML', 'tarifa']
      ].map(([nome, k]) => ({ nome, v: Object.fromEntries(DRE_MESES.map((_, i) => [i + 1, val(i + 1, k)])) }));
      // Flex: o Mercado Livre repassa ao vendedor o frete dos envios Flex (entra como valor negativo = reduz o custo).
      // O que se paga ao transportador: vale o que foi lançado em Contas a pagar numa categoria de Flex (nome com "Flex");
      // no mês sem lançamento, entra o custo pela configuração (entregas × valor por entrega de Configurações → Vendas).
      if(DRE_MESES.some((_, i) => val(i + 1, 'flex'))) linhasML.push({ nome: 'Repasse do Flex (ML)', v: Object.fromEntries(DRE_MESES.map((_, i) => [i + 1, val(i + 1, 'flex')])) });
      const pagoFlex = m => ['variavel', 'fixo'].reduce((s, g) => s + Object.keys(desp[g]).filter(n => DRE_FLEX_RX.test(n)).reduce((t, n) => t + (desp[g][n][m] || 0), 0), 0);
      const flexCfg = Object.fromEntries(DRE_MESES.map((_, i) => [i + 1, pagoFlex(i + 1) > 0 ? 0 : val(i + 1, 'flexc')]));
      if(Object.values(flexCfg).some(x => x)) linhasML.push({ nome: 'Entregas Flex (pela configuração)', v: flexCfg, flexCfg: true });
      if(typeof ftLinhas === 'function') linhasML.push(...ftLinhas(ml));
      DRE_COBR.forEach(([k, nome, desc]) => { if(DRE_MESES.some((_, i) => val(i + 1, k))) linhasML.push({ nome, desc, v: Object.fromEntries(DRE_MESES.map((_, i) => [i + 1, val(i + 1, k)])) }); });
      const linhasDe = g => Object.keys(desp[g]).map(nome => ({ nome, v: desp[g][nome], grupo: dreGrupoOlist(nome) })).sort((a,b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome));
      const variaveis = linhasDe('variavel'), fixas = linhasDe('fixo');
      const soma = (linhas, m) => linhas.reduce((s,l) => s + (l.v[m] || 0), 0);
      const meses = DRE_MESES.map((_, i) => {
        const m = i + 1;
        const entrada = val(m, 'fat');
        const operacional = soma(linhasML, m) + soma(variaveis, m);
        const fixo = soma(fixas, m);
        return { m, entrada, validas: entrada - val(m, 'canc'), operacional, mc: entrada - operacional, fixo, lucro: entrada - operacional - fixo };
      });
      return { linhasML, variaveis, fixas, meses };
    }

    // Visão do DRE: 'ano' (12 meses lado a lado) ou 'mes' (um mês por vez). Sem escolha gravada, vale o tamanho da tela.
    let dreModo = (() => { try { return localStorage.getItem('mk_dre_modo') || ''; } catch(e){ return ''; } })();
    let dreMesSel = 0;
    const DRE_MESES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    function dreModoAtual(){ return dreModo || (window.innerWidth < 760 ? 'mes' : 'ano'); }
    function dreSetModo(m){ dreModo = m; try { localStorage.setItem('mk_dre_modo', m); } catch(e){} dreDesenhar(); }
    function dreMesIr(n){
      let m = dreMesSel + n, a = dreAno; if(m < 1){ m = 12; a--; } if(m > 12){ m = 1; a++; }
      const hj = new Date().getFullYear(); if(a > hj || a < hj - 3) return;
      dreMesSel = m;
      if(a !== dreAno){ dreAno = a; renderDREAnual(); } else dreDesenhar();
    }
    // tabela de um mês: valor, % das vendas válidas e o mês anterior
    function dreTabelaMes(D){
      const m = dreMesSel, x = D.meses[m - 1], a = m > 1 ? D.meses[m - 2] : null;
      const pct = v => x.validas && v ? (v / x.validas * 100).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + '%' : '';
      const lin = (rot, v, va, cls, semPct, extra) => `<tr class="${cls || ''}" ${extra || ''}><td>${rot}</td><td class="num">${dreNum(v)}</td><td class="num dre-m-pct">${semPct ? '' : pct(v)}</td><td class="num dre-m-ant">${a ? dreNum(va) : '–'}</td></tr>`;
      const tem = l => (l.v[m] || 0) || (a && (l.v[m - 1] || 0));
      const item = (l, cls) => lin(dreNomeLinha(l), l.v[m] || 0, l.v[m - 1] || 0, cls);
      const grupos = (linhas, pref) => {
        const gs = []; linhas.filter(tem).forEach(l => { const n = l.grupo || 'Sem grupo'; let g = gs.find(z => z.n === n); if(!g){ g = { n, l: [] }; gs.push(g); } g.l.push(l); });
        return gs.map(g => { const k = pref + '|' + g.n, ab = dreAbertos.has(k), som = mm => g.l.reduce((t, l) => t + (l.v[mm] || 0), 0);
          return lin(`<span class="dre-seta">${ab ? '▾' : '▸'}</span>${dreEsc(g.n)} <small>${g.l.length}</small>`, som(m), som(m - 1), 'dre-grupo dre-gsub', false, `onclick="dreAbrirGrupo('${dreEsc(k).replace(/'/g, "\\'")}')"`) + (ab ? g.l.map(l => item(l, 'dre-sub')).join('') : ''); }).join('');
      };
      const v = k => x[k], va = k => a ? a[k] : 0;
      return `<table class="dre-tab dre-mes">
        <thead><tr><th></th><th class="num">${DRE_MESES_NOME[m - 1]}</th><th class="num dre-m-pct" title="Percentual sobre as vendas válidas (faturamento sem as canceladas)">% vendas</th><th class="num dre-m-ant">${a ? DRE_MESES_NOME[m - 2] : 'Mês anterior'}</th></tr></thead>
        <tbody>
          ${lin('(+) TOTAL ENTRADA', v('entrada'), va('entrada'), 'dre-entrada', true)}
          ${lin('Faturamento ML', v('entrada'), va('entrada'), '', true)}
          ${lin('(−) TOTAL CUSTO OPERACIONAL', v('operacional'), va('operacional'), 'dre-saida')}
          ${D.linhasML.filter(tem).map(l => item(l)).join('')}
          ${grupos(D.variaveis, 'v')}
          ${lin('(=) MARGEM DE CONTRIBUIÇÃO', v('mc'), va('mc'), 'dre-res')}
          ${lin('(−) TOTAL CUSTO FIXO', v('fixo'), va('fixo'), 'dre-saida')}
          ${grupos(D.fixas, 'f') || '<tr><td colspan="4" class="text-muted" style="font-style:italic;">Nenhuma despesa fixa neste mês</td></tr>'}
          ${lin('(=) LUCRO LÍQUIDO', v('lucro'), va('lucro'), 'dre-res dre-lucro')}
        </tbody></table>`;
    }

    function dreDesenhar(){
      const el = document.getElementById('res-anual-view');
      if(!el) return;
      const D = dreMontar();
      const mesAtual = new Date().getFullYear() === dreAno ? new Date().getMonth() + 1 : (dreAno < new Date().getFullYear() ? 12 : 0);
      const tot = k => D.meses.reduce((s,x) => s + x[k], 0);
      const cel = (v, cls) => `<td class="num ${cls || ''}">${dreNum(v)}</td>`;
      const linha = (rot, fn, cls, totalV) => `<tr class="${cls || ''}"><td>${rot}</td>${D.meses.map(x => cel(fn(x))).join('')}${cel(totalV)}</tr>`;
      const linhaItem = l => `<tr><td>${dreNomeLinha(l)}</td>${D.meses.map(x => cel(l.v[x.m] || 0)).join('')}${cel(Object.values(l.v).reduce((s,v) => s + v, 0))}</tr>`;
      // cada grupo vira uma linha com o total; clicar abre as categorias de dentro
      const comGrupo = (linhas, pref) => {
        const gs = []; linhas.forEach(l => { const n = l.grupo || 'Sem grupo'; let g = gs.find(x => x.n === n); if(!g){ g = { n, l: [] }; gs.push(g); } g.l.push(l); });
        return gs.map(g => { const k = pref + '|' + g.n, ab = dreAbertos.has(k), somaM = m => g.l.reduce((s2, l) => s2 + (l.v[m] || 0), 0), totG = g.l.reduce((s2, l) => s2 + Object.values(l.v).reduce((a, b) => a + b, 0), 0);
          return `<tr class="dre-grupo dre-gsub" onclick="dreAbrirGrupo('${dreEsc(k).replace(/'/g, "\\'")}')" title="${ab ? 'Esconder' : 'Mostrar'} as ${g.l.length} categorias deste grupo"><td><span class="dre-seta">${ab ? '▾' : '▸'}</span>${dreEsc(g.n)} <small>${g.l.length}</small></td>${D.meses.map(x => cel(somaM(x.m))).join('')}${cel(totG)}</tr>` + (ab ? g.l.map(l => linhaItem(l).replace('<tr>', '<tr class="dre-sub">')).join('') : ''); }).join('');
      };
      const pct = (a, b) => b ? (a / b * 100).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%' : '–';
      const linhaPct = k => `<tr class="dre-pct"><td></td>${D.meses.map(x => `<td class="num">${pct(x[k], x.validas)}</td>`).join('')}<td class="num">${pct(tot(k), tot('validas'))}</td></tr>`;
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
      const modo = dreModoAtual(), simples = typeof dsAtivo === 'function' && dsAtivo();
      if(!dreMesSel) dreMesSel = mesAtual || 1;
      const mesFuturo = dreAno === hoje.getFullYear() && dreMesSel > hoje.getMonth() + 1;

      el.innerHTML = `
        <div class="card">
          <div class="card-header" style="flex-wrap:wrap;gap:10px;">
            <div>
              <div class="card-title">DRE ${modo === 'mes' ? DRE_MESES_NOME[dreMesSel - 1] + ' de ' : ''}${dreAno}</div>
              <div class="pg-sub">Vendas do Mercado Livre + ${simples ? 'despesas do modo simplificado' : 'despesas de Contas a pagar'}${modo === 'mes' ? ', um mês por vez' : ', mês a mês'}.</div>
            </div>
            <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
              <div class="seg">${[['mes', 'Mensal'], ['ano', 'Anual']].map(([k, r]) => `<button type="button" class="btn-toggle ${modo === k ? 'active' : ''}" onclick="dreSetModo('${k}')">${r}</button>`).join('')}</div>
              ${simples ? `<span class="badge badge-info" title="As despesas vêm da aba Despesas simples; Contas a pagar e empréstimos não entram">Modo simplificado</span><button class="btn-out btn btn-sm" onclick="setResultadoTab('simples')">Lançar despesas</button>` : `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);cursor:pointer;"><input type="checkbox" ${dreSoPagas ? 'checked' : ''} onchange="dreSoPagas=this.checked;dreDesenhar();" style="width:auto;"> Somente despesas pagas</label>`}
              <button class="btn-out btn btn-sm" onclick="dreAbrirTodos(${dreAbertos.size ? 'false' : 'true'})" title="Mostrar ou esconder as categorias dentro de cada grupo">${dreAbertos.size ? 'Fechar grupos' : 'Abrir grupos'}</button>
              ${simples ? '' : `<button class="btn-out btn btn-sm" onclick="dreConfigurar()">Configurar categorias</button>`}
              <button class="btn-out btn btn-sm" onclick="dreExportar()">Exportar</button>
              <select onchange="dreAno=parseInt(this.value);renderDREAnual();" style="width:auto;">${anos.map(a => `<option ${a === dreAno ? 'selected' : ''}>${a}</option>`).join('')}</select>
            </div>
          </div>
          ${dreDados.erro ? `<div class="alert alert-danger" style="margin:14px 16px 0;">${dreEsc(dreDados.erro)}</div>` : ''}
          ${typeof ftAviso === 'function' ? ftAviso() : ''}
          ${simples ? `<div class="alert alert-info" style="margin:14px 16px 0;"><b>Modo simplificado:</b>&nbsp;as despesas deste DRE são as da aba Despesas simples. Contas a pagar e empréstimos não entram.</div>` : ''}
          ${semCat && !simples ? `<div class="alert alert-info" style="margin:14px 16px 0;">Nenhuma categoria de despesa entra no DRE ainda. Clique em <b>&nbsp;Configurar categorias&nbsp;</b> e diga quais são custo variável e quais são custo fixo.</div>` : ''}
          ${modo === 'mes' ? `<div class="dre-mes-nav">
              <button class="ico-btn" title="Mês anterior" onclick="dreMesIr(-1)">‹</button>
              <b>${DRE_MESES_NOME[dreMesSel - 1]} de ${dreAno}</b>
              <button class="ico-btn" title="Próximo mês" onclick="dreMesIr(1)">›</button>
              ${mesFuturo ? '' : `<button class="dre-sync" title="Buscar as vendas deste mês no Mercado Livre" onclick="dreSincMes(${dreMesSel}, this)">↻</button>`}
            </div>
            <div style="overflow-x:auto;">${dreTabelaMes(D)}</div>` : `
          <div style="overflow-x:auto;">
            <table class="dre-tab">
              <thead><tr><th></th>${DRE_MESES.map(cabMes).join('')}<th class="num">Total</th></tr></thead>
              <tbody>
                ${linha('(+) TOTAL ENTRADA', x => x.entrada, 'dre-entrada', tot('entrada'))}
                ${linha('Faturamento ML', x => x.entrada, '', tot('entrada'))}
                ${linha('(−) TOTAL CUSTO OPERACIONAL', x => x.operacional, 'dre-saida', tot('operacional'))}
                ${D.linhasML.map(linhaItem).join('')}
                ${comGrupo(D.variaveis, 'v')}
                ${linha('(=) MARGEM DE CONTRIBUIÇÃO', x => x.mc, 'dre-res', tot('mc'))}
                ${linhaPct('mc')}
                ${linha('(−) TOTAL CUSTO FIXO', x => x.fixo, 'dre-saida', tot('fixo'))}
                ${D.fixas.length ? comGrupo(D.fixas, 'f') : `<tr><td colspan="14" class="text-muted" style="font-style:italic;">Nenhuma categoria marcada como custo fixo</td></tr>`}
                ${linha('(=) LUCRO LÍQUIDO', x => x.lucro, 'dre-res dre-lucro', tot('lucro'))}
                ${linhaPct('lucro')}
              </tbody>
            </table>
          </div>`}
          <div class="text-muted" style="font-size:11.5px;padding:12px 18px;line-height:1.6;">
            Faturamento ML = valor dos produtos das vendas aprovadas e canceladas (as canceladas saem em seguida). Custo e imposto são os gravados em cada venda.
            Os percentuais são sobre as vendas válidas (faturamento sem as canceladas).
            Despesas aparecem somadas por grupo: clique num grupo para ver as categorias. Entram pelo mês de competência da conta; sem ela, pela competência padrão da categoria (em geral o mês do vencimento). ● = mês com vendas ainda sendo importadas do Mercado Livre.
            ${typeof ftRodape === 'function' ? ftRodape() : ''}
            Venda cancelada depois de enviada: o frete de ida que ficou cobrado e a tarifa de devolução entram nas linhas próprias (passe o mouse no ⓘ), lidos da fatura de cada venda toda madrugada.
            Flex: o repasse do Mercado Livre entra como redução de custo; o transportador entra pelo que foi lançado em Contas a pagar numa categoria com “Flex” no nome e, no mês sem lançamento, pelo valor por entrega das Configurações.
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

    function dreConfigurar(aviso){
      const usadas = [...new Set((typeof pagTodos === 'function' ? pagTodos() : pagamentos).map(p => p.cat).filter(Boolean))];
      const nomes = [...new Set(categorias.map(c => c.nome).concat(usadas))].sort((a,b) => (dreGrupoOlist(a) || 'zzz').localeCompare(dreGrupoOlist(b) || 'zzz') || a.localeCompare(b));
      const temOlist = typeof olist !== 'undefined' && olist.v3;
      const trat = typeof BAL_TRAT !== 'undefined' ? BAL_TRAT : null;
      let ult = null;
      vmlModal('Categorias: onde cada uma entra', `
        ${aviso ? `<div class="alert alert-info">${aviso}</div>` : ''}
        <div class="text-muted" style="margin-bottom:12px;line-height:1.55;">Para cada categoria de Contas a pagar, diga onde ela entra no <b style="color:var(--text)">DRE</b> e no <b style="color:var(--text)">balanço</b>. Quem ainda não foi escolhido segue o grupo do plano de contas do Olist.
          <b style="color:var(--text)">Compra de mercadoria, imposto e amortização não entram no DRE</b>: o custo e o imposto já vêm de cada venda, e amortização não é despesa.</div>
        ${typeof ftAuto === 'function' ? `<div class="ft-modo"><label for="dre-cfg-fatura"><b>Cobranças da fatura do Mercado Livre</b> (publicidade, armazenagem do Full, DIFAL, mensalidade da loja)</label>
          <select id="dre-cfg-fatura" style="width:auto;" onchange="document.getElementById('dre-cfg-fatura-nota').style.display=this.value==='auto'?'':'none'">
            <option value="pagar" ${ftAuto() ? '' : 'selected'}>Entram pelo que eu lanço em Contas a pagar</option>
            <option value="auto" ${ftAuto() ? 'selected' : ''}>Entram sozinhas, direto da fatura do Mercado Livre</option></select>
          <div id="dre-cfg-fatura-nota" class="text-muted" style="font-size:12px;line-height:1.5;margin-top:6px;${ftAuto() ? '' : 'display:none;'}">Cada cobrança entra no mês em que aconteceu, já sem as bonificações. A conta da fatura que você lança em Contas a pagar continua valendo para o caixa: marque a categoria dela como <b>Fatura do ML (só caixa)</b>, senão o gasto conta duas vezes. Ao salvar, as categorias com nome de publicidade, Full ou fatura do Mercado Livre são marcadas assim.</div></div>` : ''}
        <div style="max-height:52vh;overflow:auto;">
          <datalist id="dre-grupos">${[...new Set(categorias.map(c => c.grupo).filter(Boolean))].sort().map(g => `<option value="${dreEsc(g)}">`).join('')}</datalist>
          <table><thead><tr><th>Categoria</th><th style="width:190px;">Grupo ${typeof dica === 'function' ? dica('A família da categoria. No DRE as despesas aparecem somadas por grupo. Com o Olist ligado, o grupo vem de lá; aqui você pode trocar ou criar um.', true) : ''}</th><th style="width:200px;">No DRE</th><th style="width:190px;">Competência padrão ${typeof dica === 'function' ? dica('Em que mês a despesa entra no DRE quando a conta não tem competência própria. Ex.: aluguel pago no dia 5 referente ao mês anterior = "Mês anterior ao vencimento".', true) : ''}</th>${trat ? '<th style="width:240px;">No balanço (o que eu devo hoje)</th>' : ''}</tr></thead><tbody>
          ${nomes.map(n => { const g = dreGrupoDe(n), go = dreGrupoOlist(n), tb = trat && typeof balTipoDe === 'function' ? balTipoDe(n) : '';
            const cab = go !== ult ? `<tr class="dre-grupo"><td colspan="5">${dreEsc(go || 'Sem grupo')}</td></tr>` : ''; ult = go;
            const cc = (categorias.find(x => x.nome === n) || {}).competencia || 'vencimento';
            return cab + `<tr><td>${dreEsc(n)}</td><td><input type="text" list="dre-grupos" data-cat="${dreEsc(n)}" class="dre-cfg-grp" value="${dreEsc(go)}" placeholder="Sem grupo" style="width:100%;"></td><td><select data-cat="${dreEsc(n)}" class="dre-cfg-sel">
              <option value="fora" ${g === 'fora' ? 'selected' : ''}>Não entra</option>
              <option value="variavel" ${g === 'variavel' ? 'selected' : ''}>Custo variável (operacional)</option>
              <option value="fixo" ${g === 'fixo' ? 'selected' : ''}>Custo fixo</option>
              <option value="emprestimo" ${g === 'emprestimo' ? 'selected' : ''}>Empréstimo (devolução do valor)</option>
              <option value="fatura" ${g === 'fatura' ? 'selected' : ''}>Fatura do ML (só caixa)</option></select></td>
              <td><select data-cat="${dreEsc(n)}" class="dre-cfg-comp">${DRE_COMP.map(o => `<option value="${o[0]}" ${cc === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></td>
              ${trat ? `<td><select data-cat="${dreEsc(n)}" class="dre-cfg-bal">${trat.map(o => `<option value="${o[0]}" ${tb === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></td>` : ''}</tr>`; }).join('') || '<tr><td colspan="5" class="text-muted">Nenhuma categoria cadastrada.</td></tr>'}
          </tbody></table>
        </div>`,
        `${temOlist ? '<button class="btn-out btn" style="margin-right:auto;" onclick="dreImportarOlist(this)">Atualizar categorias do Olist</button>' : ''}<button class="btn-out btn" onclick="fecharModal(\'modal-vml\')">Cancelar</button><button class="btn" onclick="dreSalvarConfig()">Salvar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '1180px';
    }
    async function dreImportarOlist(btn){
      if(btn){ btn.disabled = true; btn.textContent = 'Buscando…'; }
      const r = typeof olistImportarCategorias === 'function' ? await olistImportarCategorias() : { erro: 'Olist não conectado' };
      dreConfigurar(r.erro ? 'Não consegui buscar as categorias: ' + dreEsc(r.erro) : r.total + ' categorias do Olist conferidas' + (r.novas ? ', ' + r.novas + ' novas' : '') + (r.mudaram ? ', ' + r.mudaram + ' com grupo atualizado' : '') + '.');
      dreDesenhar();
    }

    function dreSalvarConfig(){
      // grupo e competência primeiro: o "No DRE" abaixo compara com o padrão do grupo já atualizado
      const garante = nome => { let c = categorias.find(x => x.nome === nome); if(!c){ c = { nome, impactaDRE:false, tipoPassivo:'operacional' }; categorias.push(c); } return c; };
      document.querySelectorAll('.dre-cfg-grp').forEach(inp => { const c = garante(inp.getAttribute('data-cat')), g = inp.value.trim(); if((c.grupo || '') !== g){ c.grupo = g || null; c.grupoManual = true; } });
      document.querySelectorAll('.dre-cfg-comp').forEach(sel => { garante(sel.getAttribute('data-cat')).competencia = sel.value; });
      document.querySelectorAll('.dre-cfg-sel').forEach(sel => {
        const nome = sel.getAttribute('data-cat'), g = sel.value;
        let c = categorias.find(x => x.nome === nome);
        if(!c){ c = { nome, impactaDRE:false, tipoPassivo:'operacional' }; categorias.push(c); }
        // só grava como escolha o que difere do padrão do grupo (assim, se o grupo mudar no Olist, acompanha)
        c.dreGrupo = (c.grupo && drePadraoDoGrupo(c.grupo) === g) ? null : g;
        c.impactaDRE = g === 'fixo' || g === 'variavel';
      });
      const selBal = document.querySelectorAll('.dre-cfg-bal');
      if(selBal.length && typeof comprasCfg !== 'undefined'){
        comprasCfg.balanco = comprasCfg.balanco || {}; comprasCfg.balanco.tipos = comprasCfg.balanco.tipos || {};
        selBal.forEach(sel => { comprasCfg.balanco.tipos[String(sel.getAttribute('data-cat')).trim().toLowerCase()] = sel.value; });
      }
      const modo = document.getElementById('dre-cfg-fatura');
      if(modo && typeof ftModoMudar === 'function'){ const ligou = modo.value === 'auto' && !ftAuto(); ftModoMudar(modo.value); if(ligou) ftMarcarSugeridas(); }
      salvar();
      fecharModal('modal-vml');
      dreDesenhar();
      if(typeof gf !== 'undefined') gf.html = null;
      if(typeof renderCategorias === 'function') renderCategorias();
      if(typeof balDesenhar === 'function' && document.getElementById('bal-host')) try { balDesenhar(); } catch(e){}
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
