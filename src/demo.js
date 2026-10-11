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
        const GRAVA = new Set(['vendas_ml_carimbar', 'vendas_ml_reprocessar', 'vendas_ml_nivelar', 'vendas_ml_nivelar_sku', 'vendas_ml_custo_venda', 'custo_peps_recalcular']);
        const DESLIGADAS = ['cfo-chat', 'pos-venda', 'ml-atendimento', 'mcp', 'ml-callback'];
        const cache = {};
        let ultimoAviso = 0;
        const aviso = () => { if(Date.now() - ultimoAviso < 25000) return; ultimoAviso = Date.now(); setTimeout(() => { if(typeof toast === 'function') toast('Demonstração: a alteração vale só nesta tela e não é gravada.'); }, 50); };
        const dado = async (chave, h) => {
          if(chave in cache) return cache[chave];
          try { const r = await orig('https://' + SUPA + '/rest/v1/rpc/demo_dado', { method: 'POST', headers: { apikey: h.get('apikey') || '', Authorization: h.get('Authorization') || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_chave: chave }) });
            cache[chave] = r.ok ? await r.json() : null; } catch(e){ cache[chave] = null; }
          return cache[chave];
        };
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
            if(nome === 'ml-ads') return resp((await dado('ads', h)) || { ok: true, anuncios: [], contas: [] });
            if(DESLIGADAS.includes(nome)) return resp({ error: 'Na demonstração esta função fica desligada. Crie a sua conta para usar com a sua loja.' });
            return resp({ ok: true, demo: true });
          }
          if(p.startsWith('/storage/v1/')) return m === 'GET' ? orig(input, init) : resp({ Key: 'demo' });
          if(p.startsWith('/rest/v1/')){
            const alvo = p.slice(9);
            if(alvo === 'ml_tokens'){
              if(m !== 'GET' && m !== 'HEAD'){ aviso(); return resp([]); }
              const c = (await dado('contas', h)) || [];
              return (h.get('Accept') || '').includes('vnd.pgrst.object') ? resp(c[0] || {}) : resp(c);
            }
            if(alvo.startsWith('rpc/')){
              const fn = alvo.slice(4);
              if(GRAVA.has(fn) || (fn === 'vendas_ml_ajustar' && !(corpo && corpo.p_simular))){ aviso(); return resp(0); }
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
