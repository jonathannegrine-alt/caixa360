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
    if (!body?.code || !body?.user_id) {
      return resp({ error: 'Parâmetros inválidos: code e user_id obrigatórios' })
    }

    const { code, user_id } = body
    const clientId     = Deno.env.get('ML_CLIENT_ID')
    const clientSecret = Deno.env.get('ML_CLIENT_SECRET')
    const supaUrl      = Deno.env.get('SUPABASE_URL')
    const supaKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!clientId || !clientSecret) return resp({ error: 'Secrets ML não configurados' })
    if (!supaUrl  || !supaKey)      return resp({ error: 'Secrets Supabase não configurados' })

    // 1. Trocar code por tokens ML
    const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  'https://jonathannegrine-alt.github.io/caixa360/'
      })
    })
    const tokens = await tokenRes.json()
    if (tokens.error) return resp({ error: tokens.error, detail: tokens.message })

    const tokenData = {
      usuario_id:    user_id,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ml_user_id:    String(tokens.user_id),
      updated_at:    new Date().toISOString()
    }

    const headers = {
      'apikey':        supaKey,
      'Authorization': `Bearer ${supaKey}`,
      'Content-Type':  'application/json',
    }

    // 2a. Verificar se já existe linha para este usuário
    const checkRes = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${user_id}&select=usuario_id`, {
      headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Accept': 'application/json' }
    })
    if (!checkRes.ok) {
      const errBody = await checkRes.text()
      return resp({ error: 'Erro ao verificar token existente', detail: errBody })
    }
    const checkData = await checkRes.json()
    const rowExists = Array.isArray(checkData) && checkData.length > 0

    if (rowExists) {
      // 2b. Atualizar linha existente
      const patchRes = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${user_id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify(tokenData)
      })
      if (!patchRes.ok) {
        const errBody = await patchRes.text()
        return resp({ error: 'Erro no UPDATE', detail: errBody, status: patchRes.status })
      }
    } else {
      // 2c. Inserir nova linha
      const postRes = await fetch(`${supaUrl}/rest/v1/ml_tokens`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify(tokenData)
      })
      if (!postRes.ok) {
        const errBody = await postRes.text()
        return resp({ error: 'Erro no INSERT', detail: errBody, status: postRes.status })
      }
    }

    return resp({ success: true, ml_user_id: tokens.user_id })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
