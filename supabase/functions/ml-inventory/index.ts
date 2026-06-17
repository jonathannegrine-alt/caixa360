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

// Busca todos os itens Full via /sites/MLB/search (endpoint público, não precisa de produto aprovado)
// Retorna { id, titulo, aptos_venda }[]
async function buscarItensPorBuscaPublica(mlUserId: string, mlHeaders: Record<string, string>) {
  const itens: Array<{ id: string; titulo: string; aptos_venda: number }> = []
  const limit = 50
  let offset = 0
  let total = -1

  while (total === -1 || offset < total) {
    const res = await fetch(
      `https://api.mercadolibre.com/sites/MLB/search?seller_id=${mlUserId}&fulfillment_type=fulfillment&status=active&limit=${limit}&offset=${offset}`,
      { headers: mlHeaders }
    )
    const json = await safeJson(res)
    if (json.error || !Array.isArray(json.results)) break

    if (total === -1) total = json.paging?.total ?? json.results.length

    for (const item of json.results) {
      itens.push({
        id: item.id,
        titulo: item.title || '',
        aptos_venda: item.available_quantity ?? 0,
      })
    }

    offset += json.results.length
    if (json.results.length < limit) break
  }

  return itens
}

// Busca seller_sku em lotes via /items?ids=...&attributes=id,seller_sku
// Requer apenas escopo read (sem aprovação de produto "items")
async function buscarSellerSkus(ids: string[], mlHeaders: Record<string, string>): Promise<Record<string, string>> {
  const skuMap: Record<string, string> = {}
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20))

  await Promise.all(chunks.map(async chunk => {
    const r = await fetch(
      `https://api.mercadolibre.com/items?ids=${chunk.join(',')}&attributes=id,seller_sku`,
      { headers: mlHeaders }
    )
    const json = await safeJson(r)
    if (!Array.isArray(json)) return
    for (const entry of json) {
      const item = entry.body || entry
      if (item?.id) skuMap[item.id] = item.seller_sku || ''
    }
  }))

  return skuMap
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

    // Tentativa 1: stock-locations (requer produto aprovado, pode funcionar)
    const slRes = await fetch(
      `https://api.mercadolibre.com/users/${mlUserId}/stock_locations`,
      { headers: mlHeaders }
    )
    const slJson = await safeJson(slRes)
    if (!slJson.error && slRes.status !== 403) {
      const locations: any[] = Array.isArray(slJson) ? slJson : (slJson.locations || slJson.results || [])
      const itens = locations.map((loc: any) => ({
        sku: loc.seller_sku || loc.sku || loc.id || '',
        titulo: loc.name || loc.title || loc.description || '',
        aptos_venda: loc.available_quantity ?? loc.quantity ?? loc.total ?? 0,
        em_transito: loc.in_transit ?? loc.reserved ?? 0,
        pendente: loc.pending ?? 0,
      }))
      return resp({ ok: true, itens, total: itens.length, fonte: 'stock-locations' })
    }

    // Tentativa 2: busca pública por vendedor (não requer produto aprovado)
    // GET /sites/MLB/search?seller_id=X&fulfillment_type=fulfillment retorna available_quantity
    // GET /items?ids=...&attributes=id,seller_sku retorna seller_sku (só precisa de escopo read)
    const itensBusca = await buscarItensPorBuscaPublica(mlUserId, mlHeaders)

    if (itensBusca.length > 0) {
      const ids = itensBusca.map(i => i.id)
      const skuMap = await buscarSellerSkus(ids, mlHeaders)
      const itens = itensBusca.map(item => ({
        sku: skuMap[item.id] || item.id,
        titulo: item.titulo,
        aptos_venda: item.aptos_venda,
        em_transito: 0,
        pendente: 0,
      }))
      return resp({ ok: true, itens, total: itens.length, fonte: 'seller-search' })
    }

    // Tentativa 3: items/search (requer produto "items" aprovado)
    const searchRes = await fetch(
      `https://api.mercadolibre.com/users/${mlUserId}/items/search?status=active&limit=200&offset=0`,
      { headers: mlHeaders }
    )
    const searchJson = await safeJson(searchRes)
    if (searchJson.error || searchRes.status === 403 || !searchJson.results) {
      return resp({ error: 'Não foi possível buscar o estoque Full via API. Use o botão "Importar XLS" como alternativa.' }, 502)
    }

    const itemIds: string[] = searchJson.results || []
    if (itemIds.length === 0) return resp({ ok: true, itens: [], total: 0, fonte: 'items-search' })

    const chunks: string[][] = []
    for (let i = 0; i < itemIds.length; i += 20) chunks.push(itemIds.slice(i, i + 20))

    const results = await Promise.all(chunks.map(async chunk => {
      const r = await fetch(
        `https://api.mercadolibre.com/items?ids=${chunk.join(',')}&attributes=id,title,seller_sku,available_quantity,shipping`,
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
        itens.push({ sku: item.seller_sku || item.id || '', titulo: item.title || '', aptos_venda: item.available_quantity ?? 0, em_transito: 0, pendente: 0 })
      }
    }
    return resp({ ok: true, itens, total: itens.length, fonte: 'items-search' })

  } catch (err) {
    console.error('ml-inventory error:', err)
    return resp({ error: String(err) }, 500)
  }
})
