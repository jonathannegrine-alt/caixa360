const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const resp = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { headers: CORS, status })

async function safeJson(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { throw new Error(`HTTP ${res.status} — ${text.substring(0, 200)}`) }
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

// Busca todos os IDs de itens ativos do vendedor (paginado)
async function fetchTodosItemIds(mlUserId: string, headers: Record<string, string>): Promise<string[]> {
  const todos: string[] = []
  let offset = 0
  while (true) {
    const r = await fetch(
      `https://api.mercadolibre.com/users/${mlUserId}/items/search?status=active&limit=100&offset=${offset}`,
      { headers }
    )
    const json = await safeJson(r).catch(() => null)
    if (!json || json.error || !json.results?.length) break
    todos.push(...json.results)
    offset += 100
    if (offset >= (json.paging?.total ?? 0)) break
  }
  return todos
}

// Busca detalhes em chunks e filtra apenas os que são Full (logistic_type=fulfillment)
async function fetchDetalhesFullML(itemIds: string[], headers: Record<string, string>) {
  const itens: any[] = []
  const chunkSize = 20

  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize).join(',')
    const r = await fetch(
      `https://api.mercadolibre.com/items?ids=${chunk}&attributes=id,title,seller_sku,available_quantity,shipping,inventory_id`,
      { headers }
    )
    const json = await safeJson(r).catch(() => [])
    if (!Array.isArray(json)) continue

    for (const entry of json) {
      const item = entry.body || entry
      if (!item || item.error) continue
      const logisticType = item.shipping?.logistic_type || ''
      if (logisticType !== 'fulfillment') continue  // ignora itens sem Full

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
  return itens
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

    // Valida JWT (mesmo padrão ml-snapshot)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authHeader }
    })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()

    const token = await getTokenML(supaUrl, supaKey, userId, clientId, secret)
    if (!token) return resp({ error: 'Conta ML não conectada — conecte em Configurações → Mercado Livre.' }, 404)

    const mlUserId = String(token.ml_user_id || '1980904340')
    const mlHeaders = { Authorization: `Bearer ${token.access_token}` }

    // 1. Busca todos os IDs de itens ativos
    const itemIds = await fetchTodosItemIds(mlUserId, mlHeaders)

    // 2. Filtra apenas Full (logistic_type=fulfillment) e monta resultado
    const itens = itemIds.length > 0
      ? await fetchDetalhesFullML(itemIds, mlHeaders)
      : []

    return resp({ ok: true, itens, total: itens.length })
  } catch (err) {
    console.error('ml-inventory error:', err)
    return resp({ error: String(err) }, 500)
  }
})
