// ml-envios — situação do envio das vendas que saem do GALPÃO (tudo que não é Full).
// O estoque físico do galpão só baixa quando o Mercado Livre marca o pedido como enviado (como faz a UpSeller);
// até lá a venda fica "ocupando" o estoque. Esta função consulta GET /shipments/{id} das vendas recentes ainda
// não enviadas e grava vendas_ml.envio_status e vendas_ml.enviado_em.
//
//   usuário logado: {}                    confere as vendas dele
//   cron:           { cron: true, secret } confere as de todos (a cada 15 min)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const DIAS = 25          // olha as vendas dos últimos N dias
const MAX_ENVIOS = 220   // por conta, por chamada
const MAX_UF = 550        // vendas sem estado do comprador preenchidas por conta, por chamada (histórico vai aos poucos)
const ufDe = (s: any): string | null => { const id = String(s?.destination?.shipping_address?.state?.id || s?.receiver_address?.state?.id || ''); const m = id.match(/([A-Z]{2})$/); return m ? m[1] : null }

async function emLotes<T, R>(lista: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(lista.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) { const k = i++; out[k] = await fn(lista[k]) } }))
  return out
}

async function tokens(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string) {
  const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=access_token,refresh_token,expires_at,ml_user_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
  const lista = Array.isArray(rows) ? rows : []
  for (const t of lista) {
    if (new Date(t.expires_at) > new Date(Date.now() + 60000)) continue
    const ref = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: t.refresh_token })
    }).then(r => r.json()).catch(() => null)
    if (!ref?.access_token) { t.invalido = true; continue }
    t.access_token = ref.access_token
    await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}`, {
      method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + ref.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
    })
  }
  return lista.filter((t: any) => !t.invalido)
}

async function conferir(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string) {
  const desde = new Date(Date.now() - DIAS * 86400000).toISOString()
  let conferidos = 0, enviados = 0
  for (const t of await tokens(supaUrl, dbH, userId, clientId, secret)) {
    // vendas do galpão ainda sem envio registrado (canceladas ficam de fora)
    const vendas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}&data_venda=gte.${desde}&enviado_em=is.null&shipping_id=not.is.null&status=neq.cancelled&or=(logistic_type.is.null,logistic_type.neq.fulfillment)&select=shipping_id&order=data_venda.desc&limit=3000`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const ids = [...new Set((Array.isArray(vendas) ? vendas : []).map((v: any) => String(v.shipping_id)))].slice(0, MAX_ENVIOS)
    await emLotes(ids, 6, async sid => {
      const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: { Authorization: `Bearer ${t.access_token}`, 'x-format-new': 'true' } }).catch(() => null)
      if (!r || !r.ok) return
      const s = await r.json().catch(() => null); if (!s) return
      conferidos++
      const status = String(s.status || '')
      const hist = s.status_history || {}
      // enviado = saiu do vendedor (shipped / delivered / not_delivered) — a data vem do histórico
      const saiu = ['shipped', 'delivered', 'not_delivered'].includes(status) || !!hist.date_shipped
      const quando = hist.date_shipped || hist.date_delivered || (saiu ? (s.last_updated || new Date().toISOString()) : null)
      const campos: Record<string, unknown> = { envio_status: status || null }
      if (saiu && quando) { campos.enviado_em = quando; enviados++ }
      if (s.logistic?.type) campos.logistic_type = s.logistic.type
      const uf = ufDe(s); if (uf) campos.uf = uf
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(campos) })
    })
  }
  return { conferidos, enviados, estados: await estados(supaUrl, dbH, userId, clientId, secret) }
}

// Estado (UF) de entrega de cada venda, para a análise por estado. Mais novas primeiro; o histórico é preenchido aos poucos.
async function estados(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string) {
  let feitos = 0
  for (const t of await tokens(supaUrl, dbH, userId, clientId, secret)) {
    const vendas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}&uf=is.null&shipping_id=not.is.null&select=shipping_id&order=data_venda.desc&limit=${MAX_UF * 2}`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const ids = [...new Set((Array.isArray(vendas) ? vendas : []).map((v: any) => String(v.shipping_id)))].slice(0, MAX_UF)
    await emLotes(ids, 8, async sid => {
      const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: { Authorization: `Bearer ${t.access_token}`, 'x-format-new': 'true' } }).catch(() => null)
      if (!r) return
      // envio que o ML não entrega mais (404/403) fica marcado para não ser tentado de novo
      const s = r.ok ? await r.json().catch(() => null) : null
      const uf = s ? (ufDe(s) || '--') : (r.status === 404 || r.status === 403 ? '--' : null)
      if (!uf) return
      feitos++
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ uf }) })
    })
  }
  return feitos
}

// Repasse do Flex das vendas antigas (vendas_ml.frete_flex): GET /shipments/{id}/costs. Um lote por chamada.
const MAX_FLEX = 400
async function flex(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string) {
  let feitos = 0, faltam = 0
  for (const t of await tokens(supaUrl, dbH, userId, clientId, secret)) {
    const vendas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}&logistic_type=eq.self_service&frete_flex=is.null&shipping_id=not.is.null&select=shipping_id&order=data_venda.desc&limit=${MAX_FLEX * 3}`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const todos = [...new Set((Array.isArray(vendas) ? vendas : []).map((v: any) => String(v.shipping_id)))]
    const ids = todos.slice(0, MAX_FLEX); faltam += todos.length - ids.length
    await emLotes(ids, 8, async sid => {
      const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}/costs`, { headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => null)
      if (!r) return
      const c = r.ok ? await r.json().catch(() => null) : null
      if (!c && r.status !== 404 && r.status !== 403) return        // falha passageira: tenta na próxima
      const rec = c?.receiver || {}
      const total = c ? (Number(rec.cost) || 0) + (rec.discounts || []).reduce((s: number, d: any) => s + (Number(d.promoted_amount) || 0), 0) : 0
      const irmas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}&select=order_id`, { headers: dbH }).then(x => x.json()).catch(() => [])
      const n = Math.max(1, Array.isArray(irmas) ? irmas.length : 1)
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ frete_flex: Math.round(total / n * 100) / 100, envio_n: n }) })
      feitos++
    })
  }
  return { feitos, faltam }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!, secret = Deno.env.get('ML_CLIENT_SECRET')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    const body = await req.json().catch(() => ({}))

    if (body?.cron === true) {
      if (!Deno.env.get('CRON_SECRET') || body.secret !== Deno.env.get('CRON_SECRET')) return resp({ error: 'não autorizado' }, 401)
      const us = await fetch(`${supaUrl}/rest/v1/ml_tokens?select=usuario_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
      const ids = [...new Set((Array.isArray(us) ? us : []).map((u: any) => u.usuario_id))]
      const res: any[] = []
      for (const u of ids) res.push({ usuario: u, ...(await conferir(supaUrl, dbH, String(u), clientId, secret)) })
      return resp({ ok: true, usuarios: res.length, conferidos: res.reduce((s, r) => s + r.conferidos, 0), enviados: res.reduce((s, r) => s + r.enviados, 0), estados: res.reduce((s, r) => s + (r.estados || 0), 0) })
    }

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()
    if (body?.acao === 'flex') return resp({ ok: true, ...(await flex(supaUrl, dbH, userId, clientId, secret)) })
    return resp({ ok: true, ...(await conferir(supaUrl, dbH, userId, clientId, secret)) })
  } catch (err) {
    console.error('ml-envios error:', err)
    return resp({ error: String(err) }, 500)
  }
})
