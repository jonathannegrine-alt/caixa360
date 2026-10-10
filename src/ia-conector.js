// ===== CONECTOR DE IA =====
// Gera o endereço pessoal que o usuário cola no Claude (ou outra IA compatível com MCP) para que ela
// consulte os dados do Caixa 360. Somente leitura. A chave aparece uma única vez; no banco fica só o hash.
// Servidor: Edge Function "mcp" + função SQL ia_consulta.

    let iaChaves = [];

    function iaEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    function iaBase(){ return (supa && supa.supabaseUrl) || 'https://qasrccmtrllotukyeiax.supabase.co'; }

    async function iaSha256(t){
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
      return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    function iaNovaChave(){
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const r = crypto.getRandomValues(new Uint8Array(40));
      return 'c360_' + [...r].map(x => abc[x % abc.length]).join('');
    }

    // Bloco "IA" da página Configurações (criado por código; entra na aba IA)
    async function iaRenderCard(){
      const view = document.getElementById('view-config');
      if(!view) return;
      let card = document.getElementById('cfg-ia-card');
      if(!card){
        card = document.createElement('div');
        card.id = 'cfg-ia-card'; card.className = 'card'; card.dataset.cfgAba = 'ia';
        view.appendChild(card);
      }
      if(usuarioAtual){
        const { data } = await supa.from('ia_chaves').select('id,rotulo,criada_em,ultimo_uso').eq('usuario_id', usuarioAtual.id).order('criada_em', {ascending:false});
        iaChaves = data || [];
      }
      const dt = t => t ? new Date(t).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
      card.innerHTML = `
        <div class="card-header"><div class="card-title">Conectar sua IA ao Caixa 360</div></div>
        <div class="card-body" style="line-height:1.6;">
          <div>Ligue o seu Claude (ou outra IA compatível) aos dados do Caixa 360 para conversar, pedir análises e montar relatórios com os seus números. A IA <b>só consulta</b>: não altera nada no sistema, e usa o plano que você já tem.</div>
          <div style="margin:14px 0;"><button class="btn" onclick="iaGerar()">Gerar endereço de conexão</button></div>
          ${iaChaves.length ? `<table><thead><tr><th>Conexão</th><th>Criada em</th><th>Último uso</th><th></th></tr></thead><tbody>
            ${iaChaves.map(c => `<tr><td>${iaEsc(c.rotulo || 'Conexão')}</td><td>${dt(c.criada_em)}</td><td>${dt(c.ultimo_uso)}</td><td style="text-align:right;"><button class="btn-out btn btn-sm" onclick="iaRevogar('${c.id}')">Revogar</button></td></tr>`).join('')}
          </tbody></table>` : '<div class="text-muted">Nenhuma conexão criada ainda.</div>'}
          <div class="text-muted" style="font-size:12px;margin-top:14px;">O endereço funciona como uma senha: quem tiver ele consegue ler seus dados. Não compartilhe; se vazar, clique em Revogar e gere outro.</div>
        </div>`;
    }

    async function iaGerar(){
      if(!usuarioAtual) return;
      const rotulo = 'Conexão de ' + new Date().toLocaleDateString('pt-BR');
      const chave = iaNovaChave();
      const hash = await iaSha256(chave);
      const { error } = await supa.from('ia_chaves').insert({ usuario_id: usuarioAtual.id, hash, rotulo });
      if(error){ vmlModal('Conectar sua IA', `<div class="alert alert-danger">Não foi possível gerar o endereço: ${iaEsc(error.message)}</div>`); return; }
      const endereco = `${iaBase()}/functions/v1/mcp?k=${chave}`;
      vmlModal('Endereço de conexão criado', `
        <div class="alert alert-warning">Copie agora: por segurança o endereço <b>&nbsp;não será mostrado de novo</b>.</div>
        <div class="d-flex" style="gap:8px;"><input type="text" id="ia-endereco" readonly value="${iaEsc(endereco)}" style="font-family:monospace;font-size:12px;"><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('ia-endereco').value);this.textContent='Copiado ✓';">Copiar</button></div>
        <div style="margin-top:16px;line-height:1.7;">
          <b>No Claude</b> (site ou aplicativo):
          <ol style="margin:6px 0 0 18px;">
            <li>Abra <b>Configurações → Conectores</b> e escolha <b>Adicionar conector personalizado</b>.</li>
            <li>Dê o nome <b>Caixa 360</b> e cole o endereço acima.</li>
            <li>Em uma conversa, ative o conector e peça, por exemplo: <i>"Use o Caixa 360 e me mostre a margem por SKU dos últimos 30 dias"</i>.</li>
          </ol>
          <div class="text-muted" style="margin-top:10px;">Outras IAs que aceitam conectores no padrão MCP por endereço (URL) funcionam do mesmo jeito.</div>
        </div>`);
      iaRenderCard();
    }

    async function iaRevogar(id){
      if(!confirm('Revogar esta conexão? A IA que usa este endereço deixa de acessar seus dados.')) return;
      await supa.from('ia_chaves').delete().eq('id', id);
      await iaRenderCard();
      if(typeof cfgMontarAbas === 'function') cfgMontarAbas();
    }
