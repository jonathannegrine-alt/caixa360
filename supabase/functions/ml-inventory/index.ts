const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const resp = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { headers: CORS, status })

async function safeJson(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { error: true, status: res.status } }
}

async function getTokenML(supaUrl: string, supaKey: string, userId: string, clientId: string, secret: string) {
  const rows = await safeJson(await fetch(
    `${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=access_token,refresh_token,expires_at,ml_user_id`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' } }
  ))
  const token = Array.isArray(rows) ? rows[0] : null
  if (!token) return null

  if (new Date(token.expires_at) <= new Date()) {
    const ref = await safeJson(await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: token.refresh_token })
    }))
    if (ref.error) return null
    token.access_token = ref.access_token
    await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + ref.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
    })
  }
  return token
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl  = Deno.env.get('SUPABASE_URL')!
    const supaKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey  = Deno.env.get('SUPABASE_ANON_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!
    const secret   = Deno.env.get('ML_CLIENT_SECRET')!

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)

    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authHeader }
    })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()

    const token = await getTokenML(supaUrl, supaKey, userId, clientId, secret)
    if (!token) return resp({ error: 'Conta ML não conectada — conecte em Configurações → Mercado Livre.' }, 404)

    const mlUserId = String(token.ml_user_id || '1980904340')
    const mlHeaders = { Authorization: `Bearer ${token.access_token}` }

    // 1. Busca primeira página de IDs (até 200 itens) — rápido
    const searchRes = await fetch(
      `https://api.mercadolibre.com/users/${mlUserId}/items/search?status=active&limit=200&offset=0`,
      { headers: mlHeaders }
    )
    const searchJson = await safeJson(searchRes)
    if (searchJson.error || !searchJson.results) {
      return resp({ error: `ML API retornou ${searchJson.status || searchRes.status} — verifique permissões da aplicação.` }, 502)
    }

    const itemIds: string[] = searchJson.results || []
    const total_itens = searchJson.paging?.total ?? itemIds.length

    if (itemIds.length === 0) {
      return resp({ ok: true, itens: [], total: 0, total_itens_ativos: 0 })
    }

    // 2. Busca detalhes em paralelo (chunks de 20, máx 200 itens)
    const chunks: string[][] = []
    for (let i = 0; i < itemIds.length; i += 20) chunks.push(itemIds.slice(i, i + 20))

    const results = await Promise.all(chunks.map(async chunk => {
      const ids = chunk.join(',')
      const r = await fetch(
        `https://api.mercadolibre.com/items?ids=${ids}&attributes=id,title,seller_sku,available_quantity,shipping`,
        { headers: mlHeaders }
      )
      const json = await safeJson(r)
      return Array.isArray(json) ? json : []
    }))

    const itens: any[] = []
    for (const chunk of results) {
      for (const entry of chunk) {
        const item = entry.body || entry
        if (!item || item.error) continue
        if ((item.shipping?.logistic_type || '') !== 'fulfillment') continue
        itens.push({
          sku: item.seller_sku || item.id || '',
          titulo: item.title || '',
          aptos_venda: item.available_quantity ?? 0,
          em_transito: 0,
          pendente: 0,
          item_id: item.id,
        })
      }
    }

    return resp({ ok: true, itens, total: itens.length, total_itens_ativos: total_itens })
  } catch (err) {
    console.error('ml-inventory error:', err)
    return resp({ error: String(err) }, 500)
  }
})
