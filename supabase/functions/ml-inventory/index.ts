const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const resp = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { headers: CORS, status })

async function getTokenML(supaUrl: string, supaKey: string, userId: string, clientId: string, secret: string) {
  const rows = await fetch(
    `${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=access_token,refresh_token,expires_at,ml_user_id`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' } }
  ).then(r => r.json())

  const token = Array.isArray(rows) ? rows[0] : null
  if (!token) return null

  if (new Date(token.expires_at) <= new Date()) {
    const ref = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: token.refresh_token })
    }).then(r => r.json())
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

// Busca estoque Full via Inventory API do ML
// Tenta a abordagem por inventários (mais completa para Full)
async function fetchEstoqueFullML(mlUserId: string, accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` }

  // 1. Buscar inventários do usuário
  const invRes = await fetch(`https://api.mercadolibre.com/users/${mlUserId}/inventories`, { headers })
  const invJson = await invRes.json()

  if (invJson.error) {
    // Fallback: buscar via items search com fulfillment
    return await fetchEstoqueFullViaItems(mlUserId, accessToken, headers)
  }

  const inventories: any[] = invJson.inventories || invJson || []
  if (!Array.isArray(inventories) || inventories.length === 0) {
    return await fetchEstoqueFullViaItems(mlUserId, accessToken, headers)
  }

  const itens: any[] = []
  for (const inv of inventories) {
    if (!inv.id) continue
    let offset = 0
    while (true) {
      const detRes = await fetch(
        `https://api.mercadolibre.com/inventories/${inv.id}/stock/details?limit=100&offset=${offset}`,
        { headers }
      )
      const det = await detRes.json()
      if (det.error || !det.results?.length) break
      for (const item of det.results) {
        itens.push({
          sku: item.seller_sku || item.sku || '',
          titulo: item.name || item.title || '',
          aptos_venda: item.available_quantity ?? item.quantities?.available ?? 0,
          em_transito: item.unfulfillable_quantity ?? item.quantities?.in_transit ?? 0,
          pendente: item.quantities?.pending ?? item.reserved_quantity ?? 0,
        })
      }
      offset += 100
      if (offset >= (det.paging?.total ?? 0)) break
    }
  }

  if (itens.length > 0) return itens
  return await fetchEstoqueFullViaItems(mlUserId, accessToken, headers)
}

// Fallback: itens com fulfillment via search
async function fetchEstoqueFullViaItems(mlUserId: string, accessToken: string, headers: Record<string, string>) {
  const itens: any[] = []
  let offset = 0

  while (true) {
    const r = await fetch(
      `https://api.mercadolibre.com/users/${mlUserId}/items/search?listing_type_id=GOLD_PRO&status=active&limit=100&offset=${offset}`,
      { headers }
    )
    const json = await r.json()
    if (json.error || !json.results?.length) break

    // Para cada item, buscar detalhes de estoque
    const ids: string[] = json.results
    const chunkSize = 20
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize).join(',')
      const detR = await fetch(
        `https://api.mercadolibre.com/items?ids=${chunk}&attributes=id,title,seller_sku,available_quantity`,
        { headers }
      )
      const detJson = await detR.json()
      if (Array.isArray(detJson)) {
        for (const { body } of detJson) {
          if (!body) continue
          itens.push({
            sku: body.seller_sku || body.id || '',
            titulo: body.title || '',
            aptos_venda: body.available_quantity ?? 0,
            em_transito: 0,
            pendente: 0,
          })
        }
      }
    }

    offset += 100
    if (offset >= (json.paging?.total ?? 0)) break
  }

  return itens
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const clientId = Deno.env.get('ML_CLIENT_ID') ?? ''
    const secret = Deno.env.get('ML_CLIENT_SECRET') ?? ''

    // Verificar autorização
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return resp({ error: 'Unauthorized' }, 401)

    // Extrair usuario_id do body
    const body = await req.json().catch(() => ({}))
    const usuarioId = body.usuario_id as string
    if (!usuarioId) return resp({ error: 'usuario_id obrigatorio' }, 400)

    const token = await getTokenML(supaUrl, supaKey, usuarioId, clientId, secret)
    if (!token) return resp({ error: 'Token ML não encontrado — conecte sua conta ML nas configurações.' }, 404)

    const mlUserId = token.ml_user_id || '1980904340'
    const itens = await fetchEstoqueFullML(mlUserId, token.access_token)

    return resp({ ok: true, itens, total: itens.length })
  } catch (err) {
    console.error('ml-inventory error:', err)
    return resp({ error: String(err) }, 500)
  }
})
