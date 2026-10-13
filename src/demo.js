// ===== MODO DEMONSTRAÇÃO (link com ?demo) =====
// Abre o sistema numa conta de exemplo, sem login. A conta é só de leitura no banco; aqui, além disso:
//  - nada é enviado para gravar: toda gravação "dá certo" só na tela e some ao recarregar;
//  - o que no sistema real fala com o Mercado Livre devolve dados de exemplo ou fica desligado;
//  - sessão e memória do navegador ficam separadas (prefixo "demo:"), para não misturar com uma conta de verdade.
// Este arquivo é o PRIMEIRO script da página. A senha abaixo é pública de propósito: a conta só lê dados fictícios.

    const MODO_DEMO = /[?&]demo(=|&|$)/.test(location.search);
    const DEMO_EMAIL = 'demo@caixa360.app', DEMO_SENHA = 'demo-63bd058db49da002b4';

    if(MODO_DEMO){
      ['getItem', 'setItem', 'removeItem'].forEach(m => { const o = Storage.prototype[m]; Storage.prototype[m] = function(k){ const a = Array.prototype.slice.call(arguments); a[0] = 'demo:' + k; return o.apply(this, a); }; });

      (function(){
        const orig = window.fetch.bind(window), SUPA = 'qasrccmtrllotukyeiax.supabase.co';
        const resp = (obj, status) => new Response(obj === undefined ? null : JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
        // funções do banco que gravam: na demonstração respondem "0 alteradas"
        const GRAVA = new Set(['vendas_ml_carimbar', 'vendas_ml_reprocessar', 'vendas_ml_nivelar', 'vendas_ml_nivelar_sku', 'vendas_ml_custo_venda', 'custo_peps_recalcular', 'tarefa_criar', 'tarefa_vista']);
        const DESLIGADAS = ['cfo-chat', 'pos-venda', 'ml-atendimento', 'mcp', 'ml-callback'];
        const cache = {};
        let ultimoAviso = 0;
        const aviso = () => { if(Date.now() - ultimoAviso < 25000) return; ultimoAviso = Date.now(); setTimeout(() => { if(typeof toast === 'function') toast('Demonstração: a alteração vale só nesta tela e não é gravada.'); }, 50); };
        const dado = async (chave, h) => {
          if(chave in cache) return cache[chave];
          try { const r = await orig('https://' + SUPA + '/rest/v1/rpc/demo_dado', { method: 'POST', headers: { apikey: h.get('apikey') || (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : ''), Authorization: h.get('Authorization') || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_chave: chave }) });
            if(r.ok) cache[chave] = await r.json(); else return null; } catch(e){ return null; }
          return cache[chave];
        };
        // ----- exemplos da demonstração para a Conferência de frete e a Central de promoções -----
        // São números inventados, coerentes com a tabela de frete, para a pessoa ver como a tela funciona.
        const DEMO_TAB = { 1: [6.85, 6.95, 7.15, 7.35, 7.45, 8.65, 8.75], 2: [8.15, 8.25, 8.45, 8.65, 8.75, 9.15, 9.75], 4: [14.95, 16.15, 16.85, 17.15, 17.65, 19.15, 20.75], 5: [16.95, 18.15, 19.05, 19.45, 19.85, 21.65, 23.35] };
        const demoFaixa = p => [19, 49, 79, 100, 120, 150, 200].filter(x => p >= x).length, demoLinha = g => [300, 500, 1000, 1500, 2000, 3000, 4000].findIndex(x => g <= x);
        // anúncios de exemplo: medida do Full e embalagem de envio do anúncio (alguns com a do anúncio maior)
        function demoItens(){
          const cad = (typeof skus !== 'undefined' && Array.isArray(skus) ? skus.filter(s => Number(s.custo) > 0) : []).slice(0, 8);
          const M = [[8.6, 44.1, 13.8, 260, 42, 20, 12, 310, 39.9], [7.2, 33.9, 10.6, 130, 26, 20, 11, 130, 29.9], [10.3, 23.8, 22.5, 240, 29, 27, 9, 250, 43.9], [7.1, 22.1, 27.4, 260, 25, 21, 8, 270, 44.9],
                     [26.1, 30.6, 29.9, 1150, 29, 25, 25, 1100, 109.9], [8.8, 32.2, 28.7, 600, 33, 30, 9, 620, 39.9], [12.6, 41.1, 23.9, 180, 39, 29, 17, 500, 48.9], [9, 28, 42, 790, 34, 28, 8, 800, 46.9]];
          return M.map((m, i) => { const fullG = Math.max(m[0] * m[1] * m[2] / 6, m[3]), declG = Math.max(m[4] * m[5] * m[6] / 6, m[7]);
            return { item_id: 'MLB90000000' + (10 + i), sku: (cad[i] && cad[i].sku) || 'PROD-' + String(101 + i), titulo: (cad[i] && cad[i].titulo) || 'Produto de exemplo ' + (i + 1), custo: cad[i] ? Number(cad[i].custo) : null,
              preco: m[8], ml_a: m[0], ml_l: m[1], ml_c: m[2], ml_g: m[3], decl_a: m[4], decl_l: m[5], decl_c: m[6], decl_g: m[7], peso_g: Math.round(declG), fullG, lFull: demoLinha(fullG), lDecl: demoLinha(declG), bv: demoFaixa(m[8]) }; });
        }
        function demoFrete(c){
          const de = new Date((c && c.p_de) + 'T12:00:00'), ate = new Date((c && c.p_ate) + 'T12:00:00'), dias = Math.max(1, Math.round((ate - de) / 86400000) + 1), envio = (c && c.p_envio) || '', conta = (c && c.p_conta) || '0';
          const I = demoItens(), lista = [], menos = [], R = {}, por = {};
          const soma = (k, dif) => { const r = R[k] || (R[k] = { n: 0, mais: 0, menos: 0, n_mais: 0, n_menos: 0 }); r.n++; if(dif > 0){ r.mais += dif; r.n_mais++; } else if(dif < 0){ r.menos -= dif; r.n_menos++; } };
          let seq = 0;
          const venda = (it, classe, q, cobradoUn, devidoUn, extra) => {
            seq++; const tipo = (extra && extra.logistic_type) || (seq % 6 === 0 ? 'cross_docking' : 'fulfillment'); if((envio === 'full' && tipo !== 'fulfillment') || (envio === 'ag' && tipo === 'fulfillment')) return;
            const d = new Date(ate.getTime() - ((seq * 37) % dias) * 86400000 - ((seq * 53) % 600) * 60000), dif = Math.round((cobradoUn - devidoUn) * q * 100) / 100, full = tipo === 'fulfillment';
            const x = Object.assign({ order_id: 2000019000000000 + seq * 7919, item_id: it.item_id, sku: it.sku, qtd: q, preco_unit: it.preco, frete: Math.round(cobradoUn * q * 100) / 100, devido_un: devidoUn, dif, classe, base: full ? 'full' : 'anuncio',
              data_venda: d.toISOString(), ml_user_id: conta, logistic_type: tipo, peso_g: it.peso_g, ld: full ? it.lFull : it.lDecl, lp: it.lDecl, lm: full ? it.lFull : it.lDecl,
              ma: full ? it.ml_a : it.decl_a, ml: full ? it.ml_l : it.decl_l, mc: full ? it.ml_c : it.decl_c, mg: full ? it.ml_g : it.decl_g, mconta: full ? it.fullG : it.peso_g, bv: it.bv, versao: '2026-08-24', faixa_acima: null, linha_acima: null, u: cobradoUn }, extra || {});
            x.base = full ? 'full' : 'anuncio';
            soma(classe, dif); const p = por[it.item_id] || (por[it.item_id] = { n_peso: 0, rs_peso: 0, n_preco: 0, rs_preco: 0, n_peso_menos: 0, rs_peso_menos: 0 });
            if(classe === 'peso'){ p.n_peso++; p.rs_peso += dif; } if(classe === 'preco'){ p.n_preco++; p.rs_preco += dif; } if(classe === 'peso_menos'){ p.n_peso_menos++; p.rs_peso_menos -= dif; }
            (dif > 0 ? lista : menos).push(x);
          };
          const T = DEMO_TAB, k = dias / 30;
          // faixa de peso acima da medida do Full (anúncio com embalagem de envio maior que a medida)
          I.filter(it => it.lDecl > it.lFull).forEach((it, i) => { for(let n = 0; n < Math.round([150, 110, 90, 70][i % 4] * k); n++) venda(it, 'peso', n % 9 === 0 ? 2 : 1, T[it.bv][it.lDecl], T[it.bv][it.lFull], { ld: it.lFull, lm: it.lFull, linha_acima: it.lDecl, base: 'full', logistic_type: 'fulfillment', ma: it.ml_a, ml: it.ml_l, mc: it.ml_c, mg: it.ml_g, mconta: it.fullG }); });
          // faixa de preço errada: vendido na promoção, cobrado na faixa de cima
          I.filter(it => it.bv === 1).forEach((it, i) => { for(let n = 0; n < Math.round([22, 18, 14, 12, 10][i % 5] * k); n++){ const ag = n % 5 === 4, l = ag ? it.lDecl : it.lFull; venda(it, 'preco', 1, T[2][l], T[1][l], { faixa_acima: 2, ld: l, lm: l, logistic_type: ag ? 'cross_docking' : 'fulfillment', base: ag ? 'anuncio' : 'full' }); } });
          // cobrado em dobro (carrinho dividido) e outros valores
          for(let n = 0; n < Math.round(14 * k); n++){ const it = I[n % 4], l = it.lFull; venda(it, 'multiplo', 1, T[it.bv][l] * 2, T[it.bv][l], { ld: l, lm: l, logistic_type: 'fulfillment' }); }
          for(let n = 0; n < Math.round(8 * k); n++){ const it = I[(n + 3) % I.length], l = it.lFull; venda(it, 'outro', 1, T[it.bv][l] + 2.9 + (n % 3), T[it.bv][l], { ld: l, lm: l, logistic_type: 'fulfillment' }); }
          // poucas vendas cobradas a menos, só para o quadro ficar completo
          for(let n = 0; n < Math.round(6 * k); n++){ const it = I[5], l = it.lFull; venda(it, 'peso_menos', 1, T[it.bv][l - 1], T[it.bv][l], { ld: l, lm: l, logistic_type: 'fulfillment' }); }
          lista.sort((a, b) => String(b.data_venda).localeCompare(String(a.data_venda)));
          const fora = lista.length + menos.length, conferidas = Math.round((envio === 'ag' ? 30 : envio === 'full' ? 150 : 180) * dias);
          R.certo = { n: Math.max(0, conferidas - fora), mais: 0, menos: 0, n_mais: 0, n_menos: 0 };
          Object.keys(R).forEach(q => { R[q].mais = Math.round(R[q].mais * 100) / 100; R[q].menos = Math.round(R[q].menos * 100) / 100; });
          return { conferidas, fora: Math.round(conferidas * 0.06), anuncios: I.length, com_peso: I.length, com_medida: conferidas, bases: {}, resumo: R, lista, menos,
            itens: I.map((it, i) => Object.assign({ item_id: it.item_id, ml_user_id: conta, sku: it.sku, peso_g: it.peso_g, vendas: Math.round([520, 410, 330, 280, 190, 360, 300, 240][i] * k), certas: 0, ld: it.lFull, lp: it.lDecl, hab: it.lDecl, sem_peso: false, faixas_no_periodo: 1, bv: it.bv }, por[it.item_id] || { n_peso: 0, rs_peso: 0, n_preco: 0, rs_preco: 0, n_peso_menos: 0, rs_peso_menos: 0 })).map(x => { x.certas = Math.max(0, x.vendas - x.n_peso - x.n_preco - x.n_peso_menos); return x; }) };
        }
        function demoPromos(c){
          const I = demoItens().map(it => Object.assign({}, it, { preco: it.custo ? Math.round(it.custo * 3.4 * 100) / 100 : it.preco })), hoje = new Date(), dia = n => new Date(hoje.getTime() + n * 86400000).toISOString();
          if(c && c.acao === 'base') return { ok: true, itens: I.filter(it => (c.itens || []).includes(it.item_id)).map(it => ({ ml_user_id: c.conta, item_id: it.item_id, titulo: it.titulo, thumbnail: null, sku: it.sku, preco: it.preco, categoria: 'MLB0', tipo_anuncio: 'gold_special', tarifa_pct: 0.115, peso_g: it.peso_g, frete_lista: null })) };
          if(c && c.acao === 'itens'){
            const sit = c.situacao || '', todos = I.map((it, i) => { const ml = [6, 0, 8, 5, 0, 10, 4, 0][i], vd = [14, 15, 12, 20, 10, 15, 16, 12][i], s = ['candidate', 'candidate', 'started', 'candidate', 'pending', 'started', 'candidate', 'candidate'][i];
              return { item: it.item_id, situacao: s, original: it.preco, preco: Math.round(it.preco * (1 - (ml + vd) / 100) * 100) / 100, sugerido: 0, minimo: 0, maximo: 0, ml_pct: ml, vendedor_pct: vd, inicio: dia(-2), fim: dia(9), oferta: '' }; });
            const l = todos.filter(x => !sit || x.situacao === sit); return { ok: true, itens: l, total: l.length, depois: null };
          }
          return { ok: true, promos: [
            { id: 'DEMO-1', tipo: 'MARKETPLACE_CAMPAIGN', situacao: 'started', nome: 'Semana do Lar', inicio: dia(-2), fim: dia(9), prazo: dia(5), beneficio: 'REBATE', ml_pct: 6, vendedor_pct: 14 },
            { id: 'DEMO-2', tipo: 'DEAL', situacao: 'started', nome: 'Ofertas de Primavera', inicio: dia(-6), fim: dia(3), prazo: dia(1), beneficio: '', ml_pct: 0, vendedor_pct: 15 },
            { id: 'DEMO-3', tipo: 'LIGHTNING', situacao: 'pending', nome: 'Oferta relâmpago', inicio: dia(4), fim: dia(5), prazo: dia(3), beneficio: '', ml_pct: 0, vendedor_pct: 20 } ] };
        }
        window.fetch = async function(input, init){
          const url = String(input && input.url ? input.url : input);
          if(!url.includes(SUPA)) return orig(input, init);
          const m = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          const h = new Headers((init && init.headers) || (input && input.headers) || {});
          const p = new URL(url).pathname;
          let corpo = null; try { corpo = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch(e){}
          if(p.startsWith('/auth/v1/')){
            if(/\/user$/.test(p) && m !== 'GET') return resp({});                       // trocar senha/e-mail: não faz nada
            if(/\/(signup|recover|otp)/.test(p)) return resp({ msg: 'Indisponível na demonstração.' }, 400);
            return orig(input, init);
          }
          if(p.startsWith('/functions/v1/')){
            const nome = p.split('/')[3];
            if(nome === 'ml-inventory') return resp((await dado('inventory', h)) || { ok: true, itens: [], contas: [] });
            if(nome === 'ml-ads'){
              const ads = (await dado('ads', h)) || { ok: true, anuncios: [], contas: [] };
              // os dados de exemplo são de 30 dias: para um pedido de um dia só (Início), mostra a média diária proporcional à hora
              const agora = new Date(), parte = Math.max(0.05, (agora.getHours() * 60 + agora.getMinutes()) / 1440);   // dia em curso: só a parte que já passou
              if(corpo && corpo.de && corpo.de === corpo.ate) return resp({ ok: true, contas: [], anuncios: (ads.anuncios || []).map(a => { const o = Object.assign({}, a); ['cliques', 'impressoes', 'investimento', 'vendas_ads', 'diretas', 'indiretas', 'un_ads', 'un_organicas', 'organicas'].forEach(k => { o[k] = Math.round((Number(o[k]) || 0) / 30 * parte * 100) / 100; }); return o; }) });
              return resp(ads);
            }
            if(nome === 'ml-promos') return resp(demoPromos(corpo));
            if(DESLIGADAS.includes(nome)) return resp({ error: 'Na demonstração esta função fica desligada. Crie a sua conta para usar com a sua loja.' });
            return resp({ ok: true, demo: true });
          }
          if(p.startsWith('/storage/v1/')){ if(m === 'GET') return orig(input, init); if(p.includes('/object/list/')) return resp([]); aviso(); return resp({ Key: 'demo' }); }
          if(p.startsWith('/rest/v1/')){
            const alvo = p.slice(9);
            if(alvo === 'ml_tokens'){
              if(m !== 'GET' && m !== 'HEAD'){ aviso(); return resp([]); }
              const c = (await dado('contas', h)) || [];
              return (h.get('Accept') || '').includes('vnd.pgrst.object') ? resp(c[0] || {}) : resp(c);
            }
            if(alvo === 'ml_itens_base' && (m === 'GET' || m === 'HEAD')) return resp(demoItens().map(it => ({ item_id: it.item_id, preco: it.preco, decl_a: it.decl_a, decl_l: it.decl_l, decl_c: it.decl_c, decl_g: it.decl_g, ml_a: it.ml_a, ml_l: it.ml_l, ml_c: it.ml_c, ml_g: it.ml_g, peso_g: it.peso_g })));
            if(alvo === 'olist_config' && (m === 'GET' || m === 'HEAD')){   // mostra as ordens de compra de exemplo como se o Olist estivesse ligado
              const linha = { usuario_id: 'demo', atualizado_em: new Date().toISOString(), v3_em: new Date().toISOString(), v3_erro: '', client_id: '' };
              return (h.get('Accept') || '').includes('vnd.pgrst.object') ? resp(linha) : resp([linha]);
            }
            if(alvo.startsWith('rpc/')){
              const fn = alvo.slice(4);
              if(GRAVA.has(fn) || (fn === 'vendas_ml_ajustar' && !(corpo && corpo.p_simular))){ aviso(); return resp(0); }
              if(fn === 'frete_conferencia_tab') return resp(demoFrete(corpo));
              if(fn === 'ml_itens_margem') return resp([]);
              return orig(input, init);
            }
            if(m === 'GET' || m === 'HEAD') return orig(input, init);
            aviso();                                                                      // gravação em tabela: finge que deu certo
            if((h.get('Prefer') || '').includes('return=representation')){
              const arr = Array.isArray(corpo) ? corpo : (corpo ? [corpo] : []);
              arr.forEach((r, i) => { if(r && typeof r === 'object' && r.id == null) r.id = Date.now() + i; });
              return (h.get('Accept') || '').includes('vnd.pgrst.object') ? resp(arr[0] || {}, m === 'POST' ? 201 : 200) : resp(arr, m === 'POST' ? 201 : 200);
            }
            return new Response(null, { status: m === 'POST' ? 201 : 204 });
          }
          return orig(input, init);
        };
      })();

      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.classList.add('modo-demo');
        const f = document.createElement('div'); f.className = 'demo-faixa';
        f.innerHTML = '<b>Demonstração</b><span>Dados fictícios. Mexa à vontade: nada é gravado.</span><a href="' + location.pathname + '">Criar minha conta</a>';
        document.body.appendChild(f);
        // menu todo aberto na primeira visita, para o visitante ver o que existe
        if(!localStorage.getItem('mk_nav_secs')){ localStorage.setItem('mk_nav_secs', JSON.stringify([...new Set([...document.querySelectorAll('.nav-sec[data-sec]')].map(s => s.dataset.sec))])); if(typeof aplicarNavSecs === 'function') aplicarNavSecs(); }
        window.sair = function(){ location.href = location.pathname; };   // sair da demonstração = ir para a tela de entrada
        const m = document.getElementById('login-sync-msg'); if(m) m.textContent = 'Abrindo a demonstração…';
        const sy = document.getElementById('login-sync'), fo = document.querySelector('.login-form'), ta = document.querySelector('.login-tabs');
        if(sy) sy.style.display = 'flex'; if(fo) fo.style.display = 'none'; if(ta) ta.style.display = 'none';
      });
    }

    // chamado na abertura quando não há sessão: entra na conta de exemplo
    async function demoEntrar(){
      const r = await supa.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_SENHA });
      if(r.error || !r.data || !r.data.user){
        const m = document.getElementById('login-sync-msg'); if(m) m.textContent = 'A demonstração não abriu agora. Tente de novo em instantes.';
        return;
      }
      await entrarNoApp(r.data.user);
    }
