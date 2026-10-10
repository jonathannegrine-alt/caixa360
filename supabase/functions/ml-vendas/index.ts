// ml-vendas — importa as vendas (pedidos) do Mercado Livre para a tabela vendas_ml.
// Body: { de: 'YYYY-MM-DD', ate: 'YYYY-MM-DD' } (datas em BRT; padrão = hoje).
// Cada chamada tem limite de tempo: se sobrar frete para buscar, devolve pendentes > 0
// e o app chama de novo (o que já foi gravado não é rebuscado).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object) => new Response(JSON.stringify(body), { headers: CORS })

const BRT_MS = 3 * 60 * 60 * 1000
const diaBRT = (offsetDias = 0) => new Date(Date.now() - BRT_MS + offsetDias * 86400000).toISOString().substring(0, 10)
const somaDia = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().substring(0, 10)

let prazoMs = Infinity

// GET no ML com retry (429/5xx) e timeout por chamada
async function mlGet(url: string, accessToken: string, headers: Record<string, string> = {}) {
  let falha = ''
  for (let tent = 0; tent < 3; tent++) {
    if (Date.now() > prazoMs) return { ok: false, data: null, erro: falha || 'tempo esgotado' }
    if (tent > 0) await new Promise(res => setTimeout(res, 600 * tent * tent))
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, ...headers }, signal: AbortSignal.timeout(15000) })
      const d = await r.json().catch(() => null)
      if (r.ok && d) return { ok: true, data: d, erro: null as string | null }
      falha = `http ${r.status} — ${d?.message || d?.error || 'resposta inválida'}`
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break
    } catch (e) {
      falha = String(e)
    }
  }
  return { ok: false, data: null, erro: falha }
}

// Executa fn em paralelo (conc) sobre a lista
async function emParalelo<T>(lista: T[], conc: number, fn: (x: T) => Promise<void>) {
  let prox = 0
  const worker = async () => { while (prox < lista.length) { const i = prox++; await fn(lista[i]) } }
  await Promise.all(Array.from({ length: Math.min(conc, lista.length) }, worker))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl  = Deno.env.get('SUPABASE_URL')!
    const supaKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!
    const secret   = Deno.env.get('ML_CLIENT_SECRET')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }

    // Identificar usuário pelo JWT
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: req.headers.get('Authorization') || '' }
    })
    if (!jwtRes.ok) return resp({ error: 'Não autenticado' })
    const { id: userId } = await jwtRes.json()

    // Token ML (renova se expirado)
    const tokens = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&limit=1`, { headers: dbH }).then(r => r.json())
    const tokenRow = Array.isArray(tokens) ? tokens[0] : null
    if (!tokenRow) return resp({ error: 'ML não conectado. Conecte sua conta primeiro.' })
    let accessToken = tokenRow.access_token
    if (new Date(tokenRow.expires_at) <= new Date()) {
      const newTok = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: tokenRow.refresh_token })
      }).then(r => r.json())
      if (newTok.error || !newTok.access_token) return resp({ error: 'Token ML expirado. Reconecte sua conta.', detail: newTok.error || newTok.message })
      accessToken = newTok.access_token
      await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}`, {
        method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' },
        body: JSON.stringify({
          access_token: newTok.access_token, refresh_token: newTok.refresh_token,
          expires_at: new Date(Date.now() + (Number(newTok.expires_in) || 21600) * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      })
    }

    const body = await req.json().catch(() => ({}))
    const reData = /^\d{4}-\d{2}-\d{2}$/
    const de  = reData.test(body?.de || '')  ? body.de  : diaBRT()
    let   ate = reData.test(body?.ate || '') ? body.ate : de
    if (ate < de) ate = de
    if (somaDia(de, 31) < ate) return resp({ error: 'Período máximo por chamada: 31 dias.' })

    prazoMs = Date.now() + 100000

    // ─── 1. PEDIDOS — uma busca paginada por dia (offsets rasos) ─────────────
    const dias: string[] = []
    for (let d = de; d <= ate; d = somaDia(d, 1)) dias.push(d)
    const pedidos = new Map<number, any>()
    const diasFalhos: string[] = []
    let erroPedidos: string | null = null
    await emParalelo(dias, 3, async (dia) => {
      let offset = 0
      while (offset < 5000) {
        const r = await mlGet(
          `https://api.mercadolibre.com/orders/search?seller=${tokenRow.ml_user_id}&order.date_created.from=${dia}T00:00:00.000-03:00&order.date_created.to=${dia}T23:59:59.999-03:00&sort=date_desc&limit=50&offset=${offset}`,
          accessToken
        )
        if (!r.ok) { diasFalhos.push(dia); erroPedidos = r.erro; return }
        const res = r.data.results || []
        for (const o of res) pedidos.set(o.id, o)
        offset += res.length
        if (res.length === 0 || offset >= (r.data.paging?.total ?? 0)) break
      }
    })
    if (pedidos.size === 0 && diasFalhos.length > 0) {
      // 403 = o aplicativo no DevCenter do ML não tem o escopo de pedidos
      if (String(erroPedidos).includes('http 403')) {
        return resp({ error: 'O aplicativo ainda não tem a permissão "Venda e envios de um produto" no Mercado Livre. Libere a permissão no DevCenter e reconecte a conta.', detail: erroPedidos, sem_permissao: true })
      }
      return resp({ error: 'Mercado Livre não devolveu as vendas. Tente de novo em alguns minutos.', detail: erroPedidos })
    }

    // ─── 2. O que já está gravado (para não rebuscar frete nem foto) ─────────
    const jaTem = new Map<number, any>()
    const thumbs = new Map<string, string>()
    const existentes = await fetch(
      `${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&data_venda=gte.${de}T00:00:00-03:00&data_venda=lte.${ate}T23:59:59.999-03:00&select=order_id,shipping_id,logistic_type,frete_vendedor,frete_comprador,item_id,thumbnail&limit=20000`,
      { headers: dbH }
    ).then(r => r.json()).catch(() => [])
    if (Array.isArray(existentes)) for (const e of existentes) {
      jaTem.set(Number(e.order_id), e)
      if (e.item_id && e.thumbnail) thumbs.set(e.item_id, e.thumbnail)
    }

    // ─── 3. FRETE — custo do vendedor/comprador e tipo de logística ──────────
    // Vendas de um mesmo carrinho dividem o envio: o custo é rateado igualmente
    const porEnvio = new Map<number, number[]>()
    for (const o of pedidos.values()) {
      const sid = o.shipping?.id
      if (!sid) continue
      if (!porEnvio.has(sid)) porEnvio.set(sid, [])
      porEnvio.get(sid)!.push(o.id)
    }
    const fretes = new Map<number, { logistic: string | null; vendedor: number; comprador: number }>()
    const enviosBuscar = [...porEnvio.keys()].filter(sid =>
      !porEnvio.get(sid)!.every(oid => jaTem.get(oid)?.frete_vendedor != null && jaTem.get(oid)?.logistic_type))
    await emParalelo(enviosBuscar, 8, async (sid) => {
      const [s, c] = await Promise.all([
        mlGet(`https://api.mercadolibre.com/shipments/${sid}`, accessToken, { 'x-format-new': 'true' }),
        mlGet(`https://api.mercadolibre.com/shipments/${sid}/costs`, accessToken),
      ])
      if (!s.ok || !c.ok) return
      const vendedor = (c.data.senders || []).reduce((t: number, x: any) => t + (Number(x.cost) || 0), 0)
      fretes.set(sid, {
        logistic: s.data.logistic?.type || s.data.logistic_type || null,
        vendedor, comprador: Number(c.data.receiver?.cost) || 0
      })
    })

    // ─── 4. FOTOS dos anúncios ───────────────────────────────────────────────
    const itensSemFoto = [...new Set([...pedidos.values()].map(o => o.order_items?.[0]?.item?.id).filter((id: string) => id && !thumbs.has(id)))]
    const lotes: string[][] = []
    for (let i = 0; i < itensSemFoto.length; i += 20) lotes.push(itensSemFoto.slice(i, i + 20))
    await emParalelo(lotes, 4, async (lote) => {
      const r = await mlGet(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,thumbnail`, accessToken)
      if (!r.ok || !Array.isArray(r.data)) return
      for (const x of r.data) if (x.code === 200 && x.body?.thumbnail) thumbs.set(x.body.id, String(x.body.thumbnail).replace('http://', 'https://'))
    })

    // ─── 5. GRAVAR ───────────────────────────────────────────────────────────
    let pendentes = 0
    const rows = [...pedidos.values()].map(o => {
      const oi = o.order_items?.[0] || {}
      const it = oi.item || {}
      const qtd = Number(oi.quantity) || 1
      const sid = o.shipping?.id || null
      const ant = jaTem.get(o.id)
      const f = sid ? fretes.get(sid) : null
      const n = sid ? (porEnvio.get(sid)?.length || 1) : 1
      const semEnvio = !sid
      const freteVend = f ? Math.round(f.vendedor / n * 100) / 100 : (ant?.frete_vendedor ?? (semEnvio ? 0 : null))
      const freteComp = f ? Math.round(f.comprador / n * 100) / 100 : (ant?.frete_comprador ?? (semEnvio ? 0 : null))
      if (freteVend == null) pendentes++
      return {
        usuario_id: userId,
        order_id: o.id,
        pack_id: o.pack_id || null,
        data_venda: o.date_created,
        status: o.status,
        comprador_id: o.buyer?.id || null,
        comprador_apelido: o.buyer?.nickname || null,
        comprador_nome: [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(' ') || null,
        item_id: it.id || null,
        titulo: it.title || null,
        sku: it.seller_sku || it.seller_custom_field || null,
        variacao: (it.variation_attributes || []).map((v: any) => `${v.name}: ${v.value_name}`).join(', ') || null,
        qtd,
        preco_unit: Number(oi.unit_price) || 0,
        tarifa: Math.round((Number(oi.sale_fee) || 0) * qtd * 100) / 100,
        listing_type: oi.listing_type_id || null,
        shipping_id: sid,
        logistic_type: f?.logistic ?? ant?.logistic_type ?? null,
        frete_vendedor: freteVend,
        frete_comprador: freteComp,
        total_pago: Number(o.paid_amount) || 0,
        thumbnail: (it.id && thumbs.get(it.id)) || ant?.thumbnail || null,
        atualizado_em: new Date().toISOString(),
      }
    })
    for (let i = 0; i < rows.length; i += 500) {
      const up = await fetch(`${supaUrl}/rest/v1/vendas_ml?on_conflict=usuario_id,order_id`, {
        method: 'POST', headers: { ...dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500))
      })
      if (!up.ok) return resp({ error: 'Erro ao gravar vendas', detail: (await up.text()).slice(0, 300) })
    }

    return resp({
      success: true, de, ate, vendas: rows.length, fretes_buscados: fretes.size, pendentes,
      dias_falhos: diasFalhos, aviso: diasFalhos.length ? `${diasFalhos.length} dia(s) não vieram do ML (${erroPedidos})` : null
    })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
