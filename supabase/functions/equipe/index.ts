// equipe — colaboradores da conta (Configurações → Equipe). Só o dono da conta chama; um colaborador não cria outro.
//   { acao: 'criar',   email, senha, nome, paginas }  cria o login (e-mail já confirmado) e liga ao dono
//   { acao: 'senha',   membro, senha }                troca a senha do colaborador
//   { acao: 'remover', membro }                       apaga o login do colaborador
// Nome, telas e ativo o dono muda direto na tabela equipe (RLS). As telas liberadas ficam em PAGINAS.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const PAGINAS = ['pedidos']
const DEMO = 'c9c1dcb9-c774-46f8-8c41-7b0a3077f967'
const MAX = 15

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
    const u = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: req.headers.get('Authorization') || '' } })
    if (!u.ok) return resp({ error: 'Sessão inválida — entre de novo.' }, 401)
    const { id: dono } = await u.json()
    if (!dono || dono === DEMO) return resp({ error: 'Não disponível nesta conta.' }, 403)
    const eu = await fetch(`${supaUrl}/rest/v1/equipe?membro_id=eq.${dono}&select=membro_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
    if (Array.isArray(eu) && eu.length) return resp({ error: 'Colaborador não cria nem altera outros colaboradores.' }, 403)
    const body = await req.json().catch(() => ({}))
    const acao = String(body?.acao || '')
    // membro precisa ser deste dono
    const doDono = async (membro: string) => {
      const r = await fetch(`${supaUrl}/rest/v1/equipe?membro_id=eq.${encodeURIComponent(membro)}&dono_id=eq.${dono}&select=membro_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
      return Array.isArray(r) && r.length > 0
    }

    if (acao === 'criar') {
      const email = String(body?.email || '').trim().toLowerCase(), senha = String(body?.senha || ''), nome = String(body?.nome || '').trim().slice(0, 80)
      const paginas = (Array.isArray(body?.paginas) ? body.paginas : []).map(String).filter((p: string) => PAGINAS.includes(p))
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resp({ error: 'E-mail inválido.' })
      if (senha.length < 8) return resp({ error: 'A senha precisa ter pelo menos 8 caracteres.' })
      if (!paginas.length) return resp({ error: 'Marque ao menos uma tela.' })
      const qt = await fetch(`${supaUrl}/rest/v1/equipe?dono_id=eq.${dono}&select=membro_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
      if (Array.isArray(qt) && qt.length >= MAX) return resp({ error: `Limite de ${MAX} colaboradores.` })
      // e-mail que já tem conta no Caixa 360 não vira colaborador (não se liga conta de outra pessoa)
      const c = await fetch(`${supaUrl}/auth/v1/admin/users`, { method: 'POST', headers: dbH, body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { equipe: true } }) })
      const cj = await c.json().catch(() => ({}))
      if (!c.ok || !cj?.id) {
        const m = String(cj?.msg || cj?.message || cj?.error_description || '')
        return resp({ error: /already|registered|exists/i.test(m) ? 'Este e-mail já tem cadastro no Caixa 360. Use outro e-mail para o colaborador.' : 'Não consegui criar o login: ' + (m || c.status) })
      }
      const ins = await fetch(`${supaUrl}/rest/v1/equipe`, { method: 'POST', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify({ membro_id: cj.id, dono_id: dono, email, nome: nome || null, paginas }) })
      if (!ins.ok) {
        await fetch(`${supaUrl}/auth/v1/admin/users/${cj.id}`, { method: 'DELETE', headers: dbH })
        return resp({ error: 'Não consegui guardar o colaborador: ' + (await ins.text()).slice(0, 200) })
      }
      return resp({ ok: true, membro: cj.id })
    }

    const membro = String(body?.membro || '')
    if (!membro || !(await doDono(membro))) return resp({ error: 'Colaborador não encontrado.' }, 404)

    if (acao === 'senha') {
      const senha = String(body?.senha || '')
      if (senha.length < 8) return resp({ error: 'A senha precisa ter pelo menos 8 caracteres.' })
      const r = await fetch(`${supaUrl}/auth/v1/admin/users/${membro}`, { method: 'PUT', headers: dbH, body: JSON.stringify({ password: senha }) })
      return r.ok ? resp({ ok: true }) : resp({ error: 'Não consegui trocar a senha.' })
    }
    if (acao === 'remover') {
      const r = await fetch(`${supaUrl}/auth/v1/admin/users/${membro}`, { method: 'DELETE', headers: dbH })   // apaga a linha da equipe junto (cascade)
      return r.ok ? resp({ ok: true }) : resp({ error: 'Não consegui remover.' })
    }
    return resp({ error: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500)
  }
})
