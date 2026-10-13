// ml-sonda — ferramenta de estudo da API do Mercado Livre, só para o administrador (app_admin).
// Faz consultas de LEITURA (GET) em api.mercadolibre.com com o token de uma conta do próprio administrador e devolve
// o status e um resumo da resposta (chaves e um trecho curto). Serve para descobrir o que a API entrega antes de
// construir uma função de verdade. Não grava nada e não aceita outro método nem outro endereço.
//   body { conta?: '<ml_user_id>', caminhos: ['/users/me', ...] }   ({uid} no caminho vira o ml_user_id da conta)
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
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
    const auth = req.headers.get('Authorization') || ''
    const u = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } })
    if (!u.ok) return resp({ error: 'Sessão inválida.' }, 401)
    const { id, email } = await u.json()
    const adm = await fetch(`${supaUrl}/rest/v1/app_admin?select=email&email=ilike.${encodeURIComponent(String(email || ''))}`, { headers: dbH }).then(r => r.json()).catch(() => [])
    if (!Array.isArray(adm) || !adm.length) return resp({ error: 'Só o administrador.' }, 403)
    const body = await req.json().catch(() => ({}))
    const caminhos: string[] = (Array.isArray(body?.caminhos) ? body.caminhos : []).map((c: unknown) => String(c)).filter((c: string) => c.startsWith('/') && !c.includes('://')).slice(0, 25)
    if (!caminhos.length) return resp({ error: 'Informe caminhos.' })
    const filtro = body?.conta ? `&ml_user_id=eq.${String(body.conta).replace(/\D/g, '')}` : ''
    const toks = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${id}${filtro}&select=ml_user_id,access_token,expires_at&order=updated_at.desc&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const t = Array.isArray(toks) ? toks[0] : null
    if (!t) return resp({ error: 'Conta não encontrada.' })
    if (new Date(t.expires_at) <= new Date()) return resp({ error: 'Token vencido agora; tente de novo em alguns minutos.' })
    const resumo = (j: any, n = 0): any => {
      if (Array.isArray(j)) return { lista: j.length, primeiro: j.length && n < 3 ? resumo(j[0], n + 1) : undefined }
      if (j && typeof j === 'object') { const o: any = {}; for (const k of Object.keys(j).slice(0, 40)) { const v = j[k]; o[k] = v && typeof v === 'object' ? (n < 3 ? resumo(v, n + 1) : '{…}') : (typeof v === 'string' ? v.slice(0, 60) : v) } return o }
      return typeof j === 'string' ? j.slice(0, 200) : j
    }
    const out: any[] = []
    for (const c of caminhos) {
      const caminho = c.split('{uid}').join(String(t.ml_user_id))
      try {
        const r = await fetch('https://api.mercadolibre.com' + caminho, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15000) })
        const txt = await r.text(); let j: any = null; try { j = JSON.parse(txt) } catch (_e) { /* não é JSON */ }
        out.push({ caminho, status: r.status, resumo: j ? resumo(j) : txt.slice(0, 200) })
      } catch (e) { out.push({ caminho, erro: String((e as Error)?.message || e).slice(0, 120) }) }
    }
    return resp({ ok: true, conta: String(t.ml_user_id), resultados: out })
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500)
  }
})
