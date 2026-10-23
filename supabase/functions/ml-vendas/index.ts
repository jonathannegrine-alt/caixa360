// ml-vendas — importa as vendas (pedidos) do Mercado Livre para a tabela vendas_ml.
//
// Modo usuário (JWT):  { de, ate, forcar? }  → sincroniza os dias do período que ainda não estão em
//                      cache (vendas_ml_dias). Hoje e ontem são refeitos se o cache tiver mais de 10 min.
//                      Devolve restantes > 0 quando o tempo acabou: o app chama de novo.
//                      { checar: true }      → diz se o token tem os escopos de vendas e de comunicação.
// Modo cron:           { cron: true, secret } → todos os usuários: hoje/ontem + preenche o histórico
//                      (até 365 dias para trás), um pouco por execução.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object) => new Response(JSON.stringify(body), { headers: CORS })

const BRT_MS = 3 * 60 * 60 * 1000
const diaBRT = (offsetDias = 0) => new Date(Date.now() - BRT_MS + offsetDias * 86400000).toISOString().substring(0, 10)
const somaDia = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().substring(0, 10)
const HISTORICO_DIAS = 365

// GET no ML com retry (429/5xx) e timeout por chamada
async function mlGet(url: string, accessToken: string, prazoMs: number, headers: Record<string, string> = {}) {
  let falha = ''
  for (let tent = 0; tent < 3; tent++) {
    if (Date.now() > prazoMs) return { ok: false, status: 0, data: null, erro: falha || 'tempo esgotado' }
    if (tent > 0) await new Promise(res => setTimeout(res, 600 * tent * tent))
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, ...headers }, signal: AbortSignal.timeout(15000) })
      const d = await r.json().catch(() => null)
      if (r.ok && d) return { ok: true, status: r.status, data: d, erro: null as string | null }
      falha = `http ${r.status} — ${d?.message || d?.error || 'resposta inválida'}`
      if (r.status >= 400 && r.status < 500 && r.status !== 429) return { ok: false, status: r.status, data: d, erro: falha }
    } catch (e) {
      falha = String(e)
    }
  }
  return { ok: false, status: 0, data: null, erro: falha }
}

async function emParalelo<T>(lista: T[], conc: number, fn: (x: T) => Promise<void>) {
  let prox = 0
  const worker = async () => { while (prox < lista.length) { const i = prox++; await fn(lista[i]) } }
  await Promise.all(Array.from({ length: Math.min(conc, lista.length) }, worker))
}

type Ctx = { supaUrl: string; dbH: Record<string, string>; clientId: string; secret: string }

// Contas ML do usuário, já com token válido (renova as expiradas). contaFiltro restringe a uma conta.
type Conta = { mlUserId: string; apelido: string | null; accessToken: string | null; erro: string | null; desde: string | null }
// primeiro dia que se busca desta conta: ml_tokens.historico_desde (conta nova = 30 dias; nulo = conta antiga, 365 dias)
const inicioDe = (c: Conta) => c.desde && c.desde > diaBRT(-HISTORICO_DIAS) ? c.desde : diaBRT(-HISTORICO_DIAS)
async function contasDe(ctx: Ctx, userId: string, contaFiltro?: string): Promise<Conta[]> {
  const rows = await fetch(`${ctx.supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}${contaFiltro ? '&ml_user_id=eq.' + contaFiltro : ''}&order=updated_at.asc`, { headers: ctx.dbH })
    .then(r => r.json()).catch(() => [])
  if (!Array.isArray(rows)) return []
  return Promise.all(rows.map(async (row: any): Promise<Conta> => {
    const base = { mlUserId: String(row.ml_user_id), apelido: row.apelido || null, desde: row.historico_desde ? String(row.historico_desde).slice(0, 10) : null }
    if (new Date(row.expires_at) > new Date()) {
      // contas conectadas antes do seletor de contas ainda não têm apelido gravado
      if (!base.apelido) {
        const me = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${row.access_token}` } }).then(r => r.json()).catch(() => null)
        if (me?.nickname) {
          base.apelido = me.nickname
          await fetch(`${ctx.supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${base.mlUserId}`, { method: 'PATCH', headers: { ...ctx.dbH, Prefer: 'return=minimal' }, body: JSON.stringify({ apelido: me.nickname }) })
        }
      }
      return { ...base, accessToken: row.access_token, erro: null }
    }
    const novo = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ctx.clientId, client_secret: ctx.secret, refresh_token: row.refresh_token })
    }).then(r => r.json()).catch(() => ({}))
    if (novo.error || !novo.access_token) return { ...base, accessToken: null, erro: 'Token ML expirado. Reconecte a conta.' }
    await fetch(`${ctx.supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${base.mlUserId}`, {
      method: 'PATCH', headers: { ...ctx.dbH, Prefer: 'return=minimal' },
      body: JSON.stringify({
        access_token: novo.access_token, refresh_token: novo.refresh_token,
        expires_at: new Date(Date.now() + (Number(novo.expires_in) || 21600) * 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
    })
    return { ...base, accessToken: novo.access_token, erro: null }
  }))
}

// Grava nas vendas ainda sem custo/imposto o valor atual do cadastro de produtos (o passado não muda depois)
async function carimbarCustos(ctx: Ctx, userId: string) {
  await fetch(`${ctx.supaUrl}/rest/v1/rpc/vendas_ml_carimbar`, { method: 'POST', headers: ctx.dbH, body: JSON.stringify({ p_usuario: userId }) }).catch(() => null)
}

// Sincroniza UM dia. Devolve { ok, vendas, pendentes, semPermissao, erro }
async function sincronizarDia(ctx: Ctx, userId: string, mlUserId: string, accessToken: string, dia: string, prazoMs: number) {
  // 1. pedidos do dia
  const pedidos = new Map<number, any>()
  let offset = 0
  while (offset < 5000) {
    const r = await mlGet(
      `https://api.mercadolibre.com/orders/search?seller=${mlUserId}&order.date_created.from=${dia}T00:00:00.000-03:00&order.date_created.to=${dia}T23:59:59.999-03:00&sort=date_desc&limit=50&offset=${offset}`,
      accessToken, prazoMs
    )
    if (!r.ok) return { ok: false, vendas: 0, pendentes: 0, semPermissao: r.status === 403, erro: r.erro }
    const res = r.data.results || []
    for (const o of res) pedidos.set(o.id, o)
    offset += res.length
    if (res.length === 0 || offset >= (r.data.paging?.total ?? 0)) break
  }

  // 2. o que já está gravado (não rebuscar frete nem foto)
  const jaTem = new Map<number, any>()
  const thumbs = new Map<string, string>()
  const existentes = await fetch(
    `${ctx.supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&data_venda=gte.${dia}T00:00:00-03:00&data_venda=lte.${dia}T23:59:59.999-03:00&select=order_id,shipping_id,logistic_type,frete_vendedor,frete_comprador,frete_flex,item_id,thumbnail,sku,sku_fixo,cupom_vendedor,pago_mp,liquido_mp&limit=10000`,
    { headers: ctx.dbH }
  ).then(r => r.json()).catch(() => [])
  if (Array.isArray(existentes)) for (const e of existentes) {
    jaTem.set(Number(e.order_id), e)
  }
  // a foto fica uma vez por anúncio (tabela vendas_fotos), não em cada venda; relida do ML a cada 7 dias (troca de capa)
  const fotosVelhas = new Map<string, string>(), fotosNovas = new Set<string>()
  const idsDia = [...new Set([...pedidos.values()].map(o => o.order_items?.[0]?.item?.id).filter((id: string) => id))] as string[]
  for (let i = 0; i < idsDia.length; i += 150) {
    const fs = await fetch(`${ctx.supaUrl}/rest/v1/vendas_fotos?usuario_id=eq.${userId}&item_id=in.(${idsDia.slice(i, i + 150).join(',')})&select=item_id,thumbnail,atualizado_em`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
    if (Array.isArray(fs)) for (const f of fs) {
      if (!f.thumbnail) continue
      if (Date.now() - new Date(f.atualizado_em).getTime() < 7 * 86400000) thumbs.set(f.item_id, f.thumbnail); else fotosVelhas.set(f.item_id, f.thumbnail)
    }
  }

  // 3. frete — vendas do mesmo carrinho dividem o envio (custo rateado igualmente)
  const porEnvio = new Map<number, number[]>()
  for (const o of pedidos.values()) {
    const sid = o.shipping?.id
    if (!sid) continue
    if (!porEnvio.has(sid)) porEnvio.set(sid, [])
    porEnvio.get(sid)!.push(o.id)
  }
  const fretes = new Map<number, { logistic: string | null; vendedor: number; comprador: number; flex: number }>()
  const enviosBuscar = [...porEnvio.keys()].filter(sid =>
    !porEnvio.get(sid)!.every(oid => jaTem.get(oid)?.frete_vendedor != null && jaTem.get(oid)?.logistic_type))
  await emParalelo(enviosBuscar, 8, async (sid) => {
    const [s, c] = await Promise.all([
      mlGet(`https://api.mercadolibre.com/shipments/${sid}`, accessToken, prazoMs, { 'x-format-new': 'true' }),
      mlGet(`https://api.mercadolibre.com/shipments/${sid}/costs`, accessToken, prazoMs),
    ])
    if (!s.ok || !c.ok) return
    const vendedor = (c.data.senders || []).reduce((t: number, x: any) => t + (Number(x.cost) || 0), 0)
    // Flex: o vendedor é o transportador e recebe o frete do envio (o que o comprador pagou + o que o ML bancou)
    const rec = c.data.receiver || {}
    const flex = (Number(rec.cost) || 0) + (rec.discounts || []).reduce((t: number, d: any) => t + (Number(d.promoted_amount) || 0), 0)
    fretes.set(sid, { logistic: s.data.logistic?.type || s.data.logistic_type || null, vendedor, comprador: Number(rec.cost) || 0, flex })
  })

  // 4. fotos dos anúncios
  const semFoto = [...new Set([...pedidos.values()].map(o => o.order_items?.[0]?.item?.id).filter((id: string) => id && !thumbs.has(id)))]
  const lotes: string[][] = []
  for (let i = 0; i < semFoto.length; i += 20) lotes.push(semFoto.slice(i, i + 20))
  await emParalelo(lotes, 4, async (lote) => {
    const r = await mlGet(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,thumbnail`, accessToken, prazoMs)
    if (!r.ok || !Array.isArray(r.data)) return
    for (const x of r.data) if (x.code === 200 && x.body?.thumbnail) { thumbs.set(x.body.id, String(x.body.thumbnail).replace('http://', 'https://')); fotosNovas.add(x.body.id) }
  })
  if (fotosNovas.size) {
    const agora = new Date().toISOString()
    await fetch(`${ctx.supaUrl}/rest/v1/vendas_fotos?on_conflict=usuario_id,item_id`, { method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([...fotosNovas].map(id => ({ usuario_id: userId, item_id: id, thumbnail: thumbs.get(id), atualizado_em: agora }))) }).catch(() => null)
  }

  // 4b. cupom de desconto bancado pelo VENDEDOR: só vem em /orders/{id}/discounts (type "coupon", amounts.seller), não no
  //     unit_price nem no paid_amount. A oferta (type "discount") já está no unit_price. Lido uma vez por pedido com desconto.
  const cupons = new Map<number, number>()
  let cupomFalhou = false
  const temDesconto = (o: any) => Array.isArray(o.tags) && o.tags.includes('order_has_discount')
  const comDesc = [...pedidos.values()].filter(o => temDesconto(o) && jaTem.get(o.id)?.cupom_vendedor == null)
  await emParalelo(comDesc, 6, async (o) => {
    const r = await mlGet(`https://api.mercadolibre.com/orders/${o.id}/discounts`, accessToken, prazoMs)
    if (!r.ok) { if (r.status === 404) cupons.set(o.id, 0); else cupomFalhou = true; return }
    let s = 0
    for (const d of (r.data?.details || [])) if (d?.type === 'coupon') for (const i of (d.items || [])) s += Number(i?.amounts?.seller) || 0
    cupons.set(o.id, Math.round(s * 100) / 100)
  })

  // 4c. o que o Mercado Pago pagou de fato (GET /collections/{pagamento}): net_received_amount = líquido; total_paid_amount
  //     menos finance_fee (juros do parcelamento, pagos pelo comprador e repassados) = o que entrou pela venda. Lido uma vez
  //     por pedido pago. Serve para achar o "retido pelo Mercado Pago" (passo 5b) — não entra na margem.
  const cols = new Map<number, { pago: number; liq: number }>()
  let colFalhou = false
  const pagos = [...pedidos.values()].filter(o => o.status === 'paid' && jaTem.get(o.id)?.liquido_mp == null && (o.payments || []).some((p: any) => p.status === 'approved'))
  await emParalelo(pagos, 6, async (o) => {
    let pago = 0, liq = 0
    for (const p of (o.payments || []).filter((p: any) => p.status === 'approved')) {
      const r = await mlGet(`https://api.mercadolibre.com/collections/${p.id}`, accessToken, prazoMs)
      const x = r.ok ? (r.data?.collection || r.data) : null
      if (!x || x.net_received_amount == null) { colFalhou = true; return }
      pago += (Number(x.total_paid_amount) || 0) - (Number(x.finance_fee) || 0)
      liq += Number(x.net_received_amount) || 0
    }
    cols.set(o.id, { pago: Math.round(pago * 100) / 100, liq: Math.round(liq * 100) / 100 })
  })

  // 5. gravar
  // anúncio mapeado na tela Produtos (sku_mapa): a venda usa o SKU do produto; o SKU escrito no anúncio fica em sku_anuncio
  // o mapeamento só vale enquanto o anúncio tiver o SKU que tinha ao mapear (m.sku_anuncio; nulo = qualquer)
  const mapa = new Map<string, { sku: string; sa: string | null }>()
  const mp = await fetch(`${ctx.supaUrl}/rest/v1/sku_mapa?usuario_id=eq.${userId}&select=item_id,variation_id,sku,sku_anuncio`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
  if (Array.isArray(mp)) for (const m of mp) mapa.set(String(m.item_id) + ':' + String(m.variation_id || 0), { sku: String(m.sku), sa: m.sku_anuncio ? String(m.sku_anuncio).trim().toUpperCase() : null })
  const mapear = (it: any): string | null => {
    const bruto = String(it.seller_sku || it.seller_custom_field || '').trim()
    for (const k of [String(it.id) + ':' + String(it.variation_id || 0), String(it.id) + ':0']) {
      const m = mapa.get(k)
      if (m && (!m.sa || m.sa === bruto.toUpperCase())) return m.sku
    }
    return bruto || null
  }
  let pendentes = 0
  const rows = [...pedidos.values()].map(o => {
    const oi = o.order_items?.[0] || {}
    const it = oi.item || {}
    const qtd = Number(oi.quantity) || 1
    const sid = o.shipping?.id || null
    const ant = jaTem.get(o.id)
    const f = sid ? fretes.get(sid) : null
    const n = sid ? (porEnvio.get(sid)?.length || 1) : 1
    const freteVend = f ? Math.round(f.vendedor / n * 100) / 100 : (ant?.frete_vendedor ?? (sid ? null : 0))
    const freteComp = f ? Math.round(f.comprador / n * 100) / 100 : (ant?.frete_comprador ?? (sid ? null : 0))
    const logistica = f?.logistic ?? ant?.logistic_type ?? null
    const freteFlex = f ? (logistica === 'self_service' ? Math.round(f.flex / n * 100) / 100 : 0) : (ant?.frete_flex ?? null)
    if (freteVend == null) pendentes++
    return {
      usuario_id: userId,
      ml_user_id: String(mlUserId),
      order_id: o.id,
      pack_id: o.pack_id || null,
      data_venda: o.date_created,
      status: o.status,
      comprador_id: o.buyer?.id || null,
      comprador_apelido: o.buyer?.nickname || null,
      comprador_nome: [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(' ') || null,
      item_id: it.id || null,
      titulo: it.title || null,
      sku: ant?.sku_fixo ? ant.sku : mapear(it),   // SKU nivelado à mão não é trocado
      sku_anuncio: it.seller_sku || it.seller_custom_field || null,
      variation_id: it.variation_id || null,
      variacao: (it.variation_attributes || []).map((v: any) => `${v.name}: ${v.value_name}`).join(', ') || null,
      qtd,
      preco_unit: Number(oi.unit_price) || 0,
      tarifa: Math.round((Number(oi.sale_fee) || 0) * qtd * 100) / 100,
      listing_type: oi.listing_type_id || null,
      shipping_id: sid,
      logistic_type: logistica,
      frete_vendedor: freteVend,
      frete_comprador: freteComp,
      frete_flex: freteFlex,
      envio_n: n,
      cupom_vendedor: cupons.has(o.id) ? cupons.get(o.id)! : (temDesconto(o) ? (ant?.cupom_vendedor ?? null) : 0),
      pago_mp: cols.has(o.id) ? cols.get(o.id)!.pago : (ant?.pago_mp ?? null),
      liquido_mp: cols.has(o.id) ? cols.get(o.id)!.liq : (ant?.liquido_mp ?? null),
      retido_mp: null as number | null,
      total_pago: Number(o.paid_amount) || 0,
      thumbnail: null,   // a foto vem de vendas_fotos (view vendas_ml_calc)
      atualizado_em: new Date().toISOString(),
    }
  })
  // 5b. retido pelo Mercado Pago: o que entrou pela venda − cupom − tarifa − frete − líquido. Conta por envio (no carrinho o
  //     ML cobra o frete inteiro num dos pedidos) e divide pelo valor pago. Costuma ser parcela de empréstimo; fica fora da
  //     margem. Só com tudo conhecido no envio; abaixo de R$ 0,10 (ou negativo) = 0.
  const grupos = new Map<string, any[]>()
  for (const r of rows) { const k = r.shipping_id ? 's' + r.shipping_id : 'o' + r.order_id; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(r) }
  for (const g of grupos.values()) {
    if (g.some(r => r.status !== 'paid' || r.pago_mp == null || r.liquido_mp == null || r.frete_vendedor == null || r.cupom_vendedor == null)) continue
    const frete = g.reduce((t, r) => t + (Number(r.frete_vendedor) || 0) + (r.logistic_type === 'self_service' ? 0 : (Number(r.frete_comprador) || 0)), 0)
    const ret = g.reduce((t, r) => t + r.pago_mp - r.cupom_vendedor - r.tarifa - r.liquido_mp, 0) - frete
    const totPago = g.reduce((t, r) => t + r.pago_mp, 0)
    for (const r of g) r.retido_mp = ret >= 0.1 && totPago > 0 ? Math.round(ret * r.pago_mp / totPago * 100) / 100 : 0
  }
  for (let i = 0; i < rows.length; i += 500) {
    const up = await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml?on_conflict=usuario_id,order_id`, {
      method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500))
    })
    if (!up.ok) return { ok: false, vendas: 0, pendentes: 0, semPermissao: false, erro: 'gravação: ' + (await up.text()).slice(0, 200) }
  }

  // 6. "disponível após esta venda": para vendas que acabaram de entrar (feitas há menos de 40 min), guarda o estoque do
  //    anúncio no Mercado Livre (da variação vendida, quando o anúncio tem variações; no Full, é o estoque do Full) e o do galpão. Nunca derruba a sincronização se falhar.
  try {
    const novas = [...pedidos.values()].filter(o => !jaTem.has(o.id) && o.order_items?.[0]?.item?.id && Date.now() - new Date(o.date_created).getTime() < 40 * 60000)
    if (novas.length) {
      const idsItens = [...new Set(novas.map(o => String(o.order_items[0].item.id)))], disp = new Map<string, number>()
      const lts: string[][] = []; for (let i = 0; i < idsItens.length; i += 20) lts.push(idsItens.slice(i, i + 20))
      await emParalelo(lts, 4, async (lote) => {
        const r = await mlGet(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,available_quantity,variations`, accessToken, prazoMs)
        if (!r.ok || !Array.isArray(r.data)) return
        for (const x of r.data) if (x.code === 200 && x.body?.id) {
          if (x.body.available_quantity != null) disp.set(String(x.body.id), Number(x.body.available_quantity))
          // anúncio com variações (cor, tamanho, amperagem): guarda o estoque de cada uma, não só o total
          for (const vr of (Array.isArray(x.body.variations) ? x.body.variations : [])) if (vr?.id && vr.available_quantity != null) disp.set(String(x.body.id) + ':' + String(vr.id), Number(vr.available_quantity))
        }
      })
      const galpao = new Map<string, number>()
      const deps = await fetch(`${ctx.supaUrl}/rest/v1/estoque_depositos?usuario_id=eq.${userId}&tipo=eq.proprio&select=id`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
      const idsDep = (Array.isArray(deps) ? deps : []).map((d: any) => d.id)
      if (idsDep.length) {
        const sal = await fetch(`${ctx.supaUrl}/rest/v1/estoque_saldo?usuario_id=eq.${userId}&deposito_id=in.(${idsDep.join(',')})&select=sku_norm,fisico&limit=5000`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
        for (const s of (Array.isArray(sal) ? sal : [])) galpao.set(String(s.sku_norm), (galpao.get(String(s.sku_norm)) || 0) + (Number(s.fisico) || 0))
      }
      await emParalelo(novas, 6, async (o) => {
        const it = o.order_items[0].item, sku = String(mapear(it) || '').trim().toLowerCase()
        const corpo: Record<string, number | null> = { est_anuncio_apos: it.variation_id && disp.has(String(it.id) + ':' + String(it.variation_id)) ? disp.get(String(it.id) + ':' + String(it.variation_id))! : (disp.has(String(it.id)) ? disp.get(String(it.id))! : null), est_galpao_apos: sku && galpao.has(sku) ? galpao.get(sku)! : null }
        if (corpo.est_anuncio_apos == null && corpo.est_galpao_apos == null) return
        await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&order_id=eq.${o.id}`, { method: 'PATCH', headers: { ...ctx.dbH, Prefer: 'return=minimal' }, body: JSON.stringify(corpo) })
      })
    }
  } catch (_e) { /* o estoque é informativo: segue a sincronização */ }
  await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml_dias?on_conflict=usuario_id,ml_user_id,dia`, {
    method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ usuario_id: userId, ml_user_id: String(mlUserId), dia, vendas: rows.length, completo: pendentes === 0, cupom_lido: !cupomFalhou && !colFalhou, sincronizado_em: new Date().toISOString() })
  })
  return { ok: true, vendas: rows.length, pendentes, semPermissao: false, erro: null as string | null }
}

// Dias do período que precisam ir ao ML (mais recentes primeiro)
// validadeMs: por quanto tempo o cache de hoje/ontem vale antes de ir ao ML de novo
async function diasPendentes(ctx: Ctx, userId: string, conta: string, de: string, ate: string, forcar: boolean, validadeMs = 10 * 60 * 1000) {
  const hoje = diaBRT(), ontem = diaBRT(-1)
  const cache = new Map<string, { completo: boolean; em: number }>()
  const rows = await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml_dias?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&dia=gte.${de}&dia=lte.${ate}&select=dia,completo,sincronizado_em&limit=2000`, { headers: ctx.dbH })
    .then(r => r.json()).catch(() => [])
  if (Array.isArray(rows)) for (const r of rows) cache.set(String(r.dia).substring(0, 10), { completo: !!r.completo, em: new Date(r.sincronizado_em).getTime() })
  const lista: string[] = []
  for (let d = ate > hoje ? hoje : ate; d >= de; d = somaDia(d, -1)) {
    const c = cache.get(d)
    const recente = d === hoje || d === ontem
    if (forcar || !c || !c.completo || (recente && Date.now() - c.em > validadeMs)) lista.push(d)
  }
  return lista
}

// Dias já fechados (D-2 a D-10) relidos há mais de 6 h. Venda criada num dia e paga dias depois (pagamento
// recusado e refeito) só aparece na busca depois de paga, e a busca é pelo dia da criação: sem esta revisão ela não entrava.
async function diasRevisar(ctx: Ctx, userId: string, conta: string) {
  const de = diaBRT(-10), ate = diaBRT(-2)
  const rows = await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml_dias?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&dia=gte.${de}&dia=lte.${ate}&select=dia,sincronizado_em&order=sincronizado_em.asc&limit=20`, { headers: ctx.dbH })
    .then(r => r.json()).catch(() => [])
  return (Array.isArray(rows) ? rows : []).filter((r: any) => Date.now() - new Date(r.sincronizado_em).getTime() > 6 * 3600000).map((r: any) => String(r.dia).substring(0, 10))
}

// Dias dos últimos 30 ainda sem a leitura do cupom do vendedor (coluna nova em 2026-10-23): relê um por vez, do mais recente
async function diasCupom(ctx: Ctx, userId: string, conta: string) {
  const rows = await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml_dias?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&dia=gte.${diaBRT(-30)}&dia=lte.${diaBRT(-2)}&cupom_lido=eq.false&vendas=gt.0&select=dia&order=dia.desc&limit=3`, { headers: ctx.dbH })
    .then(r => r.json()).catch(() => [])
  return (Array.isArray(rows) ? rows : []).map((r: any) => String(r.dia).substring(0, 10))
}

async function sincronizarLista(ctx: Ctx, userId: string, conta: Conta, dias: string[], prazoMs: number): Promise<any> {
  if (!conta.accessToken) return { error: conta.erro || 'Conta sem token' }
  let feitos = 0, vendas = 0, pendentes = 0
  for (const dia of dias) {
    if (Date.now() > prazoMs - 20000) break   // reserva tempo para terminar com folga
    const r = await sincronizarDia(ctx, userId, conta.mlUserId, conta.accessToken, dia, prazoMs)
    if (r.semPermissao) {
      return { error: 'O aplicativo ainda não tem a permissão "Venda e envios de um produto" no Mercado Livre, ou a conta precisa ser reconectada.', detail: r.erro, sem_permissao: true }
    }
    if (!r.ok) return { success: feitos > 0, feitos, vendas, pendentes, restantes: dias.length - feitos, aviso: `Mercado Livre não devolveu ${dia} (${r.erro})` }
    vendas += r.vendas; pendentes += r.pendentes
    if (r.pendentes > 0) break   // tempo acabou no meio do dia: o app/cron chama de novo
    feitos++
  }
  return { success: true, feitos, vendas, pendentes, restantes: dias.length - feitos, aviso: null as string | null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ctx: Ctx = {
      supaUrl, clientId: Deno.env.get('ML_CLIENT_ID')!, secret: Deno.env.get('ML_CLIENT_SECRET')!,
      dbH: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
    }
    const body = await req.json().catch(() => ({}))
    const prazoMs = Date.now() + 110000

    // ── MODO CRON ───────────────────────────────────────────────────────────
    if (body?.cron === true) {
      const cronSecret = Deno.env.get('CRON_SECRET')
      if (cronSecret && body?.secret !== cronSecret) return resp({ error: 'Unauthorized' })
      const tokens = await fetch(`${supaUrl}/rest/v1/ml_tokens?select=usuario_id,ml_user_id`, { headers: ctx.dbH }).then(r => r.json())
      // { conta, recentes: true } = chamada do ml-webhook: só hoje/ontem daquela conta, sem mexer no histórico
      const soConta = body?.conta ? String(body.conta) : null, soRecentes = body?.recentes === true
      // { conta, dias: ['AAAA-MM-DD'] } = ml-webhook avisou de venda criada num dia já fechado (paga depois): relê esse dia
      const diasPedidos: string[] = soConta && Array.isArray(body?.dias) ? body.dias.map((d: unknown) => String(d)).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= diaBRT(-HISTORICO_DIAS) && d <= diaBRT()).slice(0, 3) : []
      const pares: { u: string; c: string }[] = (Array.isArray(tokens) ? tokens.map((t: any) => ({ u: t.usuario_id, c: String(t.ml_user_id) })) : [])
        .filter(x => !soConta || x.c === soConta)
      // Uma conta por vez e poucos dias de histórico por execução: com várias contas em paralelo importando
      // tudo o que coubesse em 110 s, a função estourava o limite de processamento (WORKER_RESOURCE_LIMIT) e
      // nada era gravado. O histórico avança DIAS_HIST_POR_VEZ dias por conta a cada execução do cron.
      const DIAS_HIST_POR_VEZ = 2
      const resultados: any[] = []
      for (const { u, c } of pares) {
        try {
          const conta = (await contasDe(ctx, u, c))[0]
          if (!conta) { resultados.push({ usuario_id: u, ml_user_id: c, error: 'conta não encontrada' }); continue }
          // hoje/ontem (se o cache venceu) + o próximo trecho do histórico ainda não importado
          const recentes = await diasPendentes(ctx, u, c, diaBRT(-1), diaBRT(), false, soRecentes ? 20 * 1000 : 10 * 60 * 1000)
          if (diasPedidos.length) { const r = await sincronizarLista(ctx, u, conta, diasPedidos, prazoMs); resultados.push({ usuario_id: u, ml_user_id: c, dias: diasPedidos, ...r }); continue }
          const antigos = soRecentes ? [] : await diasPendentes(ctx, u, c, inicioDe(conta), diaBRT(-2), false)
          const revisar = soRecentes ? [] : (await diasRevisar(ctx, u, c)).filter(d => !antigos.includes(d)).slice(0, 1)
          const cupom = soRecentes ? [] : (await diasCupom(ctx, u, c)).filter(d => !antigos.includes(d) && !revisar.includes(d)).slice(0, 1)
          const r = await sincronizarLista(ctx, u, conta, [...recentes, ...antigos.slice(0, DIAS_HIST_POR_VEZ), ...revisar, ...cupom], prazoMs)
          resultados.push({ usuario_id: u, ml_user_id: c, ...r })
        } catch (e) {
          resultados.push({ usuario_id: u, ml_user_id: c, error: String(e) })
        }
      }
      await Promise.all([...new Set(pares.map(x => x.u))].map(u => carimbarCustos(ctx, u)))
      console.log('ml-vendas cron', JSON.stringify(resultados))
      return resp({ success: true, contas: pares.length, resultados })
    }

    // ── MODO USUÁRIO ────────────────────────────────────────────────────────
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: req.headers.get('Authorization') || '' }
    })
    if (!jwtRes.ok) return resp({ error: 'Não autenticado' })
    const { id: userId } = await jwtRes.json()

    const contas = await contasDe(ctx, userId, body?.conta ? String(body.conta) : undefined)
    if (contas.length === 0) return resp({ conectado: false, error: 'ML não conectado. Conecte sua conta primeiro.' })

    // botão "Usar a foto do anúncio" (estoque): busca AGORA no Mercado Livre a capa atual do anúncio do SKU.
    // Anúncios do próprio SKU (cadastro de anúncios + vendas recentes) vêm antes dos kits que usam o SKU como componente;
    // entre eles, anúncio ativo antes de pausado/encerrado. Cada anúncio é lido com o token da conta dona.
    if (body?.acao === 'foto_sku') {
      const k = String(body.sku || '').trim()
      if (!k) return resp({ error: 'SKU vazio' })
      const q = (t: string, f: string) => fetch(`${supaUrl}/rest/v1/${t}?usuario_id=eq.${userId}&${f}`, { headers: ctx.dbH }).then(r => r.json()).then(d => Array.isArray(d) ? d : []).catch(() => [])
      const desde = new Date(Date.now() - 180 * 86400000).toISOString()
      const doSku = async (s: string) => {
        const e = encodeURIComponent(s)
        const [vd, base] = await Promise.all([
          q('vendas_ml', `sku=ilike.${e}&data_venda=gte.${desde}&select=item_id,ml_user_id&order=data_venda.desc&limit=200`),
          q('ml_itens_base', `sku=ilike.${e}&select=item_id,ml_user_id`)])
        return [...vd, ...base]
      }
      const cand: { item: string; conta: string; pr: number }[] = [], visto = new Set<string>()
      const juntar = (linhas: any[], pr: number) => { for (const l of linhas) if (l.item_id && !visto.has(l.item_id)) { visto.add(l.item_id); cand.push({ item: String(l.item_id), conta: String(l.ml_user_id), pr }) } }
      juntar(await doSku(k), 0)
      if (!cand.length) {
        const kits = await q('sku_composicao', `sku_componente=ilike.${encodeURIComponent(k)}&select=sku_comercial`)
        for (const kt of kits.slice(0, 10)) juntar(await doSku(String(kt.sku_comercial)), 1)
      }
      if (!cand.length) return resp({ foto: null, motivo: 'sem_anuncio' })
      const lidos = new Map<string, { thumb: string; ativo: boolean }>()
      for (const c of contas) {
        if (!c.accessToken) continue
        const ids = cand.filter(x => x.conta === c.mlUserId).map(x => x.item).slice(0, 40)
        for (let i = 0; i < ids.length; i += 20) {
          const r = await mlGet(`https://api.mercadolibre.com/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,thumbnail,status`, c.accessToken, prazoMs)
          if (r.ok && Array.isArray(r.data)) for (const x of r.data) if (x.code === 200 && x.body?.thumbnail)
            lidos.set(x.body.id, { thumb: String(x.body.thumbnail).replace('http://', 'https://'), ativo: x.body.status === 'active' })
        }
      }
      if (!lidos.size) return resp({ foto: null, motivo: 'ml_sem_foto' })
      const agora = new Date().toISOString()
      await fetch(`${supaUrl}/rest/v1/vendas_fotos?on_conflict=usuario_id,item_id`, { method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([...lidos].map(([id, v]) => ({ usuario_id: userId, item_id: id, thumbnail: v.thumb, atualizado_em: agora }))) }).catch(() => null)
      const melhor = cand.filter(x => lidos.has(x.item)).sort((a, b) => a.pr - b.pr || Number(lidos.get(b.item)!.ativo) - Number(lidos.get(a.item)!.ativo))[0]
      return resp({ foto: lidos.get(melhor.item)!.thumb, item_id: melhor.item })
    }

    // Escopos do token de cada conta: vendas (pedidos) e comunicação (perguntas/mensagens)
    // botão "Atualizar fotos dos anúncios": relê no Mercado Livre a foto de capa dos anúncios já vendidos
    // (sem o botão, cada foto é relida sozinha a cada 7 dias, quando o anúncio vende de novo)
    if (body?.acao === 'fotos') {
      const tk = contas.find(c => c.accessToken)?.accessToken
      if (!tk) return resp({ error: 'Conta do Mercado Livre desconectada. Reconecte para atualizar as fotos.' })
      const linhas = await fetch(`${supaUrl}/rest/v1/vendas_fotos?usuario_id=eq.${userId}&select=item_id&order=atualizado_em.asc&limit=800`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
      const ids: string[] = (Array.isArray(linhas) ? linhas : []).map((l: any) => String(l.item_id))
      const lotes: string[][] = []; for (let i = 0; i < ids.length; i += 20) lotes.push(ids.slice(i, i + 20))
      const novas: any[] = [], agora = new Date().toISOString()
      await emParalelo(lotes, 4, async (lote) => {
        const r = await mlGet(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,thumbnail`, tk, prazoMs)
        if (!r.ok || !Array.isArray(r.data)) return
        for (const x of r.data) if (x.code === 200 && x.body?.thumbnail) novas.push({ usuario_id: userId, item_id: x.body.id, thumbnail: String(x.body.thumbnail).replace('http://', 'https://'), atualizado_em: agora })
      })
      for (let i = 0; i < novas.length; i += 400) await fetch(`${supaUrl}/rest/v1/vendas_fotos?on_conflict=usuario_id,item_id`, { method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(novas.slice(i, i + 400)) })
      return resp({ success: true, anuncios: ids.length, atualizados: novas.length })
    }

    // ── HISTÓRICO ANTIGO (reprocessamento) ─────────────────────────────────
    // { acao: 'hist_orcar' | 'hist_pedir', conta, meses }  → conta no ML os pedidos do período que falta e calcula o preço.
    // O pedido fica bloqueado até o administrador autorizar (admin_reprocesso_decidir).
    if (body?.acao === 'hist_orcar' || body?.acao === 'hist_pedir') {
      const c = contas.find(x => x.mlUserId === String(body?.conta || '')) || (contas.length === 1 ? contas[0] : null)
      if (!c) return resp({ error: 'Escolha a conta.' })
      if (!c.accessToken) return resp({ error: c.erro || 'Conta desconectada. Reconecte para pedir o histórico.' })
      const meses = Math.min(12, Math.max(1, Math.round(Number(body?.meses) || 0)))
      const inicioAtual = inicioDe(c), limite = diaBRT(-HISTORICO_DIAS)
      let desde = diaBRT(-Math.round(meses * 30.4))
      if (desde < limite) desde = limite
      const ate = somaDia(inicioAtual, -1)
      if (desde > ate) return resp({ error: 'A conta já tem o histórico deste período.', desde: inicioAtual })
      const r = await mlGet(`https://api.mercadolibre.com/orders/search?seller=${c.mlUserId}&order.date_created.from=${desde}T00:00:00.000-03:00&order.date_created.to=${ate}T23:59:59.999-03:00&limit=1`, c.accessToken, prazoMs)
      if (!r.ok) return resp({ error: 'O Mercado Livre não respondeu a contagem dos pedidos. Tente de novo em instantes.', detail: r.erro })
      const pedidos = Number(r.data?.paging?.total) || 0
      const valor = await fetch(`${supaUrl}/rest/v1/rpc/reprocesso_valor`, { method: 'POST', headers: ctx.dbH, body: JSON.stringify({ p_pedidos: pedidos }) }).then(x => x.json()).catch(() => null)
      if (body.acao === 'hist_orcar') return resp({ success: true, conta: c.mlUserId, desde, ate, pedidos, valor })
      const aberto = await fetch(`${supaUrl}/rest/v1/reprocessos?usuario_id=eq.${userId}&ml_user_id=eq.${c.mlUserId}&situacao=eq.pedido&select=id`, { headers: ctx.dbH }).then(x => x.json()).catch(() => [])
      if (Array.isArray(aberto) && aberto.length) return resp({ error: 'Já existe um pedido de histórico desta conta aguardando autorização.' })
      const g = await fetch(`${supaUrl}/rest/v1/reprocessos`, { method: 'POST', headers: { ...ctx.dbH, Prefer: 'return=representation' },
        body: JSON.stringify({ usuario_id: userId, ml_user_id: c.mlUserId, desde, ate, pedidos, valor: Number(valor) || 0 }) })
      if (!g.ok) return resp({ error: 'Não consegui gravar o pedido: ' + (await g.text()).slice(0, 160) })
      return resp({ success: true, pedido: (await g.json())[0] })
    }

    if (body?.checar === true) {
      const det = await Promise.all(contas.map(async (c) => {
        if (!c.accessToken) return { ml_user_id: c.mlUserId, apelido: c.apelido, tem_vendas: false, tem_comunicacao: false, erro: c.erro }
        const [v, q] = await Promise.all([
          mlGet(`https://api.mercadolibre.com/orders/search?seller=${c.mlUserId}&limit=1`, c.accessToken, prazoMs),
          mlGet(`https://api.mercadolibre.com/questions/search?seller_id=${c.mlUserId}&limit=1&api_version=4`, c.accessToken, prazoMs),
        ])
        return { ml_user_id: c.mlUserId, apelido: c.apelido, tem_vendas: v.ok, tem_comunicacao: q.ok, erro: v.erro || q.erro }
      }))
      return resp({ conectado: true, tem_vendas: det.every(d => d.tem_vendas), tem_comunicacao: det.every(d => d.tem_comunicacao), contas: det })
    }

    const reData = /^\d{4}-\d{2}-\d{2}$/
    const de = reData.test(body?.de || '') ? body.de : diaBRT()
    let ate = reData.test(body?.ate || '') ? body.ate : de
    if (ate < de) ate = de
    const res: any[] = await Promise.all(contas.map(async (c) => {
      // antes do início do histórico da conta não se busca (histórico antigo = reprocessamento autorizado pelo administrador)
      const deMin = inicioDe(c)
      if (ate < deMin) return { success: true, feitos: 0, vendas: 0, pendentes: 0, restantes: 0, em_cache: true, fora_do_historico: true }
      // com a tela aberta, hoje/ontem são conferidos de novo depois de 1 minuto
      const dias = await diasPendentes(ctx, userId, c.mlUserId, de < deMin ? deMin : de, ate, body?.forcar === true, 60 * 1000)
      if (dias.length === 0) return { success: true, feitos: 0, vendas: 0, pendentes: 0, restantes: 0, em_cache: true }
      return sincronizarLista(ctx, userId, c, dias, prazoMs)
    }))
    await carimbarCustos(ctx, userId)
    const ok = res.filter(r => r.success)
    if (ok.length === 0) return resp({ de, ate, ...res[0] })
    const soma = (k: string) => ok.reduce((t, r) => t + (Number(r[k]) || 0), 0)
    const avisos = [...res.map((r, i) => r.error ? `${contas[i].apelido || contas[i].mlUserId}: ${r.error}` : null), ...ok.map(r => r.aviso)].filter(Boolean)
    return resp({
      success: true, de, ate, feitos: soma('feitos'), vendas: soma('vendas'), pendentes: soma('pendentes'), restantes: soma('restantes'),
      em_cache: ok.every(r => r.em_cache), sem_permissao: res.some(r => r.sem_permissao) || undefined, aviso: avisos.join(' · ') || null
    })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
