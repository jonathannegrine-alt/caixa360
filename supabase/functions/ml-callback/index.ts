const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const resp = (body: object) => new Response(JSON.stringify(body), { headers: CORS })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => null)
    if (!body?.user_id) return resp({ error: 'Parâmetro user_id obrigatório' })

    const { user_id, code } = body
    const clientId  = Deno.env.get('ML_CLIENT_ID')
    const secret    = Deno.env.get('ML_CLIENT_SECRET')
    const supaUrl   = Deno.env.get('SUPABASE_URL')
    const supaKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!clientId || !secret) return resp({ error: 'Secrets ML não configurados' })
    if (!supaUrl  || !supaKey) return resp({ error: 'Secrets Supabase não configurados' })

    const headers = {
      'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`,
      'Content-Type': 'application/json', 'Accept': 'application/json'
    }

    if (!code) return resp({ error: 'Parâmetro code obrigatório' })

    // Trocar code por tokens ML
    const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, client_secret: secret,
        code, redirect_uri: 'https://jonathannegrine-alt.github.io/caixa360/'
      })
    })
    const tokens = await tokenRes.json()
    if (tokens.error) return resp({ error: tokens.error, detail: tokens.message })

    const newMlUserId = String(tokens.user_id)

    // Apelido da conta no ML (para o seletor de contas do app)
    let apelido: string | null = null
    try {
      const me = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then(r => r.json())
      apelido = me?.nickname || null
    } catch (_) {}

    // Um usuário pode ter várias contas ML: grava/atualiza a linha desta conta (usuario_id + ml_user_id)
    const tokenData = {
      usuario_id:    user_id,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ml_user_id:    newMlUserId,
      apelido,
      updated_at:    new Date().toISOString()
    }
    const existentes = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${user_id}&select=ml_user_id`, { headers })
      .then(r => r.json()).catch(() => [])
    const jaTinha = Array.isArray(existentes) && existentes.some((e: any) => String(e.ml_user_id) === newMlUserId)
    const grava = await fetch(`${supaUrl}/rest/v1/ml_tokens?on_conflict=usuario_id,ml_user_id`, {
      method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(tokenData)
    })
    if (!grava.ok) return resp({ error: 'Erro ao salvar a conta', detail: (await grava.text()).slice(0, 200) })

    return resp({ success: true, ml_user_id: tokens.user_id, apelido, nova_conta: !jaTinha, total_contas: (Array.isArray(existentes) ? existentes.length : 0) + (jaTinha ? 0 : 1) })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
