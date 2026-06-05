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
    const tokens = await dbGet(supaUrl, supaKey, 'ml_tokens', `usuario_id=eq.${userId}&limit=1`)
    const tokenRow = Array.isArray(tokens) ? tokens[0] : null
    if (!tokenRow) return resp({ error: 'ML não conectado. Conecte sua conta primeiro.' })

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
      if (newTok.error) return resp({ error: 'Token ML expirado. Reconecte sua conta.', detail: newTok.error })
      accessToken = newTok.access_token
      await dbRun(supaUrl, supaKey, 'PATCH', 'ml_tokens', {
        access_token: newTok.access_token, refresh_token: newTok.refresh_token,
        expires_at: new Date(Date.now() + newTok.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }, `usuario_id=eq.${userId}`)
    }

    // Buscar releases do ML
    const hoje = new Date().toISOString().substring(0, 10)
    const all: any[] = []
    let offset = 0
    while (offset < 5000) {
      const url = `https://api.mercadolibre.com/collections/search?status=approved&released=no&sort=money_release_date&criteria=asc&limit=200&offset=${offset}&range=money_release_date&begin_date=${hoje}T00:00:00.000-03:00&end_date=2027-12-31T23:59:59.000-03:00`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const data = await r.json()
      if (data.error || !data.results) break
      all.push(...data.results.map((x: any) => x.collection || x))
      offset += 200
      if (offset >= (data.paging?.total ?? 0)) break
    }

    // Agrupar por data
    const byDate: Record<string, number> = {}
    for (const item of all) {
      const date = (item.money_release_date || '').substring(0, 10)
      if (!date) continue
      byDate[date] = (byDate[date] || 0) + (item.net_received_amount || 0)
    }
    const liberacoes = Object.entries(byDate).map(([data, val]) => ({
      usuario_id: userId, data, val: Math.round((val as number) * 100) / 100
    }))

    // Buscar saldo MP
    let saldoMP: number | null = null
    try {
      const sRes = await fetch(`https://api.mercadolibre.com/users/${tokenRow.ml_user_id}/mercadopago/account/summary`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const sd = await sRes.json()
      if (sd.available_balance !== undefined) saldoMP = sd.available_balance
    } catch (_) {}

    // Salvar liberações (delete + insert)
    await dbRun(supaUrl, supaKey, 'DELETE', 'liberacoes', undefined, `usuario_id=eq.${userId}`)
    if (liberacoes.length > 0) {
      await dbRun(supaUrl, supaKey, 'POST', 'liberacoes', liberacoes as any, undefined, 'return=minimal')
    }

    // Atualizar updated_at do token
    await dbRun(supaUrl, supaKey, 'PATCH', 'ml_tokens', { updated_at: new Date().toISOString() }, `usuario_id=eq.${userId}`)

    return resp({ success: true, liberacoes: liberacoes.length, saldoMP, atualizado_em: new Date().toISOString() })

  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
