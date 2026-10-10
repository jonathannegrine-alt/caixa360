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
type Conta = { mlUserId: string; apelido: string | null; accessToken: string | null; erro: string | null }
async function contasDe(ctx: Ctx, userId: string, contaFiltro?: string): Promise<Conta[]> {
  const rows = await fetch(`${ctx.supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}${contaFiltro ? '&ml_user_id=eq.' + contaFiltro : ''}&order=updated_at.asc`, { headers: ctx.dbH })
    .then(r => r.json()).catch(() => [])
  if (!Array.isArray(rows)) return []
  return Promise.all(rows.map(async (row: any): Promise<Conta> => {
    const base = { mlUserId: String(row.ml_user_id), apelido: row.apelido || null }
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
    `${ctx.supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&data_venda=gte.${dia}T00:00:00-03:00&data_venda=lte.${dia}T23:59:59.999-03:00&select=order_id,shipping_id,logistic_type,frete_vendedor,frete_comprador,item_id,thumbnail,sku,sku_fixo&limit=10000`,
    { headers: ctx.dbH }
  ).then(r => r.json()).catch(() => [])
  if (Array.isArray(existentes)) for (const e of existentes) {
    jaTem.set(Number(e.order_id), e)
    if (e.item_id && e.thumbnail) thumbs.set(e.item_id, e.thumbnail)
  }

  // 3. frete — vendas do mesmo carrinho dividem o envio (custo rateado igualmente)
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
      mlGet(`https://api.mercadolibre.com/shipments/${sid}`, accessToken, prazoMs, { 'x-format-new': 'true' }),
      mlGet(`https://api.mercadolibre.com/shipments/${sid}/costs`, accessToken, prazoMs),
    ])
    if (!s.ok || !c.ok) return
    const vendedor = (c.data.senders || []).reduce((t: number, x: any) => t + (Number(x.cost) || 0), 0)
    fretes.set(sid, { logistic: s.data.logistic?.type || s.data.logistic_type || null, vendedor, comprador: Number(c.data.receiver?.cost) || 0 })
  })

  // 4. fotos dos anúncios
  const semFoto = [...new Set([...pedidos.values()].map(o => o.order_items?.[0]?.item?.id).filter((id: string) => id && !thumbs.has(id)))]
  const lotes: string[][] = []
  for (let i = 0; i < semFoto.length; i += 20) lotes.push(semFoto.slice(i, i + 20))
  await emParalelo(lotes, 4, async (lote) => {
    const r = await mlGet(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,thumbnail`, accessToken, prazoMs)
    if (!r.ok || !Array.isArray(r.data)) return
    for (const x of r.data) if (x.code === 200 && x.body?.thumbnail) thumbs.set(x.body.id, String(x.body.thumbnail).replace('http://', 'https://'))
  })

  // 5. gravar
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
      sku: ant?.sku_fixo ? ant.sku : (it.seller_sku || it.seller_custom_field || null),   // SKU nivelado à mão não é trocado
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
    const up = await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml?on_conflict=usuario_id,order_id`, {
      method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500))
    })
    if (!up.ok) return { ok: false, vendas: 0, pendentes: 0, semPermissao: false, erro: 'gravação: ' + (await up.text()).slice(0, 200) }
  }
  await fetch(`${ctx.supaUrl}/rest/v1/vendas_ml_dias?on_conflict=usuario_id,ml_user_id,dia`, {
    method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ usuario_id: userId, ml_user_id: String(mlUserId), dia, vendas: rows.length, completo: pendentes === 0, sincronizado_em: new Date().toISOString() })
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
      const pares: { u: string; c: string }[] = (Array.isArray(tokens) ? tokens.map((t: any) => ({ u: t.usuario_id, c: String(t.ml_user_id) })) : [])
        .filter(x => !soConta || x.c === soConta)
      const resultados = await Promise.all(pares.map(async ({ u, c }) => {
        try {
          const conta = (await contasDe(ctx, u, c))[0]
          if (!conta) return { usuario_id: u, ml_user_id: c, error: 'conta não encontrada' }
          // hoje/ontem (se o cache venceu) + o próximo trecho do histórico ainda não importado
          const recentes = await diasPendentes(ctx, u, c, diaBRT(-1), diaBRT(), false, soRecentes ? 20 * 1000 : 10 * 60 * 1000)
          const antigos = soRecentes ? [] : await diasPendentes(ctx, u, c, diaBRT(-HISTORICO_DIAS), diaBRT(-2), false)
          const r = await sincronizarLista(ctx, u, conta, [...recentes, ...antigos], prazoMs)
          return { usuario_id: u, ml_user_id: c, ...r }
        } catch (e) {
          return { usuario_id: u, ml_user_id: c, error: String(e) }
        }
      }))
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

    // Escopos do token de cada conta: vendas (pedidos) e comunicação (perguntas/mensagens)
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
    const deMin = diaBRT(-HISTORICO_DIAS)
    const res: any[] = await Promise.all(contas.map(async (c) => {
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
