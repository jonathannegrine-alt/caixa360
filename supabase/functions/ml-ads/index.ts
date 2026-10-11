// ml-ads — anúncios pagos (Product Ads) do Mercado Livre, por anúncio, de todas as contas do usuário.
// Body: { de: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', conta? } com o JWT do usuário.
//   1) anunciante da conta        GET /advertising/advertisers?product_id=PADS                       (api-version: 1)
//   2) métricas por anúncio       GET /advertising/MLB/advertisers/{id}/product_ads/ads/search        (api-version: 2)
// Devolve, por anúncio: cliques, impressões, investimento, vendas por publicidade (diretas + indiretas) e unidades.
// ACOS = investimento ÷ vendas por publicidade. O TACOS (investimento ÷ venda total do anúncio) é calculado na tela,
// com as vendas que o Caixa 360 já tem. O período máximo aceito pelo Mercado Livre é de 90 dias.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const METRICAS = 'clicks,prints,cost,cpc,acos,units_quantity,direct_amount,indirect_amount,total_amount,direct_units_quantity,indirect_units_quantity,organic_units_quantity,organic_units_amount'

async function get(url: string, token: string, versao: string) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'api-version': versao }, signal: AbortSignal.timeout(25000) })
    const j = await r.json().catch(() => null)
    return { status: r.status, json: j }
  } catch { return { status: 0, json: null } }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: req.headers.get('Authorization') || '' } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()
    const body = await req.json().catch(() => ({}))
    const data = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''
    const de = data(body?.de), ate = data(body?.ate)
    if (!de || !ate || de > ate) return resp({ error: 'Período inválido.' })
    if ((Date.parse(ate) - Date.parse(de)) / 86400000 > 90) return resp({ error: 'O Mercado Livre entrega no máximo 90 dias de anúncios pagos por consulta.' })
    const contaPedida = /^\d+$/.test(String(body?.conta ?? '')) ? String(body.conta) : ''

    const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}${contaPedida ? '&ml_user_id=eq.' + contaPedida : ''}&select=access_token,refresh_token,expires_at,ml_user_id,apelido`, { headers: dbH }).then(r => r.json()).catch(() => [])
    if (!Array.isArray(rows) || !rows.length) return resp({ error: 'Conta do Mercado Livre não conectada.' })

    const anuncios: any[] = [], contas: any[] = []
    for (const t of rows) {
      let token = t.access_token
      if (new Date(t.expires_at) <= new Date(Date.now() + 60000)) {
        const novo = await fetch('https://api.mercadolibre.com/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ML_CLIENT_ID')!, client_secret: Deno.env.get('ML_CLIENT_SECRET')!, refresh_token: t.refresh_token })
        }).then(r => r.json()).catch(() => ({}))
        if (!novo?.access_token) { contas.push({ conta: String(t.ml_user_id), apelido: t.apelido || null, erro: 'conexão expirada: reconecte a conta' }); continue }
        token = novo.access_token
        await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}`, {
          method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ access_token: novo.access_token, refresh_token: novo.refresh_token, expires_at: new Date(Date.now() + (Number(novo.expires_in) || 21600) * 1000).toISOString(), updated_at: new Date().toISOString() })
        })
      }
      const conta = String(t.ml_user_id)
      const a = await get('https://api.mercadolibre.com/advertising/advertisers?product_id=PADS', token, '1')
      const adv = a.json?.advertisers?.[0]?.advertiser_id
      if (!adv) { contas.push({ conta, apelido: t.apelido || null, erro: a.status === 403 ? 'sem permissão de publicidade no aplicativo' : a.status === 404 ? 'a conta não usa anúncios pagos' : 'não consegui ler o anunciante (http ' + a.status + ')' }); continue }
      const site = a.json.advertisers[0].site_id || 'MLB'
      let n = 0, erro = ''
      for (let offset = 0; offset < 3000; offset += 50) {
        const r = await get(`https://api.mercadolibre.com/advertising/${site}/advertisers/${adv}/product_ads/ads/search?limit=50&offset=${offset}&date_from=${de}&date_to=${ate}&metrics=${METRICAS}`, token, '2')
        if (r.status !== 200 || !Array.isArray(r.json?.results)) { if (offset === 0) erro = 'o Mercado Livre não devolveu os anúncios (http ' + r.status + ')'; break }
        for (const x of r.json.results) {
          const m = x.metrics || {}
          anuncios.push({
            conta, item_id: x.item_id, titulo: x.title || '', status: x.status || '', campanha: x.campaign_id || null,
            foto: x.thumbnail ? String(x.thumbnail).replace('http://', 'https://') : null,
            cliques: Number(m.clicks) || 0, impressoes: Number(m.prints) || 0, investimento: Number(m.cost) || 0,
            vendas_ads: Number(m.total_amount) || 0, diretas: Number(m.direct_amount) || 0, indiretas: Number(m.indirect_amount) || 0,
            un_ads: Number(m.units_quantity) || 0, un_organicas: Number(m.organic_units_quantity) || 0, organicas: Number(m.organic_units_amount) || 0,
          })
          n++
        }
        if (r.json.results.length < 50) break
      }
      contas.push({ conta, apelido: t.apelido || null, anuncios: n, erro: erro || null })
    }
    return resp({ ok: true, de, ate, anuncios, contas })
  } catch (err) {
    console.error('ml-ads error:', err)
    return resp({ error: String(err) }, 500)
  }
})
