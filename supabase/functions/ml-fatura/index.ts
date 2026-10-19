// ml-fatura — cobranças da fatura do Mercado Livre que não são descontadas de uma venda (publicidade, armazenagem
// do Full, DIFAL, mensalidade da loja), gravadas uma a uma com o dia em que aconteceram (ml_fatura_linhas).
// O DRE soma por mês do dia da cobrança: a competência sai exata mesmo com a fatura indo do dia 23 ao dia 22.
//
// A API de faturamento aceita só 5 consultas por minuto por conta. Por isso a função trabalha aos poucos:
// cada chamada faz no máximo 4 consultas ao todo e guarda onde parou (ml_fatura_periodos.prox).
//   cron (a cada minuto)   body { cron: true, secret }   → todas as contas com algo a ler
//   tela                 body { acao: 'sync' } + JWT    → as contas do usuário (a tela repete até acabar)
// Passos por conta:  1) lista de faturas (1 vez por dia)   GET /billing/integration/monthly/periods
//                    2) resumo da fatura → tipos de cobrança que ela tem; tipo novo é sondado e classificado
//                    3) linhas dos tipos fora das vendas, 1000 por consulta, em ordem
//                   3b) releitura de alguns tipos numa fatura já lida (ml_fatura_periodos.reler_tipos), ex.: CVAF,
//                       que estava como 'venda' e não era lido. Fatura compactada volta a compactado = false no fim,
//                       e ml_fatura_compactar soma de novo o que entrou em ml_fatura_linhas
//                    4) cobranças das vendas canceladas (frete de ida e devolução), 20 vendas por consulta
//                       GET /billing/integration/group/ML/order/details → vendas_ml_cobr (DRE e tela de Vendas)
// Fatura aberta é relida uma vez por dia; fatura fechada, uma vez só.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const ML = 'https://api.mercadolibre.com/billing/integration'
const POR_CHAMADA = 4, PAGINA = 1000, FATURAS = 12
// cobranças de uma venda: a consulta devolve no máximo 250 linhas no total (com 50 vendas veio cortado; uma venda
// cancelada tem até 8 linhas), por isso 20 vendas por vez. Vendas canceladas dos últimos COBR_DIAS dias.
const COBR_LOTE = 20, COBR_DIAS = 100
const COBR_DEV = new Set(['CDSDB', 'CXDED', 'CXDID', 'BDSDB', 'BXDED', 'BXDID'])
const COBR_IDA = new Set(['CFFE', 'CFFI', 'CXDE', 'CXDI', 'CDSB', 'BFFE', 'BFFI', 'BXDE', 'BDSB'])
const tipoCobr = (sub: string, txt: string) => COBR_DEV.has(sub) || /devolu/i.test(txt) ? 'dev' : (COBR_IDA.has(sub) ? 'ida' : null)
// linha da fatura → ml_fatura_linhas
const linhaFatura = (uid: string, conta: string, periodo: string) => (c: any) => ({
  usuario_id: uid, ml_user_id: conta, detail_id: c.detail_id, periodo, dia: String(c.creation_date_time).slice(0, 10), quando: String(c.creation_date_time).slice(0, 19),
  sub_type: String(c.detail_sub_type || ''), valor: (String(c.detail_type) === 'BONUS' ? -1 : 1) * (Number(c.detail_amount) || 0),
  descricao: String(c.transaction_detail || '').slice(0, 200), bonifica: c.charge_bonified_id || null })
const linhaValida = (c: any) => c && c.detail_id && /^\d{4}-\d{2}-\d{2}/.test(String(c.creation_date_time))

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
    const db = (caminho: string, init: RequestInit = {}) => fetch(`${supaUrl}/rest/v1/${caminho}`, { ...init, headers: { ...dbH, ...(init.headers || {}) } })
    const body = await req.json().catch(() => ({}))

    let filtro = ''
    if (body?.cron === true) {
      const cronSecret = Deno.env.get('CRON_SECRET')
      if (cronSecret && body?.secret !== cronSecret) return resp({ error: 'Unauthorized' })
    } else {
      const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: req.headers.get('Authorization') || '' } })
      if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
      const { id } = await jwtRes.json()
      filtro = `&usuario_id=eq.${id}`
    }

    const contas = await db(`ml_tokens?select=usuario_id,ml_user_id,access_token,refresh_token,expires_at,historico_desde${filtro}`).then(r => r.json()).catch(() => [])
    if (!Array.isArray(contas) || !contas.length) return resp({ ok: true, contas: [] })
    const tiposRows = await db('ml_fatura_tipos?select=sub_type,classe').then(r => r.json()).catch(() => [])
    const tipos = new Map<string, string>((Array.isArray(tiposRows) ? tiposRows : []).map((t: any) => [String(t.sub_type), String(t.classe)]))
    const inicio = Date.now(), saida: any[] = []
    // medido em 12/10/2026: o limite de 5 consultas por minuto vale para o APLICATIVO inteiro, não por conta
    // (a primeira conta da rodada usa 4 e as seguintes recebem 429). Por isso o orçamento é da chamada toda,
    // e a cada minuto a fila começa por uma conta diferente.
    let usadas = 0, limite = false
    const gira = Math.floor(Date.now() / 60000) % contas.length
    const fila = [...contas.slice(gira), ...contas.slice(0, gira)]

    for (const t of fila) {
      if (Date.now() - inicio > 100000 || limite || usadas >= POR_CHAMADA) break
      const conta = String(t.ml_user_id), uid = String(t.usuario_id), chave = `usuario_id=eq.${uid}&ml_user_id=eq.${conta}`
      const info: any = { conta, consultas: 0 }
      // início do histórico da conta (conta nova = 30 dias; nulo = conta antiga, sem corte): fatura e cobranças anteriores não são lidas
      const desde: string | null = t.historico_desde ? String(t.historico_desde).slice(0, 10) : null
      const diasCobr = desde ? Math.max(1, Math.min(COBR_DIAS, Math.ceil((Date.now() - Date.parse(desde + 'T00:00:00-03:00')) / 86400000))) : COBR_DIAS
      saida.push(info)
      try {
        let periodos: any[] = await db(`ml_fatura_periodos?${chave}&select=*&order=periodo.desc`).then(r => r.json()).catch(() => [])
        if (!Array.isArray(periodos)) periodos = []
        const ultimaLista = periodos.reduce((m, p) => Math.max(m, p.lido_em ? Date.parse(p.lido_em) : 0), 0)
        // botão "Atualizar agora" da tela: relê a fatura aberta sem esperar a madrugada (no máximo uma vez a cada 10 minutos)
        const forcar = body?.forcar === true && body?.cron !== true && Date.now() - ultimaLista > 600000
        const precisaLista = !periodos.length || forcar || Date.now() - ultimaLista > 20 * 3600000
        const pendente = periodos.some(p => !p.completo || (Array.isArray(p.reler_tipos) && p.reler_tipos.length))
        const vendasPend: number[] = await db('rpc/vendas_ml_cobr_pendentes', { method: 'POST', body: JSON.stringify({ p_uid: uid, p_conta: conta, p_dias: diasCobr, p_limite: 200 }) })
          .then(r => r.json()).then(x => Array.isArray(x) ? x.map((y: any) => Number(y.order_id)).filter(Boolean) : []).catch(() => [])
        if (!precisaLista && !pendente && !vendasPend.length) { info.pendentes = 0; continue }

        let token = t.access_token
        if (new Date(t.expires_at) <= new Date(Date.now() + 60000)) {
          const novo = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ML_CLIENT_ID')!, client_secret: Deno.env.get('ML_CLIENT_SECRET')!, refresh_token: t.refresh_token })
          }).then(r => r.json()).catch(() => ({}))
          if (!novo?.access_token) { info.erro = 'conexão expirada: reconecte a conta'; continue }
          token = novo.access_token
          await db(`ml_tokens?${chave}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ access_token: novo.access_token, refresh_token: novo.refresh_token, expires_at: new Date(Date.now() + (Number(novo.expires_in) || 21600) * 1000).toISOString(), updated_at: new Date().toISOString() }) })
        }
        const ml = async (caminho: string) => {
          if (limite || usadas >= POR_CHAMADA) return null
          info.consultas++; usadas++
          const r = await fetch(ML + caminho, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }).catch(() => null)
          if (!r) return null
          if (r.status === 429) { limite = true; info.limite = true; return null }
          if (!r.ok) { info.http = r.status; return null }
          return await r.json().catch(() => null)
        }

        // 1) lista de faturas, uma vez por dia; a fatura aberta volta a ser lida do começo
        if (precisaLista) {
          const j = await ml(`/monthly/periods?group=ML&document_type=BILL&limit=${FATURAS}`)
          if (!j) { if (info.http === 403) info.erro = 'sem permissão de faturamento no aplicativo'; continue }
          const agora = new Date().toISOString(), antes = new Map(periodos.map(p => [String(p.periodo), p]))
          const linhas = (j.results || []).filter((p: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.key)) && (!desde || !p.period?.date_to || String(p.period.date_to).slice(0, 10) >= desde)).map((p: any) => {
            const a = antes.get(String(p.key)), aberta = String(p.period_status) !== 'CLOSED'
            const reler = !a || aberta || a.situacao !== 'CLOSED'      // fechou desde a última leitura: lê mais uma vez inteira
            const venc = /^\d{4}-\d{2}-\d{2}$/.test(String(p.expiration_date)) && String(p.expiration_date) < '9000' ? p.expiration_date : null
            return { usuario_id: uid, ml_user_id: conta, periodo: p.key, de: p.period?.date_from || null, ate: p.period?.date_to || null, total: Number(p.amount) || 0, aberto: Number(p.unpaid_amount) || 0,
              situacao: aberta ? 'OPEN' : 'CLOSED', vencimento: venc, tipos: reler ? null : a.tipos, prox: reler ? 0 : a.prox, completo: reler ? false : a.completo, lido_em: agora }
          })
          if (linhas.length) await db('ml_fatura_periodos?on_conflict=usuario_id,ml_user_id,periodo', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
          periodos = await db(`ml_fatura_periodos?${chave}&select=*&order=periodo.desc`).then(r => r.json()).catch(() => [])
          if (!Array.isArray(periodos)) periodos = []
        }

        // 2 e 3) faturas pendentes, da mais nova para a mais antiga
        for (const p of periodos.filter(x => !x.completo)) {
          if (limite || usadas >= POR_CHAMADA) break
          const pk = `${chave}&periodo=eq.${p.periodo}`
          if (!Array.isArray(p.tipos)) {
            const s = await ml(`/periods/key/${p.periodo}/summary/details?group=ML&document_type=BILL`)
            if (!s) break
            const b = s.bill_includes || {}, vistos: string[] = [...(b.charges || []), ...(b.bonuses || [])].map((c: any) => String(c.type || '')).filter(Boolean)
            const novos = [...new Set(vistos)].filter(x => !tipos.has(x))
            let faltou = false
            for (const n of novos) {
              // tipo que eu não conheço: olho uma linha. Se ela aponta para uma venda ou envio, já está na venda.
              const d = await ml(`/periods/key/${p.periodo}/group/ML/details?document_type=BILL&limit=1&offset=0&detail_sub_types=${encodeURIComponent(n)}`)
              if (!d) { faltou = true; break }
              const l = (d.results || [])[0]
              const rot = [...(b.charges || []), ...(b.bonuses || [])].find((c: any) => c.type === n)?.label
              // comissão de afiliados aponta para a venda, mas é cobrada na fatura (não sai da venda)
              const classe = /afiliad|seguidores/i.test(String(l?.charge_info?.transaction_detail || '') + ' ' + String(rot || '')) ? 'afil' : l && (l.sales_info || l.shipping_info) ? 'venda' : 'outros'
              tipos.set(n, classe)
              await db('ml_fatura_tipos?on_conflict=sub_type', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([{ sub_type: n, rotulo: (l?.charge_info?.transaction_detail || (rot && rot !== n ? rot : null) || n), classe }]) })
            }
            if (faltou) break
            p.tipos = [...new Set(vistos)].filter(x => tipos.get(x) !== 'venda')
            p.prox = 0
            if (!p.tipos.length) { p.completo = true }
            await db(`ml_fatura_periodos?${pk}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ tipos: p.tipos, prox: 0, completo: !!p.completo, ...(p.completo ? { lido_ok: true } : {}) }) })
            if (p.completo) continue
          }
          while (!p.completo && !limite && usadas < POR_CHAMADA) {
            const d = await ml(`/periods/key/${p.periodo}/group/ML/details?document_type=BILL&limit=${PAGINA}&offset=${p.prox}&detail_sub_types=${encodeURIComponent(p.tipos.join(','))}&sort_by=ID&order_by=ASC`)
            if (!d) break
            const R: any[] = d.results || []
            const linhas = R.map(r => r.charge_info).filter(linhaValida).map(linhaFatura(uid, conta, p.periodo))
            if (linhas.length) {
              const g = await db('ml_fatura_linhas?on_conflict=usuario_id,ml_user_id,detail_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
              if (!g.ok) { info.erro = 'gravação: ' + (await g.text()).slice(0, 160); break }
            }
            p.prox += R.length
            if (!R.length || p.prox >= (Number(d.total) || 0)) p.completo = true
            await db(`ml_fatura_periodos?${pk}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ prox: p.prox, completo: p.completo, lido_em: new Date().toISOString(), ...(p.completo ? { lido_ok: true } : {}) }) })
            info.linhas = (info.linhas || 0) + linhas.length
          }
          if (info.erro) break
        }

        // 3b) releitura de tipos numa fatura já lida
        for (const p of periodos.filter(x => Array.isArray(x.reler_tipos) && x.reler_tipos.length)) {
          if (info.erro || limite || usadas >= POR_CHAMADA) break
          const pk = `${chave}&periodo=eq.${p.periodo}`
          const tr = (p.reler_tipos as string[]).filter(x => tipos.get(x) !== 'venda')
          let prox = Number(p.reler_prox) || 0, fim = !tr.length
          while (!fim && !limite && usadas < POR_CHAMADA) {
            const d = await ml(`/periods/key/${p.periodo}/group/ML/details?document_type=BILL&limit=${PAGINA}&offset=${prox}&detail_sub_types=${encodeURIComponent(tr.join(','))}&sort_by=ID&order_by=ASC`)
            if (!d) break
            const R: any[] = d.results || []
            const linhas = R.map(r => r.charge_info).filter(linhaValida).map(linhaFatura(uid, conta, p.periodo))
            if (linhas.length) {
              const g = await db('ml_fatura_linhas?on_conflict=usuario_id,ml_user_id,detail_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
              if (!g.ok) { info.erro = 'gravação: ' + (await g.text()).slice(0, 160); break }
            }
            prox += R.length
            fim = !R.length || prox >= (Number(d.total) || 0)
            info.linhas = (info.linhas || 0) + linhas.length
          }
          if (info.erro) break
          // compactado só volta a false no fim: ml_fatura_compactar regrava o total do dia pelo que está em linhas
          await db(`ml_fatura_periodos?${pk}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fim ? { reler_tipos: null, reler_prox: 0, ...(p.compactado ? { compactado: false } : {}) } : { reler_prox: prox }) })
        }

        // 4) vendas canceladas: frete de ida e devolução, cada cobrança no dia em que aconteceu
        let lote = COBR_LOTE
        for (let i = 0; i < vendasPend.length && !info.erro && !limite && usadas < POR_CHAMADA;) {
          const ids = vendasPend.slice(i, i + lote)
          const d = await ml(`/group/ML/order/details?order_ids=${ids.join(',')}&limit=250`)
          if (!d) break
          const R: any[] = d.results || []
          // resposta cortada (250 linhas): refaz com metade das vendas
          if (R.reduce((s, r) => s + (r.details || []).length, 0) >= 250 && ids.length > 1) { lote = Math.max(1, Math.floor(ids.length / 2)); continue }
          const linhas: any[] = []
          for (const r of R) for (const x of (r.details || [])) {
            const c = x.charge_info || {}, sub = String(c.detail_sub_type || ''), txt = String(c.transaction_detail || '')
            const tipo = tipoCobr(sub, txt)
            if (!tipo || !c.detail_id || !/^\d{4}-\d{2}-\d{2}/.test(String(c.creation_date_time))) continue
            linhas.push({ usuario_id: uid, ml_user_id: conta, detail_id: c.detail_id, order_id: r.order_id, dia: String(c.creation_date_time).slice(0, 10), tipo, sub_type: sub,
              valor: (String(c.detail_type) === 'BONUS' ? -1 : 1) * (Number(c.detail_amount) || 0), descricao: txt.slice(0, 200) })
          }
          if (linhas.length) {
            const g = await db('vendas_ml_cobr?on_conflict=usuario_id,ml_user_id,detail_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
            if (!g.ok) { info.erro = 'gravação das cobranças: ' + (await g.text()).slice(0, 160); break }
          }
          await db('rpc/vendas_ml_cobr_marcar', { method: 'POST', body: JSON.stringify({ p_uid: uid, p_conta: conta, p_vendas: ids }) })
          info.vendas = (info.vendas || 0) + ids.length
          i += ids.length
        }
        info.pendentes = periodos.filter(x => !x.completo).length
      } catch (e) { info.erro = String((e as Error)?.message || e).slice(0, 160) }
    }
    return resp({ ok: true, contas: saida.map(({ conta, consultas, pendentes, linhas, vendas, limite, erro, http }) => ({ conta, consultas, pendentes, linhas: linhas || 0, vendas: vendas || 0, limite: !!limite, erro: erro || null, http: http || null })) })
  } catch (e) {
    return resp({ error: String((e as Error)?.message || e) }, 500)
  }
})
