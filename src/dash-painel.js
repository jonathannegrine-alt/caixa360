// ===== DASHBOARD — PAINEL "CAIXA PROJETADO" =====
// Substitui o velocímetro de score: mostra o saldo dia a dia nos próximos N dias,
// as entradas (confirmadas ML + projeção) e as saídas (contas a pagar).
// Usa as mesmas regras do Fluxo de Caixa: getEntrada(), getPag() e planilhaMode.

    let painelDias = parseInt(localStorage.getItem('mk_painel_dias') || '30');
    let painelSerie = [];

    function painelCompacto(v){
      const a = Math.abs(v), s = v < 0 ? '-' : '';
      if(a >= 1e6) return s + 'R$ ' + (a / 1e6).toLocaleString('pt-BR', {maximumFractionDigits:2}) + ' mi';
      if(a >= 1e3) return s + 'R$ ' + (a / 1e3).toLocaleString('pt-BR', {maximumFractionDigits:a >= 1e5 ? 0 : 1}) + ' mil';
      return s + 'R$ ' + a.toLocaleString('pt-BR', {maximumFractionDigits:0});
    }

    function painelCalcular(dias){
      const hoje = getToday();
      const projetado = planilhaMode !== 'confirmado';
      let saldo = saldoAtual;
      const serie = [];
      for(let i = 0; i < dias; i++){
        const data = addDias(hoje, i);
        const e = getEntrada(data);
        const conf = e.conf, proj = projetado ? e.proj : 0;
        const saida = getPag(data);
        saldo += conf + proj - saida;
        serie.push({ data, conf, proj, saida, saldo });
      }
      return serie;
    }

    function setPainelDias(n){
      painelDias = n;
      localStorage.setItem('mk_painel_dias', String(n));
      renderPainelCaixa();
    }

    function renderPainelCaixa(){
      // Desenha em todos os painéis da página ativa (Início e Dashboard usam o mesmo)
      const hosts = document.querySelectorAll('.view.active .pc-host');
      if(!hosts.length) return;
      const oculto = typeof dsAtivo === 'function' && dsAtivo();
      hosts.forEach(h => { h.style.display = oculto ? 'none' : ''; if(h.parentElement) h.parentElement.classList.toggle('pc-off', oculto); if(oculto) h.innerHTML = ''; });
      if(oculto) return;
      const serie = painelSerie = painelCalcular(painelDias);
      const n = serie.length;
      const tot = serie.reduce((a,d) => { a.conf += d.conf; a.proj += d.proj; a.saida += d.saida; return a; }, {conf:0, proj:0, saida:0});
      const fim = serie[n - 1].saldo;
      // menor saldo do período — o saldo de agora também conta
      const piorDia = serie.reduce((m,d) => d.saldo < m.saldo ? d : m, serie[0]);
      const pior = saldoAtual < piorDia.saldo ? { data: serie[0].data, saldo: saldoAtual, agora: true } : piorDia;
      const variacao = fim - saldoAtual;
      const reserva = Number(reservaMinima) || 0;
      const abaixoReserva = reserva > 0 ? serie.find(d => d.saldo < reserva) : null;
      const negativo = serie.find(d => d.saldo < 0);

      // ----- gráfico (SVG) -----
      const W = 1000, H = 310, mL = 70, mR = 14, top = 14, hLinha = 170, yBar0 = 232, hBar = 44;
      const larg = W - mL - mR, passo = larg / n;
      const xs = i => mL + passo * (i + 0.5);
      const valores = serie.map(d => d.saldo).concat([saldoAtual]);
      if(reserva > 0) valores.push(reserva);
      let vMin = Math.min(...valores), vMax = Math.max(...valores);
      const temNegativo = vMin < 0;
      if(vMin > 0 && vMin < vMax * 0.35) vMin = 0;
      if(vMax === vMin){ vMax += 1; vMin -= 1; }
      const folga = (vMax - vMin) * 0.1; vMax += folga;
      vMin = temNegativo ? vMin - folga : Math.max(0, vMin - folga);   // sem negativo, o eixo não desce de zero
      const y = v => top + (vMax - v) / (vMax - vMin) * hLinha;
      const pts = serie.map((d,i) => `${xs(i).toFixed(1)},${y(d.saldo).toFixed(1)}`);
      const linha = 'M' + pts.join(' L');
      const area = `M${xs(0).toFixed(1)},${(top + hLinha).toFixed(1)} L${pts.join(' L')} L${xs(n - 1).toFixed(1)},${(top + hLinha).toFixed(1)} Z`;
      // escalas separadas: uma conta grande não achata as barras de entrada
      const maxEnt = Math.max(1, ...serie.map(d => d.conf + d.proj));
      const maxSai = Math.max(1, ...serie.map(d => d.saida));
      const lb = Math.max(2, Math.min(18, passo * 0.62));
      const barras = serie.map((d,i) => {
        const x = xs(i) - lb / 2;
        const hc = d.conf / maxEnt * hBar, hp = d.proj / maxEnt * hBar, hs = d.saida / maxSai * hBar * 0.8;
        return (hc > 0 ? `<rect class="pc-conf" x="${x.toFixed(1)}" y="${(yBar0 - hc).toFixed(1)}" width="${lb.toFixed(1)}" height="${hc.toFixed(1)}" rx="2"/>` : '')
          + (hp > 0 ? `<rect class="pc-proj" x="${x.toFixed(1)}" y="${(yBar0 - hc - hp).toFixed(1)}" width="${lb.toFixed(1)}" height="${hp.toFixed(1)}" rx="2"/>` : '')
          + (hs > 0 ? `<rect class="pc-saida" x="${x.toFixed(1)}" y="${(yBar0 + 2).toFixed(1)}" width="${lb.toFixed(1)}" height="${hs.toFixed(1)}" rx="2"/>` : '');
      }).join('');
      const grade = [0, 0.5, 1].map(f => {
        const v = vMin + (vMax - vMin) * f, yy = y(v);
        return `<line class="pc-grade" x1="${mL}" x2="${W - mR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/><text class="pc-eixo" x="${mL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${painelCompacto(v)}</text>`;
      }).join('');
      const cada = Math.max(1, Math.ceil(n / 10));
      const eixoX = serie.map((d,i) => (i % cada === 0 || i === n - 1) ? `<text class="pc-eixo" x="${xs(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${d.data.substring(8,10)}/${d.data.substring(5,7)}</text>` : '').join('');
      const iPior = Math.max(0, serie.indexOf(pior));

      const atalhos = [15, 30, 60, 90];
      const cor = v => v >= 0 ? 'var(--success)' : 'var(--danger)';
      const html = `
        <div class="card pc-card">
          <div class="card-header">
            <div>
              <div class="card-title">Caixa projetado</div>
              <div class="pg-sub">Saldo dia a dia com o que já está confirmado no ML${planilhaMode !== 'confirmado' ? ', a projeção de vendas' : ''} e as contas a pagar.</div>
            </div>
            <div class="chips">${atalhos.map(d => `<button class="chip ${painelDias === d ? 'active' : ''}" onclick="setPainelDias(${d})">${d} dias</button>`).join('')}</div>
          </div>
          <div class="card-body">
            <div class="pc-metricas">
              <div><span>Saldo hoje</span><b>${fmt(saldoAtual)}</b></div>
              <div><span>Entradas previstas</span><b style="color:var(--success)">+ ${fmt(tot.conf + tot.proj)}</b><small>${fmt(tot.conf)} confirmado${tot.proj > 0 ? ' · ' + fmt(tot.proj) + ' projetado' : ''}</small></div>
              <div><span>Contas a pagar</span><b style="color:var(--danger)">− ${fmt(tot.saida)}</b></div>
              <div><span>Saldo em ${ptDate(serie[n - 1].data).substring(0,5)}</span><b style="color:${cor(fim)}">${fmt(fim)}</b><small style="color:${cor(variacao)}">${variacao >= 0 ? '▲' : '▼'} ${fmt(Math.abs(variacao))} no período</small></div>
              <div><span>Menor saldo</span><b style="color:${pior.saldo < 0 ? 'var(--danger)' : (reserva > 0 && pior.saldo < reserva ? 'var(--warning)' : 'var(--text)')}">${fmt(pior.saldo)}</b><small>${pior.agora ? 'é o saldo de hoje' : 'em ' + ptDate(pior.data).substring(0,5)}</small></div>
            </div>
            ${negativo ? `<div class="alert alert-danger" style="margin:14px 0 0;">O caixa fica <b>negativo em ${ptDate(negativo.data)}</b>. Antecipe recebíveis ou renegocie contas antes dessa data.</div>`
              : (abaixoReserva ? `<div class="alert alert-warning" style="margin:14px 0 0;">O saldo fica <b>abaixo da reserva mínima (${fmt(reserva)}) em ${ptDate(abaixoReserva.data)}</b>.</div>` : '')}
            <div class="pc-graf">
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" onmousemove="painelHover(event, this)" onmouseleave="painelHover(null, this)">
                <defs><linearGradient id="pc-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".32"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>
                ${grade}
                ${reserva > 0 ? `<line class="pc-reserva" x1="${mL}" x2="${W - mR}" y1="${y(reserva).toFixed(1)}" y2="${y(reserva).toFixed(1)}"/>` : ''}
                ${temNegativo ? `<line class="pc-zero" x1="${mL}" x2="${W - mR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>` : ''}
                <path d="${area}" fill="url(#pc-grad)"/>
                <path class="pc-linha" d="${linha}"/>
                ${pior.agora ? '' : `<circle class="pc-ponto-pior" cx="${xs(iPior).toFixed(1)}" cy="${y(pior.saldo).toFixed(1)}" r="5"/>`}
                <line class="pc-grade" x1="${mL}" x2="${W - mR}" y1="${yBar0 + 1}" y2="${yBar0 + 1}"/>
                ${barras}
                ${eixoX}
                <line class="pc-cursor" x1="0" x2="0" y1="${top}" y2="${yBar0 + hBar + 4}" style="display:none"/>
              </svg>
              <div class="pc-tip" style="display:none"></div>
            </div>
            <div class="pc-legenda">
              <span><i style="background:#6366f1"></i>Saldo projetado</span>
              <span><i style="background:#10b981"></i>Entrada confirmada ML</span>
              ${planilhaMode !== 'confirmado' ? '<span><i style="background:var(--proj)"></i>Entrada projetada</span>' : ''}
              <span><i style="background:#ef4444"></i>Contas a pagar</span>
              ${reserva > 0 ? '<span><i style="background:#f59e0b"></i>Reserva mínima</span>' : ''}
              <span class="text-muted" style="margin-left:auto;">Passe o mouse no gráfico para ver cada dia</span>
            </div>
          </div>
        </div>`;
      hosts.forEach(el => { el.innerHTML = html; el.dataset.geo = JSON.stringify({ W, mL, mR, n }); });
    }

    function painelHover(ev, svg){
      const host = svg.closest('.pc-host');
      if(!host) return;
      const tip = host.querySelector('.pc-tip'), cur = host.querySelector('.pc-cursor'), box = host.querySelector('.pc-graf');
      if(!tip || !cur || !box) return;
      if(!ev){ tip.style.display = 'none'; cur.style.display = 'none'; return; }
      const g = JSON.parse(host.dataset.geo || '{}');
      const r = box.querySelector('svg').getBoundingClientRect();
      const xv = (ev.clientX - r.left) / r.width * g.W;
      const i = Math.floor((xv - g.mL) / ((g.W - g.mL - g.mR) / g.n));
      const d = painelSerie[i];
      if(!d){ tip.style.display = 'none'; cur.style.display = 'none'; return; }
      const xc = g.mL + (g.W - g.mL - g.mR) / g.n * (i + 0.5);
      cur.setAttribute('x1', xc); cur.setAttribute('x2', xc); cur.style.display = '';
      const dia = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][parseDate(d.data).getDay()];
      const ant = i > 0 && painelSerie[i - 1] ? painelSerie[i - 1].saldo : null, var1 = ant == null ? null : d.saldo - ant;
      tip.innerHTML = `<b>${dia}, ${ptDate(d.data)}</b>
        <div class="tot" style="border-top:0;margin-top:2px;padding-top:0;"><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#6366f1;margin-right:6px;"></i>Saldo projetado</span><span style="color:${d.saldo < 0 ? 'var(--danger)' : '#6366f1'}">${fmt(d.saldo)}</span></div>
        ${var1 == null ? '' : `<div><span>Variação no dia</span><span style="color:${var1 < 0 ? 'var(--danger)' : 'var(--success)'}">${var1 < 0 ? '− ' : '+ '}${fmt(Math.abs(var1))}</span></div>`}
        <div><span>Entrada confirmada</span><span style="color:var(--success)">${fmt(d.conf)}</span></div>
        ${d.proj > 0 ? `<div><span>Entrada projetada</span><span style="color:var(--proj)">${fmt(d.proj)}</span></div>` : ''}
        <div><span>Contas a pagar</span><span style="color:var(--danger)">${fmt(d.saida)}</span></div>`;
      tip.style.display = 'block';
      const px = xc / g.W * r.width;
      tip.style.left = Math.min(Math.max(8, px + 14), r.width - tip.offsetWidth - 8) + 'px';
      if(px + 14 + tip.offsetWidth > r.width - 8) tip.style.left = Math.max(8, px - tip.offsetWidth - 14) + 'px';
    }
