// ml-anuncios — lista os anúncios (ativos e pausados) de TODAS as contas do Mercado Livre do usuário, com cada
// variação e o SKU escrito nela, e guarda em ml_anuncios. É a lista usada para mapear anúncio → SKU do produto
// (tabela sku_mapa, tela Produtos). Chamada pelo navegador (botão "Atualizar anúncios" ou lista com mais de 1 dia).
//
// Por conta:  1) ids dos anúncios          GET /users/{id}/items/search?status=...&search_type=scan (scroll)
//             2) dados de 20 em 20         GET /items?ids=...
//             3) anúncio com variação      GET /items/{id}?include_attributes=all (o SKU da variação vem nos atributos)
// Conta que falhar no meio não apaga o que já estava guardado dela.

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
  for (let tent = 0; tent < 3; tent++) {
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 15000)
      const r = await fetch(url, { headers, signal: ctrl.signal })
      clearTimeout(t)
      if (r.status === 429 || r.status >= 500) { await new Promise(ok => setTimeout(ok, 800 * (tent + 1))); continue }
      return { status: r.status, json: await safeJson(r) }
    } catch { /* tenta de novo */ }
  }
  return { status: 0, json: { error: true } }
}
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
const foto = (u: any) => u ? String(u).replace(/^http:/, 'https:') : null

async function anunciosDaConta(mlUserId: string, h: Record<string, string>) {
  // 1) ids (ativos e pausados), com scroll para passar de 1000
  const ids: string[] = []
  for (const status of ['active', 'paused']) {
    let scroll = ''
    for (let pag = 0; pag < 100; pag++) {
      const r = await get(`https://api.mercadolibre.com/users/${mlUserId}/items/search?status=${status}&search_type=scan&limit=100${scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''}`, h)
      const res = Array.isArray(r.json?.results) ? r.json.results : null
      if (!res) return { ok: false, erro: `não consegui listar os anúncios (http ${r.status})`, linhas: [] as any[] }
      ids.push(...res)
      scroll = r.json.scroll_id || ''
      if (!res.length || !scroll) break
    }
  }
  const unicos = [...new Set(ids)]
  // 2) dados de 20 em 20
  const linhas: any[] = [], comVariacao: any[] = []
  const lotes: string[][] = []; for (let i = 0; i < unicos.length; i += 20) lotes.push(unicos.slice(i, i + 20))
  let falhas = 0
  await emLotes(lotes, 4, async lote => {
    const r = await get(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,title,status,thumbnail,secure_thumbnail,attributes,seller_custom_field,variations,shipping`, h)
    if (!Array.isArray(r.json)) { falhas += lote.length; return }
    for (const e of r.json) {
      const it = e?.body
      if (e?.code !== 200 || !it?.id) { falhas++; continue }
      const base = { ml_user_id: mlUserId, item_id: String(it.id), titulo: it.title || null, status: it.status || null, logistic_type: it.shipping?.logistic_type || null, thumbnail: foto(it.secure_thumbnail || it.thumbnail) }
      if (Array.isArray(it.variations) && it.variations.length) comVariacao.push(base)
      else linhas.push({ ...base, variation_id: 0, variacao: null, sku_anuncio: skuDe(it) || null })
    }
  })
  // 3) variações com o SKU de cada uma
  await emLotes(comVariacao, 4, async base => {
    const r = await get(`https://api.mercadolibre.com/items/${base.item_id}?include_attributes=all`, h)
    const it = r.json
    if (!it?.id || !Array.isArray(it.variations)) { falhas++; return }
    for (const v of it.variations) {
      if (!v?.id) continue
      const comb = (v.attribute_combinations || []).map((a: any) => a?.value_name).filter(Boolean).join(' / ')
      linhas.push({ ...base, variation_id: Number(v.id), variacao: comb || null, sku_anuncio: skuDe(v) || null })
    }
  })
  return { ok: falhas === 0, erro: falhas ? `${falhas} anúncios sem resposta do Mercado Livre` : null, linhas, anuncios: unicos.length }
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
    const corpo = await req.json().catch(() => ({}))
    let userId = ''
    // modo servidor (teste/rotina): token de service_role (a assinatura já foi conferida pelo gateway, verify_jwt)
    const papel = (() => { try { return JSON.parse(atob(authHeader.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { return '' } })()
    if (papel === 'service_role' && corpo?.usuario) userId = String(corpo.usuario)
    else {
      const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
      if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
      userId = (await jwtRes.json()).id
    }

    const tokens = await tokensML(supaUrl, supaKey, userId, clientId, secret)
    if (!tokens.length) return resp({ error: 'Conta ML não conectada — conecte em Configurações → Mercado Livre.' }, 404)
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }

    const inicio = new Date().toISOString(), contas: any[] = []
    for (const t of tokens) {
      const conta = String(t.ml_user_id)
      if (t.invalido){ contas.push({ conta, apelido: t.apelido || '', erro: 'conexão expirada: reconecte a conta' }); continue }
      const r = await anunciosDaConta(conta, { Authorization: `Bearer ${t.access_token}` })
      const linhas = r.linhas.map((l: any) => ({ usuario_id: userId, ...l, atualizado_em: inicio }))
      for (let i = 0; i < linhas.length; i += 500) {
        const up = await fetch(`${supaUrl}/rest/v1/ml_anuncios?on_conflict=usuario_id,item_id,variation_id`, { method: 'POST', headers: { ...dbH, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas.slice(i, i + 500)) })
        if (!up.ok) return resp({ error: 'não consegui gravar os anúncios: ' + (await up.text()).slice(0, 200) }, 500)
      }
      // leitura completa: o que não veio mais (anúncio encerrado ou variação apagada) sai da lista
      if (r.ok) await fetch(`${supaUrl}/rest/v1/ml_anuncios?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&atualizado_em=lt.${encodeURIComponent(inicio)}`, { method: 'DELETE', headers: { ...dbH, Prefer: 'return=minimal' } })
      contas.push({ conta, apelido: t.apelido || '', anuncios: r.anuncios || 0, linhas: linhas.length, erro: r.erro })
    }
    return resp({ ok: true, contas, total: contas.reduce((s, c) => s + (c.linhas || 0), 0) })
  } catch (err) {
    console.error('ml-anuncios error:', err)
    return resp({ error: String(err) }, 500)
  }
})
