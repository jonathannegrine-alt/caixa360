// ===== INÍCIO — visão geral do negócio =====
// Junta numa tela: caixa, recebíveis do ML, vendas, contas a vencer e alertas.
// Vendas: usa a tabela vendas_ml quando houver dados; senão, os recebimentos
// liberados do extrato histórico (extratoHistorico).

    let inicioVendas = null;          // { porDia:{data:{val,qtd}}, top:[{sku,titulo,un,val}], em } — de vendas_ml
    let inicioVendasCarregando = false;

    function iniEsc(s){
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Resumo de vendas dos últimos 30 dias a partir de vendas_ml (em segundo plano, 1x a cada 10 min)
    async function inicioCarregarVendas(){
      if(!usuarioAtual || inicioVendasCarregando) return;
      if(inicioVendas && Date.now() - inicioVendas.em < 10 * 60 * 1000) return;
      inicioVendasCarregando = true;
      try {
        const de = addDias(getToday(), -29);
        const rows = [];
        for(let from = 0; from < 40000; from += 1000){
          const { data, error } = await supa.from('vendas_ml').select('data_venda,preco_unit,qtd,status,sku,titulo')
            .eq('usuario_id', usuarioAtual.id).gte('data_venda', de + 'T00:00:00-03:00')
            .order('data_venda', {ascending:false}).range(from, from + 999);
          if(error || !data || !data.length) break;
          rows.push(...data);
          if(data.length < 1000) break;
        }
        const porDia = {}, sk = {};
        rows.filter(r => r.status === 'paid').forEach(r => {
          const dia = new Date(new Date(r.data_venda).getTime() - 3 * 3600000).toISOString().substring(0,10);
          const qtd = Number(r.qtd) || 1, val = (Number(r.preco_unit) || 0) * qtd;
          if(!porDia[dia]) porDia[dia] = { val:0, qtd:0 };
          porDia[dia].val += val; porDia[dia].qtd += 1;
          const k = r.sku || '(sem SKU)';
          if(!sk[k]) sk[k] = { sku:k, titulo:r.titulo || '', un:0, val:0 };
          sk[k].un += qtd; sk[k].val += val;
        });
        inicioVendas = { porDia, top: Object.values(sk).sort((a,b) => b.val - a.val).slice(0,5), em: Date.now(), tem: rows.length > 0 };
      } catch(e){
        inicioVendas = { porDia:{}, top:[], em: Date.now(), tem:false };
      }
      inicioVendasCarregando = false;
      if(document.getElementById('view-inicio').classList.contains('active')) renderInicio();
    }

    function inicioSerieVendas(){
      const hoje = getToday();
      const usaVendas = !!(inicioVendas && inicioVendas.tem);
      const mapa = {};
      if(usaVendas) Object.keys(inicioVendas.porDia).forEach(d => { mapa[d] = inicioVendas.porDia[d]; });
      else extratoHistorico.forEach(e => { mapa[e.data] = { val: Number(e.val_liquido) || 0, qtd: Number(e.qtd_pedidos) || 0 }; });
      const dias = [];
      for(let i = 59; i >= 0; i--){ const d = addDias(hoje, -i); dias.push({ data:d, val:(mapa[d] || {}).val || 0, qtd:(mapa[d] || {}).qtd || 0 }); }
      return { usaVendas, atual: dias.slice(30), anterior: dias.slice(0,30) };
    }

    function renderInicio(){
      const el = document.getElementById('view-inicio');
      if(!el) return;
      inicioCarregarVendas();

      const hoje = getToday(), agora = new Date();
      const h = agora.getHours();
      const saud = h < 12 ? 'Bom dia' : (h < 18 ? 'Boa tarde' : 'Boa noite');
      const dataExt = agora.toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' });

      // ----- financeiro -----
      const aReceber = liberacoes.filter(l => l.data > hoje).reduce((s,l) => s + l.val, 0) + getHojeTotal();
      const receber7 = liberacoes.filter(l => l.data > hoje && l.data <= addDias(hoje, 7)).reduce((s,l) => s + l.val, 0) + getHojeTotal();
      const abertas = pagamentos.filter(p => !p.pago);
      const atrasadas = abertas.filter(p => p.data < hoje);
      const valAtras = atrasadas.reduce((s,p) => s + p.val, 0);
      const pagar7 = abertas.filter(p => p.data >= hoje && p.data <= addDias(hoje, 7));
      const valPagar7 = pagar7.reduce((s,p) => s + p.val, 0);
      const proximas = abertas.filter(p => p.data >= hoje).sort((a,b) => a.data.localeCompare(b.data)).slice(0, 6);
      const serieCaixa = painelCalcular(30);
      const fim30 = serieCaixa[29].saldo;
      const pior = serieCaixa.reduce((m,d) => d.saldo < m.saldo ? d : m, serieCaixa[0]);
      const negativo = serieCaixa.find(d => d.saldo < 0);

      // ----- vendas -----
      const sv = inicioSerieVendas();
      const soma = a => a.reduce((s,d) => s + d.val, 0);
      const tot30 = soma(sv.atual), totAnt = soma(sv.anterior);
      const varVendas = totAnt > 0 ? (tot30 - totAnt) / totAnt * 100 : null;
      const ult7 = sv.atual.slice(23), media7 = soma(ult7) / 7;
      const qtd30 = sv.atual.reduce((s,d) => s + d.qtd, 0);
      const vHoje = sv.atual[29], vOntem = sv.atual[28];
      const melhor = sv.atual.reduce((m,d) => d.val > m.val ? d : m, sv.atual[0]);
      const rotVendas = sv.usaVendas ? 'Vendas' : 'Recebimentos de vendas';

      // gráfico de barras de vendas (30 dias)
      const maxV = Math.max(1, ...sv.atual.map(d => d.val));
      const barras = sv.atual.map((d,i) => {
        const hgt = d.val / maxV * 100, fds = [0,6].includes(parseDate(d.data).getDay());
        return `<div class="ini-bar ${i === 29 ? 'hoje' : ''} ${fds ? 'fds' : ''}" title="${ptDate(d.data)} · ${fmt(d.val)}${d.qtd ? ' · ' + d.qtd + ' pedidos' : ''}"><i style="height:${Math.max(2, hgt).toFixed(1)}%"></i></div>`;
      }).join('');

      // próximas liberações (7 dias)
      const libs = [];
      for(let i = 0; i < 7; i++){ const d = addDias(hoje, i); libs.push({ data:d, val: getEntrada(d).conf }); }
      const maxL = Math.max(1, ...libs.map(l => l.val));
      const diaSem = d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][parseDate(d).getDay()];

      // ----- alertas -----
      const alertas = [];
      if(negativo) alertas.push({ t:'danger', i:'!', tx:`Caixa fica <b>negativo em ${ptDate(negativo.data)}</b> na projeção de 30 dias.`, ac:"nav('planilha')", la:'Ver fluxo' });
      else if((Number(reservaMinima) || 0) > 0 && pior.saldo < reservaMinima) alertas.push({ t:'warning', i:'!', tx:`Saldo cai abaixo da reserva mínima em <b>${ptDate(pior.data)}</b> (${fmt(pior.saldo)}).`, ac:"nav('planilha')", la:'Ver fluxo' });
      if(atrasadas.length) alertas.push({ t:'danger', i:'⏰', tx:`<b>${atrasadas.length} conta${atrasadas.length > 1 ? 's' : ''} em atraso</b> somando ${fmt(valAtras)}.`, ac:"nav('pagar')", la:'Regularizar' });
      if(pagar7.length) alertas.push({ t:'info', i:'📅', tx:`<b>${pagar7.length} conta${pagar7.length > 1 ? 's' : ''}</b> vence${pagar7.length > 1 ? 'm' : ''} nos próximos 7 dias: ${fmt(valPagar7)}.`, ac:"nav('pagar')", la:'Ver contas' });
      if(varVendas !== null && Math.abs(varVendas) >= 8) alertas.push({ t: varVendas > 0 ? 'ok' : 'warning', i: varVendas > 0 ? '▲' : '▼', tx:`${rotVendas} ${varVendas > 0 ? 'cresceram' : 'caíram'} <b>${Math.abs(varVendas).toFixed(1).replace('.', ',')}%</b> nos últimos 30 dias contra os 30 anteriores.`, ac:"nav('resultado')", la:'Ver resultado' });
      const semCusto = skus.filter(s => !(Number(s.custo) > 0)).length;
      if(semCusto) alertas.push({ t:'warning', i:'⚖', tx:`<b>${semCusto} produto${semCusto > 1 ? 's' : ''} sem custo</b> cadastrado — a margem fica superestimada.`, ac:"nav('skus')", la:'Cadastrar' });
      const ultSync = parseInt(localStorage.getItem('mk_ultimo_sync_ml') || '0');
      if(ultSync && Date.now() - ultSync > 6 * 3600000) alertas.push({ t:'info', i:'↻', tx:`Dados do Mercado Livre atualizados há mais de 6 horas.`, ac:'sincronizarML()', la:'Atualizar' });
      if(!alertas.length) alertas.push({ t:'ok', i:'✓', tx:'Tudo em ordem: sem contas atrasadas e caixa positivo nos próximos 30 dias.', ac:'', la:'' });

      const atalhos = [
        ['planilha','Fluxo de Caixa','Entradas e saídas dia a dia'], ['pagar','Contas a pagar','Lançar e dar baixa'],
        ['vendas','Vendas','Pedidos com margem'], ['resumo-fin','Resumo Financeiro','Receita, custos e margem'],
        ['estoque','Estoque','Full, galpão e reposição'], ['resultado','Resultado','DRE e comparativo mensal']
      ];
      const icoDe = p => { const n = document.querySelector(`.nav-item[onclick="nav('${p}')"] svg`); return n ? n.outerHTML : ''; };
      const seta = v => v === null ? '' : `<span class="ini-var ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1).replace('.', ',')}%</span>`;

      el.innerHTML = `
        <div class="ini-hero">
          <div class="ini-hero-txt">
            <div class="ini-data">${dataExt}</div>
            <div class="ini-saud">${saud}! 👋</div>
            <div class="ini-sub">Este é o resumo do seu negócio agora.</div>
            <div class="ini-acoes">
              <button onclick="nav('pagar');abrirModalLanc();">+ Conta a pagar</button>
              <button onclick="sincronizarML();this.textContent='Atualizando…';">↻ Atualizar Mercado Livre</button>
              <button onclick="nav('vendas')">Ver vendas</button>
            </div>
          </div>
          <div class="ini-hero-saldo">
            <span>Saldo em caixa</span>
            <b>${fmt(saldoAtual)}</b>
            <small>Em 30 dias: <b>${fmt(fim30)}</b> ${seta(saldoAtual ? (fim30 - saldoAtual) / Math.abs(saldoAtual) * 100 : null)}</small>
            <small class="link" onclick="nav('dashboard')">Atualizar saldos →</small>
          </div>
        </div>

        <div class="kpi-grid k4i">
          <div class="kpi k-mc" onclick="nav('receber')" style="cursor:pointer;">
            <div class="kpi-label">A receber do Mercado Livre</div><div class="kpi-value">${fmt(aReceber)}</div>
            <div class="kpi-sub"><span>Próximos 7 dias <b>${fmt(receber7)}</b></span></div></div>
          <div class="kpi k-custo" onclick="nav('pagar')" style="cursor:pointer;">
            <div class="kpi-label">Contas a pagar · 7 dias</div><div class="kpi-value">${fmt(valPagar7)}</div>
            <div class="kpi-sub"><span>${pagar7.length} conta${pagar7.length === 1 ? '' : 's'}</span>${atrasadas.length ? `<span style="color:var(--danger)"><b style="color:inherit">${atrasadas.length}</b> em atraso (${fmt(valAtras)})</span>` : '<span>nenhuma em atraso</span>'}</div></div>
          <div class="kpi k-venda" onclick="nav('${sv.usaVendas ? 'vendas' : 'receber'}')" style="cursor:pointer;">
            <div class="kpi-label">${rotVendas} · 30 dias</div><div class="kpi-value">${fmt(tot30)}</div>
            <div class="kpi-sub">${seta(varVendas)}<span>vs. 30 dias anteriores</span></div></div>
          <div class="kpi k-frete">
            <div class="kpi-label">${sv.usaVendas ? 'Vendas hoje' : 'Liberado hoje'}</div><div class="kpi-value">${fmt(vHoje.val)}</div>
            <div class="kpi-sub"><span>Ontem <b>${fmt(vOntem.val)}</b></span><span>Média 7d <b>${fmt(media7)}</b></span></div></div>
        </div>

        <div class="ini-grid">
          <div class="pc-host"></div>
          <div class="card">
            <div class="card-header"><div class="card-title">Precisa da sua atenção</div></div>
            <div class="card-body ini-alertas">
              ${alertas.map(a => `<div class="ini-alerta ${a.t}"><span class="ic">${a.i}</span><div><div>${a.tx}</div>${a.la ? `<a onclick="${a.ac}">${a.la} →</a>` : ''}</div></div>`).join('')}
            </div>
          </div>
        </div>

        <div class="ini-grid">
          <div class="card">
            <div class="card-header">
              <div><div class="card-title">${rotVendas} — últimos 30 dias</div>
              <div class="pg-sub">${sv.usaVendas ? 'Valor dos produtos das vendas aprovadas.' : 'Valor líquido das vendas liberado pelo Mercado Pago em cada dia.'}</div></div>
              <div style="text-align:right;"><div class="ini-num">${fmt(tot30)}</div>${seta(varVendas)}</div>
            </div>
            <div class="card-body">
              <div class="ini-bars">${barras}</div>
              <div class="ini-bars-eixo"><span>${ptDate(sv.atual[0].data).substring(0,5)}</span><span>${ptDate(sv.atual[14].data).substring(0,5)}</span><span>hoje</span></div>
              <div class="ini-mini">
                <div><span>Média por dia</span><b>${fmt(tot30 / 30)}</b></div>
                <div><span>Melhor dia</span><b>${fmt(melhor.val)}</b><small>${ptDate(melhor.data).substring(0,5)}</small></div>
                <div><span>Pedidos</span><b>${qtd30.toLocaleString('pt-BR')}</b></div>
                <div><span>Ticket médio</span><b>${fmt(qtd30 ? tot30 / qtd30 : 0)}</b></div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Próximos vencimentos</div><a class="ini-link" onclick="nav('pagar')">Ver todas →</a></div>
            <div class="card-body" style="padding:6px 20px 14px;">
              ${atrasadas.length ? `<div class="ini-venc atras" onclick="nav('pagar')"><div class="dt"><b>!</b><small>atraso</small></div><div class="ds"><b>${atrasadas.length} conta${atrasadas.length > 1 ? 's' : ''} em atraso</b><small>desde ${ptDate(atrasadas.reduce((m,p) => p.data < m ? p.data : m, atrasadas[0].data))}</small></div><div class="vl">${fmt(valAtras)}</div></div>` : ''}
              ${proximas.length ? proximas.map(p => {
                const dd = diasDif(hoje, p.data);
                return `<div class="ini-venc" onclick="nav('pagar')"><div class="dt"><b>${p.data.substring(8,10)}</b><small>${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][parseInt(p.data.substring(5,7)) - 1]}</small></div>
                  <div class="ds"><b>${iniEsc(p.desc || p.forn || 'Conta')}</b><small>${iniEsc(p.forn || p.cat || '')}${p.forn || p.cat ? ' · ' : ''}${dd === 0 ? 'vence hoje' : (dd === 1 ? 'amanhã' : 'em ' + dd + ' dias')}</small></div>
                  <div class="vl">${fmt(p.val)}</div></div>`;
              }).join('') : (atrasadas.length ? '' : '<div class="vazio" style="padding:26px 0;"><b>Nenhuma conta em aberto</b>Lance suas contas para acompanhar os vencimentos.</div>')}
            </div>
          </div>
        </div>

        <div class="ini-grid">
          <div class="card">
            <div class="card-header"><div class="card-title">Liberações confirmadas — próximos 7 dias</div><a class="ini-link" onclick="nav('receber')">A receber ML →</a></div>
            <div class="card-body">
              ${libs.map(l => `<div class="ini-lib"><span class="d">${l.data === hoje ? 'Hoje' : diaSem(l.data) + ' ' + l.data.substring(8,10) + '/' + l.data.substring(5,7)}</span><div class="b"><i style="width:${(l.val / maxL * 100).toFixed(1)}%"></i></div><span class="v">${fmt(l.val)}</span></div>`).join('')}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">${inicioVendas && inicioVendas.top.length ? 'Produtos que mais venderam (30 dias)' : 'Atalhos'}</div></div>
            <div class="card-body">
              ${inicioVendas && inicioVendas.top.length
                ? inicioVendas.top.map((t,i) => `<div class="ini-top"><span class="pos">${i + 1}</span><div class="ds"><b>${iniEsc(t.sku)}</b><small>${iniEsc(t.titulo)}</small></div><div class="vl"><b>${fmt(t.val)}</b><small>${t.un} un.</small></div></div>`).join('')
                : `<div class="ini-atalhos">${atalhos.map(([p,t,d]) => `<div class="ini-atalho" onclick="nav('${p}')">${icoDe(p)}<div><b>${t}</b><small>${d}</small></div></div>`).join('')}</div>`}
            </div>
          </div>
        </div>`;
      renderPainelCaixa();
    }
