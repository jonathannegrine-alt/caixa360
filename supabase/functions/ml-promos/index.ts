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

    // dados de cada anúncio para calcular frete e margem sem depender de venda recente: peso tarifável (o peso que o
    // ML usa para cobrar o frete), tarifa de venda, SKU, preço. Guarda em ml_itens_base. Até 40 anúncios por chamada.
    if (body?.acao === 'base') {
      const ids = [...new Set((Array.isArray(body?.itens) ? body.itens : []).map((x: unknown) => String(x)).filter((x: string) => /^MLB\d{6,14}$/.test(x)))].slice(0, 40) as string[]
      if (!ids.length) return resp({ ok: true, itens: [] })
      const linhas: any[] = []
      const taxas = new Map<string, number>()
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20)
        const mg: any = await g(`${ML}/items?ids=${lote.join(',')}&attributes=id,title,thumbnail,price,category_id,listing_type_id,seller_custom_field,attributes,shipping,variations`)
        const corpos = (Array.isArray(mg) ? mg : []).filter((x: any) => x?.code === 200 && x.body?.id).map((x: any) => x.body)
        await Promise.all(corpos.map(async (it: any) => {
          const atr = (it.attributes || []).find((a: any) => a?.id === 'SELLER_SKU')
          const skuVar = ((it.variations || [])[0]?.attributes || []).find((a: any) => a?.id === 'SELLER_SKU')
          const sku = String(atr?.value_name || it.seller_custom_field || skuVar?.value_name || (it.variations || [])[0]?.seller_custom_field || '').trim()
          const chave = it.category_id + '|' + it.listing_type_id
          const [fr, tx]: any[] = await Promise.all([
            g(`${ML}/users/${conta}/shipping_options/free?item_id=${it.id}`),
            taxas.has(chave) ? Promise.resolve(null) : g(`${ML}/sites/MLB/listing_prices?price=${Number(it.price) || 100}&listing_type_id=${it.listing_type_id}&category_id=${it.category_id}`),
          ])
          if (tx && !tx.erro && tx.sale_fee_details?.percentage_fee != null) taxas.set(chave, Number(tx.sale_fee_details.percentage_fee) / 100)
          const cob = fr?.coverage?.all_country || {}
          linhas.push({
            usuario_id: userId, ml_user_id: conta, item_id: it.id, titulo: it.title || null, thumbnail: String(it.thumbnail || '').replace('http://', 'https://') || null, sku: sku || null,
            preco: Number(it.price) || null, categoria: it.category_id || null, tipo_anuncio: it.listing_type_id || null, tarifa_pct: taxas.get(chave) ?? null,
            peso_g: Number(cob.billable_weight) || null, frete_lista: Number(cob.list_cost) || null, logistica: it.shipping?.logistic_type || null, lido_em: new Date().toISOString(),
          })
        }))
      }
      // a tarifa da categoria pode ter chegado depois de alguma linha do mesmo lote
      linhas.forEach(l => { if (l.tarifa_pct == null) { const t = taxas.get(l.categoria + '|' + l.tipo_anuncio); if (t != null) l.tarifa_pct = t } })
      if (linhas.length) {
        await fetch(`${supaUrl}/rest/v1/ml_itens_base?on_conflict=usuario_id,ml_user_id,item_id`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
      }
      return resp({ ok: true, itens: linhas.map(({ usuario_id: _u, ...r }) => r), pedidos: ids.length })
    }

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
