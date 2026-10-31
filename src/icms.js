// ===== ICMS ENTRE ESTADOS (DIFAL na entrada das notas de compra) =====
// Tabela em Configurações → Notas fiscais: alíquota interna de cada estado (editável, comprasCfg.icmsInterna) e a regra
// da alíquota interestadual: 7% quando sai do Sul/Sudeste (menos ES) para N, NE, CO ou ES; 12% nos outros casos;
// 4% para produto importado (origem 1, 2, 3 ou 8 na nota). Na importação da nota vale a alíquota destacada no item.
// DIFAL na entrada = (valor do item + IPI) × (interna do destino − interestadual). Só cálculo: não lança nada.
    const ICMS_COD_UF = { 11:'RO', 12:'AC', 13:'AM', 14:'RR', 15:'PA', 16:'AP', 17:'TO', 21:'MA', 22:'PI', 23:'CE', 24:'RN', 25:'PB', 26:'PE', 27:'AL', 28:'SE', 29:'BA',
      31:'MG', 32:'ES', 33:'RJ', 35:'SP', 41:'PR', 42:'SC', 43:'RS', 50:'MS', 51:'MT', 52:'GO', 53:'DF' };
    const ICMS_UFS = Object.values(ICMS_COD_UF).sort();
    // alíquota modal interna de 2026 com o adicional de pobreza (FCP) quando é geral; confira com o contador e ajuste na tabela
    const ICMS_INTERNA_PADRAO = { AC:19, AL:20.5, AM:20, AP:18, BA:20.5, CE:20, DF:20, ES:17, GO:19, MA:23, MG:18, MS:17, MT:17, PA:19, PB:20, PE:20.5,
      PI:22.5, PR:19.5, RJ:22, RN:20, RO:19.5, RR:20, RS:17, SC:17, SE:20, SP:18, TO:20 };
    const ICMS_SUL_SE = ['MG', 'PR', 'RJ', 'RS', 'SC', 'SP'];
    let icmsEd = null;

    const icmsUfLoja = () => (typeof comprasCfg !== 'undefined' && comprasCfg.icmsUf) || 'SP';
    function icmsInterna(uf){
      const t = (typeof comprasCfg !== 'undefined' && comprasCfg.icmsInterna) || {}, v = Number(t[uf]);
      return v > 0 ? v : (ICMS_INTERNA_PADRAO[uf] || 0);
    }
    function icmsInter(orig, dest, importado){
      if(!orig || !dest || orig === dest) return 0;
      if(importado) return 4;
      return ICMS_SUL_SE.includes(orig) && !ICMS_SUL_SE.includes(dest) ? 7 : 12;
    }
    // diferença em % que se paga na entrada (nunca negativa); pInter = alíquota destacada na nota, se houver
    function icmsDifal(orig, dest, importado, pInter){
      if(!orig || !dest || orig === dest) return 0;
      const inter = Number(pInter) > 0 ? Number(pInter) : icmsInter(orig, dest, importado);
      return Math.max(0, Math.round((icmsInterna(dest) - inter) * 100) / 100);
    }
    const icmsPct = v => String(Math.round(Number(v) * 100) / 100).replace('.', ',') + '%';

    // cartão em Configurações → Notas fiscais
    function icmsRenderCard(){
      const view = document.getElementById('view-config'); if(!view) return;
      let card = document.getElementById('cfg-icms-card');
      if(!card){ card = document.createElement('div'); card.id = 'cfg-icms-card'; card.className = 'card'; card.dataset.cfgAba = 'nfe'; view.appendChild(card); }
      const uf = icmsUfLoja(), liga = typeof comprasCfg !== 'undefined' && comprasCfg.difalEntrada;
      card.style.display = (typeof cfgAbaAtiva === 'undefined' || cfgAbaAtiva === 'nfe') ? '' : 'none';
      card.innerHTML = `
        <div class="card-header"><div class="card-title">Notas fiscais — ICMS entre estados (DIFAL)</div></div>
        <div class="card-body" style="line-height:1.6;">
          <div>Tabela que cruza o estado de origem da nota com o seu estado e mostra a diferença de ICMS. Na importação da nota de compra há a opção <b>Calcular DIFAL</b>, que soma essa diferença ao custo real do produto. É só cálculo: nada é lançado no Contas a pagar.</div>
          <div class="text-muted" style="margin:6px 0 10px;">Seu estado: <b>${uf}</b> (interna ${icmsPct(icmsInterna(uf))}) · Calcular DIFAL já marcado na importação: <b>${liga ? 'sim' : 'não'}</b></div>
          <button class="btn-out btn-sm" onclick="icmsTabela()">Abrir a tabela</button>
        </div>`;
    }

    function icmsTabela(daNota){
      icmsEd = { daNota: !!daNota, uf: icmsUfLoja(), liga: !!(typeof comprasCfg !== 'undefined' && comprasCfg.difalEntrada), interna: {} };
      ICMS_UFS.forEach(u => { icmsEd.interna[u] = icmsInterna(u); });
      icmsDesenhar();
    }
    function icmsDesenhar(){
      const E = icmsEd, d = E.uf, int = u => Number(E.interna[u]) || 0;
      const inter = (o, imp) => o === d ? 0 : imp ? 4 : (ICMS_SUL_SE.includes(o) && !ICMS_SUL_SE.includes(d) ? 7 : 12);
      const dif = (o, imp) => o === d ? '—' : icmsPct(Math.max(0, int(d) - inter(o, imp)));
      vmlModal('ICMS entre estados', `
        <div class="text-muted" style="margin-bottom:10px;line-height:1.6;">A diferença é o que se paga ao seu estado na entrada (DIFAL): alíquota interna do seu estado − alíquota interestadual da nota. Na importação vale a alíquota que veio destacada no item da nota; a regra abaixo é usada quando a nota não traz. <b>As alíquotas internas mudam por lei: confira com o contador e ajuste aqui.</b></div>
        <div class="pf-grid" style="grid-template-columns:1fr 2fr;align-items:end;margin-bottom:10px;">
          <label class="pf-c"><span>Seu estado (destino das compras)</span><select onchange="icmsEd.uf=this.value;icmsDesenhar()">${ICMS_UFS.map(u => `<option ${u === d ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" ${E.liga ? 'checked' : ''} onchange="icmsEd.liga=this.checked"> Deixar "Calcular DIFAL" já marcado ao importar uma nota</label>
        </div>
        <div style="overflow-x:auto;max-height:52vh;"><table class="cp-tab"><thead><tr><th>Estado</th><th class="num">Alíquota interna</th><th class="num">Origem → ${d}</th><th class="num">Diferença</th><th class="num">Importado (4%) → ${d}</th><th class="num">Diferença importado</th></tr></thead><tbody>
          ${ICMS_UFS.map(u => `<tr${u === d ? ' style="font-weight:700;"' : ''}><td>${u}${u === d ? ' (seu estado)' : ''}</td>
            <td class="num"><input type="number" step="0.5" min="0" value="${int(u)}" style="width:70px;text-align:right;" onchange="icmsEd.interna['${u}']=Number(this.value)||0;icmsDesenhar()">%</td>
            <td class="num">${u === d ? '—' : icmsPct(inter(u, false))}</td><td class="num"><b>${dif(u, false)}</b></td>
            <td class="num">${u === d ? '—' : '4%'}</td><td class="num"><b>${dif(u, true)}</b></td></tr>`).join('')}
        </tbody></table></div>`,
        `<button class="btn-out" style="margin-right:auto;" onclick="if(confirm('Voltar as alíquotas internas para o padrão do sistema?')){ICMS_UFS.forEach(u=>{icmsEd.interna[u]=ICMS_INTERNA_PADRAO[u];});icmsDesenhar();}">Restaurar padrão</button><button class="btn-out" onclick="${E.daNota ? 'nfeImpDesenhar()' : "fecharModal('modal-vml')"}">${E.daNota ? 'Voltar à nota' : 'Cancelar'}</button><button class="btn" onclick="icmsAplicar()">Aplicar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '820px';
    }
    function icmsAplicar(){
      if(typeof comprasCfg === 'undefined' || !icmsEd) return;
      const dif = {}; ICMS_UFS.forEach(u => { const v = Number(icmsEd.interna[u]) || 0; if(v !== ICMS_INTERNA_PADRAO[u]) dif[u] = v; });   // guarda só o que mudou
      comprasCfg.icmsUf = icmsEd.uf; comprasCfg.difalEntrada = !!icmsEd.liga; comprasCfg.icmsInterna = dif;
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
      icmsRenderCard();
      if(icmsEd.daNota && typeof nfeImpDesenhar === 'function'){ nfe.imp.difal = !!icmsEd.liga || nfe.imp.difal; nfeImpDesenhar(); } else fecharModal('modal-vml');   // aberta da importação: volta para ela
    }
