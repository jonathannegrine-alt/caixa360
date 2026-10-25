// ml-envios — situação do envio das vendas que saem do GALPÃO (tudo que não é Full).
// O estoque físico do galpão só baixa quando o Mercado Livre marca o pedido como enviado (como faz a UpSeller);
// até lá a venda fica "ocupando" o estoque. Esta função consulta GET /shipments/{id} das vendas recentes ainda
// não enviadas e grava vendas_ml.envio_status e vendas_ml.enviado_em.
//
//   usuário logado: {}                    confere as vendas dele
//   cron:           { cron: true, secret } confere as de todos (a cada 15 min)
import { unzipSync, gzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2'

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

const endDe = (s: any) => s?.destination?.shipping_address || s?.receiver_address || {}
const cidadeDe = (s: any): string | null => { const c = String(endDe(s)?.city?.name || '').trim(); return c || null }
const cepDe = (s: any): string | null => { const c = String(endDe(s)?.zip_code || '').replace(/\D/g, ''); return c || null }
// nome do comprador: o pedido (/orders) deixou de trazer first_name/last_name; o envio traz o nome do destinatário.
// Serve para buscar a venda pelo nome (Vendas e Pedidos). Só preenche onde está vazio.
const nomeDe = (s: any): string | null => { const n = String(s?.destination?.receiver_name || s?.receiver_address?.receiver_name || endDe(s)?.receiver_name || '').replace(/\s+/g, ' ').trim(); return n || null }
const MAX_NOME = 300      // vendas antigas sem nome preenchidas por conta, por chamada (no cron, só depois dos envios de todos)

// Guarda uma cópia da etiqueta no depósito "etiquetas": o ML só a entrega enquanto o pacote não saiu.
// Desde 16/10/2026 guarda o código da impressora térmica (ZPL) compactado, <envio>.zpl.gz (~1,3 KB contra ~40 KB do
// PDF); a tela reconstrói a imagem. O ML manda o ZPL num ZIP ("Etiqueta de envio.txt" + "Controle.pdf"; a folha de
// controle a tela monta com os dados da venda). Se o ZPL não vier, guarda o PDF como antes.
async function guardarEtiqueta(supaUrl: string, dbH: Record<string, string>, userId: string, sid: string, tk: string): Promise<boolean> {
  const z = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=zpl2`, { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null)
  if (z && z.ok) {
    try {
      const zb = new Uint8Array(await z.arrayBuffer())
      let zpl = ''
      if (zb[0] === 0x50 && zb[1] === 0x4b) { const arq = unzipSync(zb); const nome = Object.keys(arq).find(n => /.txt$/i.test(n)); zpl = nome ? strFromU8(arq[nome]) : '' }
      else zpl = strFromU8(zb)
      if (zpl.includes('^XA')) {
        const up = await fetch(`${supaUrl}/storage/v1/object/etiquetas/${userId}/${sid}.zpl.gz`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gzipSync(new TextEncoder().encode(zpl)) }).catch(() => null)
        if (up && up.ok) return true
      }
    } catch (_) { /* cai para o PDF */ }
  }
  const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=pdf`, { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null)
  if (!r || !r.ok || !(r.headers.get('content-type') || '').includes('pdf')) return false
  const up = await fetch(`${supaUrl}/storage/v1/object/etiquetas/${userId}/${sid}.pdf`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: await r.arrayBuffer() }).catch(() => null)
  return !!(up && up.ok)
}

// Apaga as cópias com mais de 12 meses (um lote por chamada).
async function limparEtiquetas(supaUrl: string, dbH: Record<string, string>) {
  const corte = new Date(Date.now() - 366 * 86400000).toISOString()
  const velhas = await fetch(`${supaUrl}/rest/v1/vendas_ml?etiqueta_em=lt.${corte}&select=usuario_id,shipping_id&limit=200`, { headers: dbH }).then(r => r.json()).catch(() => [])
  const lista = Array.isArray(velhas) ? velhas : []
  if (!lista.length) return 0
  const prefixes = [...new Set(lista.flatMap((v: any) => [`${v.usuario_id}/${v.shipping_id}.pdf`, `${v.usuario_id}/${v.shipping_id}.zpl.gz`]))]
  await fetch(`${supaUrl}/storage/v1/object/etiquetas`, { method: 'DELETE', headers: { ...dbH, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes }) }).catch(() => null)
  for (const v of lista) await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${v.usuario_id}&shipping_id=eq.${v.shipping_id}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ etiqueta_em: null }) }).catch(() => null)
  return prefixes.length
}

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

async function conferir(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string, comNomes = true) {
  const desde = new Date(Date.now() - DIAS * 86400000).toISOString()
  let conferidos = 0, enviados = 0, etiquetas = 0
  for (const t of await tokens(supaUrl, dbH, userId, clientId, secret)) {
    // vendas do galpão ainda sem envio registrado (canceladas ficam de fora). Mais antigas primeiro: com mais de
    // MAX_ENVIOS pendentes, as antigas ficavam dias sem conferir (venda de 29/09 despachada em 01/10 só baixou em 15/10)
    const vendas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}&data_venda=gte.${desde}&enviado_em=is.null&shipping_id=not.is.null&status=neq.cancelled&or=(logistic_type.is.null,logistic_type.neq.fulfillment)&select=shipping_id,etiqueta_em,comprador_nome&order=data_venda.asc&limit=3000`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const ids = [...new Set((Array.isArray(vendas) ? vendas : []).map((v: any) => String(v.shipping_id)))].slice(0, MAX_ENVIOS)
    const semNome = new Set((Array.isArray(vendas) ? vendas : []).filter((v: any) => !v.comprador_nome).map((v: any) => String(v.shipping_id)))
    const comEtiqueta = new Set((Array.isArray(vendas) ? vendas : []).filter((v: any) => v.etiqueta_em).map((v: any) => String(v.shipping_id)))
    await emLotes(ids, 6, async sid => {
      const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: { Authorization: `Bearer ${t.access_token}`, 'x-format-new': 'true' } }).catch(() => null)
      if (!r || !r.ok) return
      const s = await r.json().catch(() => null); if (!s) return
      conferidos++
      const status = String(s.status || '')
      const hist = s.status_history || s.date_history || {}
      // enviado = saiu do vendedor (shipped / delivered / not_delivered) — a data vem do histórico
      let saiu = ['shipped', 'delivered', 'not_delivered'].includes(status) || !!hist.date_shipped
      let quando = hist.date_shipped || hist.date_delivered || (saiu ? (s.last_updated || new Date().toISOString()) : null)
      // coleta/agência: o pacote já saiu do vendedor quando foi coletado ou deixado no ML, mesmo com o status ainda
      // "ready_to_ship" (substatus picked_up / dropped_off / in_hub). A hora vem do histórico do envio.
      const SUB_SAIU = ['picked_up', 'dropped_off', 'in_hub']
      if (!saiu && status === 'ready_to_ship' && SUB_SAIU.includes(String(s.substatus || ''))) {
        const h = await fetch(`https://api.mercadolibre.com/shipments/${sid}/history`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.ok ? r.json() : null).catch(() => null)
        const ev = (Array.isArray(h) ? h : []).filter((e: any) => SUB_SAIU.includes(String(e?.substatus || '')) && e?.date).sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))[0]
        saiu = true
        quando = ev?.date || s.last_updated || new Date().toISOString()
      }
      const campos: Record<string, unknown> = { envio_status: status || null, envio_substatus: s.substatus ? String(s.substatus) : null }
      // prazo para o pacote sair (tela de Pedidos: atrasados e que vencem hoje)
      // o prazo de despacho vem do SLA do envio (expected_date); o lead_time fica de reserva
      let limite = s.lead_time?.estimated_schedule_limit?.date || s.lead_time?.estimated_handling_limit?.date || null
      if (!saiu && status !== 'cancelled') {
        const sla = await fetch(`https://api.mercadolibre.com/shipments/${sid}/sla`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.ok ? r.json() : null).catch(() => null)
        if (sla?.expected_date) limite = sla.expected_date
      }
      if (limite) campos.envio_limite = limite
      if (saiu && quando) { campos.enviado_em = quando; enviados++ }
      if (s.logistic?.type) campos.logistic_type = s.logistic.type
      const uf = ufDe(s); if (uf) campos.uf = uf
      const cid = cidadeDe(s); if (cid) campos.cidade = cid
      const cep = cepDe(s); if (cep) campos.cep = cep
      if (s.tracking_number) campos.rastreio = String(s.tracking_number)
      const nm = nomeDe(s); if (nm && semNome.has(sid)) campos.comprador_nome = nm
      // etiqueta JÁ IMPRESSA e ainda sem cópia: guarda agora (depois que o pacote sai o ML não entrega mais).
      // Nunca baixar antes da 1ª impressão: o ML marca "impressa" a quem baixa e a UpSeller pula a venda para "Retirar"
      // sem ninguém ter impresso (caso de 24/10/2026, 5 coletas perdidas). A operação do galpão não pode mudar por leitura nossa.
      const jaImpressa = !!(s.date_first_printed || hist.date_first_printed) || String(s.substatus || '') === 'printed'
      if (status === 'ready_to_ship' && jaImpressa && !comEtiqueta.has(sid) && await guardarEtiqueta(supaUrl, dbH, userId, sid, t.access_token)) { campos.etiqueta_em = new Date().toISOString(); etiquetas++ }
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(campos) })
    })
  }
  return { conferidos, enviados, etiquetas, estados: await estados(supaUrl, dbH, userId, clientId, secret), nomes: comNomes ? await nomes(supaUrl, dbH, userId, clientId, secret) : 0 }
}

// Estado (UF) de entrega de cada venda, para a análise por estado. Mais novas primeiro; o histórico é preenchido aos poucos.
async function estados(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string) {
  let feitos = 0
  for (const t of await tokens(supaUrl, dbH, userId, clientId, secret)) {
    const vendas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}&cidade=is.null&shipping_id=not.is.null&select=shipping_id&order=data_venda.desc&limit=${MAX_UF * 2}`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const ids = [...new Set((Array.isArray(vendas) ? vendas : []).map((v: any) => String(v.shipping_id)))].slice(0, MAX_UF)
    await emLotes(ids, 8, async sid => {
      const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: { Authorization: `Bearer ${t.access_token}`, 'x-format-new': 'true' } }).catch(() => null)
      if (!r) return
      // envio que o ML não entrega mais (404/403) fica marcado para não ser tentado de novo
      const s = r.ok ? await r.json().catch(() => null) : null
      const uf = s ? (ufDe(s) || '--') : (r.status === 404 || r.status === 403 ? '--' : null)
      if (!uf) return
      feitos++
      const campos: Record<string, unknown> = { uf, cidade: (s && cidadeDe(s)) || '--' }
      const cep = s && cepDe(s); if (cep) campos.cep = cep
      const nm = s && nomeDe(s); if (nm) campos.comprador_nome = nm
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(campos) })
    })
  }
  return feitos
}

// Nome do comprador das vendas que já tinham estado/cidade (histórico): mais novas primeiro, aos poucos.
// Envio que o ML não entrega mais (404/403) ou sem nome fica com '' para não ser tentado de novo.
async function nomes(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string) {
  let feitos = 0
  for (const t of await tokens(supaUrl, dbH, userId, clientId, secret)) {
    const vendas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}&comprador_nome=is.null&cidade=not.is.null&shipping_id=not.is.null&select=shipping_id&order=data_venda.desc&limit=${MAX_NOME * 2}`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const ids = [...new Set((Array.isArray(vendas) ? vendas : []).map((v: any) => String(v.shipping_id)))].slice(0, MAX_NOME)
    await emLotes(ids, 8, async sid => {
      const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: { Authorization: `Bearer ${t.access_token}`, 'x-format-new': 'true' } }).catch(() => null)
      if (!r) return
      const s = r.ok ? await r.json().catch(() => null) : null
      if (!s && r.status !== 404 && r.status !== 403) return
      feitos++
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}&comprador_nome=is.null`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ comprador_nome: (s && nomeDe(s)) || '' }) })
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

// Conferência da fatura do Flex: o que aconteceu com cada envio (situação, histórico, motivo do cancelamento, reclamação).
// Só leitura. envios: [{ envio, pedido, conta }] (até 60 por chamada).
async function conferirFatura(supaUrl: string, dbH: Record<string, string>, userId: string, clientId: string, secret: string, envios: any[]) {
  const tks = await tokens(supaUrl, dbH, userId, clientId, secret)
  const g = async (url: string, tk: string, extra: Record<string, string> = {}) => {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, ...extra } }).catch(() => null)
    return r && r.ok ? await r.json().catch(() => null) : null
  }
  const ML = 'https://api.mercadolibre.com'
  const motivos = new Map<string, string>()
  const out = await emLotes((envios || []).slice(0, 60), 6, async (x: any) => {
    const t: any = tks.find((k: any) => String(k.ml_user_id) === String(x.conta)) || tks[0]
    if (!t) return { envio: x.envio, erro: 'conta não conectada' }
    const [s, h, o] = await Promise.all([
      g(ML + '/shipments/' + x.envio, t.access_token, { 'x-format-new': 'true' }),
      g(ML + '/shipments/' + x.envio + '/history', t.access_token, { 'x-format-new': 'true' }),
      x.pedido ? g(ML + '/orders/' + x.pedido, t.access_token) : Promise.resolve(null),
    ])
    const res: any = { envio: x.envio, status: s?.status || null, substatus: s?.substatus || null,
      hist: Array.isArray(h) ? h.map((i: any) => ({ s: i.status, ss: i.substatus || null, d: i.date })) : [] }
    if (o) {
      const cd = o.cancel_detail || {}
      res.pedido = { status: o.status, grupo: cd.group || null, codigo: cd.code || null, por: cd.requested_by || null, quando: cd.date || null,
        tags: o.tags || [], reembolsado: (o.payments || []).reduce((n: number, p: any) => n + (Number(p.transaction_amount_refunded) || 0), 0) }
      const med = (o.mediations || [])[0]?.id
      if (med) {
        const c = await g(ML + '/post-purchase/v1/claims/' + med, t.access_token)
        if (c) {
          res.reclamacao = { id: med, tipo: c.type, motivo: c.reason_id || null, resolucao: c.resolution?.reason || null, quando: c.date_created || null, status: c.status }
          if (c.reason_id) {
            if (!motivos.has(c.reason_id)) { const m = await g(ML + '/post-purchase/v1/claims/reasons/' + c.reason_id, t.access_token); motivos.set(c.reason_id, m?.detail || m?.name || '') }
            res.reclamacao.motivo_nome = motivos.get(c.reason_id) || ''
          }
        }
      }
    }
    return res
  })
  return { envios: out }
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
      for (const u of ids) res.push({ usuario: u, ...(await conferir(supaUrl, dbH, String(u), clientId, secret, false)) })
      // nomes do histórico por último: se a rodada passar do tempo, os envios de todos já foram atualizados
      for (const r of res) r.nomes = await nomes(supaUrl, dbH, String(r.usuario), clientId, secret).catch(() => 0)
      const limpas = await limparEtiquetas(supaUrl, dbH).catch(() => 0)
      return resp({ ok: true, usuarios: res.length, conferidos: res.reduce((s, r) => s + r.conferidos, 0), enviados: res.reduce((s, r) => s + r.enviados, 0), etiquetas: res.reduce((s, r) => s + (r.etiquetas || 0), 0), etiquetas_apagadas: limpas, estados: res.reduce((s, r) => s + (r.estados || 0), 0), nomes: res.reduce((s, r) => s + (r.nomes || 0), 0) })
    }

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()
    if (body?.acao === 'conferir') return resp({ ok: true, ...(await conferirFatura(supaUrl, dbH, userId, clientId, secret, body.envios || [])) })
    if (body?.acao === 'flex') return resp({ ok: true, ...(await flex(supaUrl, dbH, userId, clientId, secret)) })
    return resp({ ok: true, ...(await conferir(supaUrl, dbH, userId, clientId, secret)) })
  } catch (err) {
    console.error('ml-envios error:', err)
    return resp({ error: String(err) }, 500)
  }
})
