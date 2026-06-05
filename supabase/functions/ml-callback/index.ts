import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { code, user_id } = await req.json()
    if (!code || !user_id) {
      return new Response(JSON.stringify({ error: 'Parâmetros inválidos' }), { status: 400, headers: CORS })
    }

    // Trocar code por access_token + refresh_token
    const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: Deno.env.get('ML_CLIENT_ID')!,
        client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
        code,
        redirect_uri: 'https://jonathannegrine-alt.github.io/caixa360/'
      })
    })

    const tokens = await tokenRes.json()
    if (tokens.error) {
      return new Response(JSON.stringify({ error: tokens.error, message: tokens.message }), { status: 400, headers: CORS })
    }

    // Salvar tokens no banco
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await supa.from('ml_tokens').upsert({
      usuario_id: user_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ml_user_id: String(tokens.user_id),
      updated_at: new Date().toISOString()
    }, { onConflict: 'usuario_id' })

    return new Response(JSON.stringify({ success: true, ml_user_id: tokens.user_id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('ml-callback erro:', err)
    return new Response(JSON.stringify({ error: 'Erro interno', detail: String(err) }), { status: 500, headers: CORS })
  }
})
