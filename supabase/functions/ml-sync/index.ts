const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const resp = (body: object) => new Response(JSON.stringify(body), { headers: CORS })

async function dbGet(supaUrl: string, supaKey: string, table: string, filter: string) {
  const r = await fetch(`${supaUrl}/rest/v1/${table}?${filter}`, {
    headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Accept': 'application/json' }
  })
  return r.json()
}

async function dbRun(supaUrl: string, supaKey: string, method: string, table: string, body?: object, filter?: string, prefer?: string) {
  const url = filter ? `${supaUrl}/rest/v1/${table}?${filter}` : `${supaUrl}/rest/v1/${table}`
  const headers: Record<string,string> = {
    'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Content-Type': 'application/json'
  }
  if (prefer) headers['Prefer'] = prefer
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { ok: r.ok, status: r.status, text: await r.text() }
}

// Limite de tempo das buscas no ML — a Edge Function é encerrada aos ~150s
let prazoMs = Infinity

// Busca todos os resultados paginados da API ML.
// Cada página é tentada até 4x (429/5xx/erro transitório). Se uma página falhar de vez,
// retorna completo=false — quem chama NÃO deve gravar dado parcial por cima do bom.
async function fetchAllML(baseUrl: string, accessToken: string, maxOffset = 10000) {
  const seen = new Set<number>()
  const items: any[] = []
  let offset = 0
  while (offset < maxOffset) {
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
    if (!data) return { items, completo: false, erro: `offset ${offset}: ${falha}` }
    if (data.results.length === 0) break
    for (const x of data.results) {
      const item = x.collection || x
      if (item.id && seen.has(item.id)) continue  // deduplicar por ID
      if (item.id) seen.add(item.id)
      items.push(item)
    }
    offset += data.results.length
    const total = data.paging?.total
    if (typeof total === 'number' && offset >= total) break
  }
  return { items, completo: true, erro: null as string | null }
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

// Sincroniza os recebíveis de UMA conta do Mercado Livre
async function sincronizarConta(supaUrl: string, supaKey: string, clientId: string, secret: string, userId: string, tokenRow: any): Promise<any> {
    const conta = String(tokenRow.ml_user_id)
    let accessToken = tokenRow.access_token

    // Renovar token se expirado
    if (new Date(tokenRow.expires_at) <= new Date()) {
      const refreshRes = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', client_id: clientId, client_secret: secret,
          refresh_token: tokenRow.refresh_token
        })
      })
      const newTok = await refreshRes.json()
      if (newTok.error || !newTok.access_token) return ({ error: 'Token ML expirado. Reconecte sua conta.', detail: newTok.error || newTok.message })
      accessToken = newTok.access_token
      await dbRun(supaUrl, supaKey, 'PATCH', 'ml_tokens', {
        access_token: newTok.access_token, refresh_token: newTok.refresh_token,
        expires_at: new Date(Date.now() + (Number(newTok.expires_in) || 21600) * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }, `usuario_id=eq.${userId}&ml_user_id=eq.${conta}`)
    }

    prazoMs = Date.now() + 110000
    // Buscar releases do ML com filtro de data
    // Datas calculadas em BRT (UTC-3) para evitar bug de virada de dia (após 21h BRT o UTC já é dia seguinte)
    const BRT_MS = 3 * 60 * 60 * 1000
    const nowBRT = new Date(Date.now() - BRT_MS)
    const hoje = nowBRT.toISOString().substring(0, 10)
    const amanha = new Date(Date.now() - BRT_MS + 86400000).toISOString().substring(0, 10)
    const diaMais = (n: number) => new Date(Date.now() - BRT_MS + n * 86400000).toISOString().substring(0, 10)
    // Uma janela por dia nos próximos 45 dias + uma janela de cauda até D+120
    const DIAS_JANELA = 45
    const janelas: { de: string; ate: string }[] = []
    for (let i = 1; i <= DIAS_JANELA; i++) janelas.push({ de: diaMais(i), ate: diaMais(i) })
    const caudaDe = diaMais(DIAS_JANELA + 1)
    janelas.push({ de: caudaDe, ate: diaMais(120) })
    const resJanelas = await fetchJanelas(
      'https://api.mercadolibre.com/collections/search?status=approved&released=no&sort=money_release_date&criteria=asc&range=money_release_date',
      accessToken, janelas
    )
    const falhas = resJanelas.filter(j => !j.completo)
    // Nada veio: mantém as liberações já salvas em vez de apagar tudo
    if (falhas.length === resJanelas.length) {
      return ({ error: 'Mercado Livre não devolveu os recebimentos. Dados anteriores mantidos — tente de novo em alguns minutos.', detail: falhas[0].erro })
    }
    const diasFalhos = new Set(falhas.filter(j => j.de === j.ate).map(j => j.de))
    const caudaFalhou = falhas.some(j => j.de !== j.ate)
    const naoVeio = (d: string) => diasFalhos.has(d) || (caudaFalhou && d >= caudaDe)

    const seenAll = new Set<number>()
    const all: any[] = []
    for (const j of resJanelas) {
      if (!j.completo) continue
      for (const item of j.items) {
        if (item.id && seenAll.has(item.id)) continue
        if (item.id) seenAll.add(item.id)
        all.push(item)
      }
    }

    // Agrupar por data (apenas datas >= amanhã como segurança extra)
    const byDate: Record<string, number> = {}
    for (const item of all) {
      if (!ehVenda(item)) continue
      const date = diaBRT(item.money_release_date || '')
      if (!date || date < amanha || naoVeio(date)) continue
      byDate[date] = (byDate[date] || 0) + (item.net_received_amount || 0)
    }
    const liberacoes = Object.entries(byDate).map(([data, val]) => ({
      usuario_id: userId, ml_user_id: conta, data, val: Math.round((val as number) * 100) / 100
    }))

    // Buscar releases de HOJE por hora (released=no = ainda não creditado)
    const hojeEnd = `${hoje}T23:59:59.000-03:00`
    const hojeStart = `${hoje}T00:00:00.000-03:00`
    const hojeRes = await fetchAllML(
      `https://api.mercadolibre.com/collections/search?status=approved&released=no&sort=money_release_date&criteria=asc&range=money_release_date&begin_date=${hojeStart}&end_date=${hojeEnd}`,
      accessToken, 5000
    )
    const allHoje = hojeRes.items
    // Agrupar por hora em BRT (UTC-3), convertendo corretamente independente do offset do campo
    const byHora: Record<string, number> = {}
    for (const item of allHoje) {
      if (!ehVenda(item)) continue
      const dt = item.money_release_date || ''
      if (!dt) continue
      const horaBRT = ((new Date(dt).getUTCHours() - 3 + 24) % 24).toString().padStart(2, '0')
      byHora[horaBRT] = (byHora[horaBRT] || 0) + (item.net_received_amount || 0)
    }
    const liberacoesHoje = Object.entries(byHora)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hora, val]) => ({ hora: hora + ':00h', val: Math.round((val as number) * 100) / 100 }))

    // Buscar saldo MP
    let saldoMP: number | null = null
    try {
      const sRes = await fetch(`https://api.mercadolibre.com/users/${tokenRow.ml_user_id}/mercadopago/account/summary`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const sd = await sRes.json()
      if (sd.available_balance !== undefined) saldoMP = sd.available_balance
    } catch (_) {}

    // Salvar liberações (delete + insert) — dias que o ML não devolveu ficam como estavam
    let filtroDel = `usuario_id=eq.${userId}&ml_user_id=eq.${conta}`
    if (diasFalhos.size > 0 || caudaFalhou) {
      const manter = [...diasFalhos].map(d => `data.eq.${d}`)
      if (caudaFalhou) manter.push(`data.gte.${caudaDe}`)
      filtroDel += `&not.or=(${manter.join(',')})`
    }
    const del = await dbRun(supaUrl, supaKey, 'DELETE', 'liberacoes', undefined, filtroDel)
    if (!del.ok) return ({ error: 'Erro ao gravar liberações', detail: del.text })
    if (liberacoes.length > 0) {
      const ins = await dbRun(supaUrl, supaKey, 'POST', 'liberacoes', liberacoes as any, undefined, 'return=minimal')
      if (!ins.ok) return ({ error: 'Erro ao gravar liberações', detail: ins.text })
    }

    // Atualizar updated_at do token
    await dbRun(supaUrl, supaKey, 'PATCH', 'ml_tokens', { updated_at: new Date().toISOString() }, `usuario_id=eq.${userId}&ml_user_id=eq.${conta}`)

    // liberacoesHoje só vai se a busca de hoje veio completa (senão o app mantém o valor anterior)
    return ({
      success: true, liberacoes: liberacoes.length, pagamentos: all.length,
      liberacoesHoje: hojeRes.completo ? liberacoesHoje : null,
      aviso: [
        falhas.length ? `${falhas.length} dia(s) não vieram do ML e ficaram com o valor anterior: ${falhas.map(j => j.de).slice(0, 6).join(', ')}` : null,
        hojeRes.completo ? null : 'recebimentos de hoje incompletos'
      ].filter(Boolean).join(' · ') || null,
      detalheFalha: falhas[0]?.erro || hojeRes.erro || null,
      saldoMP, atualizado_em: new Date().toISOString()
    })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl  = Deno.env.get('SUPABASE_URL')!
    const supaKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!
    const secret   = Deno.env.get('ML_CLIENT_SECRET')!

    // Identificar usuário pelo JWT
    const authHeader = req.headers.get('Authorization') || ''
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'apikey': Deno.env.get('SUPABASE_ANON_KEY')!, 'Authorization': authHeader }
    })
    if (!jwtRes.ok) return resp({ error: 'Não autenticado' })
    const { id: userId } = await jwtRes.json()

    // Buscar token ML
    const tokens = await dbGet(supaUrl, supaKey, 'ml_tokens', `usuario_id=eq.${userId}&order=updated_at.asc`)

    const corpoReq = await req.json().catch(() => ({}))
    let contas: any[] = Array.isArray(tokens) ? tokens : []
    if (corpoReq?.conta) contas = contas.filter(t => String(t.ml_user_id) === String(corpoReq.conta))
    if (contas.length === 0) return resp({ error: 'ML não conectado. Conecte sua conta primeiro.' })

    // Cada conta é sincronizada em paralelo; a falha de uma não derruba as outras
    const res: any[] = await Promise.all(contas.map(t =>
      sincronizarConta(supaUrl, supaKey, clientId, secret, userId, t).catch(e => ({ error: 'Exceção interna', detail: String(e) }))
    ))
    const detalhe = res.map((r, i) => ({
      ml_user_id: String(contas[i].ml_user_id), apelido: contas[i].apelido || null,
      liberacoes: r.liberacoes ?? null, erro: r.error || null, aviso: r.aviso || null,
      saldoMP: r.saldoMP ?? null,                                         // saldo do Mercado Pago desta conta
      hoje: Array.isArray(r.liberacoesHoje) ? r.liberacoesHoje : null   // liberações de hoje por hora, desta conta
    }))
    const ok = res.filter(r => r.success)
    if (ok.length === 0) return resp({ ...res[0], contas: detalhe })

    const porHora: Record<string, number> = {}
    let temHoje = false
    for (const r of ok) if (Array.isArray(r.liberacoesHoje)) {
      temHoje = true
      for (const h of r.liberacoesHoje) porHora[h.hora] = (porHora[h.hora] || 0) + h.val
    }
    const saldos = ok.map(r => r.saldoMP).filter((v: unknown) => v !== null && v !== undefined)
    const avisos = [
      ...res.map((r, i) => r.error ? `${contas[i].apelido || contas[i].ml_user_id}: ${r.error}` : null),
      ...ok.map(r => r.aviso)
    ].filter(Boolean)
    return resp({
      success: true,
      liberacoes: ok.reduce((t, r) => t + (r.liberacoes || 0), 0),
      pagamentos: ok.reduce((t, r) => t + (r.pagamentos || 0), 0),
      liberacoesHoje: temHoje ? Object.entries(porHora).sort(([a], [b]) => a.localeCompare(b)).map(([hora, val]) => ({ hora, val: Math.round(val * 100) / 100 })) : null,
      aviso: avisos.join(' · ') || null,
      detalheFalha: ok.map(r => r.detalheFalha).find(Boolean) || null,
      saldoMP: saldos.length ? saldos.reduce((t: number, v: number) => t + v, 0) : null,
      contas: detalhe, atualizado_em: new Date().toISOString()
    })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
