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

async function getTokenML(supaUrl: string, supaKey: string, clientId: string, secret: string, userId: string, conta: string) {
  const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&select=access_token,refresh_token,expires_at,ml_user_id`, {
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
    if (ref.error || !ref.access_token) return null
    token.access_token = ref.access_token
    await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}`, {
      method: 'PATCH',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + (Number(ref.expires_in) || 21600) * 1000).toISOString(), updated_at: new Date().toISOString() })
    })
  }
  return token
}

async function fetchML(url: string, accessToken: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  return r.json()
}

// Limite de tempo das buscas no ML — a Edge Function é encerrada aos ~150s
let prazoMs = Infinity

// Busca todos os resultados paginados da API ML
async function fetchAllML(baseUrl: string, accessToken: string, maxOffset = 10000) {
  const seen = new Set<number>()
  const all: any[] = []
  let offset = 0
  while (offset < maxOffset) {
    // Cada página é tentada até 4x (429/5xx/erro transitório). Se falhar de vez, retorna
    // completo=false — quem chama NÃO deve gravar dado parcial por cima do bom.
    let data: any = null
    let falha = ''
    for (let tent = 0; tent < 4; tent++) {
      if (Date.now() > prazoMs) { falha = falha || 'tempo esgotado'; break }
      if (tent > 0) await new Promise(res => setTimeout(res, 700 * tent * tent))
      try {
        const r = await fetch(`${baseUrl}&limit=${tent < 2 ? 200 : 50}&offset=${offset}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) })
        const d = await r.json().catch(() => null)
        if (r.ok && d && !d.error && Array.isArray(d.results)) { data = d; break }
        falha = `http ${r.status} — ${d?.message || d?.error || 'resposta inválida'}`
      } catch (e) {
        falha = String(e)
      }
    }
    if (!data) return { items: all, completo: false, erro: `offset ${offset}: ${falha}` }
    if (data.results.length === 0) break
    for (const x of data.results) {
      const item = x.collection || x
      if (item.id && seen.has(item.id)) continue
      if (item.id) seen.add(item.id)
      all.push(item)
    }
    offset += data.results.length
    const total = data.paging?.total
    if (typeof total === 'number' && offset >= total) break
  }
  return { items: all, completo: true, erro: null as string | null }
}

// Só vendas (regular_payment). O ML mistura na mesma busca transferências internas do
// Mercado Pago — partition_transfer (reserva/cofrinho), operation_fund (aporte) e
// money_transfer — que não são recebimento de venda e inflavam os totais do dia.
const ehVenda = (item: any) => item.operation_type === 'regular_payment'

// Dia (YYYY-MM-DD) em BRT de um timestamp ISO, independente do offset que o ML devolver
function diaBRT(dt: string): string {
  const t = new Date(dt).getTime()
  return isNaN(t) ? '' : new Date(t - 3 * 60 * 60 * 1000).toISOString().substring(0, 10)
}

// Busca por janelas de data (normalmente 1 dia cada) em paralelo. O ML devolve
// http 500 search_batch_fetch_error em offsets profundos; com janelas curtas cada
// consulta fica em 1-2 páginas.
async function fetchJanelas(baseUrl: string, accessToken: string, janelas: { de: string; ate: string }[], conc = 4) {
  const out: { de: string; ate: string; items: any[]; completo: boolean; erro: string | null }[] = new Array(janelas.length)
  let prox = 0
  const worker = async () => {
    while (prox < janelas.length) {
      const i = prox++
      const j = janelas[i]
      const r = await fetchAllML(`${baseUrl}&begin_date=${j.de}T00:00:00.000-03:00&end_date=${j.ate}T23:59:59.999-03:00`, accessToken)
      out[i] = { ...j, ...r }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, janelas.length) }, worker))
  // Segunda passada: o erro 500 do ML costuma sumir depois de alguns segundos
  for (let i = 0; i < out.length; i++) {
    if (out[i].completo || Date.now() > prazoMs) continue
    const j = janelas[i]
    const r = await fetchAllML(`${baseUrl}&begin_date=${j.de}T00:00:00.000-03:00&end_date=${j.ate}T23:59:59.999-03:00`, accessToken)
    out[i] = { ...j, ...r }
  }
  return out
}

async function processarUsuario(userId: string, supaUrl: string, supaKey: string, clientId: string, secret: string, origem: string, refazer: { de: string; ate: string } | undefined, conta: string) {
  const token = await getTokenML(supaUrl, supaKey, clientId, secret, userId, conta)
  if (!token) return { usuario_id: userId, ml_user_id: conta, erro: 'sem token ML' }

  // Extrato pode ser refeito depois; o snapshot do dia não — por isso o extrato
  // tem orçamento próprio e sempre sobra tempo para o pipeline
  prazoMs = Date.now() + 55000
  const hoje = dataBRT()
  const amanha = dataBRT(1)
  const noventaDiasAtras = dataBRT(-90)
  const horaBRT = new Date(Date.now() - 3 * 60 * 60 * 1000).toTimeString().substring(0, 8)

  // ─── 1. EXTRATO HISTÓRICO (released=yes, últimos 90 dias) ────────────────
  // Uma consulta por dia. Rebusca sempre os últimos 10 dias e, dos mais antigos,
  // só os dias que ainda não estão gravados (dia já creditado não muda mais).
  const jaTem = await fetch(`${supaUrl}/rest/v1/extrato_historico?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&data=gte.${noventaDiasAtras}&select=data,so_vendas`, {
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' }
  }).then(r => r.json()).catch(() => [])
  const diasGravados = new Set<string>(Array.isArray(jaTem) ? jaTem.map((r: any) => String(r.data).substring(0, 10)) : [])
  // Dias antigos gravados antes do filtro "só vendas": o cron refaz alguns por execução (mais recentes primeiro)
  const diasARefazer = new Set<string>((Array.isArray(jaTem) ? jaTem : [])
    .filter((r: any) => r.so_vendas === false).map((r: any) => String(r.data).substring(0, 10))
    .sort().reverse().slice(0, 15))
  const dezDiasAtras = dataBRT(-10)
  const janelasExtrato: { de: string; ate: string }[] = []
  for (let i = -90; i <= 0; i++) {
    const d = dataBRT(i)
    const forcado = !!refazer && d >= refazer.de && d <= refazer.ate
    // No modo refazer só os dias pedidos são buscados (poupa o limite de chamadas do ML)
    if (refazer ? forcado : (d >= dezDiasAtras || !diasGravados.has(d) || diasARefazer.has(d))) janelasExtrato.push({ de: d, ate: d })
  }
  const resExtrato = await fetchJanelas(
    'https://api.mercadolibre.com/collections/search?status=approved&released=yes&sort=money_release_date&criteria=desc&range=money_release_date',
    token.access_token, janelasExtrato
  )
  const falhasExtrato = resExtrato.filter(j => !j.completo)
  const diasFalhosExtrato = new Set(falhasExtrato.map(j => j.de))

  // Agrupar por data — dia que o ML não devolveu não é gravado (o upsert
  // sobrescreveria um dia bom com soma parcial)
  const byDataExtrato: Record<string, { val: number; qtd: number }> = {}
  const seenExtrato = new Set<number>()
  for (const j of resExtrato) {
    if (!j.completo) continue
    for (const item of j.items) {
      if (item.id && seenExtrato.has(item.id)) continue
      if (item.id) seenExtrato.add(item.id)
      if (!ehVenda(item)) continue
      const data = diaBRT(item.money_release_date || '')
      if (!data || data < noventaDiasAtras || data > hoje || diasFalhosExtrato.has(data)) continue
      if (!byDataExtrato[data]) byDataExtrato[data] = { val: 0, qtd: 0 }
      byDataExtrato[data].val += item.net_received_amount || 0
      byDataExtrato[data].qtd += 1
    }
  }
  let extratoErro: string | null = falhasExtrato.length
    ? `${falhasExtrato.length} dia(s) sem resposta do ML (${falhasExtrato[0].erro})` : null

  // Upsert no extrato_historico
  const extratoRows = Object.entries(byDataExtrato).map(([data, { val, qtd }]) => ({
    usuario_id: userId,
    ml_user_id: conta,
    data,
    val_liquido: Math.round(val * 100) / 100,
    qtd_pedidos: qtd,
    so_vendas: true
  }))
  if (extratoRows.length > 0) {
    const upRes = await fetch(`${supaUrl}/rest/v1/extrato_historico?on_conflict=usuario_id,ml_user_id,data`, {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(extratoRows)
    })
    if (!upRes.ok) extratoErro = `gravação do extrato falhou: http ${upRes.status} — ${(await upRes.text()).slice(0, 300)}`
  }

  // Modo refazer: só o extrato, sem tocar no snapshot do dia
  if (refazer) {
    return { usuario_id: userId, ml_user_id: conta, extrato_dias: extratoRows.length, snapshot_datas: null, snapshot_erro: null, extrato_erro: extratoErro, ok: extratoErro === null }
  }

  // ─── 2. SNAPSHOT DO PIPELINE ATUAL (released=no, datas futuras) ──────────
  prazoMs = Date.now() + 55000
  // Uma janela por dia nos próximos 45 dias + uma janela de cauda até D+120
  const janelasFuturo: { de: string; ate: string }[] = []
  for (let i = 1; i <= 45; i++) janelasFuturo.push({ de: dataBRT(i), ate: dataBRT(i) })
  janelasFuturo.push({ de: dataBRT(46), ate: dataBRT(120) })
  const resFuturo = await fetchJanelas(
    'https://api.mercadolibre.com/collections/search?status=approved&released=no&sort=money_release_date&criteria=asc&range=money_release_date',
    token.access_token, janelasFuturo
  )
  const falhasFuturo = resFuturo.filter(j => !j.completo)
  if (falhasFuturo.length > 0) {
    // Pipeline incompleto: mantém o snapshot que já existe para hoje
    return {
      usuario_id: userId, ml_user_id: conta, extrato_dias: extratoRows.length, snapshot_datas: 0,
      snapshot_erro: `pipeline incompleto: ${falhasFuturo.length} janela(s) (${falhasFuturo[0].erro})`,
      extrato_erro: extratoErro, ok: false
    }
  }

  // Agrupar por data de recebimento
  const byDataFuturo: Record<string, { val: number; qtd: number }> = {}
  const seenFuturo = new Set<number>()
  for (const j of resFuturo) {
    for (const item of j.items) {
      if (item.id && seenFuturo.has(item.id)) continue
      if (item.id) seenFuturo.add(item.id)
      if (!ehVenda(item)) continue
      const data = diaBRT(item.money_release_date || '')
      if (!data || data < amanha) continue
      if (!byDataFuturo[data]) byDataFuturo[data] = { val: 0, qtd: 0 }
      byDataFuturo[data].val += item.net_received_amount || 0
      byDataFuturo[data].qtd += 1
    }
  }

  // Inserir snapshot — apenas colunas que existem na tabela
  const snapshotRows = Object.entries(byDataFuturo).map(([dataRecebimento, { val, qtd }]) => ({
    usuario_id: userId,
    ml_user_id: conta,
    data_captura: hoje,
    data_recebimento: dataRecebimento,
    val: Math.round(val * 100) / 100,
    qtd: qtd
  }))

  // Deletar snapshots do dia atual deste usuário (cron duplo ou reconexão)
  await fetch(`${supaUrl}/rest/v1/snapshots_ml?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&data_captura=eq.${hoje}`, {
    method: 'DELETE',
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
  })

  let snapshotErro: string | null = null
  if (snapshotRows.length > 0) {
    const insRes = await fetch(`${supaUrl}/rest/v1/snapshots_ml`, {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(snapshotRows)
    })
    if (!insRes.ok) {
      snapshotErro = await insRes.text()
    }
  }

  return {
    usuario_id: userId,
    ml_user_id: conta,
    extrato_dias: extratoRows.length,
    snapshot_datas: snapshotRows.length,
    snapshot_erro: snapshotErro,
    extrato_erro: extratoErro,
    ok: snapshotErro === null && extratoErro === null
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
      // ── MODO CRON: valida CRON_SECRET antes de processar ─────────────────
      const cronSecret = Deno.env.get('CRON_SECRET')
      if (cronSecret && body?.secret !== cronSecret) {
        return resp({ error: 'Unauthorized' })
      }

      // ── MODO CRON: processa todos os usuários com token ML ────────────────
      const tokens = await fetch(`${supaUrl}/rest/v1/ml_tokens?select=usuario_id,ml_user_id`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' }
      }).then(r => r.json())

      const pares: { u: string; c: string }[] = Array.isArray(tokens) ? tokens.map((t: any) => ({ u: t.usuario_id, c: String(t.ml_user_id) })) : []
      // Em paralelo e isolado por usuário: a falha de uma conta não derruba as outras
      // e o tempo total cabe no limite da Edge Function
      const resultados = await Promise.all(pares.map(p =>
        processarUsuario(p.u, supaUrl, supaKey, clientId, secret, 'cron', undefined, p.c)
          .catch(e => ({ usuario_id: p.u, ml_user_id: p.c, erro: String(e), ok: false }))
      ))
      // O pg_net desiste da resposta em 5s — o resultado fica nos logs da função
      console.log('ml-snapshot cron', JSON.stringify(resultados))
      return resp({ success: true, contas: pares.length, resultados })

    } else {
      // ── MODO MANUAL: processa apenas o usuário autenticado ────────────────
      const authHeader = req.headers.get('Authorization') || ''
      const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
        headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: authHeader }
      })
      if (!jwtRes.ok) return resp({ error: 'Não autenticado' })
      const { id: userId } = await jwtRes.json()

      const linhas = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=ml_user_id&order=updated_at.asc`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, Accept: 'application/json' }
      }).then(r => r.json()).catch(() => [])
      let contas: string[] = Array.isArray(linhas) ? linhas.map((t: any) => String(t.ml_user_id)) : []
      if (body?.conta) contas = contas.filter(c => c === String(body.conta))
      if (contas.length === 0) return resp({ error: 'ML não conectado. Conecte sua conta primeiro.' })
      // { refazer_extrato: { de, ate } } recalcula esses dias do extrato mesmo já gravados
      const refazer = body?.refazer_extrato?.de && body?.refazer_extrato?.ate ? body.refazer_extrato : undefined
      const resultados = await Promise.all(contas.map(c =>
        processarUsuario(userId, supaUrl, supaKey, clientId, secret, 'manual', refazer, c)
          .catch(e => ({ usuario_id: userId, ml_user_id: c, erro: String(e), ok: false }))
      ))
      const resultado: any = resultados[0]
      const junta = (k: string) => resultados.map((r: any) => r[k]).filter(Boolean).join(' · ') || null
      return resp({ success: true, ...resultado, extrato_erro: junta('extrato_erro'), snapshot_erro: junta('snapshot_erro'), contas: resultados })
    }

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
