// ===== NOTAS FISCAIS RECEBIDAS =====
// Configurações → Notas fiscais: um certificado A1 por loja (cada loja é um CNPJ). O arquivo e a senha vão direto para a
// função nfe, que guarda tudo cifrado; o navegador nunca mais lê o certificado (só CNPJ, titular e validade, pela RPC
// nfe_certificados_meus). A função consulta a SEFAZ 4 vezes por dia (cron nfe-dist) e guarda as notas em nfe_recebidas.
// Página "Notas recebidas" (grupo Compras): lista por loja, com o fornecedor do cadastro quando o CNPJ bate.
// Por enquanto só consulta (resumo). Ciência, nota completa e importar a compra vêm na próxima etapa.

    let nfe = { certs: [], dist: [], notas: [], lidoEm: 0, busca: '', mes: '', sit: '' };
    const nfeEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nfeCnpj = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (s || ''); };
    const nfeDt = t => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const nfeLojaPad = () => typeof lojaPadraoId === 'function' ? lojaPadraoId() : '';

    async function nfeLerCerts(){
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const [a, b] = await Promise.all([supa.rpc('nfe_certificados_meus'), supa.from('nfe_dist').select('*').eq('usuario_id', usuarioAtual.id)]);
      nfe.certs = a.data || []; nfe.dist = b.data || [];
    }

    // ---------- Configurações ----------
    async function nfeRenderCard(){
      const view = document.getElementById('view-config'); if(!view) return;
      let card = document.getElementById('cfg-nfe-card');
      if(!card){ card = document.createElement('div'); card.id = 'cfg-nfe-card'; card.className = 'card'; card.dataset.cfgAba = 'nfe'; view.appendChild(card); }
      await nfeLerCerts();
      const contas = typeof contasML !== 'undefined' && contasML.length ? contasML : [{ id: '', apelido: 'Minha empresa' }];
      const linha = ct => {
        const c = nfe.certs.find(x => (x.loja || nfeLojaPad()) === (ct.id || nfeLojaPad())) || (contas.length === 1 ? nfe.certs[0] : null);
        const d = c ? nfe.dist.find(x => x.cnpj === c.cnpj) : null, vence = c && c.validade ? Math.round((Date.parse(c.validade) - Date.now()) / 86400000) : null;
        return `<tr><td><b>${nfeEsc(ct.apelido || 'Conta ' + ct.id)}</b></td>
          <td>${c ? `<b>${nfeEsc(nfeCnpj(c.cnpj))}</b><div class="cp-sub">${nfeEsc(c.titular || '')}</div>` : '<span class="text-muted">sem certificado</span>'}</td>
          <td>${c ? `${new Date(c.validade).toLocaleDateString('pt-BR')}${vence != null && vence <= 30 ? ` <span class="badge badge-warning">vence em ${vence} dia${vence === 1 ? '' : 's'}</span>` : ''}` : '—'}</td>
          <td>${d ? `${nfeDt(d.consultado_em)}<div class="cp-sub">${nfeEsc(d.status || '')}</div>` : '—'}</td>
          <td style="text-align:right;white-space:nowrap;"><button class="btn${c ? '-out' : ''} btn-sm" onclick="nfeEnviarCert('${nfeEsc(ct.id)}')">${c ? 'Trocar certificado' : 'Enviar certificado'}</button>${c ? ` <button class="btn-out btn-sm" style="color:var(--danger);" onclick="nfeRemoverCert('${nfeEsc(c.cnpj)}')">Remover</button>` : ''}</td></tr>`;
      };
      card.innerHTML = `
        <div class="card-header"><div class="card-title">Notas fiscais (certificado A1)</div></div>
        <div class="card-body" style="line-height:1.6;">
          <div>Com o certificado digital A1 de cada loja, o Caixa 360 consulta na SEFAZ as <b>notas emitidas para o seu CNPJ</b> e guarda tudo, formando o seu histórico. É <b>só consulta</b>: nada é lançado sozinho. A SEFAZ entrega os últimos 90 dias; daí para frente, nada se perde. A consulta roda sozinha 4 vezes por dia.</div>
          <div style="overflow-x:auto;margin:12px 0;"><table><thead><tr><th>Loja</th><th>Certificado</th><th>Validade</th><th>Última consulta</th><th></th></tr></thead><tbody>${contas.map(linha).join('')}</tbody></table></div>
          ${nfe.certs.length ? '<button class="btn-out btn-sm" onclick="nfeConsultarAgora(this)">Consultar agora</button>' : ''}
          <div class="text-muted" style="font-size:12px;margin-top:12px;">Segurança: o arquivo e a senha seguem direto para o servidor e ficam guardados cifrados. Depois de enviados, nem esta tela consegue ler o certificado; ele só é usado pela consulta à SEFAZ. Use "Remover" para apagar quando quiser.</div>
        </div>`;
    }
    function nfeEnviarCert(loja){
      const nome = typeof contaNome === 'function' && loja ? contaNome(loja) : '';
      vmlModal('Certificado A1' + (nome ? ' — ' + nfeEsc(nome) : ''), `
        <div class="text-muted" style="margin-bottom:12px;">Escolha o arquivo do certificado A1 (.pfx ou .p12) do CNPJ desta loja e digite a senha dele. O arquivo e a senha vão direto para o servidor, cifrados.</div>
        <label class="pf-c"><span>Arquivo do certificado</span><input type="file" id="nfe-arq" accept=".pfx,.p12,application/x-pkcs12"></label>
        <label class="pf-c"><span>Senha do certificado</span><input type="password" id="nfe-senha" autocomplete="off"></label>
        <div id="nfe-msg" style="font-size:13px;margin-top:8px;"></div>`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Cancelar</button><button class="btn" id="nfe-bt" onclick="nfeEnviarCertOk('${nfeEsc(loja)}')">Enviar</button>`);
    }
    async function nfeEnviarCertOk(loja){
      const arq = document.getElementById('nfe-arq')?.files?.[0], senha = document.getElementById('nfe-senha')?.value || '';
      const msg = t => { const m = document.getElementById('nfe-msg'); if(m) m.innerHTML = t; }, bt = document.getElementById('nfe-bt');
      if(!arq){ msg('<span class="text-danger">Escolha o arquivo.</span>'); return; }
      if(arq.size > 200000){ msg('<span class="text-danger">Esse arquivo é grande demais para um certificado A1.</span>'); return; }
      if(bt){ bt.disabled = true; bt.textContent = 'Enviando e consultando a SEFAZ…'; }
      try {
        const buf = new Uint8Array(await arq.arrayBuffer()); let bin = ''; buf.forEach(b => { bin += String.fromCharCode(b); });
        const r = await supa.functions.invoke('nfe', { body: { acao: 'certificado', loja: loja || null, pfx: btoa(bin), senha } });
        const d = r.data || {};
        if(r.error || d.error){ msg('<span class="text-danger">' + nfeEsc(d.error || r.error.message) + '</span>'); if(bt){ bt.disabled = false; bt.textContent = 'Enviar'; } return; }
        const cs = d.consulta || {};
        fecharModal('modal-vml');
        alert('Certificado de ' + nfeCnpj(d.cnpj) + ' guardado (válido até ' + new Date(d.validade).toLocaleDateString('pt-BR') + ').\n\nPrimeira consulta à SEFAZ: ' + (cs.erro ? 'erro — ' + cs.erro : (cs.documentos || 0) + ' documento(s). ' + (cs.status || '')));
        nfe.lidoEm = 0; nfeRenderCard();
      } catch(err){ msg('<span class="text-danger">' + nfeEsc(err.message) + '</span>'); if(bt){ bt.disabled = false; bt.textContent = 'Enviar'; } }
    }
    async function nfeRemoverCert(cnpj){
      if(!confirm('Remover o certificado do CNPJ ' + nfeCnpj(cnpj) + '? As notas já guardadas continuam; só as consultas novas param.')) return;
      const r = await supa.functions.invoke('nfe', { body: { acao: 'remover', cnpj } });
      if(r.error || (r.data && r.data.error)){ alert('Não consegui remover: ' + ((r.data && r.data.error) || r.error.message)); return; }
      nfeRenderCard();
    }
    async function nfeConsultarAgora(bt){
      if(bt){ bt.disabled = true; bt.textContent = 'Consultando…'; }
      const r = await supa.functions.invoke('nfe', { body: { acao: 'consultar' } });
      const L = (r.data && r.data.cnpjs) || [];
      alert(L.length ? L.map(x => nfeCnpj(x.cnpj) + ': ' + (x.erro ? 'erro — ' + x.erro : x.espera ? 'a SEFAZ pede para esperar até ' + nfeDt(x.espera) + ' (não havia nada novo)' : (x.documentos || 0) + ' documento(s). ' + (x.status || ''))).join('\n') : 'Nada para consultar.');
      nfe.lidoEm = 0;
      if(document.getElementById('view-config')?.classList.contains('active')) nfeRenderCard(); else nfeRender();
    }

    // ---------- página Notas recebidas ----------
    async function nfeLer(forcar){
      if(!forcar && nfe.lidoEm && Date.now() - nfe.lidoEm < 60000) return;
      if(typeof usuarioAtual === 'undefined' || !usuarioAtual) return;
      const out = [];
      for(let i = 0; i < 10; i++){
        const r = await supa.from('nfe_recebidas').select('chave,cnpj_dest,loja,emit_cnpj,emit_nome,emissao,valor,tipo,situacao,completa,importada').eq('usuario_id', usuarioAtual.id).order('emissao', { ascending: false }).range(i * 1000, i * 1000 + 999);
        if(r.error || !r.data) break; out.push(...r.data); if(r.data.length < 1000) break;
      }
      nfe.notas = out;
      await nfeLerCerts();
      if(typeof fnLer === 'function') await fnLer();
      nfe.lidoEm = Date.now();
    }
    async function nfeRender(){
      const el = document.getElementById('view-notas'); if(!el) return;
      if(!nfe.lidoEm) el.innerHTML = '<div class="pg-head"><div><div class="pg-title">Notas recebidas</div></div></div><div class="vazio"><b>Carregando…</b></div>';
      await nfeLer();
      nfeDesenhar();
    }
    function nfeDesenhar(){
      const el = document.getElementById('view-notas'); if(!el || !el.classList.contains('active')) return;
      const vez = typeof lojaAtiva === 'function' ? lojaAtiva() : '', pad = nfeLojaPad();
      const forns = typeof fn !== 'undefined' ? fn.lista : [], fornDe = c => forns.find(f => f.cnpj && f.cnpj === String(c || '').replace(/\D/g, ''));
      const meses = [...new Set(nfe.notas.map(n => String(n.emissao || '').slice(0, 7)).filter(Boolean))].sort().reverse();
      const q = String(nfe.busca || '').toLowerCase();
      const L = nfe.notas.filter(n => (!vez || (n.loja || pad) === vez) && (!nfe.mes || String(n.emissao || '').startsWith(nfe.mes))
        && (!nfe.sit || String(n.situacao) === nfe.sit)
        && (!q || [n.emit_nome, n.emit_cnpj, n.chave, (fornDe(n.emit_cnpj) || {}).nome, (fornDe(n.emit_cnpj) || {}).grupo].join(' ').toLowerCase().includes(q.replace(/[./-]/g, '')) || String(n.emit_nome || '').toLowerCase().includes(q)));
      const ok = L.filter(n => Number(n.situacao) !== 3), sit = { 1: ['Autorizada', 'cp-ok'], 2: ['Denegada', 'cp-urgente'], 3: ['Cancelada', 'cp-semvenda'] };
      const dist = nfe.dist.filter(d => !vez || nfe.certs.some(c => c.cnpj === d.cnpj && (c.loja || pad) === vez));
      el.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Notas recebidas</div><div class="pg-sub">Notas fiscais emitidas para o CNPJ ${vez && typeof contaNome === 'function' ? 'da ' + nfeEsc(contaNome(vez)) : 'das suas lojas'}, consultadas na SEFAZ e guardadas aqui. Só consulta: nada é lançado sozinho.</div></div>
          <div class="d-flex gap-1">${nfe.certs.length ? '<button class="btn-out btn-sm" onclick="nfeConsultarAgora(this)">Consultar agora</button>' : ''}</div></div>
        ${!nfe.certs.length ? `<div class="alert alert-warning">Nenhum certificado cadastrado. Envie o certificado A1 de cada loja em <a href="#" onclick="event.preventDefault();cfgAbaAtiva='nfe';nav('config')">Configurações → Notas fiscais</a>.</div>` : ''}
        <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="kpi k-neutro"><div class="kpi-label">Notas</div><div class="kpi-value">${ok.length}</div><div class="kpi-sub"><span>${L.length - ok.length} cancelada${L.length - ok.length === 1 ? '' : 's'}</span></div></div>
          <div class="kpi k-venda"><div class="kpi-label">Valor das notas</div><div class="kpi-value">${fmt(ok.reduce((s, n) => s + (Number(n.valor) || 0), 0))}</div><div class="kpi-sub"><span>sem as canceladas</span></div></div>
          <div class="kpi k-frete"><div class="kpi-label">Emitentes</div><div class="kpi-value">${new Set(ok.map(n => n.emit_cnpj)).size}</div><div class="kpi-sub"><span>${new Set(ok.filter(n => fornDe(n.emit_cnpj)).map(n => n.emit_cnpj)).size} com cadastro de fornecedor</span></div></div>
        </div>
        <div class="card"><div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <input type="search" id="nfe-busca" placeholder="Buscar emitente, CNPJ ou chave" value="${nfeEsc(nfe.busca)}" oninput="nfeBuscar(this.value)" style="max-width:280px;">
          <select onchange="nfe.mes=this.value;nfeDesenhar()"><option value="">Todos os meses</option>${meses.map(m => `<option value="${m}" ${nfe.mes === m ? 'selected' : ''}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select>
          <select onchange="nfe.sit=this.value;nfeDesenhar()"><option value="">Todas as situações</option><option value="1" ${nfe.sit === '1' ? 'selected' : ''}>Autorizadas</option><option value="3" ${nfe.sit === '3' ? 'selected' : ''}>Canceladas</option></select>
        </div></div>
        <div class="card"><div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Emissão</th><th>Emitente</th><th>CNPJ</th><th class="num">Valor</th><th>Situação</th><th>Nota</th><th>Chave</th></tr></thead><tbody>
          ${L.length ? L.slice(0, 1000).map(n => { const f = fornDe(n.emit_cnpj), s = sit[n.situacao] || ['—', 'cp-semvenda'];
            return `<tr><td style="white-space:nowrap;">${n.emissao ? new Date(n.emissao).toLocaleDateString('pt-BR') : '—'}</td>
              <td class="cp-prod"><b>${nfeEsc(f ? f.nome : n.emit_nome)}</b><span>${f ? (f.grupo ? 'Grupo ' + nfeEsc(f.grupo) : nfeEsc(n.emit_nome)) : '<a href="#" onclick="event.preventDefault();nfeCadastrarForn(\'' + nfeEsc(n.chave) + '\')">cadastrar fornecedor</a>'}</span></td>
              <td style="white-space:nowrap;">${nfeEsc(nfeCnpj(n.emit_cnpj))}</td><td class="num"><b>${fmt(Number(n.valor) || 0)}</b></td>
              <td><span class="cp-sit ${s[1]}">${s[0]}</span></td><td>${n.completa ? 'Completa' : '<span class="text-muted">Resumo</span>'}</td>
              <td><span class="text-muted" style="font-size:11.5px;cursor:pointer;" title="Copiar a chave" onclick="navigator.clipboard&&navigator.clipboard.writeText('${nfeEsc(n.chave)}');if(typeof toast==='function')toast('Chave copiada')">${nfeEsc(n.chave.slice(0, 6) + '…' + n.chave.slice(-6))}</span></td></tr>`; }).join('')
            : `<tr><td colspan="7"><div class="vazio"><b>${nfe.notas.length ? 'Nenhuma nota com esses filtros' : 'Nenhuma nota ainda'}</b>${nfe.notas.length ? '' : (nfe.certs.length ? 'A primeira consulta à SEFAZ pode levar alguns minutos para trazer os últimos 90 dias.' : 'Cadastre o certificado A1 para começar.')}</div></td></tr>`}
        </tbody></table></div></div>
        ${dist.length ? `<div class="text-muted" style="font-size:12px;">${dist.map(d => `${nfeEsc(nfeCnpj(d.cnpj))}: última consulta ${nfeDt(d.consultado_em)} · ${nfeEsc(d.status || '')}${d.esperar_ate && Date.parse(d.esperar_ate) > Date.now() ? ' · próxima a partir de ' + nfeDt(d.esperar_ate) : ''}`).join('<br>')}</div>` : ''}`;
    }
    let nfeBuscaT = null;
    function nfeBuscar(v){ nfe.busca = v; clearTimeout(nfeBuscaT); nfeBuscaT = setTimeout(() => { nfeDesenhar(); const i = document.getElementById('nfe-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
    // abre o cadastro de fornecedor já com o CNPJ da nota e busca os dados na Receita
    function nfeCadastrarForn(chave){
      const n = nfe.notas.find(x => x.chave === chave); if(!n || typeof fnEditar !== 'function') return;
      const pad = nfeLojaPad();
      fnEditar(null, { nome: n.emit_nome || '', cnpj: n.emit_cnpj || '', loja: (n.loja || pad) === pad ? '' : n.loja });
      setTimeout(() => { if(typeof fnReceita === 'function') fnReceita(); }, 50);
    }
