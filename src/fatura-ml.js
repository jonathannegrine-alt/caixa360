// ===== FATURA DO MERCADO LIVRE NO DRE =====
// A função ml-fatura grava, toda noite, as cobranças da fatura que não são descontadas de uma venda (publicidade já
// sem a bonificação, armazenagem do Full, DIFAL, mensalidade da loja), cada uma no dia em que aconteceu.
// Aqui: soma por mês (RPC ml_fatura_mes) e as linhas que entram no DRE quando o usuário escolhe "automático".
//   comprasCfg.faturaDre = 'auto'  → o DRE usa a fatura; categorias marcadas como "Fatura do ML (só caixa)" saem do DRE
//                                    nos meses em que há fatura lida (mês sem fatura continua pelo Contas a pagar)
//                        = 'pagar' → (padrão) vale o que foi lançado em Contas a pagar; a fatura fica só para conferência
    const FT_CLASSES = [['pub', 'Publicidade (fatura ML)'], ['afil', 'Comissão de afiliados (fatura ML)'], ['full', 'Full: armazenagem e serviços (fatura ML)'], ['difal', 'DIFAL (fatura ML)'],
      ['loja', 'Mensalidade da loja (fatura ML)'], ['outros', 'Outras cobranças (fatura ML)']];
    const FT_RX = /marketplace|publicidade|product ads|\bads\b|armazen|fatura (do )?mercado livre|difal|minha p[aá]gina/i;
    let ft = { sit: null, sitEm: 0 };

    function ftAuto(){ return typeof comprasCfg !== 'undefined' && comprasCfg && comprasCfg.faturaDre === 'auto'; }
    // { mês: { pub, full, difal, loja, outros } } do ano; também atualiza a situação da leitura
    async function ftMes(ano, conta){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return {};
      const pede = [supa.rpc('ml_fatura_mes', { p_ano: ano, p_conta: conta || null })];
      if(Date.now() - ft.sitEm > 60000) pede.push(supa.rpc('ml_fatura_situacao'));
      const [r, s] = await Promise.all(pede), out = {};
      (r.data || []).forEach(x => { (out[x.mes] = out[x.mes] || {})[x.classe] = Number(x.valor) || 0; });
      if(s && !s.error){ ft.sit = s.data || []; ft.sitEm = Date.now(); }
      return out;
    }
    function ftJuntar(porMes, f){ Object.keys(f || {}).forEach(m => { (porMes[m] = porMes[m] || {}).ft = f[m]; }); return porMes; }
    // o mês tem cobrança de fatura lida e o usuário escolheu usar a fatura?
    // a primeira leitura de todas as faturas já terminou? (antes disso os meses estão pela metade)
    function ftPronta(){ const S = ft.sit || []; return S.length > 0 && S.every(x => !Number(x.faltam)); }
    function ftVale(ml, m){ return ftAuto() && ftPronta() && !!(ml && ml[m] && ml[m].ft); }
    function ftLinhas(ml){
      if(!ftAuto() || !ftPronta()) return [];
      return FT_CLASSES.map(([k, nome]) => { const v = {}; for(let m = 1; m <= 12; m++) v[m] = (ml[m] && ml[m].ft && ml[m].ft[k]) || 0; return { nome, v, fatura: k }; }).filter(l => Object.values(l.v).some(x => x));
    }
    // categorias de Contas a pagar que parecem ser o pagamento da fatura do ML
    function ftSugeridas(){ return (typeof categorias !== 'undefined' ? categorias : []).filter(c => FT_RX.test(c.nome || '')).map(c => c.nome); }
    // categorias que parecem fatura do ML e continuam entrando no DRE (com o automático ligado, contam duas vezes)
    function ftDuplicadas(){
      if(!ftAuto() || typeof dreGrupoDe !== 'function') return [];
      const usadas = new Set((typeof pagamentos !== 'undefined' ? pagamentos : []).map(p => p.cat));
      return ftSugeridas().filter(n => usadas.has(n) && ['variavel', 'fixo'].includes(dreGrupoDe(n)));
    }
    function ftModoMudar(v){
      if(typeof comprasCfg === 'undefined') return;
      comprasCfg.faturaDre = v === 'auto' ? 'auto' : 'pagar';
      if(typeof comprasSalvarCfg === 'function') comprasSalvarCfg();
    }
    // ao ligar o automático: as categorias que parecem fatura do ML passam para "só caixa"
    function ftMarcarSugeridas(){
      const mud = [];
      ftSugeridas().forEach(n => { const c = categorias.find(x => x.nome === n); if(c && typeof dreGrupoDe === 'function' && ['variavel', 'fixo'].includes(dreGrupoDe(n))){ c.dreGrupo = 'fatura'; mud.push(n); } });
      if(mud.length && typeof salvar === 'function') salvar();
      return mud;
    }
    function ftData(d){ return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : ''; }
    // linha de situação embaixo do DRE
    function ftRodape(){
      const S = ft.sit || [], conta = typeof contaParam === 'function' ? contaParam() : null, L = S.filter(x => !conta || String(x.ml_user_id) === String(conta));
      const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const ler = rot => ' <a onclick="ftLerAgora(this)" style="cursor:pointer;text-decoration:underline;">' + rot + '</a>.';
      if(!L.length) return ftAuto() ? ' Fatura do Mercado Livre: ainda não foi lida (a leitura acontece de madrugada).' + ler('Ler agora') : '';
      const ate = L.map(x => x.lido_ate).filter(Boolean).sort()[0], falta = L.reduce((s, x) => s + Number(x.faltam || 0), 0), tot = L.reduce((s, x) => s + Number(x.faturas || 0), 0);
      if(falta) return ' Fatura do Mercado Livre: primeira leitura em andamento (' + (tot - falta) + ' de ' + tot + ' faturas lidas; o Mercado Livre só aceita 5 consultas por minuto).' + (ftAuto() ? ' Até terminar, o DRE continua usando o que está em Contas a pagar.' : '') + ' A leitura continua de madrugada.' + ler('Continuar agora');
      const txt = ' Fatura do Mercado Livre lida até ' + e(ftData(ate) || '–') + ' (atualiza sozinha toda madrugada).' + ler('Atualizar agora');
      return txt + (ftAuto() ? ' As cobranças entram no mês em que aconteceram, não no mês do pagamento.' : ' Ela não está entrando no DRE: para usar, abra “Configurar categorias”.');
    }
    function ftAviso(){
      const d = ftDuplicadas(); if(!d.length) return '';
      const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<div class="alert alert-warning" style="margin:14px 16px 0;">A fatura do Mercado Livre já entra sozinha no DRE, e ${d.length > 1 ? 'as categorias' : 'a categoria'} <b>${d.map(e).join(', ')}</b> também ${d.length > 1 ? 'entram' : 'entra'}: o gasto pode estar contando duas vezes. Em <b>Configurar categorias</b>, marque como “Fatura do ML (só caixa)”.</div>`;
    }
    // pede uma rodada de leitura agora (a tela chama de novo enquanto houver fatura pendente; o ML aceita 5 consultas por minuto)
    async function ftLerAgora(bt){
      if(ft.lendo) return;
      ft.lendo = true;
      if(bt){ bt.style.pointerEvents = 'none'; bt.textContent = 'Lendo a fatura…'; }
      let r = null;
      // o ML aceita 5 consultas por minuto: a primeira chamada pede a releitura e as seguintes continuam de onde parou
      for(let i = 0; i < 12; i++){
        try { r = await supa.functions.invoke('ml-fatura', { body: { acao: 'sync', forcar: i === 0 } }); } catch(e){ r = null; }
        const C = (r && r.data && r.data.contas) || [], falta = C.some(c => Number(c.pendentes) > 0 || c.limite);
        if(!r || !r.data || !falta) break;
        if(bt && bt.isConnected) bt.textContent = 'Lendo a fatura… (leva alguns minutos, pode continuar usando)';
        await new Promise(ok => setTimeout(ok, 62000));
      }
      ft.lendo = false; ft.sitEm = 0;
      if(typeof dreDados !== 'undefined'){ dreDados.chave = null; if(typeof renderDREAnual === 'function') await renderDREAnual(); }
      if(bt && bt.isConnected){ bt.style.pointerEvents = ''; bt.textContent = 'Atualizar agora'; }
      return r && r.data;
    }
