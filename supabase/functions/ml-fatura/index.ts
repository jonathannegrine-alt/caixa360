// ml-fatura — faturas do Mercado Livre (API de faturamento), só leitura.
// Body: { conta, caminho } com o JWT do usuário. "caminho" precisa começar por /billing/integration/ e é sempre um GET.
//   períodos        /billing/integration/monthly/periods?group=ML&document_type=BILL&limit=6
//   resumo          /billing/integration/periods/key/{AAAA-MM-DD}/summary/details?group=ML&document_type=BILL
//   linhas          /billing/integration/periods/key/{AAAA-MM-DD}/group/ML/details?document_type=BILL&limit=150&offset=0

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: req.headers.get('Authorization') || '' } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()
    const body = await req.json().catch(() => ({}))
    const conta = /^\d+$/.test(String(body?.conta ?? '')) ? String(body.conta) : ''
    const caminho = String(body?.caminho || '')
    if (!conta) return resp({ error: 'Informe a conta.' })
    if (!/^\/billing\/integration\/[A-Za-z0-9_\-\/?=&.,:%]+$/.test(caminho) || caminho.includes('..')) return resp({ error: 'Caminho inválido.' })

    const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&select=access_token,refresh_token,expires_at`, { headers: dbH }).then(r => r.json()).catch(() => [])
    if (!Array.isArray(rows) || !rows.length) return resp({ error: 'Conta do Mercado Livre não conectada.' })
    const t = rows[0]
    let token = t.access_token
    if (new Date(t.expires_at) <= new Date(Date.now() + 60000)) {
      const novo = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ML_CLIENT_ID')!, client_secret: Deno.env.get('ML_CLIENT_SECRET')!, refresh_token: t.refresh_token })
      }).then(r => r.json()).catch(() => ({}))
      if (!novo?.access_token) return resp({ error: 'Conexão expirada: reconecte a conta.' })
      token = novo.access_token
      await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}`, {
        method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ access_token: novo.access_token, refresh_token: novo.refresh_token, expires_at: new Date(Date.now() + (Number(novo.expires_in) || 21600) * 1000).toISOString(), updated_at: new Date().toISOString() })
      })
    }
    const r = await fetch('https://api.mercadolibre.com' + caminho, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) }).catch(() => null)
    if (!r) return resp({ ok: false, status: 0 })
    const j = await r.json().catch(() => null)
    return resp({ ok: r.ok, status: r.status, json: j })
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500)
  }
})
