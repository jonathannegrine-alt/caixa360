// ===== NOTAS DE COMPRA (notas fiscais recebidas pelo CNPJ) =====
// Configurações → Notas fiscais: um certificado A1 por loja (cada loja é um CNPJ). O arquivo e a senha vão direto para a
// função nfe, que guarda tudo cifrado; o navegador nunca mais lê o certificado (só CNPJ, titular e validade, pela RPC
// nfe_certificados_meus). A função consulta a SEFAZ 4 vezes por dia (cron nfe-dist) e guarda as notas em nfe_recebidas.
// Página "Notas de compra" (grupo Compras): lista por loja, com o fornecedor do cadastro quando o CNPJ bate.
// Ver nota (nfeVer): itens, totais e duplicatas; nota completa tem "Baixar XML" (Storage nfe/<usuario>/<chave>.xml.gz) e
// "PDF da nota" (espelho no estilo do DANFE, montado do XML com jsPDF; não é o layout oficial ponto a ponto).
// Importar compra (nfeImportar): nota completa → ordem de compra nova (fluxo normal da ordem: revisa e salva, e as parcelas
// vão para o Contas a pagar) ou ligada a uma ordem que já existe. Código do fornecedor → SKU fica em nfe_mapa; código que
// serve para várias cores ("vários SKUs") só pode ser ligado a uma ordem, que já tem as quantidades por SKU.
// Custo do produto = valor na nota × fator ÷ unidades por item (fator do cadastro do fornecedor, editável em cada nota).
// Ciência da operação (nfeCiencia): função nfe acao 'ciencia' registra o evento 210210 e baixa a nota completa pela chave.

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
      if(typeof icmsRenderCard === 'function') icmsRenderCard();
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
      if(!nfe.lidoEm) el.innerHTML = '<div class="pg-head"><div><div class="pg-title">Notas de compra</div></div></div><div class="vazio"><b>Carregando…</b></div>';
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
      nfe.listaAtual = L;
      const ok = L.filter(n => Number(n.situacao) !== 3), sit = { 1: ['Autorizada', 'cp-ok'], 2: ['Denegada', 'cp-urgente'], 3: ['Cancelada', 'cp-semvenda'] };
      const dist = nfe.dist.filter(d => !vez || nfe.certs.some(c => c.cnpj === d.cnpj && (c.loja || pad) === vez));
      el.innerHTML = `
        <div class="pg-head"><div><div class="pg-title">Notas de compra</div><div class="pg-sub">Notas fiscais emitidas para o CNPJ ${vez && typeof contaNome === 'function' ? 'da ' + nfeEsc(contaNome(vez)) : 'das suas lojas'}, consultadas na SEFAZ e guardadas aqui. Só consulta: nada é lançado sozinho.</div></div>
          <div class="d-flex gap-1">${L.some(n => !n.completa && Number(n.situacao) !== 3) ? `<button class="btn-out btn-sm" onclick="nfeCienciaLista(this)" title="Registra a Ciência da operação nas notas em resumo desta lista e baixa as notas completas">Dar ciência nas notas em resumo (${L.filter(n => !n.completa && Number(n.situacao) !== 3).length})</button>` : ''}${nfe.certs.length ? '<button class="btn-out btn-sm" onclick="nfeConsultarAgora(this)">Consultar agora</button>' : ''}</div></div>
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
        <div class="card"><div style="overflow-x:auto;"><table class="cp-tab"><thead><tr><th>Emissão</th><th>Emitente</th><th>CNPJ</th><th class="num">Valor</th><th>Situação</th><th>Nota</th><th>Chave</th><th></th></tr></thead><tbody>
          ${L.length ? L.slice(0, 1000).map(n => { const f = fornDe(n.emit_cnpj), s = sit[n.situacao] || ['—', 'cp-semvenda'];
            return `<tr><td style="white-space:nowrap;"><a href="#" onclick="event.preventDefault();nfeVer('${nfeEsc(n.chave)}')">${n.emissao ? new Date(n.emissao).toLocaleDateString('pt-BR') : '—'}</a></td>
              <td class="cp-prod"><b>${nfeEsc(f ? f.nome : n.emit_nome)}</b><span>${f ? (f.grupo ? 'Grupo ' + nfeEsc(f.grupo) : nfeEsc(n.emit_nome)) : '<a href="#" onclick="event.preventDefault();nfeCadastrarForn(\'' + nfeEsc(n.chave) + '\')">cadastrar fornecedor</a>'}</span></td>
              <td style="white-space:nowrap;">${nfeEsc(nfeCnpj(n.emit_cnpj))}</td><td class="num"><b>${fmt(Number(n.valor) || 0)}</b></td>
              <td><span class="cp-sit ${s[1]}">${s[0]}</span></td><td>${n.importada ? '<span class="cp-sit cp-ok" title="Compra importada na ordem ' + nfeEsc(n.importada.ordem || '') + '">Importada</span>' : n.completa ? 'Completa' : '<span class="text-muted">Resumo</span>'}</td>
              <td><span class="text-muted" style="font-size:11.5px;cursor:pointer;" title="Copiar a chave" onclick="navigator.clipboard&&navigator.clipboard.writeText('${nfeEsc(n.chave)}');if(typeof toast==='function')toast('Chave copiada')">${nfeEsc(n.chave.slice(0, 6) + '…' + n.chave.slice(-6))}</span></td>
              <td style="text-align:right;"><button class="btn-out btn-sm" onclick="nfeVer('${nfeEsc(n.chave)}')">Ver nota</button></td></tr>`; }).join('')
            : `<tr><td colspan="8"><div class="vazio"><b>${nfe.notas.length ? 'Nenhuma nota com esses filtros' : 'Nenhuma nota ainda'}</b>${nfe.notas.length ? '' : (nfe.certs.length ? 'A primeira consulta à SEFAZ pode levar alguns minutos para trazer os últimos 90 dias.' : 'Cadastre o certificado A1 para começar.')}</div></td></tr>`}
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

    // ---------- ver a nota, baixar o XML, PDF ----------
    async function nfeXml(chave){
      const r = await supa.from('nfe_recebidas').select('xml_path').eq('usuario_id', usuarioAtual.id).eq('chave', chave).single();
      if(r.error || !r.data || !r.data.xml_path) throw new Error('XML não disponível para esta nota.');
      const d = await supa.storage.from('nfe').download(r.data.xml_path);
      if(d.error) throw new Error('Não consegui baixar o XML: ' + d.error.message);
      return await new Response(d.data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    async function nfeVer(chave){
      const r = await supa.from('nfe_recebidas').select('*').eq('usuario_id', usuarioAtual.id).eq('chave', chave).single();
      if(r.error || !r.data){ alert('Não achei a nota.'); return; }
      const n = r.data, itens = n.itens || [], dups = n.duplicatas || [], sit = { 1: 'Autorizada', 2: 'Denegada', 3: 'Cancelada' }[n.situacao] || '—';
      const num = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
      const chaveFmt = String(chave).replace(/(\d{4})(?=\d)/g, '$1 ');
      vmlModal('Nota fiscal — ' + nfeEsc(n.emit_nome || ''), `
        <div class="text-muted" style="margin-bottom:10px;line-height:1.6;">
          Emitente: <b>${nfeEsc(n.emit_nome || '')}</b> · CNPJ ${nfeEsc(nfeCnpj(n.emit_cnpj))}${n.emit_ie ? ' · IE ' + nfeEsc(n.emit_ie) : ''}<br>
          Emissão: <b>${n.emissao ? new Date(n.emissao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</b> · Situação: <b>${sit}</b> · Valor: <b>${fmt(Number(n.valor) || 0)}</b><br>
          Chave: <span style="font-family:monospace;font-size:12px;">${chaveFmt}</span>${n.importada ? '<br><b class="text-success">Compra importada</b> na ordem <b>' + nfeEsc(n.importada.ordem || '') + '</b>' + (n.importada.em ? ' em ' + new Date(n.importada.em).toLocaleDateString('pt-BR') : '') : ''}
        </div>
        ${n.completa ? `
          <div class="form-label">Itens (${itens.length})</div>
          <div style="overflow-x:auto;max-height:36vh;"><table class="cp-tab"><thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th class="num">Qtd.</th><th>Un.</th><th class="num">Valor unit.</th><th class="num">Total</th></tr></thead><tbody>
            ${itens.map(i => `<tr><td>${nfeEsc(i.codigo)}</td><td style="white-space:normal;">${nfeEsc(i.descricao)}</td><td>${nfeEsc(i.ncm || '')}</td><td>${nfeEsc(i.cfop || '')}</td><td class="num">${num(i.qtd)}</td><td>${nfeEsc(i.unidade || '')}</td><td class="num">${fmt(Number(i.valor_un) || 0)}</td><td class="num"><b>${fmt(Number(i.valor) || 0)}</b></td></tr>`).join('')}
          </tbody></table></div>
          ${dups.length ? `<div class="form-label" style="margin-top:12px;">Duplicatas</div><div style="display:flex;gap:8px;flex-wrap:wrap;">${dups.map(d => `<span class="cp-sit cp-comprar">${nfeEsc(d.numero || '')} · ${d.vencimento ? ptDate(d.vencimento) : '—'} · ${fmt(Number(d.valor) || 0)}</span>`).join('')}</div>` : '<div class="text-muted" style="margin-top:10px;font-size:12.5px;">Sem duplicatas na nota (pagamento à vista ou combinado fora da nota).</div>'}`
        : `<div class="alert alert-warning">Esta nota chegou só como <b>resumo</b>. A SEFAZ libera os itens depois da <b>Ciência da operação</b>: um aviso de que você sabe que a nota existe (não aceita nem recusa a nota e não tem efeito fiscal).${n.ciencia_em ? '<br>Ciência registrada em ' + new Date(n.ciencia_em).toLocaleString('pt-BR') + '; a nota completa chega em alguns minutos ou na próxima consulta.' : ''}</div>`}`,
        `<button class="btn-out" onclick="fecharModal('modal-vml')">Fechar</button>${!n.completa && Number(n.situacao) !== 3 ? `<button class="btn" onclick="nfeCiencia(['${nfeEsc(chave)}'], this)">${n.ciencia_em ? 'Tentar baixar de novo' : 'Dar ciência e baixar a nota'}</button>` : ''}${n.completa && !n.importada ? `<button class="btn" onclick="nfeImportar('${nfeEsc(chave)}')">Importar compra</button>` : ''}${n.completa ? `<button class="btn-out" onclick="nfeBaixarXml('${nfeEsc(chave)}', this)">Baixar XML</button><button class="btn" onclick="nfePdf('${nfeEsc(chave)}', this)">PDF da nota</button>` : ''}`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '980px';
    }
    async function nfeBaixarXml(chave, bt){
      if(bt){ bt.disabled = true; bt.textContent = 'Baixando…'; }
      try { const x = await nfeXml(chave), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'application/xml' })); a.download = chave + '-nfe.xml'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
      catch(e){ alert(e.message); }
      finally { if(bt){ bt.disabled = false; bt.textContent = 'Baixar XML'; } }
    }
    // PDF no estilo do DANFE, montado do XML (cópia para consulta; o documento fiscal é o XML)
    async function nfePdf(chave, bt){
      if(bt){ bt.disabled = true; bt.textContent = 'Gerando…'; }
      try {
        const xml = await nfeXml(chave), D = new DOMParser().parseFromString(xml, 'application/xml');
        const q = (el, t) => { const x = el && el.getElementsByTagName(t)[0]; return x ? x.textContent.trim() : ''; };
        const inf = D.getElementsByTagName('infNFe')[0], ide = inf.getElementsByTagName('ide')[0], emit = inf.getElementsByTagName('emit')[0], dest = inf.getElementsByTagName('dest')[0];
        const ee = emit.getElementsByTagName('enderEmit')[0], ed = dest ? dest.getElementsByTagName('enderDest')[0] : null, tot = inf.getElementsByTagName('ICMSTot')[0];
        const prot = D.getElementsByTagName('infProt')[0], transp = inf.getElementsByTagName('transp')[0];
        const end = e => e ? [q(e, 'xLgr') + (q(e, 'nro') ? ', ' + q(e, 'nro') : ''), q(e, 'xCpl'), q(e, 'xBairro'), q(e, 'xMun') + '/' + q(e, 'UF'), q(e, 'CEP') ? 'CEP ' + q(e, 'CEP').replace(/(\d{5})(\d{3})/, '$1-$2') : ''].filter(Boolean).join(' - ') : '';
        const v = x => (Number(x) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const qn = x => (Number(x) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
        const doc_ = (s0) => { const d = String(s0 || '').replace(/\D/g, ''); return d.length === 14 ? nfeCnpj(d) : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d; };
        await clScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await clScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), M = 30, W = 595 - 2 * M;
        // quadro com título pequeno e valor (como os campos do DANFE)
        const campo = (x, y, w, h, tit, val, opt) => { doc.setDrawColor(0); doc.setLineWidth(0.5); doc.rect(x, y, w, h);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(60); doc.text(tit.toUpperCase(), x + 3, y + 8);
          doc.setFont('helvetica', opt && opt.bold ? 'bold' : 'normal'); doc.setFontSize((opt && opt.tam) || 8.5); doc.setTextColor(0);
          const l = doc.splitTextToSize(String(val || ''), w - 6); doc.text(l.slice(0, (opt && opt.linhas) || 2), opt && opt.dir ? x + w - 3 : x + 3, y + 18, Object.assign({ lineHeightFactor: 1.1 }, opt && opt.dir ? { align: 'right' } : {})); };
        let y = M;
        // emitente + identificação
        doc.rect(M, y, W * 0.55, 78); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(doc.splitTextToSize(q(emit, 'xNome'), W * 0.55 - 10).slice(0, 2), M + 5, y + 16);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(doc.splitTextToSize(end(ee), W * 0.55 - 10).slice(0, 3), M + 5, y + 42);
        doc.text('CNPJ ' + doc_(q(emit, 'CNPJ')) + (q(emit, 'IE') ? '   IE ' + q(emit, 'IE') : ''), M + 5, y + 70);
        const xi = M + W * 0.55; doc.rect(xi, y, W * 0.45, 78);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('DANFE', xi + 8, y + 18);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('Documento Auxiliar da Nota Fiscal Eletrônica', xi + 8, y + 28);
        doc.setFontSize(8.5); doc.text((q(ide, 'tpNF') === '0' ? '0 - Entrada' : '1 - Saída') + '     Nº ' + q(ide, 'nNF') + '   Série ' + q(ide, 'serie'), xi + 8, y + 44);
        doc.setFontSize(6.5); doc.setTextColor(90); doc.text('Cópia gerada pelo Caixa 360 a partir do XML (para consulta)', xi + 8, y + 70); doc.setTextColor(0);
        y += 82;
        campo(M, y, W, 26, 'Chave de acesso', String(chave).replace(/(\d{4})(?=\d)/g, '$1 '), { bold: true, tam: 9.5 }); y += 28;
        campo(M, y, W * 0.6, 26, 'Natureza da operação', q(ide, 'natOp')); campo(M + W * 0.6, y, W * 0.4, 26, 'Protocolo de autorização', prot ? q(prot, 'nProt') + ' - ' + new Date(q(prot, 'dhRecbto')).toLocaleString('pt-BR') : ''); y += 30;
        // destinatário
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('DESTINATÁRIO', M, y + 7); y += 10;
        campo(M, y, W * 0.6, 26, 'Nome / razão social', dest ? q(dest, 'xNome') : ''); campo(M + W * 0.6, y, W * 0.22, 26, 'CNPJ / CPF', dest ? doc_(q(dest, 'CNPJ') || q(dest, 'CPF')) : ''); campo(M + W * 0.82, y, W * 0.18, 26, 'Emissão', new Date(q(ide, 'dhEmi')).toLocaleDateString('pt-BR')); y += 28;
        campo(M, y, W * 0.82, 36, 'Endereço', end(ed), { tam: 8 }); campo(M + W * 0.82, y, W * 0.18, 36, 'IE', dest ? q(dest, 'IE') : ''); y += 40;
        // duplicatas
        const dups = [...inf.getElementsByTagName('dup')];
        if(dups.length){ doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('FATURA / DUPLICATAS', M, y + 7); y += 10;
          const w = W / Math.min(6, dups.length); dups.slice(0, 12).forEach((d, i) => { const col = i % 6, lin = Math.floor(i / 6); campo(M + col * w, y + lin * 26, w, 26, 'Nº ' + q(d, 'nDup') + ' · venc. ' + (q(d, 'dVenc') ? ptDate(q(d, 'dVenc')) : ''), 'R$ ' + v(q(d, 'vDup'))); });
          y += 26 * Math.ceil(Math.min(12, dups.length) / 6) + 4; }
        // impostos e totais
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('CÁLCULO DO IMPOSTO', M, y + 7); y += 10;
        const tw = W / 7; [['Base ICMS', 'vBC'], ['Valor ICMS', 'vICMS'], ['Base ICMS ST', 'vBCST'], ['Valor ICMS ST', 'vST'], ['Valor IPI', 'vIPI'], ['PIS + COFINS', null], ['Valor dos produtos', 'vProd']]
          .forEach(([t, k], i) => campo(M + i * tw, y, tw, 26, t, 'R$ ' + v(k ? q(tot, k) : (Number(q(tot, 'vPIS')) || 0) + (Number(q(tot, 'vCOFINS')) || 0)), { dir: true }));
        y += 26; [['Frete', 'vFrete'], ['Seguro', 'vSeg'], ['Desconto', 'vDesc'], ['Outras despesas', 'vOutro'], ['II', 'vII'], ['', null], ['Valor total da nota', 'vNF']]
          .forEach(([t, k], i) => campo(M + i * tw, y, tw, 26, t, k ? 'R$ ' + v(q(tot, k)) : '', { dir: true, bold: k === 'vNF' }));
        y += 30;
        if(transp){ doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('TRANSPORTADOR', M, y + 7); y += 10;
          const tr = transp.getElementsByTagName('transporta')[0], vol = transp.getElementsByTagName('vol')[0], mod = { 0: 'Por conta do emitente', 1: 'Por conta do destinatário', 2: 'Por conta de terceiros', 9: 'Sem frete' }[q(transp, 'modFrete')] || q(transp, 'modFrete');
          campo(M, y, W * 0.4, 26, 'Nome', tr ? q(tr, 'xNome') : ''); campo(M + W * 0.4, y, W * 0.25, 26, 'Frete', mod); campo(M + W * 0.65, y, W * 0.17, 26, 'Volumes', vol ? q(vol, 'qVol') : ''); campo(M + W * 0.82, y, W * 0.18, 26, 'Peso bruto', vol ? q(vol, 'pesoB') : ''); y += 30; }
        // itens
        const dets = [...inf.getElementsByTagName('det')];
        doc.autoTable({ startY: y + 2, margin: { left: M, right: M }, theme: 'grid', rowPageBreak: 'avoid',
          head: [['Código', 'Descrição', 'NCM', 'CFOP', 'Un.', 'Qtd.', 'Valor unit.', 'Valor total', 'ICMS', 'IPI']],
          body: dets.map(d => { const p = d.getElementsByTagName('prod')[0], im = d.getElementsByTagName('imposto')[0], icms = im ? im.getElementsByTagName('ICMS')[0] : null, ipi = im ? im.getElementsByTagName('IPI')[0] : null;
            return [q(p, 'cProd'), q(p, 'xProd'), q(p, 'NCM'), q(p, 'CFOP'), q(p, 'uCom'), qn(q(p, 'qCom')), v(q(p, 'vUnCom')), v(q(p, 'vProd')), icms ? v(q(icms, 'vICMS')) : '', ipi ? v(q(ipi, 'vIPI')) : '']; }),
          styles: { fontSize: 7, cellPadding: 3, lineColor: 0, lineWidth: 0.4, textColor: 0, overflow: 'linebreak' },
          headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold', fontSize: 6.5 },
          columnStyles: { 0: { cellWidth: 52 }, 2: { cellWidth: 44 }, 3: { cellWidth: 30 }, 4: { cellWidth: 24 }, 5: { cellWidth: 40, halign: 'right' }, 6: { cellWidth: 50, halign: 'right' }, 7: { cellWidth: 54, halign: 'right' }, 8: { cellWidth: 36, halign: 'right' }, 9: { cellWidth: 34, halign: 'right' } } });
        y = doc.lastAutoTable.finalY + 6;
        const cpl = [q(inf.getElementsByTagName('infAdic')[0], 'infCpl'), q(inf.getElementsByTagName('infAdic')[0], 'infAdFisco')].filter(Boolean).join(' ');
        if(cpl){ if(y > 760){ doc.addPage(); y = M; } doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text('INFORMAÇÕES COMPLEMENTARES', M, y + 7);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); const l = doc.splitTextToSize(cpl, W - 6); doc.rect(M, y + 10, W, Math.min(l.length, 14) * 9 + 8); doc.text(l.slice(0, 14), M + 3, y + 20); }
        doc.save('nfe_' + q(ide, 'nNF') + '_' + (q(emit, 'xFant') || q(emit, 'xNome')).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) + '.pdf');
      } catch(e){ alert('Não consegui gerar o PDF: ' + (e.message || e)); }
      finally { if(bt){ bt.disabled = false; bt.textContent = 'PDF da nota'; } }
    }

    // Ciência da operação + nota completa (várias de uma vez: até 60 por chamada)
    async function nfeCiencia(chaves, bt){
      if(bt){ bt.disabled = true; bt.textContent = 'Registrando na SEFAZ…'; }
      const res = {};
      try {
        for(let i = 0; i < chaves.length; i += 60){
          const r = await supa.functions.invoke('nfe', { body: { acao: 'ciencia', chaves: chaves.slice(i, i + 60) } });
          if(r.error || (r.data && r.data.error)) throw new Error((r.data && r.data.error) || r.error.message);
          Object.assign(res, (r.data && r.data.resultado) || {});
        }
      } catch(e){ alert('Não consegui registrar a Ciência: ' + e.message); if(bt){ bt.disabled = false; bt.textContent = 'Tentar de novo'; } return; }
      const ok = Object.values(res).filter(x => x.ok).length, comp = Object.values(res).filter(x => x.completa).length, erros = Object.entries(res).filter(([, x]) => !x.ok);
      nfe.lidoEm = 0; await nfeLer(true); nfeDesenhar();
      if(chaves.length === 1 && res[chaves[0]] && res[chaves[0]].ok){ nfeVer(chaves[0]); if(!res[chaves[0]].completa && typeof toast === 'function') toast('Ciência registrada. A SEFAZ ainda não liberou a nota completa; ela chega em alguns minutos ou na próxima consulta.'); return; }
      fecharModal('modal-vml');
      alert('Ciência registrada em ' + ok + ' de ' + chaves.length + ' nota(s); ' + comp + ' já vieram completas.' + (ok > comp ? '\nAs outras chegam completas em alguns minutos ou na próxima consulta.' : '') + (erros.length ? '\n\nNão deu certo em ' + erros.length + ':\n' + erros.slice(0, 5).map(([k, x]) => '…' + k.slice(-8) + ': ' + (x.erro || '')).join('\n') : ''));
    }
    function nfeCienciaLista(bt){
      const L = (nfe.listaAtual || []).filter(n => !n.completa && Number(n.situacao) !== 3);
      if(!L.length) return;
      if(!confirm('Registrar a Ciência da operação em ' + L.length + ' nota(s) desta lista e baixar as notas completas?\n\nA Ciência só avisa a SEFAZ que você sabe que a nota existe: não aceita nem recusa a nota e não tem efeito fiscal. Fica registrada na nota.')) return;
      nfeCiencia(L.map(n => n.chave), bt);
    }

    // ---------- importar a compra pela nota ----------
    async function nfeMarcarImportada(chave, info){
      const r = await supa.from('nfe_recebidas').update({ importada: { ...info, em: new Date().toISOString() }, atualizado_em: new Date().toISOString() }).eq('usuario_id', usuarioAtual.id).eq('chave', chave);
      if(r.error && typeof toast === 'function') toast('A ordem foi salva, mas não consegui marcar a nota como importada: ' + r.error.message);
      nfe.lidoEm = 0;
    }
    const nfeNum = v => { const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
    async function nfeImportar(chave){
      const r = await supa.from('nfe_recebidas').select('*').eq('usuario_id', usuarioAtual.id).eq('chave', chave).single();
      if(r.error || !r.data || !r.data.completa){ alert('A nota precisa estar completa para importar.'); return; }
      const n = r.data;
      if(typeof fnLer === 'function') await fnLer(true);
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      const forn = (typeof fn !== 'undefined' ? fn.lista : []).find(f => f.cnpj && f.cnpj === n.emit_cnpj) || null;
      const m = await supa.from('nfe_mapa').select('*').eq('usuario_id', usuarioAtual.id).eq('emit_cnpj', n.emit_cnpj);
      const mapa = new Map((m.data || []).map(x => [x.codigo, x]));
      const fator = forn && Number(forn.fator_nf) > 0 ? Number(forn.fator_nf) : 1;
      nfe.imp = { chave, n, forn, fator, ordem: '', linhas: (n.itens || []).map(i => { const mp = mapa.get(String(i.codigo)) || {};
        const ipiPct = Number(i.valor) > 0 && Number(i.ipi) > 0 ? Math.round(Number(i.ipi) / Number(i.valor) * 10000) / 100 : 0;
        return { codigo: String(i.codigo), descricao: i.descricao, unidade: i.unidade, qtd: Number(i.qtd) || 0, vun: Number(i.valor_un) || 0, ipi: ipiPct,
          sku: mp.sku || '', mult: Number(mp.mult) > 0 ? Number(mp.mult) : 1, varia: !!mp.varia, custo: null }; }) };
      // estados e ICMS de cada item pelo XML (a lista de itens guardada não tem); sem o XML, origem pelo código da chave
      const I = nfe.imp; I.ufOrig = typeof ICMS_COD_UF !== 'undefined' ? ICMS_COD_UF[Number(String(chave).slice(0, 2))] || '' : '';
      try {
        const D = new DOMParser().parseFromString(await nfeXml(chave), 'application/xml'), q = (el, t) => { const x = el && el.getElementsByTagName(t)[0]; return x ? x.textContent : ''; };
        const em = D.getElementsByTagName('enderEmit')[0], de = D.getElementsByTagName('enderDest')[0];
        if(q(em, 'UF')) I.ufOrig = q(em, 'UF'); if(q(de, 'UF')) I.ufDest = q(de, 'UF');
        [...D.getElementsByTagName('det')].forEach((d, k) => { const l = I.linhas[k], ic = d.getElementsByTagName('ICMS')[0]; if(!l || !ic) return;
          l.pIcms = Number(q(ic, 'pICMS')) || 0; l.importado = ['1', '2', '3', '8'].includes(q(ic, 'orig')); });
      } catch(e){}
      if(!I.ufDest) I.ufDest = typeof icmsUfLoja === 'function' ? icmsUfLoja() : 'SP';
      I.difal = !!(typeof comprasCfg !== 'undefined' && comprasCfg.difalEntrada) && I.ufOrig && I.ufOrig !== I.ufDest;
      nfeImpDesenhar();
    }
    // ordens que podem ser desta nota: do mesmo fornecedor (pelo cadastro ou pelo nome da nota) e ainda sem nota ligada
    function nfeImpOrdens(){
      const I = nfe.imp, ch = typeof fnChave === 'function' ? fnChave : (x => String(x || '').toLowerCase());
      const nomes = new Set([I.n.emit_nome, ...(I.forn ? [I.forn.nome, I.forn.razao_social, I.forn.fantasia, ...(I.forn.apelidos || [])] : [])].map(ch).filter(Boolean));
      const todas = (typeof oc !== 'undefined' && oc.ordens ? oc.ordens : []).filter(o => Number(o.situacao) !== 2 && !(o.extra && (o.extra.excluida || o.extra.nfe)));
      const dele = todas.filter(o => nomes.has(ch(o.fornecedor)));
      return { dele, outras: todas.filter(o => !dele.includes(o)).slice(0, 60) };
    }
    function nfeImpLer(){
      const I = nfe.imp; if(!I) return;
      const f = document.getElementById('nfi-fator'); if(f) I.fator = nfeNum(f.value) > 0 ? nfeNum(f.value) : 1;
      const o = document.getElementById('nfi-ordem'); if(o) I.ordem = o.value;
      I.linhas.forEach((l, k) => { const g = c => document.getElementById('nfi-' + c + '-' + k);
        if(g('sku')) l.sku = g('sku').value.trim(); if(g('varia')) l.varia = g('varia').checked;
        if(g('mult')) l.mult = nfeNum(g('mult').value) > 0 ? nfeNum(g('mult').value) : 1;
        if(g('custo')) l.custo = g('custo').value.trim() === '' ? null : nfeNum(g('custo').value); });
    }
    // produtos para o campo "Nosso SKU": a lista mostra SKU e nome; digitar palavras do nome ("vaso diamante bege") também acha
    const nfeProdNome = s => typeof ocNomeProduto === 'function' ? ocNomeProduto(s) : ((typeof skus !== 'undefined' ? skus : []).find(x => x.sku === s) || {}).titulo || '';
    const nfeSA = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    function nfeProds(){
      return [...new Set([...(typeof skus !== 'undefined' ? skus : []).map(x => x.sku), ...(typeof estoqueGalpao !== 'undefined' ? estoqueGalpao : []).map(x => x.sku)])].filter(Boolean).sort().map(s => ({ sku: s, nome: nfeProdNome(s) }));
    }
    // texto que não é um SKU conhecido: um produto com todas as palavras (nome + SKU) troca pelo SKU dele
    function nfeSkuNome(k){
      const el = document.getElementById('nfi-sku-' + k); if(!el) return;
      const txt = el.value.trim(), P = nfeProds(), nm = document.getElementById('nfi-nome-' + k);
      const igual = P.find(p => nfeSA(p.sku) === nfeSA(txt)); if(nm) nm.textContent = igual ? igual.nome : '';
      if(!txt || igual) return;
      const pal = nfeSA(txt).split(/[\s\-·]+/).filter(Boolean);
      const achou = P.filter(p => { const t = nfeSA(p.nome + ' ' + p.sku.split('-').join(' ')); return pal.every(w => t.includes(w)); });
      if(achou.length === 1){ el.value = achou[0].sku; if(nm) nm.textContent = achou[0].nome; }
      else if(typeof toast === 'function') toast(achou.length ? achou.length + ' produtos com essas palavras: escolha na lista ou digite também a cor.' : 'Nenhum produto com esse nome ou SKU.');
    }
    const nfeCustoAuto = (l, fator) => Math.round(l.vun * fator / (l.mult || 1) * 10000) / 10000;
    // DIFAL por unidade do nosso SKU: (valor na nota + IPI) × diferença de alíquota; o preço da ordem continua sem IPI
    // (a ordem soma o IPI à parte) e sem DIFAL (não é pago ao fornecedor)
    function nfeDifalPct(l){ const I = nfe.imp; return I.difal && typeof icmsDifal === 'function' ? icmsDifal(I.ufOrig, I.ufDest, l.importado, l.pIcms) : 0; }
    function nfeCustoReal(l, preco){
      const ipi = preco * (l.ipi || 0) / 100, difal = l.vun * (1 + (l.ipi || 0) / 100) / (l.mult || 1) * nfeDifalPct(l) / 100;
      return { ipi, difal, total: preco + ipi + difal };
    }
    function nfeImpDesenhar(){
      const I = nfe.imp, n = I.n, O = nfeImpOrdens(), nNF = Number(String(I.chave).slice(25, 34));
      const prodsL = nfeProds();
      const din = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      vmlModal('Importar compra — nota nº ' + nNF, `
        <div class="text-muted" style="margin-bottom:10px;line-height:1.6;">${nfeEsc(n.emit_nome || '')} · ${nfeEsc(nfeCnpj(n.emit_cnpj))} · emitida em ${n.emissao ? new Date(n.emissao).toLocaleDateString('pt-BR') : '—'} · ${fmt(Number(n.valor) || 0)}
          ${I.forn ? '<br>Fornecedor: <b>' + nfeEsc(I.forn.nome) + '</b>' + (I.forn.grupo ? ' (grupo ' + nfeEsc(I.forn.grupo) + ')' : '') : '<br><span class="text-danger">Este CNPJ não tem cadastro de fornecedor.</span> <a href="#" onclick="event.preventDefault();nfeCadastrarForn(\'' + nfeEsc(I.chave) + '\')">Cadastrar agora</a> (o fator da nota fica no cadastro)'}</div>
        <div class="pf-grid" style="grid-template-columns:1fr 2fr;align-items:end;">
          <label class="pf-c"><span>Fator da nota ${typeof dica === 'function' ? dica('Custo do produto = valor na nota × fator ÷ unidades por item. Vem do cadastro do fornecedor; mude aqui se nesta nota for diferente.', true) : ''}</span><input id="nfi-fator" type="number" min="0" step="0.01" value="${I.fator}" onchange="nfeImpLer();nfe.imp.linhas.forEach(l=>l.custo=null);nfeImpDesenhar()"></label>
          <label class="pf-c"><span>Ordem de compra</span><select id="nfi-ordem" onchange="nfeImpLer()"><option value="">Criar uma ordem nova com esta nota</option>
            ${O.dele.length ? '<optgroup label="Deste fornecedor">' + O.dele.map(x => `<option value="${x.id}" ${String(I.ordem) === String(x.id) ? 'selected' : ''}>Ligar à ordem ${nfeEsc(x.numero)} · ${x.data ? ptDate(String(x.data).slice(0, 10)) : ''} · ${fmt(Number(x.total) || 0)}</option>`).join('') + '</optgroup>' : ''}
            ${O.outras.length ? '<optgroup label="Outras ordens">' + O.outras.map(x => `<option value="${x.id}" ${String(I.ordem) === String(x.id) ? 'selected' : ''}>Ligar à ordem ${nfeEsc(x.numero)} · ${nfeEsc(x.fornecedor || '')} · ${fmt(Number(x.total) || 0)}</option>`).join('') + '</optgroup>' : ''}</select></label>
        </div>
        ${(() => { const p = I.linhas.length ? nfeDifalPct({ ...I.linhas[0], importado: I.linhas[0].importado }) : 0, tot = I.linhas.reduce((s, l) => s + l.vun * (1 + (l.ipi || 0) / 100) * l.qtd * nfeDifalPct(l) / 100, 0);
          const inter = I.linhas[0] && I.linhas[0].pIcms ? I.linhas[0].pIcms : (typeof icmsInter === 'function' ? icmsInter(I.ufOrig, I.ufDest, I.linhas[0] && I.linhas[0].importado) : 0);
          return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin:10px 0;padding:8px 10px;border:1px solid var(--border, #ddd);border-radius:8px;">
            <label style="display:flex;gap:6px;align-items:center;font-weight:600;"><input type="checkbox" ${I.difal ? 'checked' : ''} ${!I.ufOrig || I.ufOrig === I.ufDest ? 'disabled' : ''} onchange="nfeImpLer();nfe.imp.difal=this.checked;nfeImpDesenhar()"> Calcular DIFAL (ICMS de outro estado)</label>
            <span class="text-muted">${I.ufOrig && I.ufOrig !== I.ufDest ? `${nfeEsc(I.ufOrig)} → ${nfeEsc(I.ufDest)}: interna ${nfeEsc(I.ufDest)} ${String(typeof icmsInterna === 'function' ? icmsInterna(I.ufDest) : 0).replace('.', ',')}% − ${String(inter).replace('.', ',')}% da nota${I.difal ? ` = <b>${String(p).replace('.', ',')}%</b> · DIFAL da nota <b>${fmt(tot)}</b>` : ''}` : 'Nota do mesmo estado: sem DIFAL.'}</span>
            <a href="#" onclick="event.preventDefault();nfeImpLer();icmsTabela(true)" style="margin-left:auto;">tabela de ICMS</a></div>`; })()}
        <datalist id="nfi-skus">${prodsL.map(x => `<option value="${nfeEsc(x.sku)}" label="${nfeEsc(x.nome)}">`).join('')}</datalist>
        <div style="overflow-x:auto;max-height:46vh;"><table class="cp-tab"><thead><tr><th>Item da nota</th><th class="num">Qtd.</th><th class="num">Valor na nota</th><th>Nosso SKU</th><th title="Marque quando o mesmo código vale para vários SKUs (cores). A quantidade de cada SKU vem da ordem de compra ligada.">Vários SKUs</th><th class="num" title="Quantas unidades do nosso SKU vêm em cada unidade da nota (ex.: caixa com 10)">Un. por item</th><th class="num" title="Preço de cada unidade do nosso SKU que vai para a ordem de compra, sem IPI (a ordem soma o IPI à parte)">Preço na ordem</th><th class="num" title="Preço na ordem + IPI + DIFAL (se marcado): quanto o produto custa de verdade">Custo real</th></tr></thead><tbody>
          ${I.linhas.map((l, k) => { const custo = l.custo != null ? l.custo : nfeCustoAuto(l, I.fator);
            return `<tr><td style="white-space:normal;min-width:220px;"><b>${nfeEsc(l.codigo)}</b> · ${nfeEsc(l.descricao)}</td><td class="num">${(l.qtd || 0).toLocaleString('pt-BR')} ${nfeEsc(l.unidade || '')}</td><td class="num">R$ ${din(l.vun)}${l.ipi ? '<div class="cp-sub">+ IPI ' + String(l.ipi).replace('.', ',') + '%</div>' : ''}</td>
              <td><input id="nfi-sku-${k}" list="nfi-skus" value="${nfeEsc(l.sku)}" placeholder="${l.varia ? 'vários (pela ordem)' : 'SKU ou nome'}" style="min-width:150px;" ${l.varia ? 'disabled' : ''} onchange="nfeSkuNome(${k})"><div class="cp-sub" id="nfi-nome-${k}">${!l.varia && l.sku ? nfeEsc(nfeProdNome(l.sku)) : ''}</div></td>
              <td style="text-align:center;"><input type="checkbox" id="nfi-varia-${k}" ${l.varia ? 'checked' : ''} onchange="nfeImpLer();nfeImpDesenhar()"></td>
              <td class="num"><input id="nfi-mult-${k}" type="number" min="1" step="1" value="${l.mult}" style="width:70px;" onchange="nfeImpLer();nfe.imp.linhas[${k}].custo=null;nfeImpDesenhar()"></td>
              <td class="num"><input id="nfi-custo-${k}" class="money-input" value="${din(custo)}" style="width:100px;text-align:right;" onchange="nfeImpLer();nfeImpDesenhar()"></td>
              <td class="num">${(() => { const r = nfeCustoReal(l, custo); return '<b>R$ ' + din(r.total) + '</b>' + (r.ipi || r.difal ? '<div class="cp-sub">' + [r.ipi ? 'IPI ' + din(r.ipi) : '', r.difal ? 'DIFAL ' + din(r.difal) : ''].filter(Boolean).join(' · ') + '</div>' : ''); })()}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="text-muted" style="font-size:12px;margin-top:8px;">O SKU de cada código fica guardado: na próxima nota deste fornecedor ele já vem preenchido. Criar ordem nova abre a ordem de compra para você revisar e salvar (as parcelas vão para o Contas a pagar como sempre).</div>`,
        `<button class="btn-out" onclick="nfeVer('${nfeEsc(I.chave)}')">Voltar</button><button class="btn" onclick="nfeImpConfirmar(this)">Continuar</button>`);
      const mc = document.querySelector('#modal-vml .modal-content'); if(mc) mc.style.maxWidth = '1100px';
    }
    async function nfeImpConfirmar(bt){
      nfeImpLer();
      const I = nfe.imp, n = I.n, ordem = I.ordem ? (oc.ordens || []).find(x => String(x.id) === String(I.ordem)) : null;
      const semSku = I.linhas.filter(l => !l.varia && !l.sku);
      if(semSku.length){ alert('Informe o nosso SKU de: ' + semSku.map(l => l.codigo).join(', ') + ' (ou marque "Vários SKUs").'); return; }
      if(!ordem && I.linhas.some(l => l.varia)){ alert('Itens com "Vários SKUs" precisam de uma ordem de compra ligada, porque é ela que diz quanto veio de cada SKU. Escolha a ordem no campo "Ordem de compra".'); return; }
      if(bt){ bt.disabled = true; bt.textContent = 'Salvando…'; }
      // de-para do código para o SKU, para as próximas notas
      const mp = I.linhas.map(l => ({ usuario_id: usuarioAtual.id, emit_cnpj: n.emit_cnpj, codigo: l.codigo, sku: l.varia ? null : l.sku, mult: l.mult || 1, varia: !!l.varia, atualizado_em: new Date().toISOString() }));
      const g = await supa.from('nfe_mapa').upsert(mp, { onConflict: 'usuario_id,emit_cnpj,codigo' });
      if(g.error){ alert('Não consegui guardar o de-para dos códigos: ' + g.error.message); if(bt){ bt.disabled = false; bt.textContent = 'Continuar'; } return; }
      if(ordem){
        // liga a nota à ordem e mostra a comparação de unidades
        const ex = { ...(ordem.extra || {}), nfe: I.chave };
        const u = await supa.from('olist_ordens').update({ extra: ex }).eq('usuario_id', usuarioAtual.id).eq('id', ordem.id);
        if(u.error){ alert('Não consegui ligar a nota à ordem: ' + u.error.message); if(bt){ bt.disabled = false; bt.textContent = 'Continuar'; } return; }
        ordem.extra = ex;
        await nfeMarcarImportada(I.chave, { ordem: ordem.numero, ordem_id: ordem.id, como: 'ligada' });
        const unNota = I.linhas.reduce((s, l) => s + l.qtd * (l.mult || 1), 0), unOrdem = (ordem.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);
        const porSku = new Map(); (ordem.itens || []).forEach(i => porSku.set(String(i.sku).toLowerCase(), (porSku.get(String(i.sku).toLowerCase()) || 0) + (Number(i.qtd) || 0)));
        const dif = I.linhas.filter(l => !l.varia).filter(l => (porSku.get(l.sku.toLowerCase()) || 0) !== l.qtd * (l.mult || 1)).map(l => l.sku + ': nota ' + (l.qtd * (l.mult || 1)) + ', ordem ' + (porSku.get(l.sku.toLowerCase()) || 0));
        fecharModal('modal-vml'); nfe.lidoEm = 0; await nfeLer(true); nfeDesenhar();
        alert('Nota ligada à ordem ' + ordem.numero + '.\n\nUnidades na nota: ' + unNota.toLocaleString('pt-BR') + '\nUnidades na ordem: ' + unOrdem.toLocaleString('pt-BR') + (unNota === unOrdem ? '\n\nAs quantidades batem.' : '\n\nAs quantidades NÃO batem: confira com o fornecedor.') + (dif.length ? '\n\nPor SKU:\n' + dif.slice(0, 10).join('\n') : ''));
        return;
      }
      // ordem nova: abre o formulário da ordem já preenchido; ao salvar, a nota fica marcada como importada
      const itens = I.linhas.map(l => ({ sku: l.sku, qtd: Math.round(l.qtd * (l.mult || 1) * 1000) / 1000, valor: l.custo != null ? l.custo : nfeCustoAuto(l, I.fator), ipi: l.ipi }));
      fecharModal('modal-vml'); nav('ordens-compra');
      if(typeof ocCarregar === 'function') try { await ocCarregar(false); } catch(e){}
      if(typeof ocCriar !== 'function') return;
      ocCriar(itens);
      ocNova.itens.forEach((i, k) => { if(itens[k] && itens[k].ipi) i.ipi = String(itens[k].ipi).replace('.', ','); });
      ocNova.fornecedor = I.forn ? I.forn.nome : (n.emit_nome || '');
      ocNova.data = n.emissao ? String(n.emissao).slice(0, 10) : getToday();
      ocNova.nforn = 'NF ' + Number(String(I.chave).slice(25, 34));
      if(n.loja && n.loja !== ocNova.loja){ ocNova.loja = n.loja; if(typeof ocProximoNumero === 'function') ocNova.numero = ocProximoNumero(n.loja); }   // número com o prefixo da loja da nota
      ocNova.nfe = I.chave;
      // duplicatas da nota viram as parcelas só quando o valor da nota é o real (fator 1); com fator, gere pela condição
      if(I.fator === 1 && (n.duplicatas || []).length) ocNova.parcelas = n.duplicatas.map(d => ({ data: d.vencimento, val: Number(d.valor) || 0 }));
      const difTot = I.linhas.reduce((s, l) => s + l.vun * (1 + (l.ipi || 0) / 100) * l.qtd * nfeDifalPct(l) / 100, 0);
      ocNova.obs = 'Importada da nota fiscal nº ' + Number(String(I.chave).slice(25, 34)) + ' (' + (n.emit_nome || '') + ').' + (difTot > 0 ? ' DIFAL calculado (' + I.ufOrig + ' → ' + I.ufDest + '): ' + fmt(difTot) + ', fora do total da ordem.' : '');
      ocCriarDesenhar();
    }
