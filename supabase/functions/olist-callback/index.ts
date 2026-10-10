// olist-callback — endereço de retorno do aplicativo do Olist (API v3, OAuth).
// O Olist manda o usuário de volta para cá com ?code=...&state=...  O "state" foi gravado pelo Caixa 360 em
// olist_config.oauth_state logo antes de abrir a tela de autorização; por ele achamos de quem é o pedido,
// trocamos o código pelos tokens (com o Client ID/Secret daquele usuário) e voltamos para o Caixa 360.
// Deploy: --no-verify-jwt (quem chama é o navegador vindo do Olist, sem sessão do Supabase).

const APP = 'https://jonathannegrine-alt.github.io/caixa360/'
const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'
const voltar = (q: string) => new Response(null, { status: 302, headers: { Location: APP + '?olist=' + q } })

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code') || '', state = url.searchParams.get('state') || ''
    if (!code || !/^[A-Za-z0-9]{20,80}$/.test(state)) return voltar('erro')
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
    const linhas = await fetch(`${supaUrl}/rest/v1/olist_config?oauth_state=eq.${state}&select=usuario_id,client_id,client_secret&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const cfg = Array.isArray(linhas) ? linhas[0] : null
    if (!cfg?.client_id || !cfg?.client_secret) return voltar('erro')

    const r = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: `${supaUrl}/functions/v1/olist-callback`, code })
    })
    const j = await r.json().catch(() => null)
    const grava = (campos: Record<string, unknown>) => fetch(`${supaUrl}/rest/v1/olist_config?usuario_id=eq.${cfg.usuario_id}`, { method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify(campos) })
    if (!r.ok || !j?.access_token) {
      await grava({ oauth_state: null, v3_erro: 'O Olist recusou a autorização: ' + String(j?.error_description || j?.error || 'http ' + r.status).slice(0, 200) })
      return voltar('recusado')
    }
    await grava({
      access_token: j.access_token, refresh_token: j.refresh_token || null,
      expira_em: new Date(Date.now() + (Number(j.expires_in) || 14400) * 1000).toISOString(),
      v3_em: new Date().toISOString(), v3_erro: null, oauth_state: null,
    })
    return voltar('ok')
  } catch (e) {
    console.error('olist-callback error:', e)
    return voltar('erro')
  }
})
