// ml-opinioes — opiniões dos compradores sobre os anúncios (nota e texto), só leitura.
// Body: { conta, itens: ['MLB…', …], detalhe? } (até 30 anúncios por chamada) com o JWT do usuário. A conta precisa
// ser a dona dos anúncios: com o acesso de outra conta o Mercado Livre responde 403.
//   GET /reviews/item/{id}?limit=50   → média, quantidade por nota e os textos mais recentes
// Devolve só nota, título, texto e data: nada que identifique o comprador.

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
    const itens: string[] = [...new Set((Array.isArray(body?.itens) ? body.itens : []).map((x: unknown) => String(x)).filter((x: string) => /^MLB\d{6,14}$/.test(x)))].slice(0, 30) as string[]
    if (!itens.length) return resp({ error: 'Informe os anúncios.' })

    const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=access_token,refresh_token,expires_at,ml_user_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
    if (!Array.isArray(rows) || !rows.length) return resp({ error: 'Conta do Mercado Livre não conectada.' })
    const pedida = String(body?.conta || ''), t = rows.find((x: any) => String(x.ml_user_id) === pedida) || rows[0]
    let token = t.access_token
    if (new Date(t.expires_at) <= new Date(Date.now() + 60000)) {
      const novo = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ML_CLIENT_ID')!, client_secret: Deno.env.get('ML_CLIENT_SECRET')!, refresh_token: t.refresh_token })
      }).then(r => r.json()).catch(() => ({}))
      if (!novo?.access_token) return resp({ error: 'Conexão expirada: reconecte a conta.' })
      token = novo.access_token
      await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${t.ml_user_id}`, {
        method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ access_token: novo.access_token, refresh_token: novo.refresh_token, expires_at: new Date(Date.now() + (Number(novo.expires_in) || 21600) * 1000).toISOString(), updated_at: new Date().toISOString() })
      })
    }

    // um anúncio só + detalhe: além das mais relevantes (quase todas de nota 5), lê as de nota 1, 2 e 3 (?rating=N),
    // que são as que mostram o que melhorar
    const detalhe = itens.length === 1 && !!body?.detalhe
    const pagina = async (id: string, extra: string) => {
      const r = await fetch(`https://api.mercadolibre.com/reviews/item/${id}?limit=50${extra}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }).catch(() => null)
      return r && r.ok ? await r.json().catch(() => null) : { _erro: r ? r.status : 0 }
    }
    const um = async (id: string) => {
      const j: any = await pagina(id, '&offset=0')
      if (!j || j._erro !== undefined) return { item_id: id, erro: j ? j._erro : -1 }
      const niveis = j.rating_levels || {}
      const todas: any[] = [...(j.reviews || [])]
      if (detalhe) {
        const baixas = await Promise.all([1, 2, 3].map(async n => {
          const L: any[] = []
          for (let p = 0; p < 4; p++) { const m: any = await pagina(id, `&rating=${n}&offset=${p * 50}`); if (!m || !(m.reviews || []).length) break; L.push(...m.reviews); if (m.reviews.length < 50) break }
          return L
        }))
        const vistos = new Set(todas.map(v => v.id))
        baixas.flat().forEach(v => { if (!vistos.has(v.id)) { vistos.add(v.id); todas.push(v) } })
      }
      return {
        item_id: id, media: Number(j.rating_average) || 0, total: Number(j.paging?.total) || 0,
        niveis: [1, 2, 3, 4, 5].map(n => Number(niveis[['one_star', 'two_star', 'three_star', 'four_star', 'five_star'][n - 1]]) || 0),
        opinioes: todas.map((v: any) => ({ nota: Number(v.rate) || 0, titulo: String(v.title || '').slice(0, 200), texto: String(v.content || '').slice(0, 1500), data: String(v.date_created || '').slice(0, 10) }))
      }
    }
    const out: any[] = []
    for (let i = 0; i < itens.length; i += 6) out.push(...await Promise.all(itens.slice(i, i + 6).map(um)))
    return resp({ ok: true, itens: out })
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500)
  }
})
