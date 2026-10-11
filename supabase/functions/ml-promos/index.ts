// ml-promos — Central de promoções do Mercado Livre (LEITURA).
//
//   { acao: 'lista', conta }                                   promoções da conta (campanhas, ofertas, cupons de campanha)
//   { acao: 'itens', conta, id, tipo, situacao?, depois? }     anúncios de uma promoção (50 por chamada; "depois" continua a lista)
//
// Participar/sair de promoção (gravação no ML) fica para uma próxima etapa: entra aqui como novas ações.
// O token do ML nunca sai do servidor.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const ML = 'https://api.mercadolibre.com'

async function token(supaUrl: string, dbH: Record<string, string>, userId: string, conta: string, clientId: string, secret: string) {
  const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&select=access_token,refresh_token,expires_at`, { headers: dbH }).then(r => r.json()).catch(() => [])
  const t = Array.isArray(rows) ? rows[0] : null
  if (!t) return null
  if (new Date(t.expires_at) > new Date(Date.now() + 60000)) return t.access_token as string
  const ref = await fetch(ML + '/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: t.refresh_token })
  }).then(r => r.json()).catch(() => null)
  if (!ref?.access_token) return null
  await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}`, {
    method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + ref.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
  })
  return ref.access_token as string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!, secret = Deno.env.get('ML_CLIENT_SECRET')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    const body = await req.json().catch(() => ({}))
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()

    const conta = String(body?.conta || '').replace(/\D/g, '')
    if (!conta) return resp({ error: 'Escolha uma loja.' }, 400)
    const tk = await token(supaUrl, dbH, userId, conta, clientId, secret)
    if (!tk) return resp({ error: 'A conta do Mercado Livre está desconectada. Reconecte em Configurações.' }, 400)
    const g = async (url: string) => { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } }).catch(() => null); if (!r) return { erro: 'sem resposta' }; const j = await r.json().catch(() => null); return r.ok ? j : { erro: (j && (j.message || j.error)) || ('http ' + r.status) } }

    if (body?.acao === 'itens') {
      const id = String(body?.id || ''), tipo = String(body?.tipo || '')
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !/^[A-Z_]{1,40}$/.test(tipo)) return resp({ error: 'Promoção inválida.' }, 400)
      const p = new URLSearchParams({ promotion_type: tipo, app_version: 'v2', limit: '50' })
      if (['candidate', 'pending', 'started'].includes(String(body?.situacao))) p.set('status', String(body.situacao))
      if (body?.depois) p.set('search_after', String(body.depois))
      const j: any = await g(`${ML}/seller-promotions/promotions/${id}/items?${p}`)
      if (!j || j.erro) return resp({ ok: false, motivo: (j && j.erro) || 'sem resposta' })
      const itens = (j.results || []).map((x: any) => ({
        item: x.id, situacao: x.status || '', original: Number(x.original_price) || 0,
        preco: Number(x.price) || Number(x.suggested_discounted_price) || Number(x.max_discounted_price) || 0,
        sugerido: Number(x.suggested_discounted_price) || 0, minimo: Number(x.min_discounted_price) || 0, maximo: Number(x.max_discounted_price) || 0,
        ml_pct: Number(x.meli_percentage) || 0, vendedor_pct: Number(x.seller_percentage) || 0, inicio: x.start_date || '', fim: x.end_date || '', oferta: x.offer_id || '',
      }))
      return resp({ ok: true, itens, total: Number(j.paging?.total) || itens.length, depois: j.paging?.searchAfter || null })
    }

    const j: any = await g(`${ML}/seller-promotions/users/${conta}?app_version=v2`)
    if (!j || j.erro) return resp({ ok: false, motivo: (j && j.erro) || 'sem resposta' })
    const promos = (j.results || []).map((x: any) => ({ id: x.id, tipo: x.type, situacao: x.status || '', nome: x.name || '', inicio: x.start_date || '', fim: x.finish_date || '', prazo: x.deadline_date || '', beneficio: x.benefits?.type || '', ml_pct: Number(x.benefits?.meli_percent) || 0, vendedor_pct: Number(x.benefits?.seller_percent) || 0 }))
    return resp({ ok: true, promos })
  } catch (err) {
    console.error('ml-promos error:', err)
    return resp({ error: String(err) }, 500)
  }
})
