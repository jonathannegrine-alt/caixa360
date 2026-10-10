// olist-contas — contas a pagar do Olist (Tiny) pela API v2, para o Caixa 360.
// O navegador não fala direto com o Olist (o token fica só no servidor): ele chama esta função.
//
//   { acao: 'testar' }                 confere se o token gravado funciona
//   { acao: 'listar' }                 todas as contas a pagar (100 por página) + detalhes já guardados
//   { acao: 'detalhes', ids: [...] }   busca categoria/competência de até 25 contas e guarda em olist_contas
//
// API v2: POST https://api.tiny.com.br/api2/contas.pagar.pesquisa.php  e  conta.pagar.obter.php
// Limite do Olist: requisições por minuto conforme o plano; http 429 = passou do limite (o chamador espera e repete).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const iso = (d: unknown) => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }
const comp = (d: unknown) => { const m = String(d || '').match(/^(\d{2})\/(\d{4})$/); return m ? `${m[2]}-${m[1]}` : '' }

async function tiny(recurso: string, token: string, params: Record<string, string>) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await fetch(`https://api.tiny.com.br/api2/${recurso}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, formato: 'json', ...params }),
    })
    if (r.status === 429) return { limite: true }
    const j = await r.json().catch(() => null)
    const ret = j?.retorno
    if (!ret) return { erro: `resposta inesperada do Olist (http ${r.status})` }
    // código 6 = API bloqueada momentaneamente por excesso de acessos
    if (String(ret.codigo_erro) === '6') return { limite: true }
    if (ret.status === 'Erro') return { codigo: Number(ret.codigo_erro), erro: (ret.erros || []).map((e: any) => e?.erro).filter(Boolean).join('; ') || 'erro do Olist' }
    return { ret }
  } catch (e) { return { erro: 'sem resposta do Olist: ' + String(e) } }
  finally { clearTimeout(t) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }

    const cfg = await fetch(`${supaUrl}/rest/v1/olist_config?usuario_id=eq.${userId}&select=token&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const token = Array.isArray(cfg) && cfg[0]?.token ? String(cfg[0].token).trim() : ''
    if (!token) return resp({ error: 'Olist não conectado: cole o token em Configurações.' }, 404)

    const body = await req.json().catch(() => ({}))
    const acao = String(body?.acao || 'listar')

    if (acao === 'testar') {
      const r: any = await tiny('contas.pagar.pesquisa.php', token, { data_ini_vencimento: '01/01/2020', data_fim_vencimento: '31/12/2040', pagina: '1' })
      if (r.limite) return resp({ ok: false, error: 'O Olist bloqueou por excesso de chamadas. Tente em um minuto.' })
      if (r.erro && r.codigo !== 20) return resp({ ok: false, error: r.codigo === 2 ? 'Token inválido. Confira se copiou o token inteiro.' : r.erro })
      return resp({ ok: true, paginas: Number(r.ret?.numero_paginas) || 0 })
    }

    if (acao === 'listar') {
      const contas: any[] = []
      let paginas = 1
      for (let p = 1; p <= paginas && p <= 60; p++) {
        let r: any = await tiny('contas.pagar.pesquisa.php', token, { data_ini_vencimento: '01/01/2020', data_fim_vencimento: '31/12/2040', pagina: String(p) })
        if (r.limite) { await new Promise(ok => setTimeout(ok, 8000)); r = await tiny('contas.pagar.pesquisa.php', token, { data_ini_vencimento: '01/01/2020', data_fim_vencimento: '31/12/2040', pagina: String(p) }) }
        if (r.limite) return resp({ error: 'O Olist bloqueou por excesso de chamadas. A sincronização tenta de novo em alguns minutos.', limite: true }, 429)
        if (r.erro) { if (r.codigo === 20) break; return resp({ error: r.codigo === 2 ? 'Token inválido. Cole o token de novo em Configurações.' : r.erro }, 502) }
        paginas = Number(r.ret.numero_paginas) || 1
        for (const c of (r.ret.contas || [])) {
          const x = c?.conta; if (!x?.id) continue
          contas.push({ id: Number(x.id), forn: String(x.nome_cliente || '').trim(), historico: String(x.historico || '').trim(), numero_doc: String(x.numero_doc || '').trim(),
            venc: iso(x.data_vencimento), emissao: iso(x.data_emissao), valor: Number(x.valor) || 0, saldo: Number(x.saldo) || 0, situacao: String(x.situacao || '').toLowerCase() })
        }
      }
      // detalhes já guardados (categoria, competência)
      const det = new Map<number, any>()
      for (let off = 0; off < 20000; off += 1000) {
        const linhas = await fetch(`${supaUrl}/rest/v1/olist_contas?usuario_id=eq.${userId}&select=id,categoria,competencia,ocorrencia&order=id&limit=1000&offset=${off}`, { headers: dbH }).then(r => r.json()).catch(() => [])
        if (!Array.isArray(linhas) || !linhas.length) break
        linhas.forEach((l: any) => det.set(Number(l.id), l))
        if (linhas.length < 1000) break
      }
      for (const c of contas) { const d = det.get(c.id); if (d) { c.categoria = d.categoria || ''; c.competencia = d.competencia || ''; c.temDetalhe = true } }
      return resp({ ok: true, contas, total: contas.length, semDetalhe: contas.filter(c => !c.temDetalhe).length })
    }

    if (acao === 'detalhes') {
      const ids: number[] = (Array.isArray(body?.ids) ? body.ids : []).map((x: unknown) => Number(x)).filter((x: number) => x > 0).slice(0, 25)
      const feitos: any[] = []
      let limite = false
      for (const id of ids) {
        const r: any = await tiny('conta.pagar.obter.php', token, { id: String(id) })
        if (r.limite) { limite = true; break }
        if (r.erro) { feitos.push({ usuario_id: userId, id, categoria: '', competencia: '', ocorrencia: '', nro_documento: '' }); continue }   // conta apagada: grava vazio para não repetir
        const x = r.ret?.conta || {}
        feitos.push({ usuario_id: userId, id, categoria: String(x.categoria || '').trim(), competencia: comp(x.competencia), ocorrencia: String(x.ocorrencia || ''), nro_documento: String(x.nro_documento || '') })
        await new Promise(ok => setTimeout(ok, 350))
      }
      if (feitos.length) {
        const g = await fetch(`${supaUrl}/rest/v1/olist_contas?on_conflict=usuario_id,id`, { method: 'POST', headers: { ...dbH, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(feitos.map(f => ({ ...f, atualizado_em: new Date().toISOString() }))) })
        if (!g.ok) return resp({ error: 'não consegui guardar os detalhes: ' + (await g.text()).slice(0, 200) }, 500)
      }
      return resp({ ok: true, detalhes: feitos.map(f => ({ id: f.id, categoria: f.categoria, competencia: f.competencia })), limite })
    }

    return resp({ error: 'ação desconhecida' }, 400)
  } catch (err) {
    console.error('olist-contas error:', err)
    return resp({ error: String(err) }, 500)
  }
})
