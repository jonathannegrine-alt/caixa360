// ml-atendimento — perguntas (pré-venda) e mensagens (pós-venda) do Mercado Livre.
// Body: { acao, ... } com o JWT do usuário.
//   perguntas         { status: 'UNANSWERED' | 'ANSWERED', offset?, limit? }
//   responder         { question_id, text }
//   excluir_pergunta  { question_id }
//   nao_lidas         {}                       → conversas pós-venda com mensagens não lidas
//   mensagens         { pack_id }              → conversa de uma venda/carrinho
//   enviar_mensagem   { pack_id, buyer_id, text }
// Exige o escopo "Comunicações pré e pós-vendas" no aplicativo do ML.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object) => new Response(JSON.stringify(body), { headers: CORS })

async function ml(url: string, accessToken: string, init: RequestInit = {}) {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(20000),
    })
    const d = await r.json().catch(() => null)
    return { ok: r.ok, status: r.status, data: d, erro: r.ok ? null : `http ${r.status} — ${d?.message || d?.error || 'erro'}` }
  } catch (e) {
    return { ok: false, status: 0, data: null, erro: String(e) }
  }
}

const semPermissao = (r: { status: number; erro: string | null }) => ({
  error: r.status === 403
    ? 'Sem permissão de comunicação no Mercado Livre. Libere "Comunicações pré e pós-vendas" no aplicativo e reconecte a conta.'
    : 'O Mercado Livre recusou a operação.',
  detail: r.erro, sem_permissao: r.status === 403,
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }

    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: req.headers.get('Authorization') || '' }
    })
    if (!jwtRes.ok) return resp({ error: 'Não autenticado' })
    const { id: userId } = await jwtRes.json()

    // Token ML (renova se expirado)
    const tokens = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&limit=1`, { headers: dbH }).then(r => r.json())
    const row = Array.isArray(tokens) ? tokens[0] : null
    if (!row) return resp({ error: 'ML não conectado. Conecte sua conta primeiro.' })
    let token = row.access_token
    if (new Date(row.expires_at) <= new Date()) {
      const novo = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', client_id: Deno.env.get('ML_CLIENT_ID')!, client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
          refresh_token: row.refresh_token
        })
      }).then(r => r.json()).catch(() => ({}))
      if (novo.error || !novo.access_token) return resp({ error: 'Token ML expirado. Reconecte sua conta.' })
      token = novo.access_token
      await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}`, {
        method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' },
        body: JSON.stringify({
          access_token: novo.access_token, refresh_token: novo.refresh_token,
          expires_at: new Date(Date.now() + (Number(novo.expires_in) || 21600) * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      })
    }
    const seller = row.ml_user_id
    const body = await req.json().catch(() => ({}))
    const acao = String(body?.acao || '')
    const soNumero = (v: unknown) => /^\d+$/.test(String(v ?? ''))

    // ── PERGUNTAS ───────────────────────────────────────────────────────────
    if (acao === 'perguntas') {
      const status = body.status === 'ANSWERED' ? 'ANSWERED' : 'UNANSWERED'
      const item = /^MLB\d+$/i.test(String(body.item_id || '').trim()) ? String(body.item_id).trim().toUpperCase() : ''
      const limit = Math.min(50, Math.max(1, Number(body.limit) || 30))
      const offset = Math.max(0, Number(body.offset) || 0)
      const r = await ml(`https://api.mercadolibre.com/questions/search?seller_id=${seller}&status=${status}&sort_fields=date_created&sort_types=DESC&limit=${limit}&offset=${offset}&api_version=4${item ? '&item=' + item : ''}`, token)
      if (!r.ok) return resp(semPermissao(r))
      const perguntas = r.data.questions || []
      // dados dos anúncios (título, foto, preço, estoque)
      const itens = new Map<string, any>()
      const ids = [...new Set(perguntas.map((q: any) => q.item_id).filter(Boolean))] as string[]
      for (let i = 0; i < ids.length; i += 20) {
        const m = await ml(`https://api.mercadolibre.com/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,title,thumbnail,price,available_quantity,permalink`, token)
        if (m.ok && Array.isArray(m.data)) for (const x of m.data) if (x.code === 200) itens.set(x.body.id, x.body)
      }
      // apelido de quem perguntou
      const apelidos = new Map<number, string>()
      const compradores = [...new Set(perguntas.map((q: any) => q.from?.id).filter(Boolean))] as number[]
      await Promise.all(compradores.slice(0, 50).map(async (id) => {
        const u = await ml(`https://api.mercadolibre.com/users/${id}`, token)
        if (u.ok && u.data?.nickname) apelidos.set(id, u.data.nickname)
      }))
      return resp({
        success: true, total: r.data.total ?? perguntas.length, offset, limit,
        perguntas: perguntas.map((q: any) => {
          const it = itens.get(q.item_id) || {}
          return {
            id: q.id, texto: q.text, data: q.date_created, status: q.status, item_id: q.item_id,
            comprador_id: q.from?.id || null, comprador: apelidos.get(q.from?.id) || null,
            resposta: q.answer ? { texto: q.answer.text, data: q.answer.date_created } : null,
            item: { titulo: it.title || null, foto: it.thumbnail ? String(it.thumbnail).replace('http://', 'https://') : null, preco: it.price ?? null, estoque: it.available_quantity ?? null, link: it.permalink || null },
          }
        })
      })
    }

    if (acao === 'responder') {
      const texto = String(body.text || '').trim()
      if (!soNumero(body.question_id) || !texto) return resp({ error: 'Informe a pergunta e o texto da resposta.' })
      if (texto.length > 2000) return resp({ error: 'A resposta tem mais de 2000 caracteres.' })
      const r = await ml('https://api.mercadolibre.com/answers', token, { method: 'POST', body: JSON.stringify({ question_id: Number(body.question_id), text: texto }) })
      return resp(r.ok ? { success: true } : semPermissao(r))
    }

    if (acao === 'excluir_pergunta') {
      if (!soNumero(body.question_id)) return resp({ error: 'Pergunta inválida.' })
      const r = await ml(`https://api.mercadolibre.com/questions/${body.question_id}`, token, { method: 'DELETE' })
      return resp(r.ok ? { success: true } : semPermissao(r))
    }

    // ── MENSAGENS PÓS-VENDA ─────────────────────────────────────────────────
    if (acao === 'nao_lidas') {
      const r = await ml('https://api.mercadolibre.com/messages/unread?role=seller&tag=post_sale', token)
      if (!r.ok) return resp(semPermissao(r))
      const conversas = (r.data.results || []).map((x: any) => ({
        pack_id: (String(x.resource || '').match(/packs\/(\d+)/) || [])[1] || null, nao_lidas: x.count || 0
      })).filter((x: any) => x.pack_id)
      return resp({ success: true, conversas })
    }

    if (acao === 'mensagens') {
      if (!soNumero(body.pack_id)) return resp({ error: 'Venda inválida.' })
      const r = await ml(`https://api.mercadolibre.com/messages/packs/${body.pack_id}/sellers/${seller}?tag=post_sale&mark_as_read=false&limit=50`, token)
      if (!r.ok) return resp(semPermissao(r))
      const msgs = (r.data.messages || []).map((m: any) => ({
        id: m.id, texto: m.text, data: m.message_date?.created || m.message_date?.received || null,
        minha: String(m.from?.user_id) === String(seller), de: m.from?.user_id || null,
        anexos: (m.message_attachments || []).length,
        moderada: m.message_moderation?.status && m.message_moderation.status !== 'clean' ? m.message_moderation.status : null,
      })).sort((a: any, b: any) => String(a.data).localeCompare(String(b.data)))
      const comprador = msgs.find((m: any) => !m.minha)?.de || null
      return resp({ success: true, mensagens: msgs, comprador_id: comprador, bloqueio: r.data.conversation_status?.substatus || null, seller })
    }

    if (acao === 'enviar_mensagem') {
      const texto = String(body.text || '').trim()
      if (!soNumero(body.pack_id) || !soNumero(body.buyer_id) || !texto) return resp({ error: 'Informe a venda, o comprador e o texto.' })
      if (texto.length > 350) return resp({ error: 'O Mercado Livre aceita mensagens de até 350 caracteres.' })
      const r = await ml(`https://api.mercadolibre.com/messages/packs/${body.pack_id}/sellers/${seller}?tag=post_sale`, token, {
        method: 'POST',
        body: JSON.stringify({ from: { user_id: String(seller) }, to: { user_id: String(body.buyer_id) }, text: texto })
      })
      return resp(r.ok ? { success: true } : semPermissao(r))
    }

    return resp({ error: 'Ação desconhecida.' })
  } catch (e) {
    return resp({ error: 'Exceção interna', detail: String(e) })
  }
})
