// ===== HISTÓRICO DA CONTA DO MERCADO LIVRE (reprocessamento pago) =====
// Conta nova carrega só os últimos 30 dias e segue dali para frente (ml_tokens.historico_desde). Para trazer meses
// mais antigos, o usuário pede aqui: a função ml-vendas conta no Mercado Livre os pedidos do período e calcula o
// preço (RPC reprocesso_valor, R$ por 1.000 pedidos). O pedido fica BLOQUEADO até o administrador autorizar na
// Administração → Histórico pago; autorizado, as rotinas de sempre buscam o período sozinhas.
// Dados: RPC conta_historico (por conta: desde, dias carregados, pedidos) e admin_reprocessos.

    let hist = { contas: {}, em: 0 };
    const HIST_SIT = { pedido: 'Aguardando autorização', autorizado: 'Autorizado', recusado: 'Recusado', cancelado: 'Cancelado' };
    const histE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const histData = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '—';
    const histR = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    async function histCarregar(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return hist.contas;
      const r = await supa.rpc('conta_historico');
      if(!r.error){ hist.contas = {}; (r.data || []).forEach(c => { hist.contas[c.ml_user_id] = c; }); hist.em = Date.now(); }
      return hist.contas;
    }

    // linha "Histórico desde…" embaixo de cada conta em Configurações → Mercado Livre
    async function histNaConfig(){
      const C = await histCarregar();
      document.querySelectorAll('.cfg-conta[data-conta]').forEach(el => {
        const c = C[el.dataset.conta]; if(!c) return;
        let ln = el.nextElementSibling;
        if(!ln || !ln.classList.contains('hist-linha')){ ln = document.createElement('div'); ln.className = 'hist-linha'; el.after(ln); }
        const aberto = (c.pedidos || []).find(p => p.situacao === 'pedido');
        const falta = Math.max(0, c.dias_previstos - c.dias_carregados);
        ln.style.cssText = 'font-size:12px;color:var(--text-muted);margin:-4px 0 6px 12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;';
        ln.innerHTML = `<span>Histórico desde <b>${histData(c.desde)}</b>${falta > 1 ? ` · carregando (${c.dias_carregados} de ${c.dias_previstos} dias)` : ''}</span>
          ${aberto ? `<span class="badge badge-warning">Pedido de histórico aguardando autorização</span>` : ''}
          <a class="fx-link" style="cursor:pointer;" onclick="histAbrir('${histE(c.ml_user_id)}')">${aberto ? 'Ver pedido' : 'Carregar histórico mais antigo'}</a>`;
      });
    }

    async function histAbrir(conta){
      await histCarregar();
      const c = hist.contas[conta]; if(!c) return;
      const ped = c.pedidos || [], aberto = ped.find(p => p.situacao === 'pedido');
      const limite = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), completo = String(c.desde) <= limite;
      vmlModal('Histórico da conta ' + (c.apelido || conta), `
        <div class="alert alert-info">Esta conta tem dados do Mercado Livre desde <b>${histData(c.desde)}</b>. Para trazer meses anteriores, peça o carregamento do histórico. O preço depende da quantidade de pedidos do período (quanto mais pedidos, mais consultas ao Mercado Livre). O carregamento começa depois que o pedido for autorizado.</div>
        ${completo ? '<div class="text-muted">Esta conta já tem os 12 meses de histórico que o Mercado Livre permite buscar.</div>' : aberto ? '' : `
        <div class="d-flex gap-1" style="align-items:flex-end;flex-wrap:wrap;margin:6px 0 12px;">
          <label class="pf-c" style="min-width:200px;"><span>Trazer o histórico de</span>
            <select id="hist-meses">${[3, 6, 12].map(m => `<option value="${m}" ${m === 12 ? 'selected' : ''}>últimos ${m} meses</option>`).join('')}</select></label>
          <button class="btn-out btn" onclick="histOrcar('${histE(conta)}', this)">Calcular o preço</button>
        </div>
        <div id="hist-orc"></div>`}
        ${ped.length ? `<div class="sino-sec" style="margin-top:10px;">Pedidos desta conta</div>
          <div class="pf-tab"><table><thead><tr><th>Pedido em</th><th>Período</th><th style="text-align:right;">Pedidos</th><th style="text-align:right;">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
          ${ped.map(p => `<tr><td>${histData(String(p.criado_em).slice(0, 10))}</td><td>${histData(p.desde)} a ${histData(p.ate)}</td><td style="text-align:right;">${(Number(p.pedidos) || 0).toLocaleString('pt-BR')}</td><td style="text-align:right;">${histR(p.valor)}</td>
            <td>${HIST_SIT[p.situacao] || p.situacao}${p.nota ? '<div class="text-muted" style="font-size:11.5px;">' + histE(p.nota) + '</div>' : ''}</td>
            <td>${p.situacao === 'pedido' ? `<a class="fx-link" style="cursor:pointer;" onclick="histCancelar(${p.id}, '${histE(conta)}')">desistir</a>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : ''}`,
        `<button class="btn" onclick="fecharModal('modal-vml')">Fechar</button>`);
    }

    async function histOrcar(conta, bt){
      const meses = Number((document.getElementById('hist-meses') || {}).value) || 12, alvo = document.getElementById('hist-orc');
      if(bt){ bt.disabled = true; bt.textContent = 'Contando os pedidos…'; }
      let d = null; try { d = (await supa.functions.invoke('ml-vendas', { body: { acao: 'hist_orcar', conta, meses } })).data; } catch(e){}
      if(bt){ bt.disabled = false; bt.textContent = 'Calcular o preço'; }
      if(!alvo) return;
      if(!d || d.error){ alvo.innerHTML = `<div class="alert alert-warning">${histE((d && d.error) || 'Não consegui falar com o servidor. Tente de novo.')}</div>`; return; }
      alvo.innerHTML = `<div class="adm-nums" style="margin-bottom:10px;"><div><small>Período</small><b>${histData(d.desde)} a ${histData(d.ate)}</b></div><div><small>Pedidos no Mercado Livre</small><b>${(Number(d.pedidos) || 0).toLocaleString('pt-BR')}</b></div><div><small>Valor</small><b>${histR(d.valor)}</b></div></div>
        <button class="btn" onclick="histPedir('${histE(conta)}', ${meses}, this)">Pedir o carregamento</button>
        <div class="text-muted" style="font-size:12px;margin-top:8px;">O pedido fica aguardando a autorização do administrador. Depois de autorizado, o histórico entra aos poucos (vendas, extrato e fatura), sem você precisar fazer nada.</div>`;
    }

    async function histPedir(conta, meses, bt){
      if(bt){ bt.disabled = true; bt.textContent = 'Enviando…'; }
      let d = null; try { d = (await supa.functions.invoke('ml-vendas', { body: { acao: 'hist_pedir', conta, meses } })).data; } catch(e){}
      if(!d || d.error){ if(bt){ bt.disabled = false; bt.textContent = 'Pedir o carregamento'; } if(typeof toast === 'function') toast((d && d.error) || 'Não consegui enviar o pedido.'); return; }
      if(typeof toast === 'function') toast('Pedido enviado. O carregamento começa quando for autorizado.');
      await histAbrir(conta); histNaConfig();
    }

    async function histCancelar(id, conta){
      await supa.rpc('reprocesso_cancelar', { p_id: id });
      await histAbrir(conta); histNaConfig();
    }

    // ---------- Administração → Histórico pago ----------
    let histAdm = null;
    async function histAdmCarregar(){
      const r = await supa.rpc('admin_reprocessos');
      histAdm = r.error ? { erro: r.error.message } : r.data;
    }
    function histAdmHtml(){
      if(!histAdm){ histAdmCarregar().then(() => { if(typeof admDesenhar === 'function') admDesenhar(); }); return '<div class="text-muted">Carregando…</div>'; }
      if(histAdm.erro) return `<div class="alert alert-warning">${histE(histAdm.erro)}</div>`;
      const cfg = histAdm.cfg || {}, L = histAdm.lista || [];
      return `<div class="adm-form"><label>R$ por 1.000 pedidos<input id="hist-cfg-mil" type="number" min="0" step="0.01" value="${cfg.preco_mil ?? 1}"></label>
          <label>Valor mínimo (R$)<input id="hist-cfg-min" type="number" min="0" step="0.01" value="${cfg.minimo ?? 1}"></label><button class="btn" onclick="histAdmCfg(this)">Salvar preço</button></div>
        <div class="adm-tab"><table><thead><tr><th>Pedido em</th><th>Conta</th><th>Período pedido</th><th style="text-align:right;">Pedidos</th><th style="text-align:right;">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
        ${L.map(p => `<tr><td>${histData(String(p.criado_em).slice(0, 10))}</td><td><b>${histE(p.email || '')}</b><br><small class="text-muted">${histE(p.apelido || p.conta)} · histórico desde ${histData(p.historico_desde)}</small></td>
          <td>${histData(p.desde)} a ${histData(p.ate)}</td><td style="text-align:right;">${(Number(p.pedidos) || 0).toLocaleString('pt-BR')}</td><td style="text-align:right;"><b>${histR(p.valor)}</b></td>
          <td>${HIST_SIT[p.situacao] || p.situacao}${p.decidido_em ? '<br><small class="text-muted">' + histData(String(p.decidido_em).slice(0, 10)) + '</small>' : ''}</td>
          <td style="white-space:nowrap;">${p.situacao === 'pedido' ? `<button class="btn btn-sm" onclick="histAdmDecidir(${p.id}, true, this)">Autorizar</button> <button class="btn-out btn-sm" onclick="histAdmDecidir(${p.id}, false, this)">Recusar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="text-muted">Nenhum pedido de histórico.</td></tr>'}
        </tbody></table></div>
        <div class="text-muted adm-nota">Conta nova carrega só os últimos 30 dias. O cliente pede o histórico mais antigo em Configurações → Mercado Livre, vê o preço (pela quantidade de pedidos do período, contada no Mercado Livre) e o pedido fica aqui, bloqueado. Autorize depois de receber: a conta passa a ter histórico desde o início pedido e as rotinas buscam o período sozinhas (vendas a cada 15 minutos; extrato e fatura de madrugada). O Mercado Livre deixa buscar até 12 meses de pedidos.</div>`;
    }
    async function histAdmDecidir(id, autorizar, bt){
      if(bt && bt.dataset.conf !== '1'){ bt.dataset.conf = '1'; bt.textContent = 'Confirmar'; setTimeout(() => { if(bt.isConnected){ bt.dataset.conf = ''; bt.textContent = autorizar ? 'Autorizar' : 'Recusar'; } }, 5000); return; }
      const r = await supa.rpc('admin_reprocesso_decidir', { p_id: id, p_autorizar: !!autorizar, p_nota: null });
      if(r.error && typeof toast === 'function') toast(r.error.message);
      await histAdmCarregar(); if(typeof admDesenhar === 'function') admDesenhar();
    }
    async function histAdmCfg(bt){
      const v = id => Number((document.getElementById(id) || {}).value);
      const r = await supa.rpc('admin_reprocesso_cfg', { p_preco_mil: v('hist-cfg-mil'), p_minimo: v('hist-cfg-min') });
      if(typeof toast === 'function') toast(r.error ? r.error.message : 'Preço salvo.');
      await histAdmCarregar(); if(typeof admDesenhar === 'function') admDesenhar();
    }
