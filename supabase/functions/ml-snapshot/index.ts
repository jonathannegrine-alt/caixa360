const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const resp = (body: object) => new Response(JSON.stringify(body), { headers: CORS })

// Calcula data em BRT (UTC-3)
function dataBRT(offsetDias = 0): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000 + offsetDias * 86400000)
    .toISOString().substring(0, 10)
}

async function getTokenML(supaUrl: string, supaKey: string, clientId: string, secret: string, userId: string) {
  const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=access_token,refresh_token,expires_at,ml_user_id`, {
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' }
  }).then(r => r.json())
  const token = Array.isArray(rows) ? rows[0] : null
  if (!token) return null

  // Renovar se expirado
  if (new Date(token.expires_at) <= new Date()) {
    const ref = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: token.refresh_token })
    }).then(r => r.json())
    if (ref.error) return null
    token.access_token = ref.access_token
    await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + ref.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
    })
  }
  return token
}

async function fetchML(url: string, accessToken: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  return r.json()
}

// Busca todos os resultados paginados da API ML
async function fetchAllML(baseUrl: string, accessToken: string, maxOffset = 10000) {
  const seen = new Set<number>()
  const all: any[] = []
  let offset = 0
  while (offset < maxOffset) {
    const data = await fetchML(`${baseUrl}&limit=200&offset=${offset}`, accessToken)
    if (data.error || !data.results?.length) break
    for (const x of data.results) {
      const item = x.collection || x
      if (item.id && seen.has(item.id)) continue
      if (item.id) seen.add(item.id)
      all.push(item)
    }
    offset += 200
    if (offset >= (data.paging?.total ?? 0)) break
  }
  return all
}

async function processarUsuario(userId: string, supaUrl: string, supaKey: string, clientId: string, secret: string, origem: string) {
  const token = await getTokenML(supaUrl, supaKey, clientId, secret, userId)
  if (!token) return { usuario_id: userId, erro: 'sem token ML' }

  const hoje = dataBRT()
  const amanha = dataBRT(1)
  const noventaDiasAtras = dataBRT(-90)
  const anoFim = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCFullYear()
  const horaBRT = new Date(Date.now() - 3 * 60 * 60 * 1000).toTimeString().substring(0, 8)

  // ─── 1. EXTRATO HISTÓRICO (released=yes, últimos 90 dias) ────────────────
  const urlExtrato = `https://api.mercadolibre.com/collections/search?status=approved&released=yes&sort=money_release_date&criteria=desc&range=money_release_date&begin_date=${noventaDiasAtras}T00:00:00.000-03:00&end_date=${hoje}T23:59:59.000-03:00`
  const itemsExtrato = await fetchAllML(urlExtrato, token.access_token, 20000)

  // Agrupar por data
  const byDataExtrato: Record<string, { val: number; qtd: number }> = {}
  for (const item of itemsExtrato) {
    const data = (item.money_release_date || '').substring(0, 10)
    if (!data || data < noventaDiasAtras || data > hoje) continue
    if (!byDataExtrato[data]) byDataExtrato[data] = { val: 0, qtd: 0 }
    byDataExtrato[data].val += item.net_received_amount || 0
    byDataExtrato[data].qtd += 1
  }

  // Upsert no extrato_historico
  const extratoRows = Object.entries(byDataExtrato).map(([data, { val, qtd }]) => ({
    usuario_id: userId,
    data,
    val_liquido: Math.round(val * 100) / 100,
    qtd_pedidos: qtd
  }))
  if (extratoRows.length > 0) {
    await fetch(`${supaUrl}/rest/v1/extrato_historico`, {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(extratoRows)
    })
  }

  // ─── 2. SNAPSHOT DO PIPELINE ATUAL (released=no, datas futuras) ──────────
  const urlFuturo = `https://api.mercadolibre.com/collections/search?status=approved&released=no&sort=money_release_date&criteria=asc&range=money_release_date&begin_date=${amanha}T00:00:00.000-03:00&end_date=${anoFim}-12-31T23:59:59.000-03:00`
  const itemsFuturo = await fetchAllML(urlFuturo, token.access_token)

  // Agrupar por data de recebimento
  const byDataFuturo: Record<string, { val: number; qtd: number }> = {}
  for (const item of itemsFuturo) {
    const data = (item.money_release_date || '').substring(0, 10)
    if (!data || data < amanha) continue
    if (!byDataFuturo[data]) byDataFuturo[data] = { val: 0, qtd: 0 }
    byDataFuturo[data].val += item.net_received_amount || 0
    byDataFuturo[data].qtd += 1
  }

  // Inserir snapshot (nunca sobrescreve — cada captura é um registro histórico)
  const snapshotRows = Object.entries(byDataFuturo).map(([dataRecebimento, { val, qtd }]) => {
    const diasAte = Math.round((new Date(dataRecebimento).getTime() - new Date(hoje).getTime()) / 86400000)
    return {
      usuario_id: userId,
      data_captura: hoje,
      hora_captura: horaBRT,
      origem,
      data_recebimento: dataRecebimento,
      dias_ate_recebimento: diasAte,
      val: Math.round(val * 100) / 100,
      qtd: qtd
    }
  })

  // Deletar snapshots do dia atual deste usuário (se cron rodou duas vezes ou reconexão)
  // Mantém apenas o mais recente do dia
  await fetch(`${supaUrl}/rest/v1/snapshots_ml?usuario_id=eq.${userId}&data_captura=eq.${hoje}&origem=eq.${origem}`, {
    method: 'DELETE',
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
  })

  if (snapshotRows.length > 0) {
    await fetch(`${supaUrl}/rest/v1/snapshots_ml`, {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(snapshotRows)
    })
  }

  return {
    usuario_id: userId,
    extrato_dias: extratoRows.length,
    snapshot_datas: snapshotRows.length,
    ok: true
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl  = Deno.env.get('SUPABASE_URL')!
    const supaKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!
    const secret   = Deno.env.get('ML_CLIENT_SECRET')!

    const body = await req.json().catch(() => ({}))
    const isCron = body?.cron === true

    if (isCron) {
      // ── MODO CRON: processa todos os usuários com token ML ────────────────
      const tokens = await fetch(`${supaUrl}/rest/v1/ml_tokens?select=usuario_id`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' }
      }).then(r => r.json())

      const userIds: string[] = Array.isArray(tokens) ? tokens.map((t: any) => t.usuario_id) : []
      const resultados = []
      for (const userId of userIds) {
        const r = await processarUsuario(userId, supaUrl, supaKey, clientId, secret, 'cron')
        resultados.push(r)
      }
      return resp({ success: true, usuarios: userIds.length, resultados })

    } else {
      // ── MODO MANUAL: processa apenas o usuário autenticado ────────────────
      const authHeader = req.headers.get('Authorization') || ''
      const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
        headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: authHeader }
      })
      if (!jwtRes.ok) return resp({ error: 'Não autenticado' })
      const { id: userId } = await jwtRes.json()

      const resultado = await processarUsuario(userId, supaUrl, supaKey, clientId, secret, 'manual')
      return resp({ success: true, ...resultado })
    }

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
