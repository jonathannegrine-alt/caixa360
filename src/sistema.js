// ===== SISTEMA: página "Estamos atualizando" e aviso de conta ainda carregando o histórico =====
// Manutenção: tabela sistema_status (uma linha, leitura pública). Com manutencao = true o site inteiro fica coberto
// pela página de atualização; ao desligar, a página recarrega sozinha. Conferido ao abrir e a cada minuto.
// Para o administrador ver o sistema durante a manutenção: localStorage.mk_manut_ver = '1'.
// Conta carregando: RPC ml_importacao_situacao (dias do histórico já importados, de 365). Enquanto faltar, aparece
// uma faixa no alto explicando que os relatórios de período longo ainda estão incompletos.
    let sis = { manut: false, imp: null, impEm: 0 };

    async function sisChecar(){
      let st = null;
      try {
        const r = await fetch(SUPA_URL + '/rest/v1/sistema_status?select=manutencao,mensagem&id=eq.1', { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }, cache: 'no-store' });
        if(r.ok) st = (await r.json())[0] || null;
      } catch(e){}
      if(!st) return;                                   // sem resposta: não bloqueia ninguém por causa disso
      let ver = false; try { ver = localStorage.getItem('mk_manut_ver') === '1'; } catch(e){}
      const liga = !!st.manutencao && !ver, tela = document.getElementById('sis-manut');
      if(liga && !tela){
        const d = document.createElement('div'); d.id = 'sis-manut'; d.className = 'sis-manut';
        d.innerHTML = `<div class="sis-manut-c"><div class="sis-manut-i">⟳</div><h2>Estamos atualizando</h2><p id="sis-manut-t"></p><small>Esta página volta sozinha quando a atualização terminar.</small></div>`;
        document.body.appendChild(d);
      }
      if(liga){ const p = document.getElementById('sis-manut-t'); if(p) p.textContent = st.mensagem || 'O Caixa 360 está recebendo uma atualização e volta em alguns minutos. Seus dados estão guardados.'; }
      if(!liga && tela){ tela.remove(); if(sis.manut) location.reload(); }
      sis.manut = liga;
    }

    // faixa de "conta carregando": só para quem está logado e tem conta com histórico incompleto
    async function sisImportacao(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual || sis.manut || (typeof MODO_DEMO !== 'undefined' && MODO_DEMO)) return;
      if(Date.now() - sis.impEm < 5 * 60000) return sisFaixa();
      sis.impEm = Date.now();
      try { const r = await supa.rpc('ml_importacao_situacao'); if(!r.error) sis.imp = r.data || []; } catch(e){}
      sisFaixa();
    }
    function sisFaixa(){
      const main = document.querySelector('.main'); if(!main) return;
      let f = document.getElementById('sis-faixa');
      // 360 de 365: os dias de hoje e de ontem são relidos o tempo todo e não contam como histórico pendente
      const falta = (sis.imp || []).filter(c => Number(c.dias) < 360);
      if(!falta.length){ if(f) f.remove(); return; }
      const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const nome = id => (typeof contasML !== 'undefined' && (contasML.find(c => String(c.id) === String(id)) || {}).apelido) || 'Conta ' + id;
      if(!f){ f = document.createElement('div'); f.id = 'sis-faixa'; f.className = 'sis-faixa'; main.insertBefore(f, main.firstChild); }
      f.innerHTML = `<b>Ainda estamos carregando o histórico de vendas</b> (${falta.map(c => e(nome(c.ml_user_id)) + ': ' + Number(c.dias) + ' de 365 dias').join(' · ')}).
        Os relatórios de período longo (DRE, 12 meses, comparação com o ano anterior) dependem de muitas consultas ao Mercado Livre e só ficam completos quando a carga terminar, o que pode levar até dois dias.
        Vendas recentes, contas a pagar, estoque e os demais relatórios já podem ser usados.`;
    }

    sisChecar();
    setInterval(sisChecar, 60000);
    setInterval(sisImportacao, 30000);
    setTimeout(sisImportacao, 6000);
