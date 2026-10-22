// ===== SONS DE AVISO =====
// Toca um som quando entra venda (caixa registradora), pergunta, mensagem de comprador ou reclamação nova.
// Os sons são gerados pelo navegador (Web Audio), sem arquivo. A escolha fica neste aparelho (localStorage
// mk_sons): no celular e no computador cada um decide o que quer ouvir. Com várias abas abertas, só uma toca.
// Detecção a cada 30 s: vendas novas em vendas_ml (status paid) e avisos novos em ml_avisos (o ml-webhook grava);
// pergunta/reclamação conta só na primeira vez que o recurso aparece (as atualizações do mesmo caso não tocam).

    const SOM_PADRAO = { venda: true, perguntas: true, mensagens: true, posvenda: true, somVenda: 'caixa', volume: 0.7, silencio: false, de: '22:00', ate: '07:00' };
    const SOM_TIPOS = [
      ['venda', 'Venda nova', 'A cada venda paga no Mercado Livre'],
      ['perguntas', 'Pergunta nova', 'Pergunta de comprador num anúncio'],
      ['mensagens', 'Mensagem de comprador', 'Mensagem nova numa venda'],
      ['posvenda', 'Reclamação ou devolução', 'Caso novo aberto pelo comprador'],
    ];
    const SOM_VENDA = { caixa: 'Caixa registradora', moedas: 'Moedas', sino: 'Sino' };
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
      perguntas(ctx, out, t){ somTom(ctx, out, 880, t, 0.35, 0.3); somTom(ctx, out, 1318.5, t + 0.16, 0.6, 0.3); },
      mensagens(ctx, out, t){ somTom(ctx, out, 420, t, 0.12, 0.35, 'sine', 950); somTom(ctx, out, 620, t + 0.13, 0.16, 0.35, 'sine', 1300); },
      posvenda(ctx, out, t){ [0, 0.2, 0.4].forEach((d, i) => somTom(ctx, out, i === 1 ? 523 : 659, t + d, 0.17, 0.25, 'triangle')); },
    };
    function somTocar(tipo, vezes){
      const ctx = somAudio(); if(!ctx) return false;
      const desenho = SOM_DESENHO[tipo === 'venda' ? somCfg().somVenda : tipo] || SOM_DESENHO.caixa, out = somSaida(ctx);
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
    async function somConferir(){
      if(somEst.rodando || typeof usuarioAtual === 'undefined' || !usuarioAtual || typeof supa === 'undefined' || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      const c = somCfg();
      if(!SOM_TIPOS.some(([k]) => c[k])) return;
      somEst.rodando = true;
      try {
        const tocar = {};
        // vendas pagas das últimas 6 horas que esta aba ainda não tinha visto (a primeira leitura só marca)
        if(c.venda){
          const r = await supa.from('vendas_ml').select('order_id').eq('usuario_id', usuarioAtual.id).eq('status', 'paid').gt('data_venda', new Date(Date.now() - 6 * 3600000).toISOString()).order('data_venda', { ascending: false }).limit(1000);
          if(!r.error){
            const ids = (r.data || []).map(v => String(v.order_id));
            if(somEst.vendas){ const novas = ids.filter(id => !somEst.vendas.has(id)).length; if(novas) tocar.venda = novas; ids.forEach(id => somEst.vendas.add(id)); }
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

    // ----- Configurações → Sons -----
    function somRender(){
      const el = document.getElementById('cfg-sons'); if(!el) return;
      const c = somCfg(), e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      el.innerHTML = `
        <div class="text-muted" style="font-size:13px;margin-bottom:12px;">Escolha o que toca som neste aparelho. Funciona com o Caixa 360 aberto (pode estar em outra aba ou minimizado). O navegador só libera o som depois do primeiro clique na página.</div>
        ${SOM_TIPOS.map(([k, nome, desc]) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border);flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:10px;flex:1;min-width:220px;cursor:pointer;margin:0;"><input type="checkbox" ${c[k] ? 'checked' : ''} onchange="somGravar('${k}', this.checked)" style="width:18px;height:18px;"><span><b>${nome}</b><br><small class="text-muted">${desc}</small></span></label>
          ${k === 'venda' ? `<select onchange="somGravar('somVenda', this.value)" style="width:auto;">${Object.entries(SOM_VENDA).map(([v, n]) => `<option value="${v}" ${c.somVenda === v ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
          <button type="button" class="btn-out btn" onclick="somTestar('${k}')">▶ Ouvir</button>
        </div>`).join('')}
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
