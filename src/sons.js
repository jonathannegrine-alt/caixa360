// ===== SONS DE AVISO =====
// Toca um som quando entra venda (caixa registradora), pergunta, mensagem de comprador ou reclamação nova.
// Os sons são gerados pelo navegador (Web Audio), sem arquivo. A escolha fica neste aparelho (localStorage
// mk_sons): no celular e no computador cada um decide o que quer ouvir. Com várias abas abertas, só uma toca.
// Detecção a cada 30 s: vendas novas em vendas_ml (status paid) e avisos novos em ml_avisos (o ml-webhook grava);
// pergunta/reclamação conta só na primeira vez que o recurso aparece (as atualizações do mesmo caso não tocam).

    const SOM_PADRAO = { venda: true, perguntas: true, mensagens: true, posvenda: true, somVenda: 'caixa', popVenda: true, volume: 0.7, silencio: false, de: '22:00', ate: '07:00' };
    const SOM_TIPOS = [
      ['venda', 'Venda nova', 'A cada venda paga no Mercado Livre'],
      ['perguntas', 'Pergunta nova', 'Pergunta de comprador num anúncio'],
      ['mensagens', 'Mensagem de comprador', 'Mensagem nova numa venda'],
      ['posvenda', 'Reclamação ou devolução', 'Caso novo aberto pelo comprador'],
    ];
    // sons disponíveis para qualquer aviso (cada tipo começa com um padrão e o usuário troca)
    const SOM_OPCOES = [
      ['Dinheiro', [['caixa', 'Caixa registradora antiga'], ['manivela', 'Caixa antiga de manivela'], ['moderna', 'Caixa moderna (bip e gaveta)'], ['kaching', 'Cha-ching rápido'],
        ['cofre', 'Moeda caindo no cofrinho'], ['moedas', 'Punhado de moedas'], ['notas', 'Contadora de notas'], ['pix', 'Dinheiro na conta'], ['fliperama', 'Moeda de fliperama'], ['vitoria', 'Fanfarra de vitória']]],
      ['Avisos', [['perguntas', 'Duas notas'], ['mensagens', 'Bolha (pop)'], ['gota', 'Gota'], ['campainha', 'Campainha (dim-dom)'], ['marimba', 'Marimba'], ['sino', 'Sino'], ['posvenda', 'Alerta (três bipes)'], ['sirene', 'Alerta forte']]],
    ];
    const SOM_PADRAO_DE = { venda: 'caixa', perguntas: 'perguntas', mensagens: 'mensagens', posvenda: 'posvenda' };
    const somEscolhido = (tipo, c) => (c || somCfg())['som_' + tipo] || (tipo === 'venda' && (c || somCfg()).somVenda) || SOM_PADRAO_DE[tipo];
    function somCfg(){ try { return { ...SOM_PADRAO, ...(JSON.parse(localStorage.getItem('mk_sons') || '{}')) }; } catch(e){ return { ...SOM_PADRAO }; } }
    function somGravar(k, v){ const c = somCfg(); c[k] = v; try { localStorage.setItem('mk_sons', JSON.stringify(c)); } catch(e){} somRender(); }

    // ----- motor de áudio -----
    let somCtx = null;
    function somAudio(){
      if(!somCtx){ const A = window.AudioContext || window.webkitAudioContext; if(!A) return null; somCtx = new A(); }
      if(somCtx.state === 'suspended') somCtx.resume().catch(() => {});
      return somCtx;
    }
    // o navegador só libera o som depois de um clique ou tecla na página
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => somAudio(), { passive: true }));

    function somSaida(ctx){ const g = ctx.createGain(); g.gain.value = Math.max(0, Math.min(1, somCfg().volume)); g.connect(ctx.destination); return g; }
    function somTom(ctx, out, f, t, dur, vol, tipo, f2){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = tipo || 'sine'; o.frequency.setValueAtTime(f, t);
      if(f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
    }
    function somRuido(ctx, out, t, dur, vol, freq, q){
      const n = Math.ceil(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1; g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(out); s.start(t);
    }
    // sino com parciais inarmônicos (som de campainha metálica)
    function somSino(ctx, out, f, t, dur, vol){ [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]].forEach(([r, a]) => somTom(ctx, out, f * r, t, dur / Math.sqrt(r), vol * a)); }

    const SOM_DESENHO = {
      // caixa registradora antiga: alavanca, gaveta abrindo e o "tchin-tchin" da campainha
      caixa(ctx, out, t){
        somRuido(ctx, out, t, 0.05, 0.9, 2500, 2); somTom(ctx, out, 140, t, 0.09, 0.5, 'triangle', 70);
        somRuido(ctx, out, t + 0.07, 0.18, 0.35, 900, 0.7);
        somSino(ctx, out, 2093, t + 0.1, 1.0, 0.32); somSino(ctx, out, 2637, t + 0.22, 1.5, 0.36);
        for(let i = 0; i < 5; i++) somTom(ctx, out, 4200 + Math.random() * 2600, t + 0.32 + i * 0.06 + Math.random() * 0.03, 0.07, 0.07);
      },
      moedas(ctx, out, t){ for(let i = 0; i < 9; i++){ const x = t + i * 0.055 + Math.random() * 0.03; somTom(ctx, out, 3800 + Math.random() * 3000, x, 0.12, 0.13); somRuido(ctx, out, x, 0.03, 0.15, 6000, 3); } },
      sino(ctx, out, t){ somSino(ctx, out, 1568, t, 1.6, 0.4); },
      // manivela: catraca girando, gaveta e uma campainha grande
      manivela(ctx, out, t){
        for(let i = 0; i < 8; i++) somRuido(ctx, out, t + i * 0.035, 0.02, 0.6, 3200, 4);
        somRuido(ctx, out, t + 0.3, 0.2, 0.4, 700, 0.8); somTom(ctx, out, 110, t + 0.3, 0.12, 0.5, 'triangle', 60);
        somSino(ctx, out, 2349, t + 0.36, 1.8, 0.42);
      },
      // caixa de supermercado: bip do leitor, gaveta batendo e moedas
      moderna(ctx, out, t){
        somTom(ctx, out, 1900, t, 0.13, 0.18, 'square');
        somRuido(ctx, out, t + 0.2, 0.16, 0.7, 450, 0.8); somTom(ctx, out, 95, t + 0.2, 0.14, 0.6, 'triangle', 55);
        for(let i = 0; i < 4; i++) somTom(ctx, out, 4500 + Math.random() * 2000, t + 0.34 + i * 0.05, 0.08, 0.08);
      },
      kaching(ctx, out, t){ somRuido(ctx, out, t, 0.04, 0.8, 3000, 2); somSino(ctx, out, 3136, t + 0.05, 0.6, 0.3); somSino(ctx, out, 3951, t + 0.13, 1.1, 0.34); },
      // moeda caindo e quicando no fundo do cofrinho
      cofre(ctx, out, t){
        let x = t, gap = 0.26, v = 0.32;
        for(let i = 0; i < 9; i++){ somSino(ctx, out, 3300 + i * 40, x, 0.35, v); x += gap; gap *= 0.68; v *= 0.8; }
        somRuido(ctx, out, x, 0.18, 0.12, 5000, 2);
      },
      notas(ctx, out, t){ for(let i = 0; i < 16; i++) somRuido(ctx, out, t + i * 0.028, 0.025, 0.45, 2600 + Math.random() * 1500, 1.5); somSino(ctx, out, 2637, t + 0.5, 0.9, 0.22); },
      // notificação de dinheiro recebido: arpejo subindo, com brilho de sino
      pix(ctx, out, t){ [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { somTom(ctx, out, f, t + i * 0.08, 0.5, 0.22); somTom(ctx, out, f * 2, t + i * 0.08, 0.25, 0.05); }); },
      fliperama(ctx, out, t){ somTom(ctx, out, 988, t, 0.08, 0.15, 'square'); somTom(ctx, out, 1319, t + 0.08, 0.45, 0.15, 'square'); },
      vitoria(ctx, out, t){ [[523, 0], [659, 0.11], [784, 0.22], [1046.5, 0.33]].forEach(([f, d], i) => somTom(ctx, out, f, t + d, i === 3 ? 0.7 : 0.14, 0.16, 'square')); somTom(ctx, out, 1318.5, t + 0.33, 0.7, 0.06, 'square'); },
      gota(ctx, out, t){ somTom(ctx, out, 700, t, 0.15, 0.4, 'sine', 1600); },
      campainha(ctx, out, t){ somSino(ctx, out, 659, t, 1.1, 0.4); somSino(ctx, out, 523, t + 0.45, 1.4, 0.4); },
      marimba(ctx, out, t){ somTom(ctx, out, 784, t, 0.35, 0.4, 'triangle'); somTom(ctx, out, 1568, t, 0.12, 0.1); somTom(ctx, out, 1046.5, t + 0.12, 0.45, 0.35, 'triangle'); },
      sirene(ctx, out, t){ for(let i = 0; i < 3; i++){ somTom(ctx, out, 700, t + i * 0.32, 0.15, 0.3, 'sawtooth', 1100); somTom(ctx, out, 1100, t + i * 0.32 + 0.15, 0.15, 0.3, 'sawtooth', 700); } },
      perguntas(ctx, out, t){ somTom(ctx, out, 880, t, 0.35, 0.3); somTom(ctx, out, 1318.5, t + 0.16, 0.6, 0.3); },
      mensagens(ctx, out, t){ somTom(ctx, out, 420, t, 0.12, 0.35, 'sine', 950); somTom(ctx, out, 620, t + 0.13, 0.16, 0.35, 'sine', 1300); },
      posvenda(ctx, out, t){ [0, 0.2, 0.4].forEach((d, i) => somTom(ctx, out, i === 1 ? 523 : 659, t + d, 0.17, 0.25, 'triangle')); },
    };
    function somTocar(tipo, vezes){
      const ctx = somAudio(); if(!ctx) return false;
      const desenho = SOM_DESENHO[SOM_DESENHO[tipo] && !SOM_PADRAO_DE[tipo] ? tipo : somEscolhido(tipo)] || SOM_DESENHO.caixa, out = somSaida(ctx);
      const n = Math.min(vezes || 1, 3);
      for(let i = 0; i < n; i++) desenho(ctx, out, ctx.currentTime + 0.05 + i * 0.9);
      return ctx.state === 'running';
    }
    function somTestar(tipo){ if(!somTocar(tipo) && typeof toast === 'function') toast('O navegador ainda não liberou o som. Clique em qualquer lugar da página e tente de novo.'); }

    function somSilencio(c){
      if(!c.silencio) return false;
      const d = new Date(), m = d.getHours() * 60 + d.getMinutes(), hm = s => { const [h, mi] = String(s || '0:0').split(':').map(Number); return h * 60 + (mi || 0); };
      const a = hm(c.de), b = hm(c.ate);
      return a <= b ? m >= a && m < b : m >= a || m < b;
    }

    // ----- uma aba toca por vez -----
    const SOM_ABA = Math.random().toString(36).slice(2);
    function somLider(){
      try {
        const l = JSON.parse(localStorage.getItem('mk_som_lider') || 'null');
        if(l && l.id !== SOM_ABA && Date.now() - l.t < 150000) return false;
        localStorage.setItem('mk_som_lider', JSON.stringify({ id: SOM_ABA, t: Date.now() }));
      } catch(e){}
      return true;
    }
    window.addEventListener('beforeunload', () => { try { const l = JSON.parse(localStorage.getItem('mk_som_lider') || 'null'); if(l && l.id === SOM_ABA) localStorage.removeItem('mk_som_lider'); } catch(e){} });

    // ----- detecção -----
    let somEst = { vendas: null, avisoEm: null, rodando: false, ultimo: {} };
    const SOM_TOP = { questions: 'perguntas', messages: 'mensagens', claims: 'posvenda' };
    const somChave = (top, rec) => top === 'claims' ? ((String(rec).match(/claims\/(\d+)/) || [])[1] || rec) : top === 'questions' ? ((String(rec).match(/(\d{6,})/) || [])[1] || rec) : rec;
    // celular e tablet: sem som nem janelinha (decisão do usuário, 2026-10-22)
    const somCelular = () => /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || '')) || (window.matchMedia && matchMedia('(pointer:coarse) and (max-width: 900px)').matches);
    async function somConferir(){
      if(somCelular() || somEst.rodando || typeof usuarioAtual === 'undefined' || !usuarioAtual || typeof supa === 'undefined' || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      const c = somCfg();
      if(!SOM_TIPOS.some(([k]) => c[k]) && !c.popVenda) return;
      somEst.rodando = true;
      try {
        const tocar = {};
        // vendas pagas das últimas 6 horas que esta aba ainda não tinha visto (a primeira leitura só marca)
        if(c.venda || c.popVenda){
          const r = await supa.from('vendas_ml').select('order_id').eq('usuario_id', usuarioAtual.id).eq('status', 'paid').gt('data_venda', new Date(Date.now() - 6 * 3600000).toISOString()).order('data_venda', { ascending: false }).limit(1000);
          if(!r.error){
            const ids = (r.data || []).map(v => String(v.order_id));
            if(somEst.vendas){ const novas = ids.filter(id => !somEst.vendas.has(id)); if(novas.length && c.venda) tocar.venda = novas.length; if(novas.length && c.popVenda && !document.hidden) popVendas(novas); ids.forEach(id => somEst.vendas.add(id)); }
            else somEst.vendas = new Set(ids);
          }
        } else somEst.vendas = null;
        // perguntas, mensagens e reclamações: avisos chegados desde a última leitura
        const tops = Object.keys(SOM_TOP).filter(t => c[SOM_TOP[t]]);
        if(tops.length){
          if(!somEst.avisoEm){   // a primeira leitura só marca até onde já viu (pelo relógio do banco, não do aparelho)
            const r = await supa.from('ml_avisos').select('em').eq('usuario_id', usuarioAtual.id).in('topico', tops).order('em', { ascending: false }).limit(1);
            if(!r.error) somEst.avisoEm = (r.data && r.data[0] && r.data[0].em) || new Date().toISOString();
          } else {
            const r = await supa.from('ml_avisos').select('topico,recurso,em').eq('usuario_id', usuarioAtual.id).in('topico', tops).gt('em', somEst.avisoEm).order('em', { ascending: true }).limit(200);
            if(!r.error && (r.data || []).length){
              const L = r.data, desde = somEst.avisoEm;
              somEst.avisoEm = L[L.length - 1].em;
              for(const t of tops){
                const chaves = [...new Set(L.filter(x => x.topico === t).map(x => somChave(t, x.recurso)))].slice(0, 30);
                if(!chaves.length) continue;
                let novas = chaves;
                if(t !== 'messages'){   // a mesma pergunta/reclamação gera aviso de novo a cada atualização: toca só a primeira vez
                  const v = await supa.from('ml_avisos').select('recurso').eq('usuario_id', usuarioAtual.id).eq('topico', t).lte('em', desde).or(chaves.map(k => 'recurso.like.*' + k + '*').join(',')).limit(500);
                  if(!v.error){ const ant = new Set((v.data || []).map(x => somChave(t, x.recurso))); novas = chaves.filter(k => !ant.has(k)); }
                }
                if(novas.length) tocar[SOM_TOP[t]] = novas.length;
              }
            }
          }
        } else somEst.avisoEm = null;
        if(Object.keys(tocar).length && somLider() && !somSilencio(c)){
          let atraso = 0;
          for(const [tipo] of SOM_TIPOS){
            if(!tocar[tipo] || Date.now() - (somEst.ultimo[tipo] || 0) < 8000) continue;
            somEst.ultimo[tipo] = Date.now();
            const n = tocar[tipo];
            setTimeout(() => somTocar(tipo, n), atraso);
            atraso += tipo === 'venda' ? Math.min(n, 3) * 900 + 300 : 900;
          }
        } else somLider();
      } catch(e){}
      somEst.rodando = false;
    }
    setTimeout(somConferir, 7000);
    setInterval(somConferir, 30000);

    // ----- janelinha de venda nova (canto inferior direito; some sozinha em 10 s, para enquanto o mouse está em cima) -----
    const POP_COLS = 'order_id,pack_id,item_id,titulo,thumbnail,qtd,preco_unit,sku,variacao,ml_user_id,logistic_type,data_venda';
    let popDados = {};
    const popE = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    async function popVendas(ids){
      try {
        const r = await supa.from('vendas_ml').select(POP_COLS).eq('usuario_id', usuarioAtual.id).in('order_id', ids.slice(0, 20));
        const L = (r.data || []).sort((a, b) => String(a.data_venda).localeCompare(String(b.data_venda)));
        const mostrar = L.slice(-3);
        await popFotos(mostrar);
        mostrar.forEach(v => popMostrar(v));
        if(ids.length > mostrar.length) popMostrar(null, ids.length - mostrar.length);
      } catch(e){}
    }
    // a venda costuma vir sem foto: usa a do anúncio
    async function popFotos(L){
      const ids = [...new Set(L.filter(v => !v.thumbnail && v.item_id).map(v => v.item_id))]; if(!ids.length) return;
      try { const r = await supa.from('ml_anuncios').select('item_id,thumbnail').eq('usuario_id', usuarioAtual.id).in('item_id', ids); const f = {}; (r.data || []).forEach(a => { if(a.thumbnail) f[a.item_id] = a.thumbnail; }); L.forEach(v => { if(!v.thumbnail) v.thumbnail = f[v.item_id] || null; }); } catch(e){}
    }
    function popMostrar(v, mais){
      let box = document.getElementById('som-pop');
      if(!box){
        box = document.createElement('div'); box.id = 'som-pop';
        box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;width:min(340px,calc(100vw - 32px));pointer-events:none;';
        document.body.appendChild(box);
        const st = document.createElement('style');
        st.textContent = '.som-pop-it{pointer-events:auto;display:flex;gap:10px;align-items:center;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-left:4px solid #16a34a;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;animation:somPopIn .25s ease-out;font-size:13px;}'
          + '.som-pop-it.sai{opacity:0;transform:translateX(30px);transition:all .3s;}.som-pop-it img,.som-pop-it .ft{width:48px;height:48px;border-radius:8px;object-fit:cover;flex:none;background:var(--gray-100,#eee);}'
          + '.som-pop-it .tx{flex:1;min-width:0;}.som-pop-it .tt{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3;}'
          + '.som-pop-it .cb{font-size:11.5px;color:#16a34a;font-weight:700;}.som-pop-it .rd{font-size:12px;color:var(--text-muted,#666);margin-top:2px;}.som-pop-it .x{border:0;background:none;color:var(--text-muted,#888);font-size:18px;cursor:pointer;align-self:flex-start;padding:0 2px;line-height:1;}'
          + '@keyframes somPopIn{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:none;}}';
        document.head.appendChild(st);
      }
      const it = document.createElement('div'); it.className = 'som-pop-it';
      if(v){
        popDados[v.order_id] = v;
        const val = (Number(v.qtd) || 1) * (Number(v.preco_unit) || 0), loja = typeof lojaNome === 'function' && typeof lojasVarias === 'function' && lojasVarias() ? lojaNome(v.ml_user_id) : '';
        const env = { fulfillment: 'Full', self_service: 'Flex', cross_docking: 'Coleta', xd_drop_off: 'Agência', drop_off: 'Correios' }[v.logistic_type] || '';
        it.innerHTML = (v.thumbnail ? '<img src="' + popE(String(v.thumbnail).replace('http://', 'https://')) + '" alt="">' : '<div class="ft"></div>')
          + '<div class="tx"><div class="cb">💰 Nova venda' + (loja ? ' · ' + popE(loja) : '') + '</div><div class="tt">' + popE(v.titulo || v.sku || 'Venda #' + v.order_id) + '</div>'
          + '<div class="rd">' + popE(v.qtd || 1) + ' un · <b>' + (typeof fmt === 'function' ? fmt(val) : 'R$ ' + val.toFixed(2)) + '</b>' + (env ? ' · ' + env : '') + (v.sku ? ' · ' + popE(v.sku) : '') + '</div></div>';
        it.onclick = () => { fechar(); popAbrir(v.order_id); };
      } else {
        it.innerHTML = '<div class="tx"><div class="cb">💰 E mais ' + mais + ' venda' + (mais > 1 ? 's' : '') + ' nova' + (mais > 1 ? 's' : '') + '</div><div class="rd">Clique para abrir a página Vendas</div></div>';
        it.onclick = () => { fechar(); if(typeof nav === 'function') nav('vendas'); };
      }
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Fechar';
      x.onclick = ev => { ev.stopPropagation(); fechar(); };
      it.appendChild(x);
      function fechar(){ it.classList.add('sai'); setTimeout(() => it.remove(), 320); }
      let tm = setTimeout(fechar, 10000);
      it.onmouseenter = () => clearTimeout(tm); it.onmouseleave = () => { tm = setTimeout(fechar, 4000); };
      box.appendChild(it);
      while(box.children.length > 4) box.firstChild.remove();
    }
    // clique na janelinha: abre os detalhes da venda (itens + entrega, pagamento e comprador lidos no ML)
    function popAbrir(orderId){
      const v = popDados[orderId];
      if(typeof vmlModal !== 'function' || typeof vdDetalheML !== 'function'){ if(typeof nav === 'function') nav('vendas'); return; }
      const item = v ? '<div class="d-flex gap-2" style="align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">' + (v.thumbnail ? '<img class="v-thumb" src="' + popE(String(v.thumbnail).replace('http://', 'https://')) + '" alt="">' : '') + '<div><div class="v-tit"><span class="v-qtd">' + popE(v.qtd || 1) + 'x</span>' + popE(v.titulo) + '</div><div class="text-muted">SKU: ' + popE(v.sku || '—') + (v.variacao ? ' · ' + popE(v.variacao) : '') + '</div></div></div>' : '';
      vmlModal('Venda #' + popE(orderId), item + '<div id="vd-det-ml"><div class="text-muted" style="padding:16px 0 4px;">Buscando entrega, pagamento e comprador no Mercado Livre…</div></div>');
      vdDetalheML(orderId);
    }
    async function popExemplo(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const r = await supa.from('vendas_ml').select(POP_COLS).eq('usuario_id', usuarioAtual.id).eq('status', 'paid').order('data_venda', { ascending: false }).limit(1);
      if(r.data && r.data[0]){ await popFotos(r.data); popMostrar(r.data[0]); } else if(typeof toast === 'function') toast('Ainda não há venda para mostrar de exemplo.');
    }

    // ----- Configurações → Sons -----
    function somRender(){
      const el = document.getElementById('cfg-sons'); if(!el) return;
      const c = somCfg(), e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      if(somCelular()){ el.innerHTML = '<div class="text-muted" style="font-size:13px;">Os sons e a janelinha de venda nova funcionam só no computador. No celular ficam desligados.</div>'; return; }
      el.innerHTML = `
        <div class="text-muted" style="font-size:13px;margin-bottom:12px;">Escolha o que toca som neste aparelho. Funciona com o Caixa 360 aberto (pode estar em outra aba ou minimizado). O navegador só libera o som depois do primeiro clique na página.</div>
        ${SOM_TIPOS.map(([k, nome, desc]) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border);flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:10px;flex:1;min-width:220px;cursor:pointer;margin:0;"><input type="checkbox" ${c[k] ? 'checked' : ''} onchange="somGravar('${k}', this.checked)" style="width:18px;height:18px;"><span><b>${nome}</b><br><small class="text-muted">${desc}</small></span></label>
          <select onchange="somGravar('som_${k}', this.value);somTestar('${k}')" style="width:auto;">${SOM_OPCOES.map(([g, L]) => `<optgroup label="${g}">${L.map(([v, n]) => `<option value="${v}" ${somEscolhido(k, c) === v ? 'selected' : ''}>${n}</option>`).join('')}</optgroup>`).join('')}</select>
          <button type="button" class="btn-out btn" onclick="somTestar('${k}')">▶ Ouvir</button>
        </div>`).join('')}
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border);flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:10px;flex:1;min-width:220px;cursor:pointer;margin:0;"><input type="checkbox" ${c.popVenda ? 'checked' : ''} onchange="somGravar('popVenda', this.checked)" style="width:18px;height:18px;"><span><b>Janelinha a cada venda</b><br><small class="text-muted">Mostra no canto inferior direito o produto, a quantidade e o valor de cada venda nova (mesmo com o som desligado)</small></span></label>
          <button type="button" class="btn-out btn" onclick="popExemplo()">▶ Ver exemplo</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--border);flex-wrap:wrap;">
          <b style="min-width:80px;">Volume</b><input type="range" min="0" max="1" step="0.05" value="${e(c.volume)}" onchange="somGravar('volume', Number(this.value));somTestar('venda')" style="flex:1;min-width:160px;">
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--border);flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin:0;"><input type="checkbox" ${c.silencio ? 'checked' : ''} onchange="somGravar('silencio', this.checked)" style="width:18px;height:18px;"><b>Horário silencioso</b></label>
          <span class="text-muted">das</span><input type="time" value="${e(c.de)}" onchange="somGravar('de', this.value)" style="width:auto;">
          <span class="text-muted">às</span><input type="time" value="${e(c.ate)}" onchange="somGravar('ate', this.value)" style="width:auto;">
        </div>`;
    }
    somRender();
