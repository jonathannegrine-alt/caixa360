// olist-compras — ordens de compra do Olist pela API v3 (aplicativo OAuth), para o Caixa 360.
//
//   { acao: 'ordens' }            ordens em aberto / em andamento + atendidas dos últimos 90 dias, com os itens
//   { acao: 'bruto', id? }        diagnóstico: devolve a resposta crua do Olist (lista e detalhe de uma ordem)
//   { cron: true, secret }        renova os tokens de todos os usuários (o refresh token do Olist vale só 1 dia)
//
// API v3: https://api.tiny.com.br/public-api/v3   ·   GET /ordem-compra (lista, sem itens) · GET /ordem-compra/{id}
// situacao: 0 em aberto · 1 atendido · 2 cancelado · 3 em andamento

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const API = 'https://api.tiny.com.br/public-api/v3'
const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'
const dia = (d: unknown) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null }
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }

type Ctx = { supaUrl: string; dbH: Record<string, string> }

// devolve um access token válido para o usuário, renovando se faltar menos de `margemMs` para expirar
async function acesso(ctx: Ctx, cfg: any, margemMs = 5 * 60 * 1000): Promise<{ token?: string; erro?: string }> {
  if (!cfg?.refresh_token || !cfg?.client_id) return { erro: 'Olist (compras) não autorizado: autorize em Configurações.' }
  if (cfg.access_token && cfg.expira_em && new Date(cfg.expira_em).getTime() - Date.now() > margemMs) return { token: cfg.access_token }
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token })
  })
  const j = await r.json().catch(() => null)
  const grava = (campos: Record<string, unknown>) => fetch(`${ctx.supaUrl}/rest/v1/olist_config?usuario_id=eq.${cfg.usuario_id}`, { method: 'PATCH', headers: { ...ctx.dbH, Prefer: 'return=minimal' }, body: JSON.stringify(campos) })
  if (!r.ok || !j?.access_token) {
    const msg = 'A autorização do Olist expirou. Autorize de novo em Configurações.'
    await grava({ v3_erro: msg })
    return { erro: msg }
  }
  await grava({ access_token: j.access_token, refresh_token: j.refresh_token || cfg.refresh_token, expira_em: new Date(Date.now() + (num(j.expires_in) || 14400) * 1000).toISOString(), v3_erro: null })
  return { token: j.access_token }
}

async function api(caminho: string, token: string) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: ctrl.signal })
    const j = await r.json().catch(() => null)
    return { status: r.status, json: j }
  } catch (e) { return { status: 0, json: { erro: String(e) } } }
  finally { clearTimeout(t) }
}

// os itens de uma ordem, tolerando nomes de campo diferentes
function itensDe(det: any) {
  const lista: any[] = Array.isArray(det?.itens) ? det.itens : Array.isArray(det?.produtos) ? det.produtos : []
  return lista.map(i => {
    const p = i?.produto || i
    return {
      sku: String(p?.sku ?? p?.codigo ?? i?.codigo ?? '').trim(),
      descricao: String(p?.descricao ?? p?.nome ?? i?.descricao ?? '').trim(),
      qtd: num(i?.quantidade ?? i?.qtd),
      valor: num(i?.valor ?? i?.valorUnitario ?? i?.preco),
    }
  }).filter(i => i.sku || i.descricao)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const ctx: Ctx = { supaUrl, dbH: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' } }
    const body = await req.json().catch(() => ({}))
    const CAMPOS = 'usuario_id,client_id,client_secret,access_token,refresh_token,expira_em'

    // ── cron: mantém as autorizações vivas ──
    if (body?.cron === true) {
      if (!Deno.env.get('CRON_SECRET') || body.secret !== Deno.env.get('CRON_SECRET')) return resp({ error: 'não autorizado' }, 401)
      const linhas = await fetch(`${supaUrl}/rest/v1/olist_config?refresh_token=not.is.null&select=${CAMPOS}`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
      let ok = 0, falhou = 0
      for (const cfg of (Array.isArray(linhas) ? linhas : [])) { const a = await acesso(ctx, cfg, 3 * 60 * 60 * 1000); if (a.token) ok++; else falhou++ }
      return resp({ ok: true, renovados: ok, falhas: falhou })
    }

    // ── usuário logado ──
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()
    const linhas = await fetch(`${supaUrl}/rest/v1/olist_config?usuario_id=eq.${userId}&select=${CAMPOS}&limit=1`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
    const a = await acesso(ctx, Array.isArray(linhas) ? linhas[0] : null)
    if (!a.token) return resp({ error: a.erro }, 404)
    const acao = String(body?.acao || 'ordens')

    if (acao === 'bruto') {
      const lista = await api('/ordem-compra?limit=3&orderBy=desc', a.token)
      const id = body?.id || lista.json?.itens?.[0]?.id
      const det = id ? await api(`/ordem-compra/${id}`, a.token) : null
      return resp({ ok: true, lista: { status: lista.status, corpo: JSON.stringify(lista.json).slice(0, 2500) }, detalhe: det ? { status: det.status, corpo: JSON.stringify(det.json).slice(0, 4000) } : null })
    }

    if (acao === 'ordens') {
      // lista: em aberto (0), em andamento (3) e atendidas (1) recentes
      const desde = new Date(Date.now() - 90 * 86400000).toISOString().substring(0, 10)
      const ordens = new Map<number, any>()
      for (const filtro of ['situacao=0', 'situacao=3', `situacao=1&dataInicial=${desde}`]) {
        for (let off = 0; off < 1000; off += 100) {
          const r = await api(`/ordem-compra?${filtro}&limit=100&offset=${off}`, a.token)
          if (r.status === 429) return resp({ error: 'O Olist bloqueou por excesso de chamadas. Tente em um minuto.', limite: true }, 429)
          const itens = Array.isArray(r.json?.itens) ? r.json.itens : null
          if (!itens) { if (r.status !== 200) return resp({ error: `O Olist respondeu http ${r.status} ao listar as ordens de compra. Confira se o aplicativo tem a permissão "Ordem de Compra".` }, 502); break }
          itens.forEach((o: any) => { if (o?.id) ordens.set(Number(o.id), o) })
          if (itens.length < 100) break
        }
      }
      // o que já está guardado
      const guard = await fetch(`${supaUrl}/rest/v1/olist_ordens?usuario_id=eq.${userId}&select=id,situacao,total,itens&limit=2000`, { headers: ctx.dbH }).then(r => r.json()).catch(() => [])
      const tem = new Map<number, any>((Array.isArray(guard) ? guard : []).map((g: any) => [Number(g.id), g]))
      const gravar: any[] = []
      let buscados = 0
      for (const [id, o] of ordens) {
        const sit = o.situacao == null ? null : Number(o.situacao), total = num(o.totalPedidoCompra ?? o.totalProdutos)
        const g = tem.get(id)
        let itens = g?.itens
        // busca os itens quando é nova, quando mudou de valor ou quando ainda está aberta e sem itens
        if (!g || !Array.isArray(g.itens) || !g.itens.length || num(g.total) !== total) {
          if (buscados >= 40) continue                       // o resto fica para a próxima chamada
          const d = await api(`/ordem-compra/${id}`, a.token); buscados++
          if (d.status === 429) break
          if (d.status === 200) itens = itensDe(d.json)
          await new Promise(ok => setTimeout(ok, 250))
        }
        gravar.push({ usuario_id: userId, id, numero: o.numero == null ? null : String(o.numero), data: dia(o.data), data_prevista: dia(o.dataPrevista), situacao: sit,
          fornecedor: String(o.contato?.nome || '').trim(), total, itens: itens || [], atualizado_em: new Date().toISOString() })
      }
      if (gravar.length) {
        const g = await fetch(`${supaUrl}/rest/v1/olist_ordens?on_conflict=usuario_id,id`, { method: 'POST', headers: { ...ctx.dbH, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(gravar) })
        if (!g.ok) return resp({ error: 'não consegui guardar as ordens: ' + (await g.text()).slice(0, 200) }, 500)
      }
      return resp({ ok: true, ordens: gravar.map(({ usuario_id, ...r }) => r), total: gravar.length, faltaDetalhe: ordens.size - gravar.length })
    }

    return resp({ error: 'ação desconhecida' }, 400)
  } catch (err) {
    console.error('olist-compras error:', err)
    return resp({ error: String(err) }, 500)
  }
})
