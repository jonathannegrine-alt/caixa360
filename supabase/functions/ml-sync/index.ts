import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: CORS })

    // Identificar usuário pelo JWT
    const supaAnon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user } } = await supaAnon.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: CORS })

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Buscar token ML do usuário
    const { data: tokenRow } = await supa.from('ml_tokens').select('*').eq('usuario_id', user.id).single()
    if (!tokenRow) return new Response(JSON.stringify({ error: 'ML não conectado. Conecte sua conta primeiro.' }), { status: 400, headers: CORS })

    let accessToken = tokenRow.access_token

    // Renovar token se expirado
    if (new Date(tokenRow.expires_at) <= new Date()) {
      const refreshRes = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: Deno.env.get('ML_CLIENT_ID')!,
          client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
          refresh_token: tokenRow.refresh_token
        })
      })
      const newTokens = await refreshRes.json()
      if (newTokens.error) return new Response(JSON.stringify({ error: 'Erro ao renovar token ML. Reconecte sua conta.' }), { status: 400, headers: CORS })

      accessToken = newTokens.access_token
      await supa.from('ml_tokens').update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }).eq('usuario_id', user.id)
    }

    // Buscar releases do ML (mesmo algoritmo do script PowerShell)
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
      usuario_id: user.id,
      data,
      val: Math.round((val as number) * 100) / 100
    }))

    // Buscar saldo Mercado Pago
    let saldoMP: number | null = null
    try {
      const sRes = await fetch(`https://api.mercadolibre.com/users/${tokenRow.ml_user_id}/mercadopago/account/summary`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const sData = await sRes.json()
      if (sData.available_balance !== undefined) saldoMP = sData.available_balance
    } catch (_) { /* saldo opcional */ }

    // Salvar liberações no banco (full replace)
    await supa.from('liberacoes').delete().eq('usuario_id', user.id)
    if (liberacoes.length > 0) await supa.from('liberacoes').insert(liberacoes)

    return new Response(JSON.stringify({
      success: true,
      liberacoes: liberacoes.length,
      saldoMP,
      atualizado_em: new Date().toISOString()
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
