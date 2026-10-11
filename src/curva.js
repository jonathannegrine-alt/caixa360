// ===== CURVA DE MATURAÇÃO DOS RECEBÍVEIS =====
// Todo dia o servidor fotografa (snapshots_ml) quanto o Mercado Livre já confirmou para cada data futura.
// Comparando cada foto com o que realmente caiu naquele dia (extrato), sabemos que fração do dinheiro de um dia
// já está confirmada N dias antes: é a curva de maturação f(N).
// Projeção: para uma data a N dias, o total esperado = confirmado hoje ÷ f(N). Mais fiel que a média histórica,
// porque parte do que já foi vendido de verdade.
// A curva entra SOZINHA, dia a dia de distância, quando há amostras suficientes (CURVA_MIN). Antes disso a
// projeção continua pela média do extrato (getEntrada em utils.js).
// patCfg.curvaDesde (AAAA-MM-DD): ignora fotos anteriores a essa data (quando a coleta antiga não era confiável).

    const CURVA_MIN = 14, CURVA_DIAS = 45;
    // data de corte: fica em patCfg.curvaDesde e numa cópia local (sobrevive a uma aba antiga que regrave a configuração)
    function curvaCorte(){
      let d = (typeof patCfg !== 'undefined' && patCfg && patCfg.curvaDesde) || '';
      try { if(d) localStorage.setItem('mk_curva_desde', d); else d = localStorage.getItem('mk_curva_desde') || ''; } catch(e){}
      if(d && typeof patCfg !== 'undefined' && patCfg && !patCfg.curvaDesde) patCfg.curvaDesde = d;
      return d;
    }
    let curva = { linhas: [], f: {}, n: {}, carregada: false, ate: 0 };

    async function curvaCarregar(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const desde = addDias(getToday(), -140), todas = [];
      for(let de = 0; de < 60000; de += 1000){
        const r = await supa.from('snapshots_ml').select('data_captura,data_recebimento,val,ml_user_id').eq('usuario_id', usuarioAtual.id).gte('data_captura', desde).order('id').range(de, de + 999);
        if(r.error) return;
        todas.push(...(r.data || []));
        if(!r.data || r.data.length < 1000) break;
      }
      curva.linhas = todas; curva.carregada = true;
      curvaCalcular();
      if(typeof recalc === 'function') try { recalc(); } catch(e){}
    }

    function curvaCalcular(){
      curva.f = {}; curva.n = {}; curva.ate = 0;
      if(!curva.carregada) return;
      const conta = typeof contaAtiva !== 'undefined' ? contaAtiva : '';
      const corte = curvaCorte();
      const foto = new Map(), dias = new Set();
      curva.linhas.forEach(s => {
        if(conta && String(s.ml_user_id || '') !== conta) return;
        if(corte && s.data_captura < corte) return;
        dias.add(s.data_captura);
        const k = s.data_captura + '|' + s.data_recebimento;
        foto.set(k, (foto.get(k) || 0) + (Number(s.val) || 0));
      });
      curva.diasFoto = dias.size;
      const hoje = getToday(), amostras = {};
      (typeof extratoHistorico !== 'undefined' ? extratoHistorico : []).forEach(e => {
        const fim = Number(e.val_liquido) || 0;
        if(!(fim > 0) || e.data >= hoje) return;
        for(let d = 1; d <= CURVA_DIAS; d++){
          const c = addDias(e.data, -d);
          if(!dias.has(c)) continue;                         // não houve foto naquele dia
          const r = (foto.get(c + '|' + e.data) || 0) / fim;
          if(r > 1.3) continue;                              // foto maior que o realizado: dado inconsistente
          (amostras[d] = amostras[d] || []).push(Math.min(1, r));
        }
      });
      let teto = 1;
      for(let d = 1; d <= CURVA_DIAS; d++){
        const a = (amostras[d] || []).sort((x, y) => x - y);
        curva.n[d] = a.length;
        if(a.length < CURVA_MIN) continue;
        const med = a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
        teto = Math.min(teto, med);                          // quanto mais longe, menos confirmado (nunca sobe)
        curva.f[d] = teto;
        curva.ate = d;
      }
    }

    // fração já confirmada a N dias da data (ou null se a curva ainda não vale para essa distância)
    function curvaFator(dias){
      const f = curva.f[dias];
      return f && f >= 0.15 ? f : null;
    }

    function curvaStatusHtml(){
      if(!curva.carregada) return '';
      const ativos = Object.keys(curva.f).map(Number).filter(d => d >= 8 && curvaFator(d));
      const corte = curvaCorte();
      let txt;
      if(ativos.length){
        const de = Math.min(...ativos), ate = Math.max(...ativos);
        txt = `<b>Curva de maturação ativa</b> para datas de D+${de} a D+${ate}: a projeção desses dias parte do que o Mercado Livre já confirmou (hoje, ${Math.round((curvaFator(de) || 0) * 100)}% do dinheiro de um dia já aparece confirmado ${de} dias antes). As outras datas seguem pela média do extrato.`;
      } else {
        const n8 = curva.n[8] || 0, faltam = Math.max(0, CURVA_MIN - n8);
        txt = `<b>Curva de maturação: juntando histórico.</b> ${curva.diasFoto || 0} dias de fotos válidas${corte ? ' desde ' + ptDate(corte) : ''}; faltam cerca de ${faltam} dias para ela começar a valer nas datas a partir de D+8. Até lá a projeção usa a média do extrato. A troca é automática.`;
      }
      return '<br><span style="font-size:12px;color:var(--text-muted);">' + txt + '</span>';
    }
