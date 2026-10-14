// ===== VENDAS ML + RESUMO FINANCEIRO =====
// Dados: view vendas_ml_calc (Supabase) — venda + custo/imposto do cadastro de Produtos + margem.
// O app pede ao banco só a página atual (com os filtros) e os totais do período (RPC vendas_ml_totais),
// por isso funciona com períodos longos. A Edge Function ml-vendas traz do ML os dias que ainda
// não estão em cache; o histórico antigo é preenchido aos poucos pelo cron ml-vendas-sync.
// Margem de contribuição = valor dos produtos − custo − imposto − tarifa − frete do vendedor.

    let vmlSync = { rodando:false, msg:'' };
    let vmlFreteComprador = localStorage.getItem('mk_vml_frete_comp') === '1';
    let vmlSemPermissao = false;       // token sem o escopo de vendas (mostra aviso de reconexão)
    let vmlSeq = 0;                    // descarta respostas de consultas antigas
    const VML_EXPORT_MAX_DIAS = 31, VML_EXPORT_MAX_LINHAS = 5000;
    const VD_MAX_DIAS = 31;            // a página Vendas é operacional: períodos longos ficam no Resumo Financeiro

    // Vendas
    let vdFiltro = { de:null, ate:null, atalho:'hoje', status:'todas', envio:'todas', campo:'sku', termo:'', semCusto:false, pagina:1, porPagina:40 };
    let vdDados = { linhas:[], total:0, tot:null, carrinhos:{}, carregado:false };
    // Resumo Financeiro
    let rfPend = null;   // filtros do Resumo alterados na tela e ainda não buscados
    let rfFiltro = { de:null, ate:null, pedido:'', titulo:'', sku:'', status:'aprovadas', modalidade:'todas', frete:'todos', custo:'todos', pagina:1, porPagina:50, ordem:'data', desc:true };
    let rfDados = { linhas:[], total:0, tot:null, carregado:false };

    function vmlEsc(s){
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function vmlNum(n){ return (Number(n) || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }
    function vmlPct(n){ return (isFinite(n) ? Number(n) : 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%'; }
    function vmlDataBRT(iso){
      const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString();
      return { dia: d.substring(0,10), hora: d.substring(11,16) };
    }
    function vmlCopiar(txt, el){
      if(navigator.clipboard) navigator.clipboard.writeText(String(txt));
      if(el){ const o = el.textContent; el.textContent = '✓'; setTimeout(() => { el.textContent = o; }, 900); }
    }
    function vmlSkuInfo(sku){
      if(!sku) return null;
      const k = String(sku).trim().toUpperCase();
      return skus.find(s => String(s.sku || '').trim().toUpperCase() === k) || null;
    }
    // Números de uma linha da view vendas_ml_calc
    function vmlCalc(v){
      const bruto = Number(v.bruto) || 0, freteComp = Number(v.frete_comprador) || 0, freteVend = Number(v.frete_vendedor) || 0, tarifa = Number(v.tarifa) || 0;
      return {
        qtd: Number(v.qtd) || 1, bruto, freteComp, freteVend, tarifa,
        custo: Number(v.custo) || 0, imposto: Number(v.imposto) || 0, mc: Number(v.mc) || 0, mcPct: Number(v.mc_pct) || 0,
        faturamento: bruto + freteComp, liquidoML: bruto - tarifa - freteVend,
        temCusto: !!v.tem_custo, temImposto: !!v.tem_imposto, fretePendente: v.frete_vendedor == null,
        flexRep: Number(v.flex_repasse) || 0, flexCusto: Number(v.flex_custo) || 0, flex: v.logistic_type === 'self_service'
      };
    }
    function vmlDiasEntre(de, ate){ return diasDif(de, ate) + 1; }

    // ----- sincronização com o ML -----
    function vmlAtualizarSync(){
      document.querySelectorAll('.vml-sync').forEach(el => {
        el.innerHTML = `<span class="sync-dot ${vmlSync.rodando ? 'run' : ''}"></span>${vmlEsc(vmlSync.msg || 'Dados do Mercado Livre')}`;
      });
    }

    // Traz do ML os dias do período que não estão em cache. Períodos longos: importa o que der em
    // algumas chamadas e deixa o resto para o cron (a tela já mostra o que estiver no banco).
    async function vmlSincronizar(de, ate, forcar, aoTerminar){
      if(vmlSync.rodando || !usuarioAtual) return;
      vmlSync = { rodando:true, msg:'Buscando vendas no Mercado Livre…' };
      vmlAtualizarSync();
      let msg = '';
      try {
        const { data: sessao } = await supa.auth.getSession();
        const jwt = sessao?.session?.access_token;
        const maxChamadas = vmlDiasEntre(de, ate) > 3 ? 4 : 8;
        for(let i = 0; i < maxChamadas; i++){
          const { data, error } = await supa.functions.invoke('ml-vendas', {
            headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}, body: { de, ate, forcar: !!forcar && i === 0, conta: contaParam() || undefined }
          });
          if(error || data?.error){
            vmlSemPermissao = !!data?.sem_permissao;
            msg = vmlSemPermissao ? '⚠️ Conta do ML precisa ser reconectada' : '❌ ' + (data?.error || error?.message);
            break;
          }
          vmlSemPermissao = !!data.sem_permissao;
          if(data.aviso){ msg = '⚠️ ' + data.aviso; break; }
          if(!data.restantes){ msg = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}); break; }
          msg = `Importando histórico em segundo plano — faltam ${data.restantes} dia${data.restantes > 1 ? 's' : ''}`;
          vmlSync.msg = msg; vmlAtualizarSync();
          if(data.feitos > 0 && aoTerminar) aoTerminar(true);   // já mostra o que chegou
        }
      } catch(e){
        msg = '❌ ' + e.message;
      }
      vmlSync = { rodando:false, msg };
      vmlAtualizarSync();
      if(aoTerminar) aoTerminar(false);
    }

    function vmlAtalho(atalho){
      const h = getToday();
      if(atalho === 'ontem') return { de:addDias(h,-1), ate:addDias(h,-1) };
      if(atalho === '7d') return { de:addDias(h,-6), ate:h };
      if(atalho === '30d') return { de:addDias(h,-29), ate:h };
      if(atalho === 'mes') return { de:h.substring(0,8) + '01', ate:h };
      if(atalho === '12m') return { de:addDias(h,-364), ate:h };
      return { de:h, ate:h };
    }

    function vmlAvisoPermissao(){
      if(!vmlSemPermissao) return '';
      return `<div class="alert alert-warning" style="justify-content:space-between;flex-wrap:wrap;">
        <span>Para carregar as vendas é preciso <b>reconectar sua conta do Mercado Livre</b> (novas permissões de vendas, perguntas e mensagens).</span>
        <button class="btn btn-sm" onclick="conectarML()">Reconectar agora</button></div>`;
    }

    function vmlPaginacao(atual, total, fn){
      if(total <= 1) return '<div></div>';
      const nums = [];
      for(let p = Math.max(1, atual - 2); p <= Math.min(total, atual + 2); p++) nums.push(p);
      return `<div class="pag">
        <button ${atual === 1 ? 'disabled' : ''} onclick="${fn}(1)">«</button>
        <button ${atual === 1 ? 'disabled' : ''} onclick="${fn}(${atual - 1})">‹</button>
        ${nums.map(p => `<button class="${p === atual ? 'active' : ''}" onclick="${fn}(${p})">${p}</button>`).join('')}
        <button ${atual === total ? 'disabled' : ''} onclick="${fn}(${atual + 1})">›</button>
        <button ${atual === total ? 'disabled' : ''} onclick="${fn}(${total})">»</button>
      </div>`;
    }

    function vmlModal(titulo, corpo, rodape){
      let m = document.getElementById('modal-vml');
      if(!m){
        m = document.createElement('div'); m.id = 'modal-vml'; m.className = 'modal';
        // clicar fora fecha; mas se a pessoa já preencheu algo, pergunta antes para não perder
        m.addEventListener('click', e => { if(e.target !== m) return; if(m._sujo && m.querySelector('.modal-body input, .modal-body textarea, .modal-body select') && !confirm('Sair sem salvar? O que você preencheu nesta janela será perdido.')) return; m.classList.remove('open'); });
        m.addEventListener('input', () => { m._sujo = true; });
        m.addEventListener('change', () => { m._sujo = true; });
        document.body.appendChild(m);
      }
      // "sujo" continua valendo quando a mesma janela é redesenhada (ex.: depois de o robô preencher o contrato)
      if(m._titulo !== titulo || !m.classList.contains('open')) m._sujo = false;
      m._titulo = titulo;
      m.innerHTML = `<div class="modal-content" style="max-width:720px;">
        <div class="modal-header"><div class="modal-title">${titulo}</div><button class="ico-btn" onclick="fecharModal('modal-vml')">✕</button></div>
        <div class="modal-body">${corpo}</div>
        <div class="modal-footer">${rodape || `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button>`}</div>
      </div>`;
      m.classList.add('open');
    }

    // ===================================================================
    // PÁGINA VENDAS
    // ===================================================================
    const VD_CAMPOS = { sku:'sku', venda:'order_txt', carrinho:'pack_txt', mlb:'item_id', titulo:'titulo', apelido:'comprador_apelido', nome:'comprador_nome' };

    // Com termo de busca, procura em TODAS as vendas (como no Mercado Turbo): o período e os filtros de situação/envio
    // só valem com a busca vazia. Nº da venda acha também pelo nº do carrinho; SKU e anúncio batem o código inteiro
    // (se não houver nenhum, vdCarregar tenta de novo por parte do SKU); título e comprador batem por parte do texto.
    function vdConsulta(sel, opts, semConta){
      const f = vdFiltro, t = f.termo.trim();
      let q = supa.from('vendas_ml_calc').select(sel, opts).eq('usuario_id', usuarioAtual.id);
      if(contaAtiva && !semConta) q = q.eq('ml_user_id', contaAtiva);
      if(!t){
        q = q.gte('dia', f.de).lte('dia', f.ate);
        if(f.status === 'aprovadas') q = q.eq('situacao', 'aprovada');
        if(f.status === 'canceladas') q = q.eq('situacao', 'cancelada');
        if(f.status === 'pendentes') q = q.eq('situacao', 'pendente');
        if(f.envio !== 'todas') q = q.eq('envio', f.envio);
        if(f.semCusto) q = q.or('tem_custo.eq.false,tem_imposto.eq.false');
        return q;
      }
      const limpo = t.replace(/[%,()]/g, ' ').trim();
      if(f.campo === 'venda' || f.campo === 'carrinho'){ const n = t.replace(/\D/g, '') || '0'; return q.or('order_txt.eq.' + n + ',pack_txt.eq.' + n); }
      if(f.campo === 'mlb') return q.ilike('item_id', limpo.replace(/^(mlb)\s*-\s*/i, '$1'));
      if(f.campo === 'sku' && !f.parcial) return q.ilike('sku', limpo);
      return q.ilike(VD_CAMPOS[f.campo] || 'sku', '%' + limpo + '%');
    }

    async function vdFotos(bt){
      const rot = bt.textContent; bt.disabled = true; bt.textContent = 'Atualizando fotos…';
      let d = null; try { const r = await supa.functions.invoke('ml-vendas', { body: { acao: 'fotos' } }); d = r.data; } catch(e){}
      bt.disabled = false; bt.textContent = rot;
      if(typeof toast === 'function') toast(d && d.success ? d.atualizados + ' de ' + d.anuncios + ' anúncios com a foto atualizada.' : ((d && d.error) || 'Não foi possível atualizar as fotos agora.'));
      if(d && d.success) vdCarregar();
    }
    async function vdCarregar(){
      if(!usuarioAtual) return;
      const seq = ++vmlSeq, f = vdFiltro, buscando = !!f.termo.trim();
      const ini = (f.pagina - 1) * f.porPagina;
      const pagina = () => vdConsulta('*', { count:'exact' }).order('data_venda', {ascending:false}).range(ini, ini + f.porPagina - 1);
      let [pag, tot] = await Promise.all([
        pagina(),
        (typeof tfTotaisRpc === 'function' ? tfTotaisRpc({ p_de:f.de, p_ate:f.ate, p_conta:contaParam() }, vdCarregar) : supa.rpc('vendas_ml_totais', { p_de:f.de, p_ate:f.ate, p_conta:contaParam() }))
      ]);
      if(seq !== vmlSeq) return;
      if(buscando && f.campo === 'sku' && !f.parcial && !pag.error && !pag.count){   // nenhum SKU com esse código inteiro: tenta por parte dele
        f.parcial = true; pag = await pagina();
        if(seq !== vmlSeq) return;
        if(!pag.count) f.parcial = false;
      }
      let outraLoja = 0;
      if(buscando && contaAtiva && !pag.error && !pag.count){   // nada nesta loja: avisa se a venda está na outra
        const r = await vdConsulta('order_id', { count:'exact', head:true }, true);
        if(seq !== vmlSeq) return;
        outraLoja = r.count || 0;
      }
      vdDados.outraLoja = outraLoja;
      const linhas = pag.data || [];
      // quantas vendas tem cada carrinho que aparece na página
      const packs = [...new Set(linhas.map(v => v.pack_id).filter(Boolean))];
      const carrinhos = {};
      if(packs.length){
        const { data } = await supa.from('vendas_ml').select('pack_id').eq('usuario_id', usuarioAtual.id).in('pack_id', packs);
        (data || []).forEach(r => { carrinhos[r.pack_id] = (carrinhos[r.pack_id] || 0) + 1; });
        if(seq !== vmlSeq) return;
      }
      const extra = {};
      if(linhas.length){
        const ex = await supa.from('vendas_ml').select('order_id,cidade,uf,cep,envio_status,rastreio,etiqueta_em,shipping_id,logistic_type,est_anuncio_apos,est_galpao_apos').eq('usuario_id', usuarioAtual.id).in('order_id', linhas.map(v => v.order_id));
        if(seq !== vmlSeq) return;
        (ex.data || []).forEach(r => { extra[r.order_id] = r; });
      }
      vdDados = { linhas, total: pag.count || 0, tot: tot.data || null, carrinhos, extra, carregado:true, erro: pag.error?.message || tot.error?.message, outraLoja };
      vdDesenhar();
      if(tot.data && tot.data.aprov && tot.data.aprov.sem_custo) vmlSemDetalhe(f.de, f.ate, 'vd-sem');
    }

    function renderVendas(){
      const el = document.getElementById('view-vendas');
      if(!el) return;
      if(!vdFiltro.de){ const p = vmlAtalho('hoje'); vdFiltro.de = p.de; vdFiltro.ate = p.ate; }
      vdFiltro.cortado = false;
      if(vmlDiasEntre(vdFiltro.de, vdFiltro.ate) > VD_MAX_DIAS){ vdFiltro.de = addDias(vdFiltro.ate, -(VD_MAX_DIAS - 1)); vdFiltro.cortado = true; }
      if(!vdDados.carregado) el.innerHTML = '<div class="vazio"><b>Carregando vendas…</b></div>';
      vdCarregar();
      vdGrafCarregar();
      vmlSincronizar(vdFiltro.de, vdFiltro.ate, false, () => { if(el.classList.contains('active')) vdCarregar(); });
    }

    function vdDesenhar(){
      const el = document.getElementById('view-vendas');
      if(!el || !el.classList.contains('active')) return;
      const f = vdFiltro, d = vdDados, t = d.tot || {}, a = t.aprov || {}, c = t.canc || {};
      const paginas = Math.max(1, Math.ceil(d.total / f.porPagina));
      const envios = (t.envios_todos || []).slice().sort((x,y) => y.qtd - x.qtd);
      const atalhos = [['hoje','Hoje'],['ontem','Ontem'],['7d','7 dias'],['30d','30 dias'],['mes','Mês atual']];
      const buscando = !!f.termo.trim();
      const rotCampo = { sku:'SKU', venda:'nº da venda', carrinho:'nº do carrinho', mlb:'anúncio', titulo:'título', apelido:'apelido do comprador', nome:'nome do comprador' }[f.campo] || 'SKU';
      const nDias = vmlDiasEntre(f.de, f.ate);
      const podeExportar = nDias <= VML_EXPORT_MAX_DIAS && d.total <= VML_EXPORT_MAX_LINHAS;

      el.innerHTML = `
        <div class="pg-head">
          <div>
            <div class="pg-title">Vendas</div>
            <div class="pg-sub">Suas vendas do Mercado Livre com custo, tarifa, frete e margem de cada pedido.</div>
          </div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
            <span class="sync-bar vml-sync"></span>
            <button class="btn-out btn btn-sm" onclick="vdAtualizar()">↻ Atualizar</button>
            <button class="btn-out btn btn-sm" onclick="vdFotos(this)" title="Busca de novo no Mercado Livre a foto de capa dos seus anúncios. Sem isso, cada foto se atualiza sozinha em até 7 dias.">Atualizar fotos dos anúncios</button>
            <button class="btn-out btn btn-sm" ${podeExportar ? '' : 'disabled style="opacity:.5;cursor:not-allowed;"'} title="${podeExportar ? 'Baixar as vendas filtradas' : `Exportação disponível para até ${VML_EXPORT_MAX_DIAS} dias e ${VML_EXPORT_MAX_LINHAS.toLocaleString('pt-BR')} vendas. Reduza o período ou filtre.`}" onclick="vdExportar()">⬇ Exportar .xlsx</button>
          </div>
        </div>
        ${vmlAvisoPermissao()}
        ${d.erro ? `<div class="alert alert-danger">Erro ao consultar as vendas: ${vmlEsc(d.erro)}</div>` : ''}
        ${f.cortado ? `<div class="alert alert-info">A página Vendas mostra até ${VD_MAX_DIAS} dias por vez. Para períodos maiores, use o <a onclick="nav('resumo-fin')" style="cursor:pointer;font-weight:700;text-decoration:underline;">Resumo Financeiro</a>.</div>` : ''}
        <div id="vd-graf">${vdGraficoHtml()}</div>

        <div class="kpi-grid">
          <div class="kpi k-venda"><div class="kpi-label">Vendas aprovadas${vdRotPeriodo()}</div><div class="kpi-value">${(a.qtd || 0).toLocaleString('pt-BR')}</div><div class="kpi-sub"><span><b>${(a.un || 0).toLocaleString('pt-BR')}</b> unidades</span><span><b>${c.qtd || 0}</b> canceladas</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Faturamento (produtos)${vdRotPeriodo()}</div><div class="kpi-value">R$ ${vmlNum(a.bruto)}</div><div class="kpi-sub"><span>Ticket médio <b>R$ ${vmlNum(a.qtd ? a.bruto / a.qtd : 0)}</b></span></div></div>
          <div class="kpi k-mc"><div class="kpi-label">Margem de contribuição${vdRotPeriodo()}</div><div class="kpi-value">R$ ${vmlNum(a.mc)}</div><div class="kpi-sub"><span><b>${vmlPct(a.bruto ? a.mc / a.bruto * 100 : 0)}</b> do faturamento</span>${a.sem_custo ? `<span class="sem-custo" id="vd-sem" style="cursor:pointer;" title="Mostrar essas vendas" onclick="vdSet('semCusto',true)">${a.sem_custo} sem custo ou imposto</span>` : ''}</div></div>
        </div>

        <div class="card"><div class="card-body">
          <div class="chips" style="margin-bottom:14px;">
            ${atalhos.map(([k,l]) => `<button class="chip ${f.atalho === k ? 'active' : ''}" onclick="vdSetAtalho('${k}')">${l}</button>`).join('')}
            <span style="display:inline-flex;gap:6px;align-items:center;margin-left:6px;">
              <input type="date" value="${f.de}" onchange="vdSetData('de', this.value)" style="width:150px;">
              <span class="text-muted">até</span>
              <input type="date" value="${f.ate}" onchange="vdSetData('ate', this.value)" style="width:150px;">
            </span>
          </div>
          <div class="filtros">
            <div><label>Buscar por</label>
              <select onchange="vdFiltro.campo=this.value">
                ${[['sku','SKU'],['venda','Nº da venda'],['carrinho','Nº do carrinho'],['mlb','ID do anúncio (MLB)'],['titulo','Título do anúncio'],['apelido','Apelido do comprador'],['nome','Nome do comprador']]
                  .map(([k,l]) => `<option value="${k}" ${f.campo === k ? 'selected' : ''}>${l}</option>`).join('')}
              </select></div>
            <div style="grid-column:span 2;"><label>Termo de busca</label>
              <input type="text" id="vd-termo" placeholder="Digite e pressione Enter" value="${vmlEsc(f.termo)}" onkeydown="if(event.key==='Enter'){vdBuscar();}"></div>
            <div style="display:flex;gap:6px;"><button class="btn btn-sm" style="flex:1;padding:9px;" onclick="vdBuscar()">Filtrar</button>${buscando ? '<button class="btn-out btn btn-sm" style="padding:9px 12px;white-space:nowrap;" onclick="vdLimpar()">Limpar busca</button>' : ''}</div>
          </div>
          ${buscando ? `<div class="alert alert-info" style="margin:12px 0 0;">Buscando <b>${vmlEsc(rotCampo)}</b> "${vmlEsc(f.termo.trim())}" em <b>todas as vendas</b>, das mais novas para as mais antigas${f.campo === 'sku' && f.parcial ? ' (nenhum SKU tem exatamente esse código; mostrando os que contêm o trecho)' : ''}. O período e os filtros abaixo não valem durante a busca.</div>` : ''}
        </div></div>

        <div class="chips" style="margin:2px 0 14px;${buscando ? 'opacity:.45;pointer-events:none;' : ''}">
          ${[['todas','Todas',t.linhas || 0],['aprovadas','Aprovadas',a.qtd || 0],['pendentes','Pgto. pendente',t.pend || 0],['canceladas','Canceladas',c.qtd || 0]]
            .map(([k,l,n]) => `<button class="chip ${f.status === k ? 'active' : ''}" onclick="vdSet('status','${k}')">${l}<span class="n">${Number(n).toLocaleString('pt-BR')}</span></button>`).join('')}
          <span style="width:1px;background:var(--border);margin:0 6px;"></span>
          <button class="chip ${f.envio === 'todas' ? 'active' : ''}" onclick="vdSet('envio','todas')">Todos os envios</button>
          ${envios.map(e => `<button class="chip ${f.envio === e.envio ? 'active' : ''}" onclick="vdSet('envio','${e.envio}')">${e.envio}<span class="n">${Number(e.qtd).toLocaleString('pt-BR')}</span></button>`).join('')}
          <span style="width:1px;background:var(--border);margin:0 6px;"></span>
          <button class="chip ${f.semCusto ? 'active' : ''}" onclick="vdSet('semCusto',${!f.semCusto})">Sem custo ou imposto</button>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">${d.total.toLocaleString('pt-BR')} venda${d.total === 1 ? '' : 's'}</div>
            ${vmlPaginacao(f.pagina, paginas, 'vdIr')}
          </div>
          <div>
            ${d.linhas.length ? d.linhas.map(v => vdCard(v)).join('') : `<div class="vazio"><b>Nenhuma venda encontrada</b>${buscando ? (d.outraLoja ? `Nesta loja não há. Na outra loja ${d.outraLoja === 1 ? 'há 1 venda' : 'há ' + d.outraLoja.toLocaleString('pt-BR') + ' vendas'} com esse termo: escolha "Todas as lojas" na barra lateral.` : 'Procurei em todas as datas. Confira o campo escolhido em "Buscar por".') : (vmlSync.rodando ? 'Buscando no Mercado Livre…' : 'Ajuste o período ou os filtros.')}</div>`}
          </div>
          ${d.linhas.length ? `<div class="card-header" style="border-bottom:none;border-top:1px solid var(--border);"><span class="text-muted">Página ${f.pagina} de ${paginas.toLocaleString('pt-BR')}</span>${vmlPaginacao(f.pagina, paginas, 'vdIr')}</div>` : ''}
        </div>`;
      vmlAtualizarSync();
    }

    const VD_ENVIO = { pending:'Aguardando', handling:'Em preparação', ready_to_ship:'Pronto para enviar', shipped:'A caminho', delivered:'Entregue', not_delivered:'Não entregue', cancelled:'Envio cancelado' };
    const vdCep = c => { const d = String(c || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : d; };
    function vdCard(v){
      const c = vmlCalc(v), st = v.situacao, dt = vmlDataBRT(v.data_venda), log = v.envio;
      const ex = (vdDados.extra || {})[v.order_id] || {}, temCid = ex.cidade && ex.cidade !== '--';
      const nCart = v.pack_id ? (vdDados.carrinhos[v.pack_id] || 1) : 1;
      const nota = vmlNotas()[v.order_id] || '';
      const completo = c.temCusto && c.temImposto;
      const cp = (txt) => `<button class="ico-btn" style="width:20px;height:20px;border:none;background:none;" title="Copiar" onclick="vmlCopiar('${vmlEsc(txt)}', this)">⧉</button>`;
      const linha = (rot, val, cls, tit) => `<div class="${cls || ''}" ${tit ? `title="${tit}"` : ''}><span>${rot}</span><span>${val}</span></div>`;
      return `
        <div class="venda ${st === 'cancelada' ? 'cancelada' : ''}">
          <div class="v-comp">
            <div class="nome"><button class="ico-btn v-i" title="Dados do comprador" onclick="vdPagamento('${v.order_id}','comprador')">i</button>${vmlEsc(v.comprador_nome || v.comprador_apelido || 'Comprador')} ${v.comprador_nome ? cp(v.comprador_nome) : ''}</div>
            <div>${vmlEsc(v.comprador_apelido || '')} ${v.comprador_apelido ? cp(v.comprador_apelido) : ''}</div>
            <div><a class="v-id" href="https://www.mercadolivre.com.br/vendas/${v.order_id}/detalhe" target="_blank" rel="noopener" title="Ver os detalhes do pedido no ML">Venda: #${v.order_id}</a> ${cp(v.order_id)}</div>
            ${v.pack_id ? `<div><span class="v-id" onclick="vdCarrinho('${v.pack_id}')" title="Ver os itens do carrinho">Carrinho: #${v.pack_id}</span> ${cp(v.pack_id)}</div>` : ''}
            ${ex.cep || temCid ? `<div>${ex.cep ? '<b>CEP:</b> ' + vdCep(ex.cep) + ' ' + cp(vdCep(ex.cep)) : ''}${temCid ? '<span class="text-muted"> ' + vmlEsc(ex.cidade) + (ex.uf && ex.uf !== '--' ? ' - ' + ex.uf : '') + '</span>' : ''}</div>` : ''}
            <div><b>Data:</b> ${ptDate(dt.dia)} - ${dt.hora}</div>
            <div style="margin-top:4px;"><button class="ico-btn" style="width:auto;padding:0 8px;gap:5px;" onclick="vdNota('${v.order_id}')" title="Anotação da venda">✎ ${nota ? vmlEsc(nota.length > 22 ? nota.slice(0,22) + '…' : nota) : 'Anotar'}</button></div>
          </div>

          <div class="v-prod">
            ${v.thumbnail ? (/^MLB\d+$/.test(v.item_id || '') ? `<a href="https://produto.mercadolivre.com.br/${v.item_id.replace('MLB', 'MLB-')}" target="_blank" rel="noopener" title="Abrir o anúncio"><img class="v-thumb" src="${vmlEsc(v.thumbnail)}" loading="lazy" alt=""></a>` : `<img class="v-thumb" src="${vmlEsc(v.thumbnail)}" loading="lazy" alt="">`) : '<div class="v-thumb"></div>'}
            <div style="min-width:0;">
              <div class="v-tit"><span class="v-qtd">${c.qtd}x</span>${vmlEsc(v.titulo || '—')}</div>
              <div class="v-meta">
                <span><b>SKU:</b> ${vmlEsc(v.sku || 'sem SKU')}</span>${v.sku ? cp(v.sku) : ''}
                <button class="ico-btn" title="Alterar custo e imposto deste SKU" onclick="vdEditarCusto('${v.order_id}')">⚖</button>
              </div>
              <div class="v-meta">
                ${contasML.length > 1 && !contaAtiva ? `<span class="v-tag conta">${vmlEsc(contaNome(v.ml_user_id) || v.ml_user_id)}</span>` : ''}
                <span class="v-tag">${vmlEsc(v.modalidade)}</span>
                <span class="v-tag ${log === 'Full' ? 'full' : (log === 'Flex' ? 'flex' : '')}">${log === 'Full' ? '⚡ ' : ''}${vmlEsc(log)}</span>
                <button class="ico-btn" title="Informações da entrega: rastreio, prazo, pacote e endereço" onclick="vdPagamento('${v.order_id}','entrega')">📦</button>
                ${nCart > 1 ? `<span class="v-tag cart" onclick="vdCarrinho('${v.pack_id}')">🛒 +${nCart - 1} produto${nCart > 2 ? 's' : ''}</span>` : ''}
                ${v.item_id ? `<a href="https://produto.mercadolivre.com.br/${String(v.item_id).replace(/^MLB/, 'MLB-')}" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:none;" title="Ver o anúncio no ML">${vmlEsc(v.item_id)}</a>${cp(v.item_id)}` : ''}
              </div>
              <div class="v-meta"><span class="v-preco">R$ ${vmlNum(v.preco_unit)}</span><button class="ico-btn" title="Informações do pagamento" onclick="vdPagamento('${v.order_id}','pagamento')">$</button>${v.variacao ? `<span>${vmlEsc(v.variacao)}</span>` : ''}</div>
                ${ex.est_anuncio_apos != null || ex.est_galpao_apos != null ? `<div class="v-estq" title="Estoque disponível logo depois desta venda (lido quando a venda entrou no sistema)">Disponível após esta venda: ${ex.est_anuncio_apos != null ? '<b>' + Math.round(ex.est_anuncio_apos).toLocaleString('pt-BR') + '</b> ' + (ex.logistic_type === 'fulfillment' ? 'no Full' : 'no anúncio') : ''}${ex.est_anuncio_apos != null && ex.est_galpao_apos != null ? ' · ' : ''}${ex.est_galpao_apos != null ? '<b>' + Math.round(ex.est_galpao_apos).toLocaleString('pt-BR') + '</b> no galpão' : ''}</div>` : ''}
            </div>
          </div>

          <div class="v-fin">
            ${linha('Recebido', 'R$ ' + vmlNum(c.faturamento), 'pos', 'Valor dos produtos + frete pago pelo comprador')}
            ${linha('Frete', c.fretePendente ? '…' : '-R$ ' + vmlNum(c.freteVend + c.freteComp), 'neg', 'Frete do comprador + frete do vendedor')}
            ${linha('Tarifa de venda', '-R$ ' + vmlNum(c.tarifa), 'neg')}
            ${c.flexCusto > 0 ? linha('Flex', (c.flexRep - c.flexCusto >= 0 ? 'R$ ' : '-R$ ') + vmlNum(Math.abs(c.flexRep - c.flexCusto)), c.flexRep - c.flexCusto >= 0 ? 'pos' : 'neg', 'Repasse do Mercado Livre pelo envio Flex (R$ ' + vmlNum(c.flexRep) + ') menos o que você paga ao transportador (R$ ' + vmlNum(c.flexCusto) + ')') : ''}
            ${linha('Líquido ML', 'R$ ' + vmlNum(c.liquidoML), 'sub')}
            ${linha('Custo', c.temCusto ? '-R$ ' + vmlNum(c.custo) : 'sem custo', c.temCusto ? 'neg' : 'neg sem-custo')}
            ${linha('Imposto', c.temImposto ? '-R$ ' + vmlNum(c.imposto) : 'sem imposto', c.temImposto ? 'neg' : 'neg sem-custo')}
            <div class="mc" ${completo ? '' : 'title="Margem incompleta: falta custo ou imposto no cadastro do produto"'}><span>Margem${completo ? '' : ' *'}</span><span class="${!completo ? 'sem-custo' : (c.mc >= 0 ? 'mc-pos' : 'mc-neg')}">R$ ${vmlNum(c.mc)} <small>(${vmlPct(c.mcPct)})</small></span></div>
          </div>

          <div class="v-acoes">
            <div class="v-status ${st === 'aprovada' ? 'ok' : (st === 'cancelada' ? 'canc' : 'pend')}">${st === 'aprovada' ? 'Aprovada' : (st === 'cancelada' ? 'Cancelada' : 'Pagamento pendente')}</div>
            ${st !== 'cancelada' && ex.envio_status && VD_ENVIO[ex.envio_status] ? `<div class="v-envio" title="${ex.rastreio ? 'Rastreio: ' + vmlEsc(ex.rastreio) : 'Situação do envio'}" onclick="vdPagamento('${v.order_id}','entrega')">${VD_ENVIO[ex.envio_status]}</div>` : ''}
            <button class="btn-out btn btn-sm v-bt-msg" onclick="abrirMensagensVenda('${v.pack_id || v.order_id}','${v.order_id}','${v.ml_user_id || ''}')">Mensagens</button>
            <button class="btn-out btn btn-sm" onclick="vdPagamento('${v.order_id}')">Detalhes</button>
            <a class="btn-out btn btn-sm v-bt-ml" style="text-align:center;text-decoration:none;" href="https://www.mercadolivre.com.br/vendas/${v.order_id}/detalhe" target="_blank" rel="noopener">Abrir no ML</a>
          </div>
        </div>`;
    }

    function vdIr(p){ vdFiltro.pagina = p; vdCarregar(); window.scrollTo(0,0); }
    function vdSet(campo, val){ vdFiltro[campo] = val; vdFiltro.pagina = 1; vdCarregar(); }
    function vdBuscar(){ vdFiltro.termo = document.getElementById('vd-termo').value; vdFiltro.parcial = false; vdFiltro.pagina = 1; vdCarregar(); }
    function vdLimpar(){ vdFiltro.termo = ''; vdFiltro.parcial = false; vdFiltro.pagina = 1; vdCarregar(); }
    // " · hoje", " · 7 dias"… ou as datas, para o indicador dizer de que período ele é
    function vdRotPeriodo(){
      const f = vdFiltro, n = { hoje: 'hoje', ontem: 'ontem', '7d': '7 dias', '30d': '30 dias', mes: 'mês atual' }[f.atalho];
      return ' · ' + (n || (f.de && f.ate ? (f.de === f.ate ? ptDate(f.de).slice(0, 5) : ptDate(f.de).slice(0, 5) + ' a ' + ptDate(f.ate).slice(0, 5)) : 'período'));
    }
    function vdSetAtalho(k){ const p = vmlAtalho(k); vdFiltro.atalho = k; vdFiltro.de = p.de; vdFiltro.ate = p.ate; vdFiltro.pagina = 1; renderVendas(); }
    function vdSetData(campo, val){
      if(!val) return;
      vdFiltro[campo] = val; vdFiltro.atalho = '';
      if(vdFiltro.ate < vdFiltro.de){ if(campo === 'de') vdFiltro.ate = val; else vdFiltro.de = val; }
      vdFiltro.pagina = 1; renderVendas();
    }
    function vdAtualizar(){ vmlSincronizar(vdFiltro.de, vdFiltro.ate, vmlDiasEntre(vdFiltro.de, vdFiltro.ate) <= 3, () => vdCarregar()); }

    function vdAchar(orderId){
      return vdDados.linhas.concat(rfDados.linhas).find(v => String(v.order_id) === String(orderId));
    }

    async function vdCarrinho(packId){
      vmlModal('Carrinho: ' + packId, '<div class="vazio">Carregando…</div>');
      const { data } = await supa.from('vendas_ml_calc').select('order_id,qtd,titulo,sku,preco_unit,thumbnail').eq('usuario_id', usuarioAtual.id).eq('pack_id', packId);
      vmlModal('Carrinho: ' + packId, `
        <div class="alert alert-info">Os produtos abaixo foram vendidos no mesmo carrinho e seguem no mesmo frete (o custo do frete é dividido entre eles).</div>
        ${(data || []).map(v => `<div class="d-flex gap-2" style="align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
          ${v.thumbnail ? `<img class="v-thumb" src="${vmlEsc(v.thumbnail)}" alt="">` : '<div class="v-thumb"></div>'}
          <div><div class="text-muted">#${v.order_id}</div><div class="v-tit"><span class="v-qtd">${v.qtd}x</span>${vmlEsc(v.titulo)}</div><div class="text-muted">SKU: ${vmlEsc(v.sku || '—')} · R$ ${vmlNum(v.preco_unit)}</div></div>
        </div>`).join('')}`);
    }

    function vdPagamento(orderId, foco){
      const v = vdAchar(orderId); if(!v) return;
      setTimeout(() => vdDetalheML(orderId, foco), 0);
      const c = vmlCalc(v), dt = vmlDataBRT(v.data_venda);
      const l = (a,b) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);"><span class="text-muted">${a}</span><b>${b}</b></div>`;
      vmlModal('Detalhes da venda #' + v.order_id, `
        <div class="v-tit" style="margin-bottom:10px;"><span class="v-qtd">${c.qtd}x</span>${vmlEsc(v.titulo)}</div>
        <div class="responsive-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:0 26px;">
          <div>
            ${l('Data da venda', ptDate(dt.dia) + ' ' + dt.hora)}
            ${l('Status', v.situacao)}
            ${l('Comprador', vmlEsc(v.comprador_nome || v.comprador_apelido || '—'))}
            ${l('Anúncio', vmlEsc(v.item_id || '—') + ' · ' + vmlEsc(v.modalidade))}
            ${l('Envio', vmlEsc(v.envio) + (v.shipping_id ? ' · #' + v.shipping_id : ''))}
            ${l('Total pago pelo comprador', 'R$ ' + vmlNum(v.total_pago))}
          </div>
          <div>
            ${l('Valor dos produtos', 'R$ ' + vmlNum(c.bruto))}
            ${l('Frete pago pelo comprador', 'R$ ' + vmlNum(c.freteComp))}
            ${l('Frete pago pelo vendedor', c.fretePendente ? 'buscando…' : '-R$ ' + vmlNum(c.freteVend))}
            ${l('Tarifa de venda', '-R$ ' + vmlNum(c.tarifa))}
            ${c.flexCusto > 0 ? l('Repasse do ML pelo envio Flex', 'R$ ' + vmlNum(c.flexRep)) + l('Pago ao transportador (Flex)', '-R$ ' + vmlNum(c.flexCusto)) : ''}
            ${l('Custo do produto', c.temCusto ? '-R$ ' + vmlNum(c.custo) : 'não cadastrado')}
            ${l('Imposto', c.temImposto ? '-R$ ' + vmlNum(c.imposto) : (c.flex ? 'Flex sem imposto (ou não cadastrado)' : 'não cadastrado'))}
            ${l('Margem de contribuição', `<span class="${c.mc >= 0 ? 'mc-pos' : 'mc-neg'}">R$ ${vmlNum(c.mc)} (${vmlPct(c.mcPct)})</span>`)}
          </div>
        </div>
        <div id="vd-det-ml"><div class="text-muted" style="padding:16px 0 4px;">Buscando entrega, pagamento e comprador no Mercado Livre…</div></div>`);
    }

    async function vdFuncao(corpo){
      const sd = await supa.auth.getSession(), tk = sd && sd.data && sd.data.session ? sd.data.session.access_token : '';
      const r = await fetch(SUPA_URL + '/functions/v1/ml-venda', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      return r.json().catch(() => ({ error: 'resposta inválida' }));
    }
    const VD_PAG = { account_money:'Saldo em conta', credit_card:'Cartão de crédito', debit_card:'Cartão de débito', ticket:'Boleto', bank_transfer:'Pix ou transferência', digital_currency:'Mercado Crédito', digital_wallet:'Carteira digital' };
    const VD_PAG_ST = { approved:'Aprovado', pending:'Pendente', in_process:'Em análise', rejected:'Recusado', refunded:'Devolvido', cancelled:'Cancelado', charged_back:'Contestado', accredited:'Pagamento creditado' };
    const VD_LOG = { fulfillment:'Full', self_service:'Flex', cross_docking:'Coleta', xd_drop_off:'Agência', drop_off:'Correios' };
    async function vdDetalheML(orderId, foco){
      const alvo = () => document.getElementById('vd-det-ml');
      let d; try { d = await vdFuncao({ acao: 'detalhe', pedido: orderId }); } catch(e){ d = { error: 'sem conexão' }; }
      const el = alvo(); if(!el) return;
      if(d && d.demo){ el.innerHTML = '<div class="alert alert-info" style="margin-top:14px;">Na demonstração, os dados de entrega, pagamento e comprador ficam desligados: eles são lidos na hora na conta do Mercado Livre.</div>'; return; }
      if(!d || d.error || !d.ok){ el.innerHTML = '<div class="alert alert-warning" style="margin-top:14px;">Não consegui ler os detalhes no Mercado Livre agora' + (d && d.error ? ': ' + vmlEsc(d.error) : '') + '.</div>'; return; }
      const l = (a, b) => b === '' || b == null ? '' : `<div class="vd-l"><span class="text-muted">${a}</span><b>${b}</b></div>`;
      const dh = s => { if(!s) return ''; const x = vmlDataBRT(s); return ptDate(x.dia) + ' ' + x.hora; };
      const dd = s => s ? ptDate(vmlDataBRT(s).dia) : '';
      const cp = txt => `<button class="ico-btn" style="width:20px;height:20px;border:none;background:none;" title="Copiar" onclick="vmlCopiar('${vmlEsc(txt)}', this)">⧉</button>`;
      const e = d.entrega, p = d.pagamento, c = d.comprador || {};
      const end = e ? [e.endereco, e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ') : '';
      const bloco = (id, tit, corpo) => `<div class="vd-sec" id="vd-sec-${id}"><h4>${tit}</h4><div class="vd-cols">${corpo}</div></div>`;
      el.innerHTML =
        (e ? bloco('entrega', 'Entrega',
          l('Nº do envio', '#' + vmlEsc(e.envio) + ' ' + cp(e.envio)) + l('Tipo', VD_LOG[e.tipo] || vmlEsc(e.tipo)) + l('Situação', (VD_ENVIO[e.status] || vmlEsc(e.status)) + (e.substatus ? ' <small class="text-muted">(' + vmlEsc(e.substatus) + ')</small>' : '')) +
          l('Código de rastreio', e.rastreio ? vmlEsc(e.rastreio) + ' ' + cp(e.rastreio) : '') + l('Transportadora', vmlEsc(e.transportadora)) + l('Entrega prevista', dd(e.prevista)) + l('Limite para despachar', dh(e.limite_envio)) +
          l('Pacote', e.altura || e.largura || e.comprimento ? `${e.altura} × ${e.largura} × ${e.comprimento} cm` : '') + l('Peso', e.peso ? e.peso.toLocaleString('pt-BR') + ' g' : '') + l('Valor declarado', e.valor_declarado ? 'R$ ' + vmlNum(e.valor_declarado) : '') +
          l('Destinatário', vmlEsc(e.destinatario)) + l('CEP', e.cep ? vdCep(e.cep) + ' ' + cp(vdCep(e.cep)) : '') +
          (end ? `<div class="vd-l vd-larga"><span class="text-muted">Endereço</span><b>${vmlEsc(end)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end + ' ' + (e.cep || ''))}" target="_blank" rel="noopener" style="font-weight:500;">ver no mapa</a></b></div>` : ''))
          : '<div class="text-muted" style="padding:14px 0 0;">Esta venda não tem envio pelo Mercado Envios.</div>') +
        (p ? bloco('pagamento', 'Pagamento',
          l('Criado em', dh(p.criado)) + l('Aprovado em', dh(p.aprovado)) + l('Forma', (VD_PAG[p.tipo] || vmlEsc(p.tipo)) + (p.parcelas > 1 ? ' em ' + p.parcelas + 'x' : '')) + l('Meio', vmlEsc(p.meio)) +
          l('Situação', (VD_PAG_ST[p.status] || vmlEsc(p.status)) + (p.detalhe && VD_PAG_ST[p.detalhe] && p.detalhe !== p.status ? ' · ' + VD_PAG_ST[p.detalhe] : '')) + l('Valor dos produtos', 'R$ ' + vmlNum(p.produtos)) + l('Total cobrado do comprador', 'R$ ' + vmlNum(p.total)) +
          l('Devolvido', p.reembolsado ? 'R$ ' + vmlNum(p.reembolsado) : 'R$ 0,00') + l('Pago a mais', p.a_mais ? 'R$ ' + vmlNum(p.a_mais) : 'R$ 0,00') + (p.qtd > 1 ? l('Pagamentos', p.qtd) : '')) : '') +
        bloco('comprador', 'Comprador',
          l('Nome', vmlEsc(c.nome || '—')) + l('Apelido', vmlEsc(c.apelido)) + l(c.doc_tipo || 'Documento', c.doc ? vmlEsc(c.doc) + ' ' + cp(c.doc) : 'não informado') + l('Código no Mercado Livre', vmlEsc(c.id))) +
        `<div class="vd-acoes">
          ${e ? `<button class="btn-out btn btn-sm" onclick="vdEtiqueta('${orderId}', this)" title="Abre a etiqueta do envio em PDF. Vale também para etiqueta já impressa na UpSeller; depois que o pacote sai, usa a cópia guardada aqui.">🖨 ${d.tem_etiqueta ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}</button>` : ''}
          <button class="btn-out btn btn-sm" onclick="vdNotaFiscal('${orderId}', this)" title="Mostra a nota fiscal que o Mercado Livre tem desta venda (Full e coleta). Nada é guardado.">🧾 Ver nota fiscal</button>
          <span id="vd-det-msg" class="text-muted" style="font-size:12.5px;"></span>
        </div><div id="vd-det-nf"></div>`;
      if(foco){ const s = document.getElementById('vd-sec-' + foco); if(s){ s.classList.add('vd-foco'); s.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
      // o que acabou de ser lido passa a aparecer no cartão
      if(e && vdDados.extra){ const x = vdDados.extra[orderId] || (vdDados.extra[orderId] = {}); x.cidade = e.cidade || x.cidade; x.uf = e.uf || x.uf; x.cep = e.cep || x.cep; x.rastreio = e.rastreio || x.rastreio; x.envio_status = e.status || x.envio_status; }
    }
    // abre um PDF (base64) em outra aba, pronto para imprimir
    function vdAbrirPdf(b64){
      const bin = atob(b64), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function vdDanfe(orderId, bt){
      const rot = bt.textContent; bt.disabled = true; bt.textContent = 'Buscando a nota…';
      let d; try { d = await vdFuncao({ acao: 'danfe', pedido: orderId }); } catch(e){ d = { error: 'sem conexão' }; }
      bt.disabled = false; bt.textContent = rot;
      const m = document.getElementById('vd-danfe-msg');
      if(d && d.ok && d.pdf){ vdAbrirPdf(d.pdf); if(m) m.textContent = 'Nota aberta em outra aba.'; }
      else if(m) m.textContent = (d && (d.motivo || d.error)) || 'Não foi possível abrir a nota.';
    }
    async function vdEtiqueta(orderId, bt){
      const msg = document.getElementById('vd-det-msg'), rot = bt.textContent; bt.disabled = true; bt.textContent = 'Buscando etiqueta…'; if(msg) msg.textContent = '';
      let d; try { d = await vdFuncao({ acao: 'etiqueta', pedido: orderId }); } catch(e){ d = { error: 'sem conexão' }; }
      bt.disabled = false; bt.textContent = rot;
      if(d && d.ok && d.pdf){
        vdAbrirPdf(d.pdf);
        if(msg) msg.textContent = d.origem === 'guardada' ? 'Etiqueta aberta (cópia guardada no Caixa 360).' : 'Etiqueta aberta e cópia guardada por 12 meses.';
      } else if(msg) msg.textContent = (d && (d.motivo || d.error)) || 'Não foi possível abrir a etiqueta.';
    }
    async function vdNotaFiscal(orderId, bt){
      const el = document.getElementById('vd-det-nf'), rot = bt.textContent; bt.disabled = true; bt.textContent = 'Consultando…';
      let d; try { d = await vdFuncao({ acao: 'nota', pedido: orderId }); } catch(e){ d = { error: 'sem conexão' }; }
      bt.disabled = false; bt.textContent = rot; if(!el) return;
      if(!d || !d.ok){ el.innerHTML = '<div class="alert alert-info" style="margin-top:12px;">' + vmlEsc((d && (d.motivo || d.error)) || 'Sem nota para esta venda.') + '</div>'; return; }
      const l = (a, b) => b ? `<div class="vd-l"><span class="text-muted">${a}</span><b>${b}</b></div>` : '';
      const cp = txt => `<button class="ico-btn" style="width:20px;height:20px;border:none;background:none;" title="Copiar" onclick="vmlCopiar('${vmlEsc(txt)}', this)">⧉</button>`;
      el.innerHTML = `<div class="vd-sec vd-foco"><h4>Nota fiscal <small class="text-muted" style="font-weight:500;">· ${vmlEsc(d.origem)}</small></h4><div class="vd-cols">
        ${l('Número', vmlEsc(String(d.numero)) + (d.serie ? ' · série ' + vmlEsc(String(d.serie)) : ''))}${l('Emitida em', d.emitida ? ptDate(String(d.emitida).substring(0, 10)) : '')}${l('Valor', d.valor ? 'R$ ' + vmlNum(d.valor) : '')}${l('Situação', vmlEsc(String(d.situacao || '')))}
        ${d.chave ? `<div class="vd-l vd-larga"><span class="text-muted">Chave de acesso</span><b style="word-break:break-all;">${vmlEsc(d.chave)} ${cp(d.chave)}</b></div>` : ''}
        </div><div class="vd-acoes" style="margin-top:10px;"><button class="btn btn-sm" onclick="vdDanfe('${orderId}', this)" title="Abre o PDF da nota (DANFE) em outra aba para imprimir. Nada é guardado.">🖨 Imprimir nota (DANFE)</button>${d.chave ? `<a href="https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=" target="_blank" rel="noopener" style="font-size:12.5px;">Consultar no portal da nota fiscal</a>` : ''}<span id="vd-danfe-msg" class="text-muted" style="font-size:12.5px;"></span></div></div>`;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // separa "N sem custo ou imposto" em custo e imposto (duas contagens rápidas)
    async function vmlSemDetalhe(de, ate, elId){
      try {
        const base = () => { let q = supa.from('vendas_ml_calc').select('order_id', { count: 'exact', head: true }).eq('usuario_id', usuarioAtual.id).eq('situacao', 'aprovada').gte('dia', de).lte('dia', ate); if(contaAtiva) q = q.eq('ml_user_id', contaAtiva); return q; };
        const [a, b] = await Promise.all([base().eq('tem_custo', false), base().eq('tem_imposto', false)]);
        const el = document.getElementById(elId); if(!el) return;
        const p = []; if(a.count) p.push(a.count + ' sem custo'); if(b.count) p.push(b.count + ' sem imposto');
        if(p.length) el.textContent = p.join(' · ');
      } catch(e){}
    }

    // Custo e imposto, como no Mercado Turbo: só nesta venda, ou no cadastro do SKU (vale dali para frente).
    function vdEditarCusto(orderId){
      const v = vdAchar(orderId); if(!v) return;
      if(!v.sku){ vmlModal('Custo & Imposto', '<div class="alert alert-warning">Este anúncio não tem SKU no Mercado Livre. Cadastre o SKU no anúncio para vincular custo e imposto.</div>'); return; }
      const info = vmlSkuInfo(v.sku) || {};
      const per = document.getElementById('view-resumo-fin').classList.contains('active') ? rfFiltro : vdFiltro;
      const custoVenda = Number(v.custo_unit) > 0 ? Number(v.custo_unit) : (Number(info.custo) || ''), impVenda = Number(v.imposto_pct) > 0 ? Number(v.imposto_pct) : (Number(info.imposto) || '');
      vmlModal('Custo & Imposto', `
        <div class="v-tit" style="margin-bottom:4px;">${vmlEsc(v.titulo)}</div>
        <div class="text-muted" style="margin-bottom:16px;">SKU <b>${vmlEsc(v.sku)}</b> · Venda #${vmlEsc(orderId)} · Preço unitário R$ ${vmlNum(v.preco_unit)}${Number(info.custo) > 0 ? ' · no cadastro hoje: R$ ' + vmlNum(info.custo) + (Number(info.imposto) > 0 ? ' e ' + String(info.imposto).replace('.', ',') + '%' : '') : ' · sem custo no cadastro'}</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Custo unitário (R$)</label><input type="number" step="0.01" min="0" id="vml-custo" value="${custoVenda}"></div>
          <div class="form-group"><label class="form-label">Imposto (% sobre a venda)</label><input type="number" step="0.01" min="0" id="vml-imposto" value="${impVenda}"></div>
        </div>
        <div class="form-label" style="margin-top:4px;">Onde aplicar</div>
        <label class="vml-opcao"><input type="radio" name="vml-onde" value="venda" onchange="vdCustoOnde()"> <span><b>Só nesta venda</b><br><span class="text-muted">Corrige o custo e o imposto desta venda. O cadastro do produto e as outras vendas não mudam.</span></span></label>
        <label class="vml-opcao"><input type="radio" name="vml-onde" value="sku" checked onchange="vdCustoOnde()"> <span><b>No cadastro do SKU</b><br><span class="text-muted">Vale para as vendas <b>daqui para frente</b> e para as que ainda estavam sem custo. As vendas antigas mantêm o custo da época.</span></span></label>
        <label id="vml-aplicar-box" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;line-height:1.45;margin:6px 0 0 28px;font-size:13px;"><input type="checkbox" id="vml-aplicar" style="width:auto;margin-top:3px;"> <span>Aplicar também às vendas deste SKU <b>no período exibido</b> (${ptDate(per.de)} a ${ptDate(per.ate)})</span></label>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" id="vml-salvar-custo" onclick="vdSalvarCusto('${vmlEsc(v.sku)}','${orderId}')">Salvar</button>`);
    }
    function vdCustoOnde(){
      const sku = (document.querySelector('input[name="vml-onde"]:checked') || {}).value !== 'venda';
      const box = document.getElementById('vml-aplicar-box'); if(box) box.style.display = sku ? 'flex' : 'none';
    }

    async function vdSalvarCusto(sku, orderId){
      const custo = parseFloat(document.getElementById('vml-custo').value) || 0;
      const imposto = parseFloat(document.getElementById('vml-imposto').value) || 0;
      const soVenda = (document.querySelector('input[name="vml-onde"]:checked') || {}).value === 'venda';
      const b = document.getElementById('vml-salvar-custo'); if(b){ b.textContent = 'Salvando…'; b.disabled = true; }
      if(soVenda){
        const r = await supa.rpc('vendas_ml_custo_venda', { p_pedido: String(orderId), p_sku: sku, p_custo: custo || null, p_imposto: imposto || null });
        if(r.error){ if(typeof toast === 'function') toast('Não consegui gravar: ' + r.error.message); if(b){ b.textContent = 'Salvar'; b.disabled = false; } return; }
        fecharModal('modal-vml'); vmlRecarregar();
        if(typeof toast === 'function') toast('Custo gravado só nesta venda.');
        return;
      }
      const info = vmlSkuInfo(sku);
      if(info){ info.custo = custo; info.imposto = imposto; }
      else {
        const v = vdAchar(orderId);
        skus.push({ sku: String(sku).trim().toUpperCase(), titulo: v ? v.titulo : '', custo, imposto, created_at: new Date().toISOString() });
      }
      localStorage.setItem('mk_skus', JSON.stringify(skus));
      // a margem é calculada no banco: espera o cadastro subir antes de recarregar
      const aplicar = document.getElementById('vml-aplicar')?.checked;
      const per = document.getElementById('view-resumo-fin').classList.contains('active') ? rfFiltro : vdFiltro;
      try {
        await salvarSupabase();
        // período longo: vai para a fila e o sininho avisa (não segura a tela nem estoura o tempo do banco)
        if(aplicar && typeof tarefaPedir === 'function' && tfDias(per.de, per.ate) > TF_DIAS_FILA){
          await supa.rpc('vendas_ml_carimbar');
          await tarefaPedir('nivelar', { de: per.de, ate: per.ate, sku, custo: custo || null, imposto: imposto || null, conta: contaParam() || '' }, 'Nivelar custo de ' + sku + ' (' + per.de.split('-').reverse().join('/') + ' a ' + per.ate.split('-').reverse().join('/') + ')', () => vmlRecarregar());
        }
        else if(aplicar) await supa.rpc('vendas_ml_nivelar', { p_de: per.de, p_ate: per.ate, p_sku: sku, p_custo: custo || null, p_imposto: imposto || null, p_conta: contaParam() });
        else await supa.rpc('vendas_ml_carimbar');   // grava o valor nas vendas que estavam sem custo
      } catch(e){}
      fecharModal('modal-vml');
      vmlRecarregar();
    }

    function vmlRecarregar(){
      if(document.getElementById('view-vendas').classList.contains('active')) vdCarregar();
      if(document.getElementById('view-resumo-fin').classList.contains('active')) rfCarregar();
    }

    // Anotações por venda (ficam neste navegador)
    function vmlNotas(){ try { return JSON.parse(localStorage.getItem('mk_vml_notas') || '{}'); } catch(e){ return {}; } }
    function vdNota(orderId){
      const atual = vmlNotas()[orderId] || '';
      vmlModal('Anotação da venda #' + orderId,
        `<textarea id="vml-nota" rows="4" placeholder="Escreva uma anotação para esta venda">${vmlEsc(atual)}</textarea>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" onclick="vdSalvarNota('${orderId}')">Salvar</button>`);
    }
    function vdSalvarNota(orderId){
      const n = vmlNotas(); const t = document.getElementById('vml-nota').value.trim();
      if(t) n[orderId] = t; else delete n[orderId];
      localStorage.setItem('mk_vml_notas', JSON.stringify(n));
      fecharModal('modal-vml'); vdDesenhar();
    }

    // ----- exportação (limitada: período curto e poucas linhas, como no Mercado Turbo) -----
    function vmlLinhasExport(lista){
      return lista.map(v => {
        const c = vmlCalc(v), dt = vmlDataBRT(v.data_venda);
        return {
          'Data': ptDate(dt.dia), 'Hora': dt.hora, 'Venda': String(v.order_id), 'Carrinho': v.pack_id ? String(v.pack_id) : '',
          'Status': v.situacao, 'Anúncio': v.titulo || '', 'MLB': v.item_id || '', 'SKU': v.sku || '',
          'Modalidade': v.modalidade, 'Envio': v.envio, 'Comprador': v.comprador_nome || v.comprador_apelido || '',
          'Qtd': c.qtd, 'Valor unit.': Number(v.preco_unit) || 0, 'Valor produtos': c.bruto, 'Frete comprador': c.freteComp,
          'Custo': c.custo, 'Imposto': c.imposto, 'Tarifa de venda': c.tarifa, 'Frete vendedor': c.freteVend,
          'Margem contrib.': c.mc, 'MC %': c.mcPct
        };
      });
    }
    async function vmlBaixar(consulta, de, ate, total, nome, formato){
      if(vmlDiasEntre(de, ate) > VML_EXPORT_MAX_DIAS || total > VML_EXPORT_MAX_LINHAS){
        alert(`A exportação está disponível para períodos de até ${VML_EXPORT_MAX_DIAS} dias e ${VML_EXPORT_MAX_LINHAS.toLocaleString('pt-BR')} vendas. Reduza o período ou aplique filtros.`);
        return;
      }
      if(!total){ alert('Não há vendas para exportar.'); return; }
      const todas = [];
      for(let from = 0; from < VML_EXPORT_MAX_LINHAS; from += 1000){
        const { data, error } = await consulta().order('data_venda', {ascending:false}).range(from, from + 999);
        if(error || !data || !data.length) break;
        todas.push(...data);
        if(data.length < 1000) break;
      }
      const ws = XLSX.utils.json_to_sheet(vmlLinhasExport(todas));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Vendas');
      XLSX.writeFile(wb, nome + (formato === 'csv' ? '.csv' : '.xlsx'), formato === 'csv' ? { bookType:'csv' } : undefined);
    }
    function vdExportar(){ vmlBaixar(() => vdConsulta('*'), vdFiltro.de, vdFiltro.ate, vdDados.total, `vendas_${vdFiltro.de}_${vdFiltro.ate}`, 'xlsx'); }

    // ===================================================================
    // RESUMO FINANCEIRO
    // ===================================================================
    const RF_COLS = [
      ['titulo','Anúncio','','titulo'], ['sku','SKU','','sku'], ['data','Data','','data_venda'], ['envio','Frete','','envio'],
      ['unit','Valor unit.','num','preco_unit'], ['qtd','Qtd.','num','qtd'], ['fat','Faturamento ML','num','bruto'],
      ['custo','Custo (−)','num','custo'], ['imposto','Imposto (−)','num','imposto'], ['tarifa','Tarifa de venda (−)','num','tarifa'],
      ['fcomp','Frete comprador','num','frete_comprador'], ['fvend','Frete vendedor (−)','num','frete_vendedor'],
      ['mc','Margem contrib. (=)','num','mc'], ['mcp','MC em %','num','mc_pct']
    ];
    function rfParams(){
      const f = rfFiltro;
      return { p_de:f.de, p_ate:f.ate, p_pedido:f.pedido.trim() || null, p_titulo:f.titulo.trim() || null, p_sku:f.sku.trim() || null,
        p_modalidade: f.modalidade === 'todas' ? null : f.modalidade, p_envio: f.frete === 'todos' ? null : f.frete, p_custo: f.custo === 'todos' ? null : f.custo, p_conta: contaParam() };
    }
    function rfConsulta(sel, opts){
      const f = rfFiltro, limpa = s => s.trim().replace(/[%,()]/g, ' ');
      let q = supa.from('vendas_ml_calc').select(sel, opts).eq('usuario_id', usuarioAtual.id).gte('dia', f.de).lte('dia', f.ate);
      if(contaAtiva) q = q.eq('ml_user_id', contaAtiva);
      if(f.status === 'aprovadas') q = q.eq('situacao', 'aprovada');
      if(f.status === 'canceladas') q = q.eq('situacao', 'cancelada');
      if(f.pedido.trim()) q = q.or(`order_txt.ilike.%${limpa(f.pedido)}%,pack_txt.ilike.%${limpa(f.pedido)}%`);
      if(f.titulo.trim()) q = q.or(`titulo.ilike.%${limpa(f.titulo)}%,item_id.ilike.%${limpa(f.titulo)}%`);
      if(f.sku.trim()) q = q.ilike('sku', '%' + limpa(f.sku) + '%');
      if(f.modalidade !== 'todas') q = q.eq('modalidade', f.modalidade);
      if(f.frete !== 'todos') q = q.eq('envio', f.frete);
      if(f.custo === 'sem-custo') q = q.eq('tem_custo', false);
      if(f.custo === 'sem-imposto') q = q.eq('tem_imposto', false);
      if(f.custo === 'sem-um') q = q.or('tem_custo.eq.false,tem_imposto.eq.false');
      if(f.custo === 'sem-ambos') q = q.eq('tem_custo', false).eq('tem_imposto', false);
      return q;
    }

    async function rfCarregar(){
      if(!usuarioAtual) return;
      const seq = ++vmlSeq, f = rfFiltro;
      const ini = (f.pagina - 1) * f.porPagina;
      const col = (RF_COLS.find(c => c[0] === f.ordem) || RF_COLS[2])[3];
      const [pag, tot] = await Promise.all([
        rfConsulta('*', { count:'exact' }).order(col, {ascending:!f.desc, nullsFirst:false}).range(ini, ini + f.porPagina - 1),
        (typeof tfTotaisRpc === 'function' ? tfTotaisRpc(rfParams(), rfCarregar) : supa.rpc('vendas_ml_totais', rfParams()))
      ]);
      if(seq !== vmlSeq) return;
      rfDados = { linhas: pag.data || [], total: pag.count || 0, tot: tot.data || null, carregado:true, erro: pag.error?.message || tot.error?.message };
      rfDesenhar();
      if(document.getElementById('rf-sem')) vmlSemDetalhe(rfFiltro.de, rfFiltro.ate, 'rf-sem');
    }

    function renderResumoFin(){
      const el = document.getElementById('view-resumo-fin');
      if(!el) return;
      if(!rfFiltro.de){ rfFiltro.de = getToday(); rfFiltro.ate = getToday(); }
      if(!rfDados.carregado) el.innerHTML = '<div class="vazio"><b>Carregando resumo…</b></div>';
      rfCarregar();
      vmlSincronizar(rfFiltro.de, rfFiltro.ate, false, () => { if(el.classList.contains('active')) rfCarregar(); });
    }

    function rfDonut(partes){
      const total = partes.reduce((s,p) => s + Math.max(0, p.v), 0);
      if(total <= 0) return '<div class="vazio">Sem dados no período.</div>';
      const R = 70, C = 2 * Math.PI * R;
      let acum = 0;
      const arcos = partes.filter(p => p.v > 0).map(p => {
        const frac = p.v / total, dash = frac * C;
        const ang = (acum + frac / 2) * 2 * Math.PI - Math.PI / 2;
        const seg = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${p.cor}" stroke-width="34" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acum * C}" transform="rotate(-90 100 100)"><title>${p.nome}: R$ ${vmlNum(p.v)}</title></circle>`
          + (frac > 0.05 ? `<text x="${100 + Math.cos(ang) * R}" y="${100 + Math.sin(ang) * R + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${(frac * 100).toFixed(1)}%</text>` : '');
        acum += frac;
        return seg;
      }).join('');
      return `<div class="donut-wrap">
        <svg viewBox="0 0 200 200" width="210" height="210">${arcos}</svg>
        <div class="donut-leg">${partes.map(p => `<div><i style="background:${p.cor}"></i>${p.nome} · <b>R$ ${vmlNum(p.v)}</b></div>`).join('')}</div>
      </div>`;
    }

    function rfDesenhar(){
      const el = document.getElementById('view-resumo-fin');
      if(!el || !el.classList.contains('active')) return;
      const f = rfFiltro, g = rfPend || rfFiltro, d = rfDados, T = d.tot || {}, a = T.aprov || {}, c = T.canc || {};
      const n = k => Number(a[k]) || 0;
      const vendas = n('bruto') + (vmlFreteComprador ? n('frete_comp') : 0);
      const porEnvio = {};
      (T.por_envio || []).forEach(e => { porEnvio[e.envio] = Number(e.bruto) + (vmlFreteComprador ? Number(e.frete_comp) : 0); });
      const log = k => 'R$ ' + vmlNum(porEnvio[k] || 0);
      const outros = Object.keys(porEnvio).filter(k => !['Full','Flex','Coleta','Agência','Places'].includes(k)).reduce((s,k) => s + porEnvio[k], 0);
      const paginas = Math.max(1, Math.ceil(d.total / f.porPagina));
      const sel = (id, val, opts) => `<select onchange="rfSet('${id}', this.value)">${opts.map(([k,l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const nDias = vmlDiasEntre(f.de, f.ate);
      const podeExportar = nDias <= VML_EXPORT_MAX_DIAS && d.total <= VML_EXPORT_MAX_LINHAS;

      el.innerHTML = `
        <div class="pg-head">
          <div>
            <div class="pg-title">Resumo Financeiro</div>
            <div class="pg-sub">Receitas, despesas e margem de contribuição das suas vendas no Mercado Livre.</div>
          </div>
          <div class="d-flex gap-1" style="align-items:center;flex-wrap:wrap;">
            <span class="sync-bar vml-sync"></span>
            <button class="btn-out btn btn-sm" onclick="rfAtualizar()">↻ Atualizar</button>
            <button class="btn-out btn btn-sm" onclick="rfLegenda()">Legendas</button>
            <button class="btn-out btn btn-sm" onclick="rfRanking()">🏆 Ranking de produtos</button>
            <div class="dd-wrap" style="position:relative;display:inline-block;">
              <button class="btn btn-sm" title="${podeExportar ? 'Exportar todas as vendas filtradas' : 'Período grande: exporta apenas a página atual'}" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">⬇ Exportar ▾</button>
              <div class="dd-menu" style="display:none;position:absolute;right:0;top:110%;z-index:20;min-width:150px;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-lg);padding:6px;">
                <div class="dd-item" style="padding:8px 10px;cursor:pointer;border-radius:7px;" onclick="rfExportar('xlsx')">Excel (.xlsx)</div>
                <div class="dd-item" style="padding:8px 10px;cursor:pointer;border-radius:7px;" onclick="rfExportar('csv')">CSV</div>
              </div>
            </div>
          </div>
        </div>
        ${vmlAvisoPermissao()}
        ${d.erro ? `<div class="alert alert-danger">Erro ao consultar as vendas: ${vmlEsc(d.erro)}</div>` : ''}

        <div class="kpi-grid k5">
          <div class="kpi k-venda">
            <div class="kpi-label" title="Valor dos produtos${vmlFreteComprador ? ' + frete pago pelo comprador' : ''} das vendas aprovadas">Vendas aprovadas</div>
            <div class="kpi-value">R$ ${vmlNum(vendas)}</div>
            <div class="kpi-sub"><span>Canceladas <b>R$ ${vmlNum(c.valor)}</b></span></div>
            <label style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:11.5px;color:var(--text-muted);cursor:pointer;">
              <input type="checkbox" ${vmlFreteComprador ? 'checked' : ''} onchange="rfToggleFrete(this.checked)" style="width:auto;"> Considerar frete do comprador
            </label>
          </div>
          <div class="kpi k-custo"><div class="kpi-label" title="Valores do cadastro de Produtos">Custo &amp; imposto</div><div class="kpi-value">R$ ${vmlNum(n('custo') + n('imposto'))}</div><div class="kpi-sub"><span>Custo <b>R$ ${vmlNum(n('custo'))}</b></span><span>Imposto <b>R$ ${vmlNum(n('imposto'))}</b></span></div></div>
          <div class="kpi k-tarifa"><div class="kpi-label">Tarifa de venda</div><div class="kpi-value">R$ ${vmlNum(n('tarifa'))}</div><div class="kpi-sub"><span><b>${vmlPct(n('bruto') ? n('tarifa') / n('bruto') * 100 : 0)}</b> das vendas</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Frete total</div><div class="kpi-value">R$ ${vmlNum(n('frete_comp') + n('frete_vend'))}</div><div class="kpi-sub"><span>Comprador <b>R$ ${vmlNum(n('frete_comp'))}</b></span><span>Vendedor <b>R$ ${vmlNum(n('frete_vend'))}</b></span></div></div>
          <div class="kpi k-mc"><div class="kpi-label" title="Vendas aprovadas − custo − imposto − tarifa − frete do vendedor">Margem de contribuição</div><div class="kpi-value">R$ ${vmlNum(n('mc'))}</div><div class="kpi-sub"><span><b>${vmlPct(n('bruto') ? n('mc') / n('bruto') * 100 : 0)}</b></span>${a.sem_custo ? `<span class="sem-custo" id="rf-sem">${a.sem_custo} sem custo ou imposto</span>` : ''}</div></div>
        </div>
        <div class="kpi-grid k4">
          <div class="kpi k-neutro"><div class="kpi-label">Por tipo de envio</div>
            <div class="kpi-sub" style="margin-top:9px;display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;">
              <span>Full <b>${log('Full')}</b></span><span>Flex <b>${log('Flex')}</b></span>
              <span>Coleta <b>${log('Coleta')}</b></span><span>Agência/Places <b>R$ ${vmlNum((porEnvio['Agência'] || 0) + (porEnvio['Places'] || 0))}</b></span>
              <span>Outros <b>R$ ${vmlNum(outros)}</b></span>
            </div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Qtd. vendas aprovadas</div><div class="kpi-value">${n('qtd').toLocaleString('pt-BR')}</div><div class="kpi-sub"><span><b>${n('un').toLocaleString('pt-BR')}</b> unidades</span><span>Canceladas <b>${c.qtd || 0}</b> (${c.un || 0} un.)</span></div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Ticket médio por venda</div><div class="kpi-value">R$ ${vmlNum(n('qtd') ? vendas / n('qtd') : 0)}</div></div>
          <div class="kpi k-neutro"><div class="kpi-label">Ticket médio da margem</div><div class="kpi-value">R$ ${vmlNum(n('qtd') ? n('mc') / n('qtd') : 0)}</div><div class="kpi-sub"><span><b>${vmlPct(n('bruto') ? n('mc') / n('bruto') * 100 : 0)}</b></span></div></div>
        </div>

        <div style="display:grid;grid-template-columns:minmax(0,1.9fr) minmax(280px,1fr);gap:16px;" class="responsive-grid-2">
          <div class="card"><div class="card-header"><div class="card-title">Filtrar busca</div><span class="text-muted">${nDias} dia${nDias > 1 ? 's' : ''}</span></div><div class="card-body">
            <div class="filtros">
              <div style="grid-column:span 3;"><label>Período</label><div class="dt-nav dt-par">
                <input type="date" value="${g.de}" onchange="rfSetData('de', this.value)" aria-label="Data de início">
                <span class="text-muted">até</span>
                <input type="date" value="${g.ate}" onchange="rfSetData('ate', this.value)" aria-label="Data de fim">
                <button class="ico-btn" title="Voltar um dia" onclick="rfMoverDia(-1)">‹</button>
                <button class="ico-btn" title="Avançar um dia" onclick="rfMoverDia(1)">›</button></div></div>
              <div><label>Nº pedido / carrinho</label><input type="text" value="${vmlEsc(g.pedido)}" oninput="rfSet('pedido', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();rfBuscar();}"></div>
              <div><label>Título ou MLB</label><input type="text" value="${vmlEsc(g.titulo)}" oninput="rfSet('titulo', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();rfBuscar();}"></div>
              <div><label>SKU</label><input type="text" value="${vmlEsc(g.sku)}" oninput="rfSet('sku', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();rfBuscar();}"></div>
              <div><label>Status da venda</label>${sel('status', g.status, [['todas','Todos'],['aprovadas','Aprovados'],['canceladas','Cancelados']])}</div>
              <div><label>Modalidade</label>${sel('modalidade', g.modalidade, [['todas','Todos'],['Premium','Premium'],['Clássico','Clássico'],['Grátis','Grátis']])}</div>
              <div><label>Tipo do frete</label>${sel('frete', g.frete, [['todos','Todos'],['Full','Full'],['Flex','Flex'],['Coleta','Coleta'],['Agência','Agência'],['Places','Places'],['Outros','Outros']])}</div>
              <div><label>Custo &amp; imposto</label>${sel('custo', g.custo, [['todos','Todos'],['sem-custo','Somente vendas sem custo'],['sem-imposto','Somente vendas sem imposto'],['sem-um','Sem custo ou sem imposto'],['sem-ambos','Sem custo e sem imposto']])}</div>
            </div>
            <div class="chips" style="margin-top:14px;">
              ${[['hoje','Hoje'],['ontem','Ontem'],['7d','7 dias'],['30d','30 dias'],['mes','Mês atual'],['12m','12 meses']].map(([k,l]) => `<button class="chip" onclick="rfAtalho('${k}')">${l}</button>`).join('')}
            </div>
            <div class="d-flex" style="margin-top:14px;gap:12px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
              <span id="rf-pend" class="text-muted" style="font-size:12px;${rfPend ? '' : 'display:none;'}">Filtros alterados. Clique em Buscar para atualizar.</span>
              <button class="btn" id="rf-buscar" onclick="rfBuscar()">🔍 Buscar</button>
            </div>
          </div></div>
          <div class="card"><div class="card-header"><div class="card-title">Para onde vai cada real</div></div><div class="card-body">
            ${rfDonut([
              { nome:'Frete', v:n('frete_vend'), cor:'#3b82f6' }, { nome:'Tarifa', v:n('tarifa'), cor:'#eab308' },
              { nome:'M. contribuição', v:n('mc'), cor:'#10b981' }, { nome:'Custo', v:n('custo'), cor:'#f97316' }, { nome:'Imposto', v:n('imposto'), cor:'#ef4444' }])}
            <div class="text-muted" style="font-size:11px;margin-top:10px;">* O frete pago pelo comprador não entra no gráfico.</div>
          </div></div>
        </div>

        <div class="card">
          ${podeExportar ? '' : `<div class="alert alert-info" style="margin:14px 16px 0;"><b>Visualização otimizada para muitas vendas.</b>&nbsp;Os totais consideram o período inteiro; a exportação em Excel ou CSV considera apenas a página atual.</div>`}
          <div class="rf-ferr">
            <div class="dd-wrap" style="position:relative;display:inline-block;">
              <button class="btn btn-sm" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">⚖ Nivelar custo &amp; imposto ▾</button>
              <div class="dd-menu" style="display:none;position:absolute;left:0;top:110%;z-index:20;min-width:250px;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-lg);padding:6px;">
                <div class="dd-item" style="padding:8px 10px;cursor:pointer;border-radius:7px;" onclick="rfNivelar()"><b>Nivelar</b><br><small class="text-muted">gravar nas vendas o custo e o imposto que eu informar (ou limpar)</small></div>
                <div class="dd-item" style="padding:8px 10px;cursor:pointer;border-radius:7px;" onclick="rfReprocessar()"><b>Reprocessar</b><br><small class="text-muted">regravar com o cadastro atual de Produtos</small></div>
              </div>
            </div>
            <button class="btn-out btn btn-sm" onclick="rfNivelarSku()">Nivelar SKU</button>
            <button class="btn-out btn btn-sm" onclick="rfRanking()">🏆 Ranking de produtos</button>
          </div>
          <div class="card-header">
            <div class="card-title">${Math.min(f.porPagina, d.linhas.length)} de ${d.total.toLocaleString('pt-BR')} registro${d.total === 1 ? '' : 's'}</div>
            ${vmlPaginacao(f.pagina, paginas, 'rfIr')}
          </div>
          <div style="overflow-x:auto;">
            <table class="rf-table">
              <thead><tr>${RF_COLS.map(([k,l,cls]) => `<th class="${cls}" onclick="rfOrdenar('${k}')">${l}${f.ordem === k ? (f.desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
              <tbody>
                ${d.linhas.length ? d.linhas.map(v => {
                  const x = vmlCalc(v), dt = vmlDataBRT(v.data_venda), canc = v.situacao === 'cancelada';
                  return `<tr style="${canc ? 'opacity:.55;' : ''}">
                    <td>${(h => v.sku && typeof fotoLinha === 'function' ? fotoLinha(v.sku, h) : h)(vmlEsc(v.titulo || '—') + (canc ? ' <span class="badge badge-danger">cancelada</span>' : ''))}</td>
                    <td>${vmlEsc(v.sku || '—')}</td>
                    <td>${ptDate(dt.dia)}</td>
                    <td>${vmlEsc(v.envio)}</td>
                    <td class="num">${vmlNum(v.preco_unit)}</td>
                    <td class="num">${x.qtd}</td>
                    <td class="num">${vmlNum(x.faturamento)}</td>
                    <td class="num ${x.temCusto ? '' : 'sem-custo'}">${x.temCusto ? vmlNum(x.custo) : '—'}</td>
                    <td class="num ${x.temImposto ? '' : 'sem-custo'}">${x.temImposto ? vmlNum(x.imposto) : '—'}</td>
                    <td class="num">${vmlNum(x.tarifa)}</td>
                    <td class="num">${vmlNum(x.freteComp)}</td>
                    <td class="num">${x.fretePendente ? '…' : vmlNum(x.freteVend)}</td>
                    <td class="num"><b class="${x.mc >= 0 ? 'mc-pos' : 'mc-neg'}">${vmlNum(x.mc)}</b></td>
                    <td class="num"><b class="${x.mc >= 0 ? 'mc-pos' : 'mc-neg'}">${vmlPct(x.mcPct)}</b></td>
                  </tr>`;
                }).join('') : `<tr><td colspan="${RF_COLS.length}"><div class="vazio"><b>Nenhuma venda no período</b>${vmlSync.rodando ? 'Buscando no Mercado Livre…' : 'Ajuste as datas ou os filtros.'}</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;
      vmlAtualizarSync();
    }

    function rfIr(p){ rfFiltro.pagina = p; rfCarregar(); }
    // Filtros: mexer num campo só guarda o rascunho (rfPend); a consulta roda quando clicar em Buscar (ou Enter)
    function rfRasc(){ if(!rfPend){ const f = rfFiltro; rfPend = { de:f.de, ate:f.ate, pedido:f.pedido, titulo:f.titulo, sku:f.sku, status:f.status, modalidade:f.modalidade, frete:f.frete, custo:f.custo }; } return rfPend; }
    function rfMarcaPend(){ const a = document.getElementById('rf-pend'); if(a) a.style.display = rfPend ? '' : 'none'; }
    function rfSet(campo, val){ rfRasc()[campo] = val; rfMarcaPend(); }
    function rfBuscar(){
      const p = rfPend, mudouData = p && (p.de !== rfFiltro.de || p.ate !== rfFiltro.ate);
      if(p){ Object.assign(rfFiltro, p); rfPend = null; }
      rfFiltro.pagina = 1;
      const b = document.getElementById('rf-buscar'); if(b){ b.disabled = true; b.textContent = 'Buscando…'; }
      rfMarcaPend();
      if(mudouData) renderResumoFin(); else rfCarregar();
    }
    function rfOrdenar(col){ if(rfFiltro.ordem === col) rfFiltro.desc = !rfFiltro.desc; else { rfFiltro.ordem = col; rfFiltro.desc = true; } rfFiltro.pagina = 1; rfCarregar(); }
    function rfToggleFrete(on){ vmlFreteComprador = on; localStorage.setItem('mk_vml_frete_comp', on ? '1' : '0'); rfDesenhar(); }
    function rfSetData(campo, val){
      if(!val) return;
      const r = rfRasc(); r[campo] = val;
      if(r.ate < r.de){ if(campo === 'de') r.ate = val; else r.de = val; }
      rfDesenhar();
    }
    function rfMoverDia(n){ const r = rfRasc(); r.de = addDias(r.de, n); r.ate = addDias(r.ate, n); rfDesenhar(); }
    function rfAtalho(k){ const p = vmlAtalho(k), r = rfRasc(); r.de = p.de; r.ate = p.ate; rfDesenhar(); }
    function rfAtualizar(){ vmlSincronizar(rfFiltro.de, rfFiltro.ate, vmlDiasEntre(rfFiltro.de, rfFiltro.ate) <= 3, () => rfCarregar()); }
    function rfExportar(formato){
      const grande = vmlDiasEntre(rfFiltro.de, rfFiltro.ate) > VML_EXPORT_MAX_DIAS || rfDados.total > VML_EXPORT_MAX_LINHAS;
      const nome = `resumo_financeiro_${rfFiltro.de}_${rfFiltro.ate}`;
      if(!grande){ vmlBaixar(() => rfConsulta('*'), rfFiltro.de, rfFiltro.ate, rfDados.total, nome, formato); return; }
      // período grande: só a página atual (os totais da tela continuam sendo do período inteiro)
      vmlPlanilha(vmlLinhasExport(rfDados.linhas), 'Vendas', nome + `_pagina${rfFiltro.pagina}`, formato);
    }
    function vmlPlanilha(linhas, aba, nome, formato){
      if(!linhas.length){ alert('Não há dados para exportar.'); return; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), aba);
      XLSX.writeFile(wb, nome + (formato === 'csv' ? '.csv' : '.xlsx'), formato === 'csv' ? { bookType:'csv' } : undefined);
    }

    function rfLegenda(){
      vmlModal('Legendas da página', `
        <div style="line-height:2.2;">
          <div><b class="sem-custo">R$ / —</b> &nbsp;Venda sem custo ou sem imposto cadastrado no produto</div>
          <div><b class="mc-pos">R$</b> &nbsp;Margem de contribuição positiva</div>
          <div><b class="mc-neg">R$</b> &nbsp;Margem de contribuição negativa</div>
          <div class="text-muted" style="margin-top:10px;line-height:1.6;">Margem de contribuição = valor dos produtos − custo − imposto − tarifa de venda − frete pago pelo vendedor. Custo e imposto vêm do cadastro de Produtos.</div>
        </div>`);
    }

    // Ranking de produtos do período (vendas aprovadas) — agrupado no banco
    let rfRankAba = 'cons', rfRankGrupo = 'sku', rfRankDados = null;
    async function rfRanking(aba, grupo){
      if(aba) rfRankAba = aba;
      const mudouGrupo = grupo && grupo !== rfRankGrupo;
      if(grupo) rfRankGrupo = grupo;
      const chave = rfFiltro.de + rfFiltro.ate + rfRankGrupo + contaAtiva;
      if(!rfRankDados || rfRankDados.chave !== chave || mudouGrupo){
        vmlModal('Ranking de produtos', '<div class="vazio">Calculando…</div>');
        const { data, error } = await supa.rpc('vendas_ml_ranking', { p_de:rfFiltro.de, p_ate:rfFiltro.ate, p_grupo:rfRankGrupo, p_conta:contaParam() });
        rfRankDados = { chave, erro: error?.message, linhas: (data || []).map(x => ({ ...x, bruto:Number(x.bruto), custo:Number(x.custo), mc:Number(x.mc), mc_pct:Number(x.mc_pct), un:Number(x.un), vendas:Number(x.vendas) })) };
      }
      const L = rfRankDados.linhas;
      const T = L.reduce((a,x) => { a.un += x.un; a.vd += x.vendas; a.bruto += x.bruto; a.mc += x.mc; return a; }, {un:0, vd:0, bruto:0, mc:0});
      const pct = (v, t) => t > 0 ? v / t * 100 : 0;
      // curva ABC pela margem acumulada: A até 80%, B até 95%, C o restante
      const porMargem = L.slice().sort((a,b) => b.mc - a.mc);
      let ac = 0; const abc = {};
      porMargem.forEach(x => { ac += Math.max(0, x.mc); const p = pct(ac, Math.max(1e-9, porMargem.reduce((s,y) => s + Math.max(0, y.mc), 0))); abc[x.chave] = p <= 80 ? 'A' : (p <= 95 ? 'B' : 'C'); });
      const ord = { mcp:'mc_pct', mc:'mc', fat:'bruto', un:'un', cons:'mc' }[rfRankAba];
      const linhas = L.slice().sort((a,b) => b[ord] - a[ord]);
      const abas = [['cons','Consolidado'],['mcp','Maior margem %'],['mc','Maior margem R$'],['fat','Mais geram faturamento'],['un','Mais unidades vendidas']];
      const cor = v => v >= 0 ? 'mc-pos' : 'mc-neg';
      const rot = rfRankGrupo === 'sku' ? 'Produto' : 'Anúncio';
      const prod = x => { const h = '<b>' + vmlEsc(x.chave) + '</b><span>' + vmlEsc(x.titulo || '') + '</span>'; return '<td class="rk-prod">' + (rfRankGrupo === 'sku' && typeof fotoLinha === 'function' ? fotoLinha(x.chave, h) : h) + '</td>'; };
      const tabela = rfRankAba === 'cons'
        ? `<table class="rf-table rk-tab"><thead><tr><th title="Curva ABC pela margem acumulada">Curva</th><th>${rot}</th><th class="num">Unid. vendidas</th><th class="num" title="Participação nas unidades vendidas">Contrib. %</th><th class="num">Vendas aprovadas (R$)</th><th class="num" title="Participação no faturamento">Contrib. %</th><th class="num">Custo (R$)</th><th class="num" title="Margem de contribuição ÷ custo">Margem s/ custo %</th><th class="num">Margem contrib. (=)</th><th class="num">Margem contrib. %</th><th class="num" title="Participação na margem total">Contrib. %</th></tr></thead>
            <tbody>${linhas.map(x => `<tr><td><span class="abc abc-${abc[x.chave]}">${abc[x.chave]}</span></td>${prod(x)}<td class="num">${x.un}</td><td class="num">${vmlPct(pct(x.un, T.un))}</td><td class="num">${vmlNum(x.bruto)}</td><td class="num">${vmlPct(pct(x.bruto, T.bruto))}</td><td class="num">${vmlNum(x.custo)}</td><td class="num">${x.custo > 0 ? vmlPct(x.mc / x.custo * 100) : '—'}</td><td class="num"><b class="${cor(x.mc)}">${vmlNum(x.mc)}</b></td><td class="num"><b class="${cor(x.mc)}">${vmlPct(x.mc_pct)}</b></td><td class="num"><b class="${cor(x.mc)}">${vmlPct(pct(x.mc, T.mc))}</b></td></tr>`).join('')}</tbody></table>`
        : `<table class="rf-table rk-tab"><thead><tr><th>#</th><th>${rot}</th><th class="num">Unid.</th><th class="num">Vendas aprovadas (R$)</th><th class="num">Margem contrib. (=)</th><th class="num">Margem contrib. %</th></tr></thead>
            <tbody>${linhas.map((x,i) => `<tr><td>${i + 1}</td>${prod(x)}<td class="num">${x.un}</td><td class="num">${vmlNum(x.bruto)}</td><td class="num"><b class="${cor(x.mc)}">${vmlNum(x.mc)}</b></td><td class="num"><b class="${cor(x.mc)}">${vmlPct(x.mc_pct)}</b></td></tr>`).join('')}</tbody></table>`;
      const faixa = rfRankAba === 'cons'
        ? `<div class="rk-faixa verde"><b>R$ ${vmlNum(T.mc)}</b><span>Margem de contribuição total</span></div>`
        : `<div class="rk-faixa"><b>${T.un.toLocaleString('pt-BR')} unidades</b><span>em ${T.vd.toLocaleString('pt-BR')} vendas aprovadas</span></div>`;
      vmlModal(`Ranking de produtos — ${ptDate(rfFiltro.de)} a ${ptDate(rfFiltro.ate)}`, `
        <div class="chips" style="margin-bottom:12px;">${abas.map(([k,l]) => `<button class="chip ${rfRankAba === k ? 'active' : ''}" onclick="rfRanking('${k}')">${l}</button>`).join('')}</div>
        ${faixa}
        <div class="d-flex" style="justify-content:space-between;align-items:center;margin:12px 0;gap:10px;flex-wrap:wrap;">
          <div class="chips"><button class="chip ${rfRankGrupo === 'sku' ? 'active' : ''}" onclick="rfRanking(null,'sku')">SKU</button><button class="chip ${rfRankGrupo === 'mlb' ? 'active' : ''}" onclick="rfRanking(null,'mlb')">MLB</button></div>
          <button class="btn-out btn btn-sm" onclick="rfRankExportar()">⬇ Exportar ranking</button>
        </div>
        <div class="rk-rola">${L.length ? tabela : `<div class="vazio">${rfRankDados.erro ? vmlEsc(rfRankDados.erro) : 'Sem vendas aprovadas no período.'}</div>`}</div>
        <div class="text-muted" style="font-size:11px;margin-top:10px;line-height:1.5;">* Somente vendas aprovadas do período. ** Vendas sem SKU ficam agrupadas em "(sem SKU)". *** Vendas sem custo ou imposto distorcem o ranking: use o filtro "Custo &amp; imposto" do Resumo para encontrá-las.</div>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc){ mc.style.maxWidth = '1400px'; mc.style.width = '96vw'; }
      rfRankDados.abc = abc; rfRankDados.tot = T;
    }

    function rfRankExportar(){
      if(!rfRankDados) return;
      const T = rfRankDados.tot, abc = rfRankDados.abc || {}, pct = (v,t) => t > 0 ? Math.round(v / t * 10000) / 100 : 0;
      vmlPlanilha(rfRankDados.linhas.slice().sort((a,b) => b.mc - a.mc).map(x => ({
        'Índice': abc[x.chave] || '', [rfRankGrupo === 'sku' ? 'SKU' : 'MLB']: x.chave, 'Título': x.titulo, 'Unidades': x.un, 'Contrib. unidades %': pct(x.un, T.un),
        'Vendas aprovadas': x.bruto, 'Contrib. faturamento %': pct(x.bruto, T.bruto), 'Custo': x.custo, 'Margem s/ custo %': x.custo > 0 ? Math.round(x.mc / x.custo * 10000) / 100 : '',
        'Margem contrib.': x.mc, 'Margem contrib. %': x.mc_pct, 'Contrib. margem %': pct(x.mc, T.mc)
      })), 'Ranking', `ranking_${rfRankGrupo}_${rfFiltro.de}_${rfFiltro.ate}`, 'xlsx');
    }

    // ----- custo por venda: nivelar / reprocessar / nivelar SKU -----
    function rfPeriodoTxt(){ return `${ptDate(rfFiltro.de)} a ${ptDate(rfFiltro.ate)}${contaAtiva ? ' · conta ' + vmlEsc(contaNome(contaAtiva)) : ''}`; }
    function rfFecharMenus(){ document.querySelectorAll('#view-resumo-fin .dd-menu').forEach(m => { m.style.display = 'none'; }); }

    // Mesmas funções do Mercado Turbo:
    //  Nivelar     → grava nas vendas o custo/imposto que você informar (aba Limpar: apaga o custo/imposto das vendas)
    //  Reprocessar → regrava as vendas com o cadastro atual de Produtos
    // Em todas: SKU ou todos os SKUs, período, loja atual ou todas. "Conferir" conta as vendas antes de gravar.
    let rfAj = { tipo: 'rep', aba: 'nivelar', oque: 'ambos', cNa: false, iNa: false };

    function rfAjComum(){
      const varias = typeof contasML !== 'undefined' && contasML.length > 1;
      return `
        <div class="form-group"><label class="form-label">SKU</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="aj-sku" value="${vmlEsc(rfFiltro.sku)}" placeholder="Digite um SKU ou marque todos ao lado" oninput="rfAjLimpa()" style="flex:1;">
            <label style="display:flex;gap:6px;align-items:center;white-space:nowrap;cursor:pointer;font-size:12.5px;font-weight:650;"><input type="checkbox" id="aj-todos" style="width:auto;" onchange="document.getElementById('aj-sku').disabled=this.checked;rfAjLimpa()"> Todos os SKUs</label>
          </div></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Data início</label><input type="date" id="aj-de" value="${rfFiltro.de}" onchange="rfAjLimpa()"></div>
          <div class="form-group"><label class="form-label">Data fim</label><input type="date" id="aj-ate" value="${rfFiltro.ate}" onchange="rfAjLimpa()"></div>
          <div class="form-group"><label class="form-label" for="aj-envio">Tipo de envio</label><select id="aj-envio" onchange="rfAjLimpa()"><option value="">Todos</option><option value="full">Só Full</option><option value="ag">Só coleta e agência</option><option value="flex">Só Flex</option></select></div>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:-4px;">O período já vem do filtro da tela. Escolha o tipo de envio para aplicar só a uma parte das vendas.</div>
        ${varias ? `<label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:13px;margin-top:10px;"><input type="checkbox" id="aj-contas" style="width:auto;" ${contaAtiva ? '' : 'checked disabled'} onchange="rfAjLimpa()"> Realizar em todas as lojas${contaAtiva ? ' (desmarcado: só ' + vmlEsc(contaNome(contaAtiva)) + ')' : ''}</label>` : ''}`;
    }
    function rfAjOque(){
      return `<div class="seg" style="margin-top:12px;">${[['custo', 'Somente custo'], ['imposto', 'Somente imposto'], ['ambos', 'Ambos']].map(([v, r]) => `<button type="button" class="btn-toggle ${rfAj.oque === v ? 'active' : ''}" onclick="rfAj.oque='${v}';rfAjDesenhar()">${r}</button>`).join('')}</div>`;
    }
    function rfAjDesenhar(){
      const rodape = `<div id="aj-msg" style="margin-top:12px;"></div>`;
      const botoes = `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Fechar</button><button class="btn-out btn" id="aj-conf" onclick="rfAjOk(true)">Conferir</button><button class="btn" id="aj-ok" onclick="rfAjOk(false)">Aplicar</button>`;
      // guarda o que já foi digitado ao trocar de aba/opção
      const g = id => document.getElementById(id), ant = !rfAj.novo && g('aj-de') ? { sku: g('aj-sku').value, todos: g('aj-todos').checked, de: g('aj-de').value, ate: g('aj-ate').value, contas: g('aj-contas') ? g('aj-contas').checked : null, vazias: g('aj-vazias') ? g('aj-vazias').checked : null } : null;
      rfAj.novo = false;
      if(rfAj.tipo === 'rep'){
        vmlModal('Reprocessar custo & imposto', `
          <div class="alert alert-info" style="margin-bottom:14px;">Atualiza o custo e o imposto das vendas com os valores <b>atualmente cadastrados</b> em Produtos.</div>
          ${rfAjComum()}${rfAjOque()}
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:14px;line-height:1.45;"><input type="checkbox" id="aj-vazias" style="width:auto;margin-top:3px;" checked onchange="rfAjLimpa()"> <span>Atualizar somente quando o custo/imposto da venda estiver zerado <span style="color:var(--danger)">(não mexe nas vendas que já têm valor)</span></span></label>
          ${rodape}`, botoes);
      } else {
        const abas = `<div class="seg" style="margin-bottom:14px;">${[['nivelar', 'Nivelar'], ['limpar', 'Limpar']].map(([v, r]) => `<button type="button" class="btn-toggle ${rfAj.aba === v ? 'active' : ''}" onclick="rfAj.aba='${v}';rfAjDesenhar()">${r}</button>`).join('')}</div>`;
        const campo = (id, rot, ph, na) => `<div class="form-group"><label class="form-label">${rot}</label>
            <div style="display:flex;gap:8px;align-items:center;"><input type="number" step="0.01" min="0" id="${id}" placeholder="${ph}" ${rfAj[na] ? 'disabled' : ''} oninput="rfAjLimpa()" style="flex:1;">
            <label style="display:flex;gap:5px;align-items:center;white-space:nowrap;cursor:pointer;font-size:12.5px;"><input type="checkbox" style="width:auto;" ${rfAj[na] ? 'checked' : ''} onchange="rfAj.${na}=this.checked;document.getElementById('${id}').disabled=this.checked;rfAjLimpa()"> Não alterar</label></div></div>`;
        vmlModal('Nivelamento de custo & imposto', rfAj.aba === 'nivelar' ? `${abas}
          <div class="alert alert-info" style="margin-bottom:14px;">Grava nas vendas do período o custo e o imposto que você informar abaixo. O cadastro de Produtos não muda.</div>
          ${rfAjComum()}
          <div class="form-row" style="margin-top:10px;">${campo('aj-custo', 'Custo unitário (R$)', '0,00', 'cNa')}${campo('aj-imp', 'Imposto (%)', '0,00', 'iNa')}</div>
          <div class="text-muted" style="font-size:12px;line-height:1.5;">Marque "Não alterar" para deixar o custo ou o imposto como está. Se informar zero, é zero que será gravado.</div>
          ${rodape}` : `${abas}
          <div class="alert alert-warning" style="margin-bottom:14px;">Apaga o custo e o imposto gravados nas vendas do período. Não tem como desfazer: para voltar, só reprocessando ou nivelando de novo.</div>
          ${rfAjComum()}${rfAjOque()}${rodape}`, botoes);
      }
      if(ant){ g('aj-sku').value = ant.sku; g('aj-todos').checked = ant.todos; g('aj-sku').disabled = ant.todos; g('aj-de').value = ant.de; g('aj-ate').value = ant.ate;
        if(g('aj-contas') && ant.contas !== null && !g('aj-contas').disabled) g('aj-contas').checked = ant.contas;
        if(g('aj-vazias') && ant.vazias !== null) g('aj-vazias').checked = ant.vazias; }
    }
    function rfAjLimpa(){ const m = document.getElementById('aj-msg'); if(m) m.innerHTML = ''; }
    function rfNivelar(){ rfFecharMenus(); rfAj = { tipo: 'niv', aba: 'nivelar', oque: 'ambos', cNa: false, iNa: false, novo: true }; rfAjDesenhar(); }
    function rfReprocessar(){ rfFecharMenus(); rfAj = { tipo: 'rep', aba: 'nivelar', oque: 'ambos', cNa: false, iNa: false, novo: true }; rfAjDesenhar(); }

    async function rfAjOk(simular){
      const g = id => document.getElementById(id), msg = g('aj-msg');
      const aviso = tx => { msg.innerHTML = `<div class="alert alert-warning">${tx}</div>`; };
      const de = g('aj-de').value, ate = g('aj-ate').value, todos = g('aj-todos').checked, sku = todos ? '' : g('aj-sku').value.trim();
      if(!todos && !sku) return aviso('Digite um SKU ou marque "Todos os SKUs".');
      if(!de || !ate || de > ate) return aviso('Confira as datas do período.');
      let cm = 'nada', im = 'nada', c = null, i = null, vazias = false;
      if(rfAj.tipo === 'rep'){ if(rfAj.oque !== 'imposto') cm = 'cadastro'; if(rfAj.oque !== 'custo') im = 'cadastro'; vazias = g('aj-vazias').checked; }
      else if(rfAj.aba === 'limpar'){ if(rfAj.oque !== 'imposto') cm = 'limpar'; if(rfAj.oque !== 'custo') im = 'limpar'; }
      else {
        if(!rfAj.cNa){ if(g('aj-custo').value === '') return aviso('Informe o custo ou marque "Não alterar".'); cm = 'valor'; c = Number(g('aj-custo').value); }
        if(!rfAj.iNa){ if(g('aj-imp').value === '') return aviso('Informe o imposto ou marque "Não alterar".'); im = 'valor'; i = Number(g('aj-imp').value); }
        if(cm === 'nada' && im === 'nada') return aviso('Os dois estão como "Não alterar": não há o que gravar.');
      }
      const conta = g('aj-contas') && g('aj-contas').checked ? null : contaParam();
      const bo = g('aj-ok'), bc = g('aj-conf'); bo.disabled = bc.disabled = true;
      msg.innerHTML = '<div class="text-muted">' + (simular ? 'Conferindo…' : 'Aplicando…') + '</div>';
      const { data, error } = await supa.rpc('vendas_ml_ajustar', { p_envio: (g('aj-envio') && g('aj-envio').value) || null, p_de: de, p_ate: ate, p_sku: sku || null, p_conta: conta,
        p_custo_modo: cm, p_custo: c, p_imp_modo: im, p_imposto: i, p_so_vazias: vazias, p_simular: !!simular });
      if(!document.getElementById('aj-msg')) return;
      bo.disabled = bc.disabled = false;
      if(error){ msg.innerHTML = `<div class="alert alert-danger">${vmlEsc(error.message)}</div>`; return; }
      const n = (Number(data) || 0).toLocaleString('pt-BR');
      if(simular){ msg.innerHTML = `<div class="alert alert-info"><b>${n}</b>&nbsp;venda(s) seriam alteradas. Nada foi gravado ainda.</div>`; return; }
      msg.innerHTML = `<div class="alert alert-info"><b>${n}</b>&nbsp;venda(s) alterada(s), de ${ptDate(de)} a ${ptDate(ate)}${sku ? ', SKU ' + vmlEsc(sku) : ', todos os SKUs'}.</div>`;
      rfRankDados = null; rfCarregar();
    }

    function rfNivelarSku(){
      vmlModal('Nivelar SKU', `
        <div class="text-muted" style="margin-bottom:14px;line-height:1.5;">Aplica um SKU a <b style="color:var(--text)">todas as vendas</b> de um anúncio (MLB). Útil quando o anúncio ficou sem SKU ou com o SKU errado no Mercado Livre. As próximas sincronizações mantêm o SKU definido aqui.</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">ID do anúncio (MLB)</label><input type="text" id="nsk-mlb" placeholder="MLB1234567890"></div>
          <div class="form-group"><label class="form-label">SKU</label><input type="text" id="nsk-sku" placeholder="J-2010-Vermelho"></div>
        </div>
        <div id="nsk-msg"></div>`,
        `<button class="btn-out btn" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" id="nsk-ok" onclick="rfNivelarSkuOk()">Aplicar SKU</button>`);
    }
    async function rfNivelarSkuOk(){
      const mlb = document.getElementById('nsk-mlb').value.trim().replace(/^MLB-?/i, 'MLB'), sku = document.getElementById('nsk-sku').value.trim();
      const msg = document.getElementById('nsk-msg');
      if(!mlb || !sku){ msg.innerHTML = '<div class="alert alert-warning">Informe o anúncio e o SKU.</div>'; return; }
      document.getElementById('nsk-ok').disabled = true;
      const { data, error } = await supa.rpc('vendas_ml_nivelar_sku', { p_mlb: mlb, p_sku: sku });
      if(error){ msg.innerHTML = `<div class="alert alert-danger">${vmlEsc(error.message)}</div>`; document.getElementById('nsk-ok').disabled = false; return; }
      try { await supa.rpc('vendas_ml_carimbar'); } catch(e){}
      vmlModal('Nivelar SKU', `<div class="alert alert-info"><b>${data || 0}</b>&nbsp;venda(s) do anúncio ${vmlEsc(mlb)} agora usam o SKU ${vmlEsc(sku)}.</div>`);
      rfRankDados = null; rfCarregar();
    }

    // ===================================================================
    // GRÁFICO DA PÁGINA VENDAS — mês passado x mês atual, dia a dia
    // ===================================================================
    let vdGraf = { carregado:false, dias:{}, chave:'' };

    async function vdGrafCarregar(){
      if(!usuarioAtual) return;
      const hoje = getToday(), chave = hoje + contaAtiva;
      if(vdGraf.carregado && vdGraf.chave === chave && Date.now() - vdGraf.em < 5 * 60 * 1000) return;
      const iniAtual = hoje.substring(0,8) + '01';
      const iniAnt = addDias(iniAtual, -1).substring(0,8) + '01';
      const { data, error } = await supa.rpc('vendas_ml_por_dia', { p_de: iniAnt, p_ate: hoje, p_conta: contaParam() });
      const dias = {};
      (data || []).forEach(r => { dias[String(r.dia).substring(0,10)] = { qtd:Number(r.vendas) || 0, val:Number(r.bruto) || 0, frete:Number(r.frete_comp) || 0 }; });
      vdGraf = { carregado:!error, dias, chave, em:Date.now(), iniAtual, iniAnt, hoje };
      const el = document.getElementById('vd-graf');
      if(el) el.innerHTML = vdGraficoHtml();
    }

    function vdGrafSerie(ini, ate){
      const out = [];
      for(let d = ini; d <= ate; d = addDias(d, 1)){ const x = vdGraf.dias[d] || {qtd:0, val:0, frete:0}; out.push({ data:d, dia:parseInt(d.substring(8,10)), qtd:x.qtd, val:x.val + (vmlFreteComprador ? x.frete : 0) }); }
      return out;
    }

    function vdGraficoHtml(){
      if(!vdGraf.carregado) return '';
      const fimAnt = addDias(vdGraf.iniAtual, -1);
      const ant = vdGrafSerie(vdGraf.iniAnt, fimAnt), atu = vdGrafSerie(vdGraf.iniAtual, vdGraf.hoje);
      const bloco = (tipo, titulo, fmtV) => {
        const max = Math.max(1, ...ant.map(x => x[tipo]), ...atu.map(x => x[tipo]));
        const tot = a => a.reduce((s,x) => s + x[tipo], 0);
        const barras = (serie, cls, mes) => serie.map(x => `<i class="${cls}" style="height:${Math.max(3, x[tipo] / max * 100).toFixed(1)}%" onmouseenter="vdGrafHover(this,'${tipo}','${mes}',${x.dia})" onmouseleave="vdGrafHover(null)"></i>`).join('');
        return `<div class="card vg-card">
          <div class="vg-tit">${titulo}${tipo === 'val' ? `<label class="vg-frete"><input type="checkbox" ${vmlFreteComprador ? 'checked' : ''} onchange="vdGrafFrete(this.checked)" style="width:auto;"> Incluir frete comprador</label>` : ''}</div>
          <div class="vg-meses">
            <div><span>Mês passado</span><b>${fmtV(tot(ant))}</b><div class="vg-bars">${barras(ant, 'ant', 'ant')}</div></div>
            <div><span>Mês atual</span><b>${fmtV(tot(atu))}</b><div class="vg-bars">${barras(atu, 'atu', 'atu')}</div></div>
          </div>
        </div>`;
      };
      return `<div class="vg-grid">${bloco('qtd', 'Vendas aprovadas (qtd)', v => v.toLocaleString('pt-BR'))}${bloco('val', 'Vendas aprovadas (R$)', v => 'R$ ' + vmlNum(v))}</div><div class="vg-tip" id="vg-tip" style="display:none;"></div>`;
    }

    function vdGrafFrete(on){ vmlFreteComprador = on; localStorage.setItem('mk_vml_frete_comp', on ? '1' : '0'); const el = document.getElementById('vd-graf'); if(el) el.innerHTML = vdGraficoHtml(); }

    // Ao passar o mouse: o dia contra o mesmo dia do outro mês, e o acumulado do mês até aquele dia
    function vdGrafHover(el, tipo, mes, dia){
      const tip = document.getElementById('vg-tip');
      if(!tip) return;
      if(!el){ tip.style.display = 'none'; return; }
      const MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const fimAnt = addDias(vdGraf.iniAtual, -1);
      const ant = vdGrafSerie(vdGraf.iniAnt, fimAnt), atu = vdGrafSerie(vdGraf.iniAtual, vdGraf.hoje);
      const nomeAnt = MES[parseInt(vdGraf.iniAnt.substring(5,7)) - 1], nomeAtu = MES[parseInt(vdGraf.iniAtual.substring(5,7)) - 1];
      const v = (serie, d) => (serie.find(x => x.dia === d) || {})[tipo];
      const acum = (serie, d) => serie.filter(x => x.dia <= d).reduce((s,x) => s + x[tipo], 0);
      const fmtV = x => x == null ? '—' : (tipo === 'qtd' ? x.toLocaleString('pt-BR') + ' pedidos' : 'R$ ' + vmlNum(x));
      const selo = (a, b) => (a == null || b == null || !b) ? '' : `<span class="ini-var ${a >= b ? 'up' : 'down'}">${a >= b ? '▲' : '▼'} ${Math.abs((a - b) / b * 100).toFixed(0)}%</span>`;
      const dd = String(dia).padStart(2, '0');
      const temAtu = dia <= atu.length;
      // o primeiro bloco é sempre o mês da barra sob o mouse
      const [n1, s1, n2, s2] = mes === 'atu' ? [nomeAtu, atu, nomeAnt, ant] : [nomeAnt, ant, nomeAtu, atu];
      const d1 = v(s1, dia), d2 = (mes === 'ant' && !temAtu) ? null : v(s2, dia);
      const a1 = acum(s1, dia), a2 = (mes === 'ant' && !temAtu) ? null : acum(s2, dia);
      tip.innerHTML = `
        <div class="l">Dia ${dd} de ${n1}</div><div class="v">${fmtV(d1)} ${selo(d1, d2)}</div>
        <div class="l" style="margin-top:8px;">Dia ${dd} de ${n2}</div><div class="v">${fmtV(d2)}</div>
        <hr>
        <div class="l">período de 1 a ${dd} de ${n1}</div><div class="v">${fmtV(a1)} ${selo(a1, a2)}</div>
        <div class="l" style="margin-top:8px;">período de 1 a ${dd} de ${n2}</div><div class="v">${fmtV(a2)}</div>`;
      tip.style.display = 'block';
      const host = document.getElementById('vd-graf').getBoundingClientRect(), r = el.getBoundingClientRect();
      const x = Math.min(Math.max(8, r.left - host.left - 20), host.width - 250);
      tip.style.left = x + 'px';
      tip.style.top = (r.bottom - host.top + 10) + 'px';
    }

    // ----- atualização automática da página Vendas enquanto ela está aberta (período inclui hoje) -----
    // A cada 30 s confere no banco se entrou venda nova (o ml-webhook grava em tempo real); a cada ~2 min
    // também pergunta ao ML, para funcionar mesmo sem o aviso em tempo real configurado.
    let vdTick = 0;
    setInterval(async () => {
      const el = document.getElementById('view-vendas');
      if(!el || !el.classList.contains('active') || document.hidden || typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      if(!vdFiltro.ate || vdFiltro.ate < getToday() || document.querySelector('#modal-vml.open')) return;
      try {
        vdTick++;
        if(vdTick % 4 === 0 && !vmlSync.rodando) await vmlSincronizar(getToday(), getToday(), false, null);
        const { count } = await vdConsulta('order_id', { count:'exact', head:true });
        const digitando = document.activeElement && document.activeElement.id === 'vd-termo';
        if(typeof count === 'number' && count !== vdDados.total && vdFiltro.pagina === 1 && !digitando) vdCarregar();
      } catch(e){}
    }, 30000);
