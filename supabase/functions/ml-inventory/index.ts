// ml-inventory — estoque do Full de TODAS as contas do Mercado Livre do usuário, pela API.
//
// Por conta:  1) anúncios com logística Full            GET /users/{id}/items/search?logistic_type=fulfillment
//             2) SKU e inventory_id de cada anúncio     GET /items?ids=...   (variações: GET /items/{id}?include_attributes=all)
//             3) estoque de cada inventory_id (1 vez)   GET /inventories/{inventory_id}/stock/fulfillment
// O mesmo inventory_id pode estar em vários anúncios: conta uma vez só.
// LIMITE DA API: unidades enviadas ao Full e ainda não recebidas ("entrada pendente") não aparecem aqui —
// o ML não expõe os envios (/inbounds responde 403). Para elas, só o relatório "Estoque Geral Full" em planilha.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })

async function safeJson(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { error: true, status: res.status } }
}
async function get(url: string, headers: Record<string, string>) {
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 15000)
    const r = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(t)
    return { status: r.status, json: await safeJson(r) }
  } catch { return { status: 0, json: { error: true } } }
}
// executa fn sobre a lista com no máximo n chamadas simultâneas
async function emLotes<T, R>(lista: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(lista.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) { const k = i++; out[k] = await fn(lista[k]) } }))
  return out
}

async function tokensML(supaUrl: string, supaKey: string, userId: string, clientId: string, secret: string) {
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' }
  const rows = await safeJson(await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=access_token,refresh_token,expires_at,ml_user_id,apelido&order=updated_at.asc`, { headers: dbH }))
  const lista = Array.isArray(rows) ? rows : []
  for (const token of lista) {
    if (new Date(token.expires_at) > new Date(Date.now() + 60000)) continue
    const ref = await safeJson(await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: token.refresh_token })
    }))
    if (ref.error || !ref.access_token) { token.invalido = true; continue }
    token.access_token = ref.access_token
    await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${token.ml_user_id}`, {
      method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + ref.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
    })
  }
  return lista
}

const skuDe = (o: any): string => {
  const a = Array.isArray(o?.attributes) ? o.attributes.find((x: any) => x?.id === 'SELLER_SKU') : null
  return String(a?.value_name || o?.seller_custom_field || o?.seller_sku || '').trim()
}

async function estoqueDaConta(mlUserId: string, apelido: string, h: Record<string, string>) {
  const avisos: string[] = []
  // 1) anúncios Full (ativos e pausados)
  const ids: string[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await get(`https://api.mercadolibre.com/users/${mlUserId}/items/search?logistic_type=fulfillment&limit=100&offset=${offset}`, h)
    const res = Array.isArray(r.json?.results) ? r.json.results : null
    if (!res) { if (offset === 0) avisos.push(`não consegui listar os anúncios (http ${r.status})`); break }
    ids.push(...res)
    if (res.length < 100) break
  }
  if (!ids.length) return { conta: mlUserId, apelido, itens: [], anuncios: 0, avisos }

  // 2) SKU + inventory_id (anúncio simples ou cada variação)
  const alvos = new Map<string, { sku: string; titulo: string }>()   // inventory_id -> dados
  const comVariacao: string[] = []
  const lotes: string[][] = []
  for (let i = 0; i < ids.length; i += 20) lotes.push(ids.slice(i, i + 20))
  await emLotes(lotes, 4, async lote => {
    const r = await get(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,title,inventory_id,attributes,seller_custom_field,variations`, h)
    if (!Array.isArray(r.json)) return
    for (const e of r.json) {
      const it = e?.body || e
      if (!it?.id) continue
      if (Array.isArray(it.variations) && it.variations.length) { comVariacao.push(it.id); continue }
      if (it.inventory_id && !alvos.has(it.inventory_id)) alvos.set(it.inventory_id, { sku: skuDe(it), titulo: it.title || '' })
    }
  })
  await emLotes(comVariacao, 4, async id => {
    const r = await get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, h)
    const it = r.json
    if (!it?.id) return
    for (const v of (it.variations || [])) {
      if (!v?.inventory_id || alvos.has(v.inventory_id)) continue
      const comb = (v.attribute_combinations || []).map((a: any) => a?.value_name).filter(Boolean).join(' / ')
      alvos.set(v.inventory_id, { sku: skuDe(v), titulo: (it.title || '') + (comb ? ' — ' + comb : '') })
    }
  })

  // 3) estoque de cada inventory_id
  let falhas = 0
  const linhas = await emLotes([...alvos.entries()], 8, async ([inv, d]) => {
    const r = await get(`https://api.mercadolibre.com/inventories/${inv}/stock/fulfillment`, h)
    const j = r.json
    if (r.status !== 200 || j?.error) { falhas++; return null }
    const det: any[] = Array.isArray(j.not_available_detail) ? j.not_available_detail : []
    const transf = det.filter(x => /transfer/i.test(String(x?.status))).reduce((s, x) => s + (Number(x?.quantity) || 0), 0)
    const disp = Number(j.available_quantity) || 0, naoDisp = Number(j.not_available_quantity) || 0
    return {
      sku: d.sku || inv, titulo: d.titulo, item_id: inv, _conta: mlUserId,
      aptos_venda: disp, em_transito: transf, nao_aptos: Math.max(0, naoDisp - transf), em_separacao: 0, pendente: 0,
      total_geral: Number(j.total) || disp + naoDisp,
      detalhe: det.map(x => `${x?.status}: ${x?.quantity}`).join(', ')
    }
  })
  if (falhas) avisos.push(`${falhas} produtos sem resposta do estoque`)
  const itens = linhas.filter(Boolean)
  const semSku = itens.filter((x: any) => x.sku === x.item_id).length
  if (semSku) avisos.push(`${semSku} anúncios sem SKU preenchido`)
  return { conta: mlUserId, apelido, itens, anuncios: ids.length, avisos }
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
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()

    const tokens = await tokensML(supaUrl, supaKey, userId, clientId, secret)
    if (!tokens.length) return resp({ error: 'Conta ML não conectada — conecte em Configurações → Mercado Livre.' }, 404)

    // diagnóstico: testa endereços candidatos da API para uma conta e devolve só o status e o começo da resposta
    const corpo = await req.json().catch(() => ({}))
    if (corpo?.diag) {
      const tk: any = tokens.find((x: any) => String(x.ml_user_id) === String(corpo.conta)) || tokens[0]
      const h = { Authorization: `Bearer ${tk.access_token}` }
      const out: any[] = []
      for (const caminho of (corpo.caminhos || []).slice(0, 30)) {
        const r = await get('https://api.mercadolibre.com' + String(caminho).replace('{u}', String(tk.ml_user_id)), h)
        out.push({ caminho, status: r.status, corpo: JSON.stringify(r.json).slice(0, Number(corpo.tam) || 300) })
      }
      return resp({ ok: true, conta: tk.ml_user_id, out })
    }

    const contas = await Promise.all(tokens.map((t: any) => t.invalido
      ? Promise.resolve({ conta: String(t.ml_user_id), apelido: t.apelido || '', itens: [], anuncios: 0, avisos: ['conexão expirada: reconecte a conta'] })
      : estoqueDaConta(String(t.ml_user_id), t.apelido || '', { Authorization: `Bearer ${t.access_token}` })))
    const itens = contas.flatMap(c => c.itens)
    return resp({
      ok: true, itens, total: itens.length, fonte: 'inventories',
      contas: contas.map(c => ({ conta: c.conta, apelido: c.apelido, anuncios: c.anuncios, produtos: c.itens.length, unidades: c.itens.reduce((s: number, x: any) => s + (x.total_geral || 0), 0), avisos: c.avisos }))
    })
  } catch (err) {
    console.error('ml-inventory error:', err)
    return resp({ error: String(err) }, 500)
  }
})
