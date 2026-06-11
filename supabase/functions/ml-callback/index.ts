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

    // Se já tem conta conectada com ID diferente → ignorar silenciosamente
    const existing = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${user_id}&select=ml_user_id`, { headers })
      .then(r => r.json()).then(d => d[0])

    if (existing?.ml_user_id && existing.ml_user_id !== newMlUserId) {
      return resp({ ignored: true, kept_ml_user_id: existing.ml_user_id })
    }

    // Sem conflito: salva os tokens
    const tokenData = {
      usuario_id:    user_id,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ml_user_id:    newMlUserId,
      updated_at:    new Date().toISOString()
    }

    if (existing) {
      await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${user_id}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(tokenData)
      })
    } else {
      await fetch(`${supaUrl}/rest/v1/ml_tokens`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(tokenData)
      })
    }

    return resp({ success: true, ml_user_id: tokens.user_id })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
