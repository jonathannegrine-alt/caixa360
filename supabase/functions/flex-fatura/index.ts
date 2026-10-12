// flex-fatura — baixa a fatura do transportador do Flex a partir do link que ele manda e devolve o PDF (base64).
//
//   { url }   só aceita https://tracken.app.br/tracken/fatura/<código>. Qualquer outro endereço é recusado:
//             nesse caso o usuário envia o PDF pela tela.
//
// Cuidados: endereço conferido antes e depois de seguir redirecionamento, limite de tamanho, e o conteúdo precisa
// começar como PDF. O arquivo só é lido como texto no navegador (pdf.js); nada é executado.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })

// endereços aceitos (para liberar outro transportador, acrescentar aqui)
const ACEITOS = [{ host: 'tracken.app.br', caminho: /^\/tracken\/fatura\/[0-9a-f]{16,64}$/i }]
const MAX = 12 * 1024 * 1024

const aceito = (u: URL) => u.protocol === 'https:' && !u.username && !u.port && ACEITOS.some(a => u.hostname.toLowerCase() === a.host && a.caminho.test(u.pathname))
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)

    const body = await req.json().catch(() => ({}))
    let u: URL
    try { u = new URL(String(body?.url || '').trim()) } catch (_e) { return resp({ error: 'Este não é um link válido.' }, 400) }
    if (!aceito(u)) return resp({ error: 'Só consigo importar pelo link das faturas de tracken.app.br. Para outro transportador, baixe o PDF e envie o arquivo.', recusado: true }, 400)

    // segue no máximo 3 redirecionamentos, conferindo o endereço a cada passo
    let r: Response | null = null
    for (let i = 0; i < 4; i++) {
      r = await fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': 'Caixa360/1.0' } })
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        u = new URL(r.headers.get('location')!, u)
        if (!aceito(u)) return resp({ error: 'O link levou a outro endereço, que não é aceito. Baixe o PDF e envie o arquivo.' }, 400)
        continue
      }
      break
    }
    if (!r || !r.ok) return resp({ error: 'O link não abriu (resposta ' + (r ? r.status : 'vazia') + '). Confira se ele está completo.' }, 502)
    const tam = Number(r.headers.get('content-length') || 0)
    if (tam > MAX) return resp({ error: 'O arquivo deste link é grande demais para uma fatura.' }, 400)
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.length > MAX) return resp({ error: 'O arquivo deste link é grande demais para uma fatura.' }, 400)
    const ini = String.fromCharCode(...bytes.subarray(0, 5))
    if (ini !== '%PDF-') return resp({ error: 'O link não devolveu um PDF. Abra o link no navegador, baixe a fatura e envie o arquivo.' }, 400)
    return resp({ pdf: b64(bytes), bytes: bytes.length, nome: 'fatura-' + u.pathname.split('/').pop()!.slice(0, 8) + '.pdf' })
  } catch (e) {
    return resp({ error: (e as Error).message || String(e) }, 500)
  }
})
