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
    function vrDe(conta){ return vr.cfg[String(conta)] || { flex_imposto: true, flex_custo: 0, frete_no_imposto: false }; }

    async function vrRenderCard(){
      const view = document.getElementById('view-config');
      if(!view || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      let card = document.getElementById('cfg-regras-card');
      if(!card){ card = document.createElement('div'); card.id = 'cfg-regras-card'; card.className = 'card'; card.dataset.cfgAba = 'ml'; view.appendChild(card); }
      if(!vr.carregado) await vrCarregar();
      const contas = typeof contasML !== 'undefined' ? contasML : [];
      const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const sn = (conta, campo, val, sim, nao) => `<select onchange="vrSalvar('${conta}','${campo}',this.value==='1')"><option value="1" ${val ? 'selected' : ''}>${sim}</option><option value="0" ${val ? '' : 'selected'}>${nao}</option></select>`;
      card.innerHTML = `
        <div class="card-header"><div><div class="card-title">Regras de cálculo das vendas</div><div class="pg-sub">Como o imposto e o frete entram na margem de cada venda. Vale por loja e também para as vendas já feitas.</div></div></div>
        <div class="card-body">
          ${contas.length ? contas.map(c => { const g = vrDe(c.id); return `
            <div class="vr-loja"><h4>${esc(c.nome || c.apelido || c.id)}</h4>
              <div class="vr-linha"><div><b>Vendas Flex pagam imposto?</b><span class="d">Marque "Não" se você não emite nota fiscal nas vendas entregues pelo Flex: o imposto dessas vendas fica zero.</span></div>
                ${sn(c.id, 'flex_imposto', g.flex_imposto !== false, 'Sim, pagam imposto', 'Não pagam imposto')}</div>
              <div class="vr-linha"><div><b>Quanto você paga ao transportador por envio Flex</b><span class="d">No Flex o Mercado Livre repassa a você o valor do frete do envio, e você paga o motoboy. Informando o valor aqui, cada venda Flex passa a mostrar a margem real: soma o repasse do Mercado Livre e desconta este valor. O DRE ganha a linha "Ajuste Flex ML". Em branco ou zero, nada muda.</span></div>
                <input type="text" inputmode="decimal" value="${Number(g.flex_custo) > 0 ? Number(g.flex_custo).toFixed(2).replace('.', ',') : ''}" placeholder="R$ 0,00" onchange="vrSalvar('${c.id}','flex_custo',this.value)"></div>
              <div class="vr-linha"><div><b>Frete pago pelo comprador entra no cálculo do imposto?</b><span class="d">Em alguns lugares o comprador paga uma parte do frete. Marque "Sim" se a sua nota fiscal inclui esse valor; com "Não", o imposto é só sobre o valor do produto.</span></div>
                ${sn(c.id, 'frete_no_imposto', !!g.frete_no_imposto, 'Sim, considerar o frete', 'Não considerar o frete')}</div>
            </div>`; }).join('') : '<div class="text-muted">Conecte uma conta do Mercado Livre para configurar.</div>'}
          <div id="vr-msg" class="text-muted" style="font-size:12.5px;"></div>
        </div>`;
    }

    async function vrSalvar(conta, campo, valor){
      const g = { ...vrDe(conta) };
      if(campo === 'flex_custo'){ const s = String(valor).replace(/[^\d,.]/g, ''); valor = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; }
      g[campo] = valor;
      const linha = { usuario_id: usuarioAtual.id, ml_user_id: String(conta), flex_imposto: g.flex_imposto !== false, flex_custo: Number(g.flex_custo) || 0, frete_no_imposto: !!g.frete_no_imposto };
      const r = await supa.from('vendas_cfg').upsert(linha);
      if(r.error){ toast('Não consegui gravar: ' + r.error.message); return; }
      vr.cfg[String(conta)] = linha;
      // as telas de vendas guardam resultado: força buscar de novo
      if(typeof inicioVendas !== 'undefined') inicioVendas = null;
      if(typeof dreDados !== 'undefined') dreDados = { chave: '', ml: {}, cobertura: {}, carregado: false, erro: null };
      if(typeof an !== 'undefined'){ an.chave = ''; an.meses = null; }
      toast('Regra gravada. As margens das vendas já consideram a mudança.');
    }
