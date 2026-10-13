// ===== ADMINISTRAÇÃO DO SISTEMA (só para quem está em app_admin) =====
// Botão "Administração" no rodapé do menu. Abre um painel com: contas e uso, cobrança simulada (planos por faixa de
// pedidos), cupons individuais, saúde e capacidade do servidor, sugestões e erros dos usuários.
// Dados: RPC admin_painel. Fase 1 da cobrança: nada é cobrado de verdade; mostra quanto cada conta pagaria.
    let adm = { d: null, aba: 'contas', erro: '' };
    const admE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const admData = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
    const admQuando = d => { if(!d) return 'nunca'; const h = (Date.now() - new Date(d).getTime()) / 3600000; return h < 1 ? 'há menos de 1 h' : h < 48 ? 'há ' + Math.round(h) + ' h' : 'há ' + Math.round(h / 24) + ' dias'; };
    const admR = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const admN = v => (Number(v) || 0).toLocaleString('pt-BR');
    const ADM_SIT = { cortesia: 'Cortesia', teste: 'Teste grátis', cupom: 'Cupom 100%', desconto: 'Com desconto', 'a cobrar': 'A cobrar', 'sem loja': 'Sem loja conectada', 'aguardando acesso': 'Teste começa no próximo acesso' };
    const admDica = t => typeof dica === 'function' ? ' ' + dica(t) : '';

    async function admBotao(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || document.getElementById('adm-botao') || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      let ok = false; try { ok = !!(await supa.rpc('eh_admin')).data; } catch(e){}
      const tema = document.querySelector('.tema-toggle'); if(!ok || !tema) return;
      const b = document.createElement('button'); b.id = 'adm-botao'; b.className = tema.className; b.title = 'Contas, cobrança, cupons e saúde do servidor'; b.onclick = admAbrir;
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 4.5-3.2 8-8 9-4.800-1-8-4.500-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg><span>Administração</span>';
      tema.insertAdjacentElement('afterend', b);
    }
    async function admCarregar(){
      adm.erro = '';
      try { const r = await supa.rpc('admin_painel'); if(r.error) adm.erro = r.error.message; else { adm.d = r.data; const c = await supa.rpc('admin_cfg_ler'); adm.d.cfg = (c && c.data) || {}; } } catch(e){ adm.erro = (e && e.message) || String(e); }
    }
    async function admAbrir(){
      if(typeof vmlModal !== 'function') return;
      vmlModal('Administração do sistema', '<div class="text-muted">Carregando…</div>', '<button class="btn" onclick="fecharModal(\'modal-vml\')">Fechar</button>');
      await admCarregar(); admDesenhar();
    }
    function admAba(a){ adm.aba = a; admDesenhar(); }
    function admDesenhar(){
      const c = document.querySelector('#modal-vml .modal-body') || document.getElementById('vml-corpo') || document.querySelector('#modal-vml .modal-content'); if(!c) return;
      const d = adm.d;
      if(adm.erro || !d){ c.innerHTML = `<div class="alert alert-warning">${admE(adm.erro || 'Sem dados.')}</div>`; return; }
      const abas = [['contas', 'Contas e cobrança'], ['cupons', 'Cupons'], ['planos', 'Planos'], ['servidor', 'Servidor'], ['retorno', 'Sugestões e erros']];
      const corpo = adm.aba === 'cupons' ? admCupons(d) : adm.aba === 'planos' ? admPlanos(d) : adm.aba === 'servidor' ? admServidor(d) : adm.aba === 'retorno' ? admRetorno(d) : admContas(d);
      c.innerHTML = `<div class="adm-abas">${abas.map(a => `<button class="${adm.aba === a[0] ? 'ativa' : ''}" onclick="admAba('${a[0]}')">${a[1]}</button>`).join('')}</div>${corpo}`;
    }
    function admContas(d){
      const L = d.contas || [], cap = d.capacidade || {}, comLoja = L.filter(x => (x.lojas || []).length);
      const receita = comLoja.reduce((s, x) => s + (Number(x.cobranca.a_pagar) || 0), 0), tabela = comLoja.filter(x => x.cobranca.situacao !== 'cortesia').reduce((s, x) => s + (Number(x.cobranca.preco_tabela) || 0), 0);
      return `<div class="adm-nums"><div><small>Contas com loja</small><b>${comLoja.length}</b></div><div><small>Pedidos em 30 dias</small><b>${admN(cap.pedidos_30d)}</b></div><div><small>Valor do mês, somado</small><b>${admR(tabela)}</b></div><div><small>A receber hoje, por mês</small><b>${admR(receita)}</b></div></div>
        <div class="adm-tab"><table><thead><tr><th>Conta</th><th>Lojas</th><th>Último acesso</th><th style="text-align:right;">Pedidos 30 d</th><th>Plano que cabe</th><th style="text-align:right;">Valor do mês</th><th>Situação</th><th style="text-align:right;">Pagaria</th><th></th></tr></thead><tbody>
        ${L.map(x => { const k = x.cobranca || {}, sem = !(x.lojas || []).length;
          return `<tr><td><b>${admE(x.email)}</b><br><small class="text-muted">desde ${admData(x.criado)} · ${admN(x.vendas_guardadas)} vendas guardadas${x.historico_dias < 360 && !sem ? ' · histórico ' + x.historico_dias + '/365 dias' : ''}</small></td>
            <td>${sem ? '<span class="text-muted">nenhuma conectada</span>' : (x.lojas || []).map(admE).join('<br>')}</td><td>${admQuando(x.ultimo_acesso)}</td>
            <td style="text-align:right;">${sem ? '—' : admN(k.pedidos_30d)}</td><td>${sem ? '—' : admE(k.plano || '')}</td><td style="text-align:right;">${sem ? '—' : admR(k.preco_tabela)}</td>
            <td>${sem ? '—' : admE(ADM_SIT[k.situacao] || k.situacao)}${k.situacao === 'teste' ? '<br><small class="text-muted">até ' + admData(k.teste_ate) + '</small>' : ''}${k.cupom ? '<br><small class="text-muted">' + admE(k.cupom) + (k.desconto_ate ? ' até ' + admData(k.desconto_ate) : '') + '</small>' : ''}</td>
            <td style="text-align:right;"><b>${sem ? '—' : admR(k.a_pagar)}</b></td>
            <td><a class="fx-link" style="cursor:pointer;" onclick="admCortesia('${x.id}', ${k.situacao !== 'cortesia'})">${k.situacao === 'cortesia' ? 'tirar cortesia' : 'dar cortesia'}</a></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="text-muted adm-nota">Nada é cobrado de verdade ainda, e ninguém é bloqueado: "Pagaria" é uma simulação. A regra do valor está na aba Planos (hoje: ${(L[0] && L[0].cobranca.modo) === 'tabela' ? 'tabela de planos' : 'rateio do custo do servidor'}). Pedidos = vendas aprovadas dos últimos 30 dias, somando as lojas da conta. O teste grátis começa no próximo acesso de cada pessoa. Para liberar alguém depois do teste, gere um cupom na aba Cupons.</div>`;
    }
    function admCupons(d){
      const L = d.cupons || [];
      return `<div class="adm-form"><label>Desconto (%)<input id="adm-cp-pct" type="number" min="1" max="100" value="100"></label><label>Vale por quantos meses<input id="adm-cp-meses" type="number" min="0" placeholder="vazio = sem prazo"></label>
          <label>Dias para usar o cupom<input id="adm-cp-dias" type="number" min="0" value="30"></label><label>E-mail da conta (opcional)<input id="adm-cp-email" type="email" placeholder="só essa conta pode usar"></label>
          <label>Anotação<input id="adm-cp-nota" placeholder="para quem é"></label><button class="btn" onclick="admCupomCriar(this)">Gerar cupom</button></div>
        <div class="adm-tab"><table><thead><tr><th>Código</th><th>Desconto</th><th>Dura</th><th>Para</th><th>Anotação</th><th>Usar até</th><th>Situação</th><th></th></tr></thead><tbody>
        ${L.map(c => `<tr><td><b style="font-family:monospace;">${admE(c.codigo)}</b></td><td>${c.desconto_pct}%</td><td>${c.meses ? c.meses + ' mês(es)' : 'sem prazo'}</td><td>${admE(c.para || 'qualquer conta')}</td><td>${admE(c.nota || '')}</td><td>${c.valido_ate ? admData(c.valido_ate) : '—'}</td>
          <td>${c.usado_em ? 'usado por ' + admE(c.usado_por || '') + ' em ' + admData(c.usado_em) : 'disponível'}</td><td>${c.usado_em ? '' : `<a class="fx-link" style="cursor:pointer;" onclick="admCopiar('${admE(c.codigo)}')">copiar</a> · <a class="fx-link" style="cursor:pointer;" onclick="admCupomApagar('${admE(c.codigo)}')">apagar</a>`}</td></tr>`).join('') || '<tr><td colspan="8" class="text-muted">Nenhum cupom gerado ainda.</td></tr>'}
        </tbody></table></div><div class="text-muted adm-nota">Cada cupom serve uma vez só. A pessoa digita o código em Configurações → Conta → Minha assinatura.</div>`;
    }
    function admPlanos(d){
      const k = ((d.contas || [])[0] || {}).cobranca || {}, cap = d.capacidade || {}, cfg = d.cfg || {};
      return `<div class="adm-form"><label>Como calcular o valor de cada conta<select id="adm-cf-modo"><option value="custo" ${cfg.modo !== 'tabela' ? 'selected' : ''}>Rateio do custo do servidor</option><option value="tabela" ${cfg.modo === 'tabela' ? 'selected' : ''}>Tabela de planos (abaixo)</option></select></label>
          <label>Custo do servidor (US$ por mês)<input id="adm-cf-usd" type="number" step="0.01" value="${cfg.custo_usd ?? 30}"></label><label>Dólar (R$)<input id="adm-cf-cambio" type="number" step="0.01" value="${cfg.cambio ?? 5.5}"></label>
          <label>Teste grátis (dias)<input id="adm-cf-teste" type="number" value="${cfg.teste_dias ?? 30}"></label><button class="btn" onclick="admCfgSalvar(this)">Salvar</button></div>
        <div class="adm-explica"><b>Como os valores são calculados</b>
          <p><b>Rateio do custo:</b> custo do servidor em reais (US$ ${cfg.custo_usd ?? 30} × R$ ${cfg.cambio ?? 5.5} = ${admR((cfg.custo_usd ?? 30) * (cfg.cambio ?? 5.5))} por mês) dividido entre as contas com loja conectada, na proporção dos pedidos dos últimos 30 dias. Quem tem 50% dos pedidos paga 50% do custo. Hoje são ${admN(cap.pedidos_30d)} pedidos no total. Não inclui o uso de IA, que é cobrado à parte.</p>
          <p><b>Tabela de planos:</b> cada conta cai na menor faixa que comporta os pedidos dos últimos 30 dias, somando as lojas dela. Cada loja além das incluídas na faixa soma o valor de "Loja extra". As faixas foram montadas olhando o que o mercado cobra por volume de pedidos (Bling de R$ 55 a R$ 650, Olist de R$ 55 a R$ 143, UpSeller R$ 45 por mil pedidos, Mercado Turbo perto de R$ 230 para 5 mil pedidos) e ficam abaixo deles. São ponto de partida: edite à vontade.</p>
          <p><b>Teto de 30 mil pedidos por mês:</b> é uma estimativa prudente do que a máquina atual aguenta processando (sincronização de vendas, envios e rotinas), não um limite medido. O espaço não é o gargalo: cada pedido ocupa cerca de 0,6 KB e o plano inclui 8 GB. Quando o uso passar de 80%, sobe-se a máquina um degrau (mais memória e processamento, cerca de US$ 5 a mais por mês); o espaço em disco é separado e cresce sozinho conforme o uso.</p></div>
        <div class="adm-tab"><table><thead><tr><th>Plano</th><th>Pedidos por mês (até)</th><th>Lojas incluídas</th><th>Mensalidade (R$)</th><th>Loja extra (R$)</th><th></th></tr></thead><tbody>
        ${(d.planos || []).map(p => `<tr><td><input id="adm-pl-n-${p.id}" value="${admE(p.nome)}" style="width:190px;"></td><td><input id="adm-pl-p-${p.id}" type="number" value="${p.pedidos_max || ''}" placeholder="sem limite" style="width:110px;"></td>
          <td><input id="adm-pl-l-${p.id}" type="number" value="${p.lojas}" style="width:70px;"></td><td><input id="adm-pl-v-${p.id}" type="number" step="0.01" value="${p.preco}" style="width:100px;"></td><td><input id="adm-pl-e-${p.id}" type="number" step="0.01" value="${p.loja_extra}" style="width:90px;"></td>
          <td><button class="btn btn-sm" onclick="admPlanoSalvar(${p.id}, this)">Salvar</button></td></tr>`).join('')}
        </tbody></table></div><div class="text-muted adm-nota">A conta cai no menor plano que comporta os pedidos dos últimos 30 dias. Cada loja além das incluídas soma o valor de "Loja extra". O uso de IA é cobrado à parte, em créditos.</div>`;
    }
    function admServidor(d){
      const c = d.capacidade || {}, S = d.saude || [], u = S[0] || {}, pc = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
      const barra = (rot, a, b, un) => `<div class="adm-barra"><div><span>${rot}</span><b>${admN(a)} de ${admN(b)} ${un} (${pc(a, b)}%)</b></div><i><em style="width:${pc(a, b)}%;${pc(a, b) > 80 ? 'background:var(--danger);' : ''}"></em></i></div>`;
      const falhas = S.reduce((s, x) => s + (Number(x.cron_falhas) || 0), 0);
      return `${barra('Pedidos por mês (todas as contas)' + admDica('Vendas aprovadas de todas as contas nos últimos 30 dias, contra o teto estimado que a máquina atual processa com folga. Perto de 80%, vale subir a máquina.'), c.pedidos_30d, c.teto, 'pedidos')}${barra('Banco de dados' + admDica('Espaço ocupado pelos dados (vendas, contas a pagar, produtos) dentro dos 8 GB incluídos no plano. Cresce devagar: cerca de 0,6 KB por pedido.'), c.banco_mb, c.banco_teto_mb, 'MB')}${barra('Arquivos (etiquetas e anexos)' + admDica('Etiquetas de envio em PDF, contratos e anexos. Ficam fora do banco, numa área de 100 GB incluída no plano.'), c.arquivos_mb, c.arquivos_teto_mb, 'MB')}
        <div class="adm-nums"><div><small>Rotinas que falharam (6 h)${admDica('Quantas rotinas automáticas (importar vendas, envios, pós-venda) não conseguiram rodar nas últimas 6 horas. O normal é zero. Acima de zero em várias leituras seguidas é o primeiro sinal de servidor sem fôlego: foi assim que a queda de 12/10 começou.')}</small><b style="${falhas ? 'color:var(--danger)' : ''}">${falhas}</b></div><div><small>Conexões agora${admDica('Quantas conexões estão abertas com o banco neste momento. O limite da máquina atual é 60. O normal fica entre 10 e 25.')}</small><b>${admN(u.conexoes)}</b></div><div><small>Resumo a refazer${admDica('Dias de venda cujo total pronto precisa ser recalculado porque chegou venda nova ou mudou custo. O sistema refaz sozinho a cada 2 minutos. Número alto por muito tempo indica fila acumulada.')}</small><b>${admN(u.resumo_pend)}</b></div><div><small>Tarefas na fila${admDica('Operações pesadas pedidas pelos usuários (nivelar custo de período longo, totais de 12 meses) esperando para rodar em segundo plano. O normal é zero ou perto disso.')}</small><b>${admN(u.tarefas_fila)}</b></div></div>
        <div class="text-muted adm-nota">Retrato gravado a cada 10 minutos (último: ${u.em ? new Date(u.em).toLocaleString('pt-BR') : '—'}). O teto de 30 mil pedidos por mês é uma estimativa prudente para a máquina atual (plano Pro, 1 GB, cerca de US$ ${c.custo_usd} por mês); perto de 80%, vale subir a máquina um degrau. Falha de rotina acima de zero por mais de uma leitura é sinal de servidor sem fôlego.</div>`;
    }
    function admRetorno(d){
      const F = d.sugestoes || [], E = d.erros || [];
      return `<div class="sino-sec">Sugestões dos usuários (${F.length})</div>${F.map(f => `<div class="adm-it"><small>${admE(f.email || '')} · ${admData(f.em)} · ${admE(f.pagina || '')}</small><div>${admE(f.mensagem)}</div></div>`).join('') || '<div class="text-muted">Nenhuma sugestão.</div>'}
        <div class="sino-sec" style="margin-top:16px;">Erros nos últimos 14 dias (${E.length})</div>${E.map(e => `<div class="adm-it"><small>${admE(e.pagina || '')} · ${e.n} vez(es) · ${e.usuarios} conta(s) · último em ${admData(e.ultimo)}</small><div>${admE(e.erro)}</div></div>`).join('') || '<div class="text-muted">Nenhum erro registrado.</div>'}`;
    }
    async function admCupomCriar(bt){
      const v = id => (document.getElementById(id) || {}).value || ''; bt.disabled = true;
      const r = await supa.rpc('admin_cupom_criar', { p_desconto: Number(v('adm-cp-pct')) || 100, p_meses: Number(v('adm-cp-meses')) || null, p_validade_dias: Number(v('adm-cp-dias')) || 0, p_email: v('adm-cp-email').trim() || null, p_nota: v('adm-cp-nota').trim() || null });
      bt.disabled = false;
      if(r.error){ if(typeof toast === 'function') toast(r.error.message); return; }
      admCopiar(r.data); await admCarregar(); admDesenhar();
    }
    async function admCupomApagar(cod){ await supa.rpc('admin_cupom_apagar', { p_codigo: cod }); await admCarregar(); admDesenhar(); }
    function admCopiar(t){ try { navigator.clipboard.writeText(t); if(typeof toast === 'function') toast('Cupom ' + t + ' copiado.'); } catch(e){} }
    async function admPlanoSalvar(id, bt){
      const v = k => (document.getElementById('adm-pl-' + k + '-' + id) || {}).value; bt.disabled = true;
      const r = await supa.rpc('admin_plano_salvar', { p_id: id, p_nome: v('n'), p_pedidos: Number(v('p')) || 0, p_lojas: Number(v('l')) || 1, p_preco: Number(v('v')) || 0, p_extra: Number(v('e')) || 0 });
      bt.disabled = false; if(typeof toast === 'function') toast(r.error ? r.error.message : 'Plano salvo.');
      await admCarregar(); admDesenhar();
    }
    async function admCfgSalvar(bt){
      const v = id => (document.getElementById(id) || {}).value; bt.disabled = true;
      const r = await supa.rpc('admin_cobranca_cfg', { p_modo: v('adm-cf-modo'), p_custo_usd: Number(v('adm-cf-usd')) || 0, p_cambio: Number(v('adm-cf-cambio')) || 0, p_teste_dias: Number(v('adm-cf-teste')) || 0 });
      bt.disabled = false; if(typeof toast === 'function') toast(r.error ? r.error.message : 'Regra de cobrança salva.');
      await admCarregar(); admDesenhar();
    }
    async function admCortesia(id, sim){ await supa.rpc('admin_cortesia', { p_usuario: id, p_sim: !!sim }); await admCarregar(); admDesenhar(); }

    // usuário comum: situação da própria assinatura e campo do cupom (aparece em Configurações → Conta)
    async function assCartao(){
      const alvo = document.getElementById('ass-cartao'); if(!alvo || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const r = await supa.rpc('minha_assinatura'); if(r.error || !r.data) return; const k = r.data;
      alvo.innerHTML = `<div class="card-title" style="margin-bottom:8px;">Minha assinatura</div>
        <div style="font-size:13px;line-height:1.7;">Plano pelo seu volume: <b>${admE(k.plano || '—')}</b> (${admN(k.pedidos_30d)} pedidos nos últimos 30 dias, ${k.lojas} loja${k.lojas === 1 ? '' : 's'}).<br>
        Situação: <b>${admE(ADM_SIT[k.situacao] || k.situacao)}</b>${k.situacao === 'teste' ? ' até ' + admData(k.teste_ate) : ''}${k.cupom ? ' · cupom ' + admE(k.cupom) : ''}. Valor do mês: <b>${admR(k.a_pagar)}</b>${Number(k.preco_tabela) !== Number(k.a_pagar) ? ' <span class="text-muted">(sem desconto: ' + admR(k.preco_tabela) + ')</span>' : ''}.</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><input id="ass-cupom" placeholder="Tem um cupom? Digite aqui" style="max-width:240px;"><button class="btn btn-out" onclick="assCupom(this)">Aplicar cupom</button></div>
        <div class="text-muted" style="font-size:12px;margin-top:8px;">Por enquanto nada é cobrado: este quadro mostra como ficaria a sua mensalidade.</div>`;
    }
    async function assCupom(bt){
      const c = (document.getElementById('ass-cupom') || {}).value || ''; if(!c.trim()) return; bt.disabled = true;
      const r = await supa.rpc('cupom_usar', { p_codigo: c }); bt.disabled = false;
      if(typeof toast === 'function') toast(r.error ? r.error.message : 'Cupom aplicado.');
      if(!r.error) assCartao();
    }
    // registra o acesso: é a partir dele que o teste grátis começa a contar
    setTimeout(() => { if(typeof usuarioAtual !== 'undefined' && usuarioAtual && !(typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) supa.rpc('assinatura_acesso').then(() => {}, () => {}); }, 9000);
    setTimeout(admBotao, 7000);
    setInterval(admBotao, 60000);

    // cartão "Minha assinatura" no fim de Configurações
    setInterval(() => {
      const v = document.getElementById('view-config');
      if(!v || !v.classList.contains('active') || document.getElementById('ass-cartao') || typeof usuarioAtual === 'undefined' || !usuarioAtual || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      const c = document.createElement('div'); c.className = 'card'; c.style.marginTop = '16px'; c.innerHTML = '<div class="card-body" id="ass-cartao"><span class="text-muted">Carregando assinatura…</span></div>';
      v.appendChild(c); assCartao();
    }, 2500);
