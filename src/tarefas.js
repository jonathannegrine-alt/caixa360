// ===== TAREFAS EM SEGUNDO PLANO (fila com aviso no sininho) =====
// O que é pesado e raro (nivelar custo de um período longo, totais de um ano no Resumo Financeiro) não roda na hora
// da tela: tarefaPedir() põe na fila (RPC tarefa_criar), o banco executa em até um minuto (cron 'tarefas') e esta
// tela confere a cada 15 s enquanto houver algo pendente. Ao terminar: aviso na tela, item no sininho e, se quem
// pediu passou uma função em `depois`, ela é chamada com a tarefa pronta.
    let tf = { lista: [], depois: {}, timer: null, lendo: false };
    const TF_DIAS_FILA = 45;      // nivelar acima disso vai para a fila

    function tfDias(de, ate){ return Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / 86400000) + 1; }
    function tfPendentes(){ return tf.lista.filter(t => t.status === 'fila' || t.status === 'rodando'); }
    function tfNovas(){ return tf.lista.filter(t => (t.status === 'pronto' || t.status === 'erro') && !t.visto); }
    // número que soma no sininho: terminadas ainda não vistas
    function tfSinoN(){ return tfNovas().length; }

    async function tarefaPedir(tipo, params, rotulo, depois){
      if(typeof MODO_DEMO !== 'undefined' && MODO_DEMO){ if(typeof toast === 'function') toast('Demonstração: esta operação não é executada.'); return null; }
      const r = await supa.rpc('tarefa_criar', { p_tipo: tipo, p_params: params, p_rotulo: rotulo || null });
      if(r.error){ if(typeof toast === 'function') toast('Não foi possível agendar: ' + r.error.message); return null; }
      if(depois) tf.depois[r.data] = depois;
      if(typeof toast === 'function') toast((rotulo || 'Tarefa') + ': entrou na fila. Pode continuar usando o sistema; o sininho avisa quando terminar.');
      tfConferir(true);
      return r.data;
    }
    // resultado pronto de uma tarefa igual pedida há pouco (evita recalcular o mesmo período)
    async function tarefaRecente(tipo, params, minutos){
      const r = await supa.from('tarefas').select('id,resultado,terminado_em,params').eq('usuario_id', usuarioAtual.id).eq('tipo', tipo).eq('status', 'pronto')
        .gt('terminado_em', new Date(Date.now() - (minutos || 30) * 60000).toISOString()).order('id', { ascending: false }).limit(10);
      const chave = JSON.stringify(tfOrdenar(params));
      return ((r.data || []).find(t => JSON.stringify(tfOrdenar(t.params)) === chave) || null);
    }
    function tfOrdenar(o){ const s = {}; Object.keys(o || {}).sort().forEach(k => { if(o[k] != null && o[k] !== '') s[k] = o[k]; }); return s; }

    async function tfConferir(forcar){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || tf.lendo || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      tf.lendo = true;
      try {
        const antes = new Set(tfPendentes().map(t => t.id));
        const r = await supa.from('tarefas').select('id,tipo,rotulo,status,erro,visto,criado_em,terminado_em').eq('usuario_id', usuarioAtual.id)
          .or('status.in.(fila,rodando),visto.eq.false').order('id', { ascending: false }).limit(30);
        if(!r.error){
          tf.lista = r.data || [];
          for(const t of tf.lista){
            if(!antes.has(t.id) || t.status === 'fila' || t.status === 'rodando') continue;
            if(typeof toast === 'function') toast(t.status === 'pronto' ? 'Concluído: ' + (t.rotulo || t.tipo) : 'Não deu certo: ' + (t.rotulo || t.tipo) + (t.erro ? ' (' + t.erro + ')' : ''));
            const f = tf.depois[t.id]; delete tf.depois[t.id];
            if(f){ try { await f(t); } catch(e){} }
          }
          if(typeof avSinoPintar === 'function') avSinoPintar();
        }
      } catch(e){}
      tf.lendo = false;
      clearTimeout(tf.timer);
      if(tfPendentes().length) tf.timer = setTimeout(tfConferir, 15000);
    }
    async function tfMarcarVistas(){
      if(!tfNovas().length) return;
      tf.lista.forEach(t => { if(t.status === 'pronto' || t.status === 'erro') t.visto = true; });
      try { await supa.rpc('tarefa_vista', { p_id: null }); } catch(e){}
      if(typeof avSinoPintar === 'function') avSinoPintar();
    }
    // bloco do sininho
    function tfSinoHtml(){
      const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const L = tf.lista.filter(t => t.status === 'fila' || t.status === 'rodando' || !t.visto); if(!L.length) return '';
      const sit = t => t.status === 'fila' ? 'na fila' : t.status === 'rodando' ? 'processando…' : t.status === 'pronto' ? 'concluído' : 'não deu certo' + (t.erro ? ': ' + e(t.erro) : '');
      return `<div class="sino-sec">Tarefas em segundo plano (${L.length})</div>` + L.map(t => `<div class="sino-it" style="cursor:default;"><small>${sit(t)}</small><b>${e(t.rotulo || t.tipo)}</b></div>`).join('');
    }

    setTimeout(tfConferir, 12000);
    setInterval(() => { if(!tfPendentes().length) tfConferir(); }, 5 * 60000);

    // totais do período (Vendas e Resumo Financeiro): direto quando dá; se o banco cancelar por demora, vai para a fila
    async function tfTotaisRpc(params, recarregar){
      const longo = params && params.p_de && params.p_ate && tfDias(params.p_de, params.p_ate) > 185, demo = typeof MODO_DEMO !== 'undefined' && MODO_DEMO;
      if(longo && !demo){ const rec = await tarefaRecente('totais', params, 30).catch(() => null); if(rec) return { data: rec.resultado, error: null }; }
      const r = await supa.rpc('vendas_ml_totais', params);
      if(!r.error || demo || !/timeout|canceling statement/i.test(r.error.message || '')) return r;
      const id = await tarefaPedir('totais', params, 'Totais de ' + params.p_de.split('-').reverse().join('/') + ' a ' + params.p_ate.split('-').reverse().join('/'), recarregar);
      return { data: null, error: { message: id ? 'Período longo: os totais estão sendo calculados em segundo plano e aparecem aqui sozinhos em cerca de um minuto.' : r.error.message } };
    }
