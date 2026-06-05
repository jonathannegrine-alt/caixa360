import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ok  = (body: object) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } })
const err = (msg: string, detail?: string) => new Response(JSON.stringify({ error: msg, detail }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => null)
    if (!body?.code || !body?.user_id) return err('Parâmetros inválidos: code e user_id são obrigatórios')

    const { code, user_id } = body

    const clientId     = Deno.env.get('ML_CLIENT_ID')
    const clientSecret = Deno.env.get('ML_CLIENT_SECRET')
    if (!clientId || !clientSecret) return err('Secrets ML não configurados no servidor')

    // Trocar code por tokens
    const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: 'https://jonathannegrine-alt.github.io/caixa360/'
      })
    })

    const tokens = await tokenRes.json()
    console.log('ML token response status:', tokenRes.status, 'error:', tokens.error)

    if (tokens.error) return err(tokens.error, tokens.message)

    // Salvar tokens no banco
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error: dbErr } = await supa.from('ml_tokens').upsert({
      usuario_id: user_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ml_user_id: String(tokens.user_id),
      updated_at: new Date().toISOString()
    }, { onConflict: 'usuario_id' })

    if (dbErr) return err('Erro ao salvar token no banco', dbErr.message)

    return ok({ success: true, ml_user_id: tokens.user_id })

  } catch (e) {
    console.error('ml-callback exception:', e)
    return err('Erro interno', String(e))
  }
})
