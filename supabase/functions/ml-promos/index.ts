// ml-promos — Central de promoções do Mercado Livre (LEITURA).
//
//   { acao: 'lista', conta }                                   promoções da conta (campanhas, ofertas, cupons de campanha)
//   { acao: 'itens', conta, id, tipo, situacao?, depois? }     anúncios de uma promoção (50 por chamada; "depois" continua a lista)
//
// Participar/sair de promoção (gravação no ML) fica para uma próxima etapa: entra aqui como novas ações.
// O token do ML nunca sai do servidor.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const ML = 'https://api.mercadolibre.com'

async function token(supaUrl: string, dbH: Record<string, string>, userId: string, conta: string, clientId: string, secret: string) {
  const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&select=access_token,refresh_token,expires_at`, { headers: dbH }).then(r => r.json()).catch(() => [])
  const t = Array.isArray(rows) ? rows[0] : null
  if (!t) return null
  if (new Date(t.expires_at) > new Date(Date.now() + 60000)) return t.access_token as string
  const ref = await fetch(ML + '/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: t.refresh_token })
  }).then(r => r.json()).catch(() => null)
  if (!ref?.access_token) return null
  await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}`, {
    method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ access_token: ref.access_token, refresh_token: ref.refresh_token, expires_at: new Date(Date.now() + ref.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() })
  })
  return ref.access_token as string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const clientId = Deno.env.get('ML_CLIENT_ID')!, secret = Deno.env.get('ML_CLIENT_SECRET')!
    const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    const body = await req.json().catch(() => ({}))
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    const { id: userId } = await jwtRes.json()

    const conta = String(body?.conta || '').replace(/\D/g, '')
    if (!conta) return resp({ error: 'Escolha uma loja.' }, 400)
    const tk = await token(supaUrl, dbH, userId, conta, clientId, secret)
    if (!tk) return resp({ error: 'A conta do Mercado Livre está desconectada. Reconecte em Configurações.' }, 400)
    const g = async (url: string) => { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } }).catch(() => null); if (!r) return { erro: 'sem resposta' }; const j = await r.json().catch(() => null); return r.ok ? j : { erro: (j && (j.message || j.error)) || ('http ' + r.status) } }

    // ---------- CAMPANHAS DO VENDEDOR (gravam na conta do Mercado Livre) ----------
    // chamada genérica com método e corpo
    const chama = async (metodo: string, url: string, corpo?: unknown) => {
      const r = await fetch(url, { method: metodo, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }).catch(() => null)
      if (!r) return { ok: false, status: 0, erro: 'sem resposta do Mercado Livre' }
      const j: any = await r.json().catch(() => null)
      return r.ok ? { ok: true, status: r.status, dados: j } : { ok: false, status: r.status, erro: (j && (j.message || j.error || (j.cause && JSON.stringify(j.cause)))) || ('http ' + r.status) }
    }
    const idCamp = (x: unknown) => /^C-MLB\d{3,14}$/.test(String(x)) ? String(x) : ''
    const idItem = (x: unknown) => /^MLB\d{6,14}$/.test(String(x)) ? String(x) : ''

    // promoções de UM anúncio (todas as campanhas em que ele está ou pode entrar)
    if (body?.acao === 'do_anuncio') {
      const item = idItem(body?.item); if (!item) return resp({ error: 'Anúncio inválido.' }, 400)
      const j: any = await g(`${ML}/seller-promotions/items/${item}?app_version=v2`)
      if (!j || j.erro) return resp({ ok: false, motivo: (j && j.erro) || 'sem resposta' })
      return resp({ ok: true, promos: (Array.isArray(j) ? j : []).map((x: any) => ({ id: x.id, tipo: x.type, sub: x.sub_type || '', situacao: x.status || '', nome: x.name || '', preco: Number(x.price) || 0, original: Number(x.original_price) || 0,
        ml_pct: Number(x.meli_percentage) || 0, vendedor_pct: Number(x.seller_percentage) || 0, inicio: x.start_date || '', fim: x.finish_date || '', sugerido: Number(x.suggested_discounted_price) || 0, minimo: Number(x.min_discounted_price) || 0, maximo: Number(x.max_discounted_price) || 0, ref: x.ref_id || x.offer_id || '', estoque_min: Number(x.stock?.min) || 0, estoque_max: Number(x.stock?.max) || 0 })) })
    }
    // promoções EM ANDAMENTO de vários anúncios (para o selo "Promoção ativa" da lista, sem abrir anúncio por anúncio).
    // O preço "de" de /items não serve para isso (vem vazio em campanha do vendedor), então consulta as promoções de cada
    // anúncio, 8 por vez, até 120 anúncios por chamada.
    if (body?.acao === 'ativas') {
      const ids = [...new Set((Array.isArray(body?.itens) ? body.itens : []).map((x: unknown) => String(x)).filter((x: string) => /^MLB\d{6,14}$/.test(x)))].slice(0, 120) as string[]
      // reb = maior % de rebate do Mercado Livre (meli_percentage) entre as promoções em andamento; reb_oferta = entre as que o anúncio pode entrar
      const out: { item: string, n: number, nome: string, reb: number, reb_oferta: number }[] = []
      const maxReb = (l: any[]) => l.reduce((m: number, x: any) => Math.max(m, Number(x.meli_percentage) || 0), 0)
      for (let i = 0; i < ids.length; i += 8) {
        await Promise.all(ids.slice(i, i + 8).map(async item => {
          const j: any = await g(`${ML}/seller-promotions/items/${item}?app_version=v2`)
          if (!Array.isArray(j)) return
          const at = j.filter((x: any) => x.status === 'started')
          out.push({ item, n: at.length, nome: at.map((x: any) => x.name || x.type || '').filter(Boolean).slice(0, 4).join(', '),
            reb: maxReb(at), reb_oferta: maxReb(j.filter((x: any) => x.status === 'candidate' || x.status === 'pending')) })
        }))
      }
      return resp({ ok: true, ativas: out })
    }
    // todos os anúncios da conta (ativos e pausados), só os códigos
    if (body?.acao === 'anuncios') {
      const ids: { item: string, pausado: boolean }[] = []
      for (const st of ['active', 'paused']) {
        let scroll = ''
        for (let k = 0; k < 30; k++) {
          const j: any = await g(`${ML}/users/${conta}/items/search?search_type=scan&limit=100&status=${st}${scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''}`)
          if (!j || j.erro || !(j.results || []).length) break
          for (const i of j.results) ids.push({ item: String(i), pausado: st === 'paused' })
          scroll = j.scroll_id || ''; if (!scroll) break
        }
      }
      return resp({ ok: true, anuncios: ids })
    }
    // participar de uma promoção com UM anúncio. Campanhas com preço livre pedem "preco"; as do Mercado Livre com preço pronto usam a referência da oferta.
    if (body?.acao === 'participar' || body?.acao === 'sair') {
      const item = idItem(body?.item), pid = String(body?.id || ''), tipo = String(body?.tipo || '')
      if (!item || !/^[A-Za-z0-9_-]{1,40}$/.test(pid) || !/^[A-Z_]{1,40}$/.test(tipo)) return resp({ error: 'Dados da promoção inválidos.' }, 400)
      const ref = /^[A-Za-z0-9_-]{1,80}$/.test(String(body?.ref || '')) ? String(body.ref) : ''
      if (body.acao === 'sair') {
        const p = new URLSearchParams({ promotion_type: tipo, promotion_id: pid, app_version: 'v2' }); if (ref && tipo !== 'SELLER_CAMPAIGN' && tipo !== 'DEAL') p.set('offer_id', ref)
        const r = await chama('DELETE', `${ML}/seller-promotions/items/${item}?${p}`)
        return resp(r.ok ? { ok: true } : { ok: false, motivo: r.erro })
      }
      const corpo: Record<string, unknown> = { promotion_id: pid, promotion_type: tipo }
      const comPreco = ['SELLER_CAMPAIGN', 'DEAL', 'DOD', 'LIGHTNING', 'PRICE_DISCOUNT'].includes(tipo)
      if (comPreco) { const p = Math.round(Number(body?.preco) * 100) / 100; if (!(p > 0)) return resp({ error: 'Informe o preço com desconto.' }, 400); corpo.deal_price = p }
      else { if (!ref) return resp({ error: 'Esta promoção não trouxe a referência da oferta. Atualize a lista e tente de novo.' }, 400); corpo.offer_id = ref }
      if (comPreco && Number(body?.preco_meli) > 0) { const pm = Math.round(Number(body.preco_meli) * 100) / 100; if (pm >= Number(corpo.deal_price)) return resp({ error: 'O preço exclusivo Meli+ precisa ser menor que o preço da promoção.' }, 400); corpo.top_deal_price = pm }
      if (tipo === 'LIGHTNING') { const e = Math.round(Number(body?.estoque)); if (!(e > 0)) return resp({ error: 'Informe o estoque reservado para a oferta relâmpago.' }, 400); corpo.stock = e }
      const r = await chama('POST', `${ML}/seller-promotions/items/${item}?app_version=v2`, corpo)
      return resp(r.ok ? { ok: true, preco: Number(r.dados?.price) || null, original: Number(r.dados?.original_price) || null } : { ok: false, motivo: r.erro })
    }
    // anúncios de uma campanha do vendedor: participantes (com preço) e candidatos (com mínimo, máximo e sugerido). Guarda a foto da campanha no banco.
    if (body?.acao === 'campanha_itens') {
      const id = idCamp(body?.id); if (!id) return resp({ error: 'Campanha inválida.' }, 400)
      const cab: any = await g(`${ML}/seller-promotions/promotions/${id}?promotion_type=SELLER_CAMPAIGN&app_version=v2`)
      if (!cab || cab.erro) return resp({ ok: false, motivo: (cab && cab.erro) || 'sem resposta' })
      const todos: any[] = []; let depois = ''
      for (let k = 0; k < 40; k++) {
        const p = new URLSearchParams({ promotion_type: 'SELLER_CAMPAIGN', app_version: 'v2', limit: '50' }); if (depois) p.set('search_after', depois)
        const j: any = await g(`${ML}/seller-promotions/promotions/${id}/items?${p}`)
        if (!j || j.erro) break
        todos.push(...(j.results || [])); depois = j.paging?.searchAfter || ''
        if (!depois || !(j.results || []).length) break
      }
      const itens = todos.map((x: any) => ({ item: x.id, situacao: x.status || '', original: Number(x.original_price) || 0, preco: Number(x.price) || 0, sugerido: Number(x.suggested_discounted_price) || 0, minimo: Number(x.min_discounted_price) || 0, maximo: Number(x.max_discounted_price) || 0, pausado: false }))
      {
        const ja = new Set(itens.map(x => x.item)), pausados: string[] = []; let scroll = ''
        for (let k = 0; k < 20; k++) {
          const j: any = await g(`${ML}/users/${conta}/items/search?search_type=scan&limit=100&status=paused${scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''}`)
          if (!j || j.erro || !(j.results || []).length) break
          for (const i of j.results) if (!ja.has(String(i))) pausados.push(String(i))
          scroll = j.scroll_id || ''; if (!scroll) break
        }
        for (let i = 0; i < pausados.length && i < 300; i += 10) {
          await Promise.all(pausados.slice(i, i + 10).map(async it => {
            const pj: any = await g(`${ML}/seller-promotions/items/${it}?app_version=v2`)
            const c = (Array.isArray(pj) ? pj : []).find((x: any) => x?.id === id)
            if (c && (c.status === 'started' || c.status === 'pending')) itens.push({ item: it, situacao: c.status, original: Number(c.original_price) || 0, preco: Number(c.price) || 0, sugerido: 0, minimo: 0, maximo: 0, pausado: true })
          }))
        }
      }
      const dentro = itens.filter(x => x.situacao === 'started' || x.situacao === 'pending')
      const camp = { id: cab.id, nome: cab.name || '', sub: cab.sub_type || '', situacao: cab.status || '', inicio: cab.start_date || '', fim: cab.finish_date || '', pct_fixa: Number(cab.fixed_percentage) || null }
      await fetch(`${supaUrl}/rest/v1/promo_campanhas?on_conflict=usuario_id,ml_user_id,id`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ usuario_id: userId, ml_user_id: conta, id: camp.id, nome: camp.nome, sub_tipo: camp.sub, situacao: camp.situacao, inicio: camp.inicio || null, fim: camp.fim || null, pct_fixa: camp.pct_fixa, itens: dentro.map(x => ({ item: x.item, preco: x.preco, original: x.original, pausado: !!x.pausado })), atualizado: new Date().toISOString() }]) })
      return resp({ ok: true, campanha: camp, itens })
    }
    // cria uma campanha do vendedor
    if (body?.acao === 'campanha_criar') {
      const nome = String(body?.nome || '').trim().slice(0, 25), sub = body?.sub === 'FIXED_PERCENTAGE' ? 'FIXED_PERCENTAGE' : 'FLEXIBLE_PERCENTAGE'
      const dia = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s) : ''
      const ini = dia(body?.inicio), fim = dia(body?.fim)
      if (!nome || !ini || !fim || fim < ini) return resp({ error: 'Informe o nome e as datas de início e de fim da campanha.' }, 400)
      const corpo: Record<string, unknown> = { promotion_type: 'SELLER_CAMPAIGN', name: nome, sub_type: sub, start_date: ini + 'T00:00:00', finish_date: fim + 'T23:59:59' }
      if (sub === 'FIXED_PERCENTAGE') { const p = Number(body?.pct_fixa); if (!(p >= 5 && p <= 80)) return resp({ error: 'Na porcentagem fixa, informe um desconto entre 5% e 80%.' }, 400); corpo.fixed_percentage = p }
      const r = await chama('POST', `${ML}/seller-promotions/promotions?app_version=v2`, corpo)
      if (!r.ok) return resp({ ok: false, motivo: r.erro })
      return resp({ ok: true, campanha: { id: r.dados?.id, nome: r.dados?.name, sub: r.dados?.sub_type, situacao: r.dados?.status, inicio: r.dados?.start_date, fim: r.dados?.finish_date } })
    }
    // altera nome e/ou datas de uma campanha
    if (body?.acao === 'campanha_editar') {
      const id = idCamp(body?.id); if (!id) return resp({ error: 'Campanha inválida.' }, 400)
      const corpo: Record<string, unknown> = { promotion_type: 'SELLER_CAMPAIGN' }
      if (body?.nome) corpo.name = String(body.nome).trim().slice(0, 25)
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(body?.inicio))) corpo.start_date = body.inicio + 'T00:00:00'
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(body?.fim))) corpo.finish_date = body.fim + 'T23:59:59'
      const r = await chama('PUT', `${ML}/seller-promotions/promotions/${id}?app_version=v2`, corpo)
      return resp(r.ok ? { ok: true } : { ok: false, motivo: r.erro })
    }
    // apaga uma campanha inteira (o front pede confirmação digitada)
    if (body?.acao === 'campanha_excluir') {
      const id = idCamp(body?.id); if (!id) return resp({ error: 'Campanha inválida.' }, 400)
      const urlCamp = ML + '/seller-promotions/promotions/' + id + '?promotion_type=SELLER_CAMPAIGN&app_version=v2'
      // o Mercado Livre só apaga a campanha vazia: a primeira chamada tira os anúncios dela, a segunda apaga. Confere no fim.
      let ultimo = ''
      for (let k = 0; k < 4; k++) {
        const r = await chama('DELETE', urlCamp)
        if (!r.ok) ultimo = String(r.erro || '')
        await new Promise(res => setTimeout(res, 1500))
        const c: any = await g(urlCamp)
        if (c && c.status === 'deleted') return resp({ ok: true })
      }
      return resp({ ok: false, motivo: ultimo || 'o Mercado Livre não confirmou a exclusão; tente de novo em um minuto' })
    }
    // põe (ou atualiza o preço de) anúncios numa campanha e tira os pedidos: { id, por: [{ item, preco }], tirar: [item] } — até 40 por chamada
    if (body?.acao === 'campanha_gravar') {
      const id = idCamp(body?.id); if (!id) return resp({ error: 'Campanha inválida.' }, 400)
      const por = (Array.isArray(body?.por) ? body.por : []).filter((x: any) => idItem(x?.item) && Number(x?.preco) > 0).slice(0, 40)
      const tirar = (Array.isArray(body?.tirar) ? body.tirar : []).map(idItem).filter(Boolean).slice(0, 40)
      const res: any[] = []
      for (let i = 0; i < por.length; i += 5) {
        await Promise.all(por.slice(i, i + 5).map(async (x: any) => {
          const r = await chama('POST', `${ML}/seller-promotions/items/${x.item}?app_version=v2`, { promotion_id: id, promotion_type: 'SELLER_CAMPAIGN', deal_price: Math.round(Number(x.preco) * 100) / 100 })
          res.push({ item: x.item, acao: 'por', ok: r.ok, motivo: r.ok ? '' : r.erro, preco: r.ok ? Number(r.dados?.price) || Number(x.preco) : null })
        }))
      }
      for (const it of tirar) {
        // sempre com o id da campanha: tira o anúncio SÓ desta campanha
        const r = await chama('DELETE', `${ML}/seller-promotions/items/${it}?promotion_type=SELLER_CAMPAIGN&promotion_id=${id}&app_version=v2`)
        res.push({ item: it, acao: 'tirar', ok: r.ok, motivo: r.ok ? '' : r.erro })
      }
      return resp({ ok: true, resultados: res })
    }

    // medida que o ML registrou em cada envio (agência/coleta): { acao: 'medidas_envio', conta, envios: [{ pedido, envio }] } — até 60 por chamada
    if (body?.acao === 'medidas_envio') {
      const lista = (Array.isArray(body?.envios) ? body.envios : []).filter((x: any) => /^\d{6,20}$/.test(String(x?.pedido)) && /^\d{6,20}$/.test(String(x?.envio))).slice(0, 60)
      const linhas: any[] = []
      for (let i = 0; i < lista.length; i += 12) {
        await Promise.all(lista.slice(i, i + 12).map(async (x: any) => {
          const r = await fetch(`${ML}/shipments/${x.envio}`, { headers: { Authorization: 'Bearer ' + tk, 'x-format-new': 'true' } }).catch(() => null)
          const j: any = r && r.ok ? await r.json().catch(() => null) : null; const d = j?.dimensions
          // sem medida no envio também é gravado (com nulos), para não consultar de novo toda vez
          linhas.push({ usuario_id: userId, order_id: Number(x.pedido), a: Number(d?.height) || null, l: Number(d?.width) || null, c: Number(d?.length) || null, g: Number(d?.weight) || null, lido_em: new Date().toISOString() })
        }))
      }
      if (linhas.length) await fetch(`${supaUrl}/rest/v1/frete_envio_medida?on_conflict=usuario_id,order_id`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
      return resp({ ok: true, lidos: linhas.length, com_medida: linhas.filter(l => l.a).length })
    }

    // dados de cada anúncio para calcular frete e margem sem depender de venda recente: peso tarifável (o peso que o
    // ML usa para cobrar o frete), tarifa de venda, SKU, preço. Guarda em ml_itens_base. Até 40 anúncios por chamada.
    if (body?.acao === 'base') {
      const ids = [...new Set((Array.isArray(body?.itens) ? body.itens : []).map((x: unknown) => String(x)).filter((x: string) => /^MLB\d{6,14}$/.test(x)))].slice(0, 40) as string[]
      if (!ids.length) return resp({ ok: true, itens: [] })
      const linhas: any[] = []
      const taxas = new Map<string, number>()
      // Medida que o ML registrou: a do PACOTE dos últimos envios de 1 unidade do anúncio (um conjunto do Full e um de
      // agência/coleta). A medida "do item" em /shipments/{id}/items não serve: às vezes vem de outra origem
      // (optimal_box) com números que não são os da embalagem. Lê até 3 envios e fica com a medida que mais se repete.
      const vs: any[] = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&item_id=in.(${ids.join(',')})&status=eq.paid&qtd=eq.1&shipping_id=not.is.null&logistic_type=neq.self_service&select=item_id,shipping_id,logistic_type&order=data_venda.desc&limit=6000`, { headers: dbH }).then(r => r.json()).catch(() => [])
      const lista = Array.isArray(vs) ? vs : []
      const vezes = new Map<string, number>(); for (const v of lista) vezes.set(String(v.shipping_id), (vezes.get(String(v.shipping_id)) || 0) + 1)
      const ultimos = new Map<string, string[]>()
      for (const v of lista) { if (vezes.get(String(v.shipping_id)) !== 1) continue; const k = v.item_id + '|' + (v.logistic_type === 'fulfillment' ? 'full' : 'ag'); const l = ultimos.get(k) || []; if (l.length < 3) { l.push(String(v.shipping_id)); ultimos.set(k, l) } }
      const medidaEnvio = async (item: string, tipo: string) => {
        const sids = ultimos.get(item + '|' + tipo) || []; if (!sids.length) return null
        const lidas = await Promise.all(sids.map(async sid => {
          const r = await fetch(`${ML}/shipments/${sid}`, { headers: { Authorization: 'Bearer ' + tk, 'x-format-new': 'true' } }).catch(() => null)
          const j: any = r && r.ok ? await r.json().catch(() => null) : null; const d = j?.dimensions
          return d && Number(d.height) > 0 && Number(d.width) > 0 && Number(d.length) > 0 ? { a: Number(d.height), l: Number(d.width), c: Number(d.length), g: Number(d.weight) || null, envio: sid, origem: 'pacote' } : null
        }))
        const ok = lidas.filter(Boolean) as any[]; if (!ok.length) return null
        const cont = new Map<string, number>(); ok.forEach(m => { const k = [m.a, m.l, m.c].sort((x, y) => x - y).join('x'); cont.set(k, (cont.get(k) || 0) + 1) })
        const melhor = [...cont.entries()].sort((x, y) => y[1] - x[1])[0][0]
        return ok.find(m => [m.a, m.l, m.c].sort((x, y) => x - y).join('x') === melhor)
      }
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20)
        const mg: any = await g(`${ML}/items?ids=${lote.join(',')}&attributes=id,title,thumbnail,price,category_id,listing_type_id,seller_custom_field,attributes,shipping,variations&include_attributes=all`)
        const corpos = (Array.isArray(mg) ? mg : []).filter((x: any) => x?.code === 200 && x.body?.id).map((x: any) => x.body)
        await Promise.all(corpos.map(async (it: any) => {
          const atr = (it.attributes || []).find((a: any) => a?.id === 'SELLER_SKU')
          const skuVar = ((it.variations || [])[0]?.attributes || []).find((a: any) => a?.id === 'SELLER_SKU')
          const sku = String(atr?.value_name || it.seller_custom_field || skuVar?.value_name || (it.variations || [])[0]?.seller_custom_field || '').trim()
          const chave = it.category_id + '|' + it.listing_type_id
          const [mf, ma] = await Promise.all([medidaEnvio(it.id, 'full'), medidaEnvio(it.id, 'ag')])
          const [fr, tx]: any[] = await Promise.all([
            g(`${ML}/users/${conta}/shipping_options/free?item_id=${it.id}`),
            taxas.has(chave) ? Promise.resolve(null) : g(`${ML}/sites/MLB/listing_prices?price=${Number(it.price) || 100}&listing_type_id=${it.listing_type_id}&category_id=${it.category_id}`),
          ])
          if (tx && !tx.erro && tx.sale_fee_details?.percentage_fee != null) taxas.set(chave, Number(tx.sale_fee_details.percentage_fee) / 100)
          const cob = fr?.coverage?.all_country || {}
          // medidas: declaradas pelo vendedor (SELLER_PACKAGE_*) e medidas pelo ML (PACKAGE_*), em cm e g
          const med = (id: string) => { const a = (it.attributes || []).find((x: any) => x?.id === id); const v = parseFloat(String(a?.value_name || '').replace(',', '.')); if (!(v > 0)) return null; return /kg/i.test(String(a?.value_name)) ? v * 1000 : v }
          const fonte = (it.attributes || []).find((x: any) => x?.id === 'PACKAGE_DATA_SOURCE')
          linhas.push({
            usuario_id: userId, ml_user_id: conta, item_id: it.id, titulo: it.title || null, thumbnail: String(it.thumbnail || '').replace('http://', 'https://') || null, sku: sku || null,
            preco: Number(it.price) || null, categoria: it.category_id || null, tipo_anuncio: it.listing_type_id || null, tarifa_pct: taxas.get(chave) ?? null,
            peso_g: Number(cob.billable_weight) || null, frete_lista: Number(cob.list_cost) || null, logistica: it.shipping?.logistic_type || null, lido_em: new Date().toISOString(),
            decl_a: med('SELLER_PACKAGE_HEIGHT'), decl_l: med('SELLER_PACKAGE_WIDTH'), decl_c: med('SELLER_PACKAGE_LENGTH'), decl_g: med('SELLER_PACKAGE_WEIGHT'),
            full_a: mf?.a ?? null, full_l: mf?.l ?? null, full_c: mf?.c ?? null, full_g: mf?.g ?? null, full_envio: mf?.envio ?? null,
            ag_a: ma?.a ?? null, ag_l: ma?.l ?? null, ag_c: ma?.c ?? null, ag_g: ma?.g ?? null, ag_envio: ma?.envio ?? null, ag_origem: ma?.origem ?? null, env_lido: new Date().toISOString(),
            ml_a: med('PACKAGE_HEIGHT'), ml_l: med('PACKAGE_WIDTH'), ml_c: med('PACKAGE_LENGTH'), ml_g: med('PACKAGE_WEIGHT'), ml_origem: fonte?.value_name || null,
          })
        }))
      }
      // a tarifa da categoria pode ter chegado depois de alguma linha do mesmo lote
      linhas.forEach(l => { if (l.tarifa_pct == null) { const t = taxas.get(l.categoria + '|' + l.tipo_anuncio); if (t != null) l.tarifa_pct = t } })
      if (linhas.length) {
        await fetch(`${supaUrl}/rest/v1/ml_itens_base?on_conflict=usuario_id,ml_user_id,item_id`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) })
      }
      return resp({ ok: true, itens: linhas.map(({ usuario_id: _u, ...r }) => r), pedidos: ids.length })
    }

    if (body?.acao === 'itens') {
      const id = String(body?.id || ''), tipo = String(body?.tipo || '')
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !/^[A-Z_]{1,40}$/.test(tipo)) return resp({ error: 'Promoção inválida.' }, 400)
      const p = new URLSearchParams({ promotion_type: tipo, app_version: 'v2', limit: '50' })
      if (['candidate', 'pending', 'started'].includes(String(body?.situacao))) p.set('status', String(body.situacao))
      if (body?.depois) p.set('search_after', String(body.depois))
      const j: any = await g(`${ML}/seller-promotions/promotions/${id}/items?${p}`)
      if (!j || j.erro) return resp({ ok: false, motivo: (j && j.erro) || 'sem resposta' })
      const itens = (j.results || []).map((x: any) => ({
        item: x.id, situacao: x.status || '', original: Number(x.original_price) || 0,
        preco: Number(x.price) || Number(x.suggested_discounted_price) || Number(x.max_discounted_price) || 0,
        sugerido: Number(x.suggested_discounted_price) || 0, minimo: Number(x.min_discounted_price) || 0, maximo: Number(x.max_discounted_price) || 0,
        ml_pct: Number(x.meli_percentage) || 0, vendedor_pct: Number(x.seller_percentage) || 0, inicio: x.start_date || '', fim: x.end_date || '', oferta: x.offer_id || '',
      }))
      return resp({ ok: true, itens, total: Number(j.paging?.total) || itens.length, depois: j.paging?.searchAfter || null })
    }

    const j: any = await g(`${ML}/seller-promotions/users/${conta}?app_version=v2`)
    if (!j || j.erro) return resp({ ok: false, motivo: (j && j.erro) || 'sem resposta' })
    const promos = (j.results || []).map((x: any) => ({ id: x.id, tipo: x.type, situacao: x.status || '', nome: x.name || '', inicio: x.start_date || '', fim: x.finish_date || '', prazo: x.deadline_date || '', beneficio: x.benefits?.type || '', ml_pct: Number(x.benefits?.meli_percent) || 0, vendedor_pct: Number(x.benefits?.seller_percent) || 0 }))
    return resp({ ok: true, promos })
  } catch (err) {
    console.error('ml-promos error:', err)
    return resp({ error: String(err) }, 500)
  }
})
