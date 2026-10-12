// ===== REGRAS DE CÁLCULO DAS VENDAS (Configurações → Mercado Livre) =====
// Uma linha por loja na tabela vendas_cfg; a view vendas_ml_calc aplica na hora (vale também para as vendas antigas):
//   flex_imposto      vendas Flex pagam imposto?
//   flex_custo        quanto se paga ao transportador por envio Flex (0 = não ajusta a margem)
//   frete_no_imposto  o frete pago pelo comprador entra na base do imposto?

    let vr = { cfg: {}, carregado: false };

    async function vrCarregar(){
      const r = await supa.from('vendas_cfg').select('*').eq('usuario_id', usuarioAtual.id);
      vr.cfg = {}; (r.data || []).forEach(x => { vr.cfg[String(x.ml_user_id)] = x; });
      vr.carregado = !r.error;
    }
    function vrDe(conta){ return vr.cfg[String(conta)] || { flex_imposto: true, flex_custo: 0, frete_no_imposto: false, imposto_pct: null }; }

    async function vrRenderCard(){
      const view = document.getElementById('view-config');
      if(!view || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      let card = document.getElementById('cfg-regras-card');
      if(!card){ card = document.createElement('div'); card.id = 'cfg-regras-card'; card.className = 'card'; card.dataset.cfgAba = 'ml'; view.appendChild(card); }
      if(!vr.carregado) await vrCarregar();
      const pc = await supa.from('custo_peps_cfg').select('desde,ativo').eq('usuario_id', usuarioAtual.id).maybeSingle();
      vr.peps = pc.data || null;
      const contas = typeof contasML !== 'undefined' ? contasML : [];
      const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const sn = (conta, campo, val, sim, nao) => `<select onchange="vrSalvar('${conta}','${campo}',this.value==='1')"><option value="1" ${val ? 'selected' : ''}>${sim}</option><option value="0" ${val ? '' : 'selected'}>${nao}</option></select>`;
      card.innerHTML = `
        <div class="card-header"><div><div class="card-title">Regras de cálculo das vendas</div><div class="pg-sub">Como o imposto e o frete entram na margem de cada venda. Vale por loja e também para as vendas já feitas.</div></div></div>
        <div class="card-body">
          ${contas.length ? contas.map(c => { const g = vrDe(c.id); return `
            <div class="vr-loja"><h4>${esc(c.nome || c.apelido || c.id)}</h4>
              <div class="vr-linha"><div><b>Imposto sobre a venda nesta loja (%)</b><span class="d">Preencha se a loja inteira paga o mesmo percentual (ex.: 4). As vendas novas da loja passam a usar esse valor no lugar do imposto do cadastro de cada produto. Deixe vazio para usar o imposto de cada produto.</span></div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;"><input type="text" inputmode="decimal" style="width:90px;" value="${g.imposto_pct != null ? String(Number(g.imposto_pct)).replace('.', ',') : ''}" placeholder="do produto" onchange="vrSalvar('${c.id}','imposto_pct',this.value)">
                  ${g.imposto_pct != null ? `<button class="btn-out btn-sm" onclick="vrImpostoPassado('${c.id}')" title="Grava esse percentual também nas vendas que já aconteceram nesta loja">Aplicar às vendas já feitas</button>` : ''}</div></div>
              <div class="vr-linha"><div><b>Vendas Flex pagam imposto?</b><span class="d">Marque "Não" se você não emite nota fiscal nas vendas entregues pelo Flex: o imposto dessas vendas fica zero.</span></div>
                ${sn(c.id, 'flex_imposto', g.flex_imposto !== false, 'Sim, pagam imposto', 'Não pagam imposto')}</div>
              <div class="vr-linha"><div><b>Quanto você paga ao transportador por envio Flex</b><span class="d">No Flex o Mercado Livre repassa a você o valor do frete do envio, e você paga o motoboy. Informando o valor aqui, cada venda Flex passa a mostrar a margem real: soma o repasse do Mercado Livre e desconta este valor. No DRE entra só o repasse do Mercado Livre; o que você paga ao transportador continua vindo das contas a pagar. Em branco ou zero, nada muda.</span></div>
                <input type="text" inputmode="decimal" value="${Number(g.flex_custo) > 0 ? Number(g.flex_custo).toFixed(2).replace('.', ',') : ''}" placeholder="R$ 0,00" onchange="vrSalvar('${c.id}','flex_custo',this.value)"></div>
              <div class="vr-linha"><div><b>Frete pago pelo comprador entra no cálculo do imposto?</b><span class="d">Em alguns lugares o comprador paga uma parte do frete. Marque "Sim" se a sua nota fiscal inclui esse valor; com "Não", o imposto é só sobre o valor do produto.</span></div>
                ${sn(c.id, 'frete_no_imposto', !!g.frete_no_imposto, 'Sim, considerar o frete', 'Não considerar o frete')}</div>
            </div>`; }).join('') : '<div class="text-muted">Conecte uma conta do Mercado Livre para configurar.</div>'}
          <div class="vr-loja"><h4>Custo do produto nas vendas</h4>
            <div class="vr-linha"><div><b>De onde vem o custo de cada venda?</b><span class="d"><b>Pelas ordens de compra</b>: cada compra que chega vira um lote com o preço pago, e as vendas consomem os lotes na ordem de chegada. <b>Pelo valor do cadastro</b>: vale o custo que você digita em Produtos — útil para quem não lança ordem de compra ou quer embutir outros gastos no custo (por exemplo, R$ 10 do produto + R$ 1 de expedição = R$ 11). A troca vale para as próximas vendas; as já calculadas não mudam.</span></div>
              ${vr.peps ? `<select onchange="vrCusto(this.value==='1')"><option value="1" ${vr.peps.ativo ? 'selected' : ''}>Pelas ordens de compra (lotes)</option><option value="0" ${vr.peps.ativo ? '' : 'selected'}>Pelo valor do cadastro</option></select>`
                : `<div style="text-align:right;"><div class="text-muted" style="font-size:12.5px;margin-bottom:6px;">Hoje: pelo valor do cadastro</div><button class="btn-out btn btn-sm" onclick="nav('ordens-compra');if(typeof pepsAbrir==='function')setTimeout(pepsAbrir,400)">Passar a usar as ordens de compra</button></div>`}</div>
          </div>
          <div id="vr-msg" class="text-muted" style="font-size:12.5px;"></div>
        </div>`;
    }

    // grava o imposto da loja nas vendas que já aconteceram (pergunta antes, mostrando quantas mudam)
    async function vrImpostoPassado(conta){
      const g = vrDe(conta), pct = g.imposto_pct; if(pct == null || typeof vmlModal !== 'function') return;
      const nome = (typeof contaNome === 'function' && contaNome(conta)) || conta, txt = String(Number(pct)).replace('.', ',') + '%';
      const q = await supa.rpc('vendas_ml_imposto_loja_conta', { p_conta: String(conta), p_pct: Number(pct) });
      const n = Number(q.data) || 0;
      if(!n){ vmlModal('Imposto das vendas já feitas', `<div style="line-height:1.6;">Todas as vendas de <b>${nome}</b> já estão com imposto de <b>${txt}</b>. Não há o que mudar.</div>`); return; }
      vmlModal('Aplicar ' + txt + ' às vendas já feitas', `<div style="line-height:1.6;"><b>${n.toLocaleString('pt-BR')} vendas</b> de <b>${nome}</b> estão com outro percentual de imposto e passarão a <b>${txt}</b>. Isso muda a margem dessas vendas no Resumo, na Análise e no DRE.<br><br>O percentual que cada venda tinha antes não fica guardado. As vendas do Flex continuam seguindo a regra "Vendas Flex pagam imposto?".</div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="vrImpostoAplicar('${conta}', this)">Aplicar a ${n.toLocaleString('pt-BR')} vendas</button>`);
    }
    async function vrImpostoAplicar(conta, bt){
      const g = vrDe(conta); if(g.imposto_pct == null) return;
      if(bt){ bt.disabled = true; bt.textContent = 'Aplicando…'; }
      const r = await supa.rpc('vendas_ml_imposto_loja', { p_conta: String(conta), p_pct: Number(g.imposto_pct) });
      fecharModal('modal-vml');
      if(r.error){ toast('Não consegui aplicar: ' + r.error.message); return; }
      if(typeof inicioVendas !== 'undefined') inicioVendas = null;
      if(typeof dreDados !== 'undefined') dreDados = { chave: '', ml: {}, cobertura: {}, carregado: false, erro: null };
      if(typeof an !== 'undefined'){ an.chave = ''; an.meses = null; }
      toast((Number(r.data) || 0).toLocaleString('pt-BR') + ' vendas atualizadas.');
    }
    async function vrSalvar(conta, campo, valor){
      const g = { ...vrDe(conta) };
      if(campo === 'flex_custo'){ const s = String(valor).replace(/[^\d,.]/g, ''); valor = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; }
      if(campo === 'imposto_pct'){ const s = String(valor).replace(/[^\d,.]/g, ''); valor = s === '' ? null : Number(s.replace(',', '.')); if(valor != null && !(valor >= 0 && valor <= 60)){ toast('Informe um percentual entre 0 e 60.'); return; } }
      g[campo] = valor;
      const linha = { usuario_id: usuarioAtual.id, ml_user_id: String(conta), flex_imposto: g.flex_imposto !== false, flex_custo: Number(g.flex_custo) || 0, frete_no_imposto: !!g.frete_no_imposto, imposto_pct: g.imposto_pct == null ? null : Number(g.imposto_pct) };
      const r = await supa.from('vendas_cfg').upsert(linha);
      if(r.error){ toast('Não consegui gravar: ' + r.error.message); return; }
      vr.cfg[String(conta)] = linha;
      // as telas de vendas guardam resultado: força buscar de novo
      if(typeof inicioVendas !== 'undefined') inicioVendas = null;
      if(typeof dreDados !== 'undefined') dreDados = { chave: '', ml: {}, cobertura: {}, carregado: false, erro: null };
      if(typeof an !== 'undefined'){ an.chave = ''; an.meses = null; }
      toast('Regra gravada. As margens das vendas já consideram a mudança.');
    }

    async function vrCusto(porLote){
      const r = await supa.from('custo_peps_cfg').update({ ativo: !!porLote }).eq('usuario_id', usuarioAtual.id);
      if(r.error){ toast('Não consegui gravar: ' + r.error.message); return; }
      if(vr.peps) vr.peps.ativo = !!porLote;
      toast(porLote ? 'As próximas vendas usam o custo das ordens de compra (lotes).' : 'As próximas vendas usam o custo digitado no cadastro do produto.');
    }
