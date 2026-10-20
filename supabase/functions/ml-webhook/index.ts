// ml-webhook — recebe as notificações do Mercado Livre (tópico orders_v2) para a venda aparecer no
// Caixa 360 logo depois de acontecer, sem esperar o agendamento de 15 minutos.
//
// O ML chama este endereço com { topic, resource: "/orders/123", user_id: <conta do vendedor> }.
// Aqui só disparamos a sincronização de hoje/ontem daquela conta (função ml-vendas, modo servidor).
// Não há segredo no endereço: a notificação não traz dado nenhum que seja gravado; quem busca os
// pedidos é o ml-vendas, com o token da própria conta. No máximo um disparo por conta a cada 20 s.
//
// Configuração (uma vez, no DevCenter do ML → aplicativo → "URL de retornos de chamada de notificação"):
//   https://qasrccmtrllotukyeiax.supabase.co/functions/v1/ml-webhook      (tópicos orders_v2, questions e messages marcados)
// Perguntas e mensagens: cada notificação grava uma linha em ml_avisos (src/avisos.js mostra o selo no menu).
// Reclamações e devoluções (tópicos claims / claims_actions): também viram aviso (selo no Pós-venda).
// Envios (tópico shipments): a situação do envio é lida na hora e gravada na venda (vendas_ml.envio_status).
// Anúncios (tópico items): preço, situação e estoque do anúncio são lidos e gravados em ml_itens_base.
// Estoque do Full (fbm_stock_operations / stock_locations): vira aviso "full"; a tela relê o estoque do Full sozinha.
// Avaliação do comprador (orders_feedback): só as negativas e neutras viram aviso "avaliacao" (aparecem no sininho).

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

const ultimo = new Map<string, number>()   // por conta, nesta instância

async function sincronizar(conta: string) {
  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
  // só contas conectadas ao Caixa 360
  const tem = await fetch(`${supaUrl}/rest/v1/ml_tokens?ml_user_id=eq.${conta}&select=usuario_id&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
  if (!Array.isArray(tem) || tem.length === 0) return
  // outra instância pode ter sincronizado agora há pouco
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().substring(0, 10)
  const dia = await fetch(`${supaUrl}/rest/v1/vendas_ml_dias?ml_user_id=eq.${conta}&dia=eq.${hoje}&select=sincronizado_em&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
  if (Array.isArray(dia) && dia[0] && Date.now() - new Date(dia[0].sincronizado_em).getTime() < 20000) return
  await fetch(`${supaUrl}/functions/v1/ml-vendas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cron: true, secret: Deno.env.get('CRON_SECRET') || '', conta, recentes: true })
  }).catch(() => null)
}

// venda de um dia já fechado (criada antes de ontem e paga agora, ou mudou depois): relê o dia da criação dela.
// A sincronização normal só refaz hoje e ontem; sem isto, venda com pagamento aprovado dias depois ficava de fora.
const diaVisto = new Map<string, number>()
async function vendaAntiga(conta: string, recurso: string) {
  const m = recurso.match(/\/orders\/(\d{10,20})/); if (!m) return
  const { supaUrl, dbH, toks } = await tokens(conta); if (!toks.length) return
  const r = await fetch(`https://api.mercadolibre.com/orders/${m[1]}`, { headers: { Authorization: `Bearer ${toks[0].access_token}` } }).catch(() => null)
  if (!r || !r.ok) return
  const o: any = await r.json().catch(() => null); if (!o || !o.date_created || o.status === 'payment_required') return
  const dia = new Date(new Date(o.date_created).getTime() - 3 * 3600000).toISOString().substring(0, 10)
  const ontem = new Date(Date.now() - 27 * 3600000).toISOString().substring(0, 10)
  if (dia >= ontem) return
  // já gravada com o mesmo status: nada a fazer
  const tem = await fetch(`${supaUrl}/rest/v1/vendas_ml?ml_user_id=eq.${conta}&order_id=eq.${m[1]}&select=status&limit=1`, { headers: dbH }).then(x => x.json()).catch(() => [])
  if (Array.isArray(tem) && tem[0] && tem[0].status === o.status) return
  const k = conta + '|' + dia; if (Date.now() - (diaVisto.get(k) || 0) < 60000) return
  diaVisto.set(k, Date.now())
  await fetch(`${supaUrl}/functions/v1/ml-vendas`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cron: true, secret: Deno.env.get('CRON_SECRET') || '', conta, dias: [dia] }) }).catch(() => null)
}

// reclamação nova: aciona o Pós-venda na hora para os donos da conta que ligaram a automação (a função pos-venda
// confere de novo e ignora se rodou há menos de 5 minutos). Quem não ligou continua só com o aviso.
async function posVendaJa(conta: string) {
  const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
  const donos = await fetch(`${supaUrl}/rest/v1/ml_tokens?ml_user_id=eq.${conta}&select=usuario_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
  if (!Array.isArray(donos) || !donos.length) return
  const ids = [...new Set(donos.map((d: any) => d.usuario_id))]
  const lig = await fetch(`${supaUrl}/rest/v1/pos_venda_cfg?ativo=eq.true&usuario_id=in.(${ids.join(',')})&select=usuario_id,ultima_rodada`, { headers: dbH }).then(r => r.json()).catch(() => [])
  for (const u of (Array.isArray(lig) ? lig : [])) {
    if (u.ultima_rodada && Date.now() - Date.parse(u.ultima_rodada) < 5 * 60000) continue
    await fetch(`${supaUrl}/functions/v1/pos-venda`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron: true, secret: Deno.env.get('CRON_SECRET') || '', usuario: u.usuario_id }) }).catch(() => null)
  }
}

// pergunta ou mensagem nova: grava um aviso para cada usuário dono daquela conta (a tela mostra o selo em até 1 minuto)
async function avisar(conta: string, topico: string, recurso: string) {
  const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
  const donos = await fetch(`${supaUrl}/rest/v1/ml_tokens?ml_user_id=eq.${conta}&select=usuario_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
  if (!Array.isArray(donos) || !donos.length) return
  await fetch(`${supaUrl}/rest/v1/ml_avisos`, { method: 'POST', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify(donos.map((d: any) => ({ usuario_id: d.usuario_id, ml_user_id: conta, topico, recurso: recurso.slice(0, 200) }))) }).catch(() => null)
  // limpeza: avisos com mais de 10 dias
  await fetch(`${supaUrl}/rest/v1/ml_avisos?em=lt.${new Date(Date.now() - 10 * 86400000).toISOString()}`, { method: 'DELETE', headers: dbH }).catch(() => null)
}

// envio mudou de situação: lê o envio com o token da conta e atualiza a venda. Token vencido: deixa para a rotina de envios.
async function envioMudou(conta: string, recurso: string) {
  const m = recurso.match(/\/shipments\/(\d{6,20})/); if (!m) return
  const sid = m[1]
  const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
  const toks = await fetch(`${supaUrl}/rest/v1/ml_tokens?ml_user_id=eq.${conta}&select=usuario_id,access_token,expires_at`, { headers: dbH }).then(r => r.json()).catch(() => [])
  for (const t of (Array.isArray(toks) ? toks : [])) {
    if (!t.access_token || new Date(t.expires_at).getTime() < Date.now() + 30000) continue
    const r = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: { Authorization: `Bearer ${t.access_token}`, 'x-format-new': 'true' } }).catch(() => null)
    if (!r || !r.ok) continue
    const s: any = await r.json().catch(() => null); if (!s || !s.status) continue
    const hist = s.status_history || s.date_history || {}, status = String(s.status), sub = String(s.substatus || '')
    let saiu = ['shipped', 'delivered', 'not_delivered'].includes(status) || !!hist.date_shipped
    const campos: Record<string, unknown> = { envio_status: status, envio_substatus: s.substatus ? sub : null }
    let quando = hist.date_shipped || hist.date_delivered || (saiu ? (s.last_updated || new Date().toISOString()) : null)
    // coleta bipada (ou pacote deixado na agência): o pacote saiu do galpão, mesmo com o status ainda "ready_to_ship".
    // O aviso chega na hora do bipe; "shipped" só vem quando o pacote passa no centro do ML (às vezes no dia seguinte)
    if (!saiu && status === 'ready_to_ship' && ['picked_up', 'dropped_off', 'in_hub'].includes(sub)) { saiu = true; quando = s.last_updated || new Date().toISOString() }
    if (s.tracking_number) campos.rastreio = String(s.tracking_number)
    const alvo = `${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${t.usuario_id}&ml_user_id=eq.${conta}&shipping_id=eq.${sid}`
    await fetch(alvo, { method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify(campos) }).catch(() => null)
    // enviado_em só é gravado uma vez: a hora da coleta (ml-envios) não pode ser trocada depois pela de "shipped",
    // que vem mais tarde; o estoque baixa pela comparação dessa hora com a da contagem (esoBaixarVendas)
    if (saiu && quando) await fetch(alvo + '&enviado_em=is.null', { method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify({ enviado_em: quando }) }).catch(() => null)
  }
}

async function tokens(conta: string) {
  const supaUrl = Deno.env.get('SUPABASE_URL')!, supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }
  const toks = await fetch(`${supaUrl}/rest/v1/ml_tokens?ml_user_id=eq.${conta}&select=usuario_id,access_token,expires_at`, { headers: dbH }).then(r => r.json()).catch(() => [])
  return { supaUrl, dbH, toks: (Array.isArray(toks) ? toks : []).filter((t: any) => t.access_token && new Date(t.expires_at).getTime() > Date.now() + 30000) }
}

// anúncio mudou (preço, pausa, estoque): atualiza a linha dele em ml_itens_base, se o anúncio já estiver lá
async function itemMudou(conta: string, recurso: string) {
  const m = recurso.match(/\/items\/(MLB\d{6,14})/); if (!m) return
  const { supaUrl, dbH, toks } = await tokens(conta); if (!toks.length) return
  const r = await fetch(`https://api.mercadolibre.com/items/${m[1]}?attributes=id,price,status,available_quantity,listing_type_id,title`, { headers: { Authorization: `Bearer ${toks[0].access_token}` } }).catch(() => null)
  if (!r || !r.ok) return
  const it: any = await r.json().catch(() => null); if (!it || !it.id) return
  const campos: Record<string, unknown> = { situacao: String(it.status || ''), estoque: Number(it.available_quantity) || 0, aviso_em: new Date().toISOString() }
  if (Number(it.price) > 0) campos.preco = Number(it.price)
  if (it.listing_type_id) campos.tipo_anuncio = String(it.listing_type_id)
  for (const t of toks) await fetch(`${supaUrl}/rest/v1/ml_itens_base?usuario_id=eq.${t.usuario_id}&ml_user_id=eq.${conta}&item_id=eq.${m[1]}`, { method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify(campos) }).catch(() => null)
}

// avaliação do comprador: lê a nota e só avisa quando é negativa ou neutra
async function avaliacao(conta: string, recurso: string) {
  const m = recurso.match(/\/orders\/(\d{10,20})/); if (!m) return
  const { toks } = await tokens(conta); if (!toks.length) return
  const r = await fetch(`https://api.mercadolibre.com/orders/${m[1]}/feedback`, { headers: { Authorization: `Bearer ${toks[0].access_token}` } }).catch(() => null)
  if (!r || !r.ok) return
  const f: any = await r.json().catch(() => null), nota = String((f && f.purchase && f.purchase.rating) || '')
  if (nota === 'negative' || nota === 'neutral') await avisar(conta, 'avaliacao', m[1] + '|' + nota)
}

Deno.serve(async (req) => {
  // o ML exige resposta 200 rápida; o trabalho segue em segundo plano
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}))
    const topico = String(b?.topic || ''), conta = String(b?.user_id || '')
    if (/^orders/.test(topico) && /^\d{4,20}$/.test(conta)) {
      const agora = Date.now()
      if (agora - (ultimo.get(conta) || 0) > 20000) {
        ultimo.set(conta, agora)
        EdgeRuntime.waitUntil(sincronizar(conta))
      }
      if (topico === 'orders_v2') EdgeRuntime.waitUntil(vendaAntiga(conta, String(b?.resource || '')))
    }
    else if ((topico === 'questions' || topico === 'messages') && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(avisar(conta, topico, String(b?.resource || '')))
    }
    // reclamação/devolução aberta ou com ação pendente: aviso para o Pós-venda (os dois tópicos viram "claims")
    else if (/^(claims|claims_actions|post_purchase)$/.test(topico) && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(avisar(conta, 'claims', String(b?.resource || '')).then(() => posVendaJa(conta)))
    }
    // promoção nova para um anúncio (candidato) ou oferta que mudou: aviso para a Central de promoções.
    // No máximo um aviso a cada 10 minutos por conta: o ML manda um por anúncio e uma campanha nova gera dezenas.
    else if (/^(public_candidates|public_offers|public candidates|public offers)$/.test(topico) && /^\d{4,20}$/.test(conta)) {
      const agora = Date.now(), k = 'promo:' + conta
      if (agora - (ultimo.get(k) || 0) > 600000) { ultimo.set(k, agora); EdgeRuntime.waitUntil(avisar(conta, 'promos', String(b?.resource || ''))) }
    }
    // disputa de catálogo: passou a ganhar ou a perder num anúncio
    else if (/^(item_competition|item competition)$/.test(topico) && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(avisar(conta, 'catalogo', String(b?.resource || '')))
    }
    else if (topico === 'shipments' && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(envioMudou(conta, String(b?.resource || '')))
    }
    // anúncio mudou: no máximo uma leitura a cada 5 minutos por anúncio (o ML avisa a cada venda)
    else if (topico === 'items' && /^\d{4,20}$/.test(conta)) {
      const rec = String(b?.resource || ''), agora = Date.now(), k = 'item:' + rec
      if (agora - (ultimo.get(k) || 0) > 300000) { if (ultimo.size > 5000) ultimo.clear(); ultimo.set(k, agora); EdgeRuntime.waitUntil(itemMudou(conta, rec)) }
    }
    // estoque do Full mexeu (entrada, retirada, ajuste): um aviso a cada 5 minutos por conta
    else if (/^(fbm_stock_operations|fbm stock operations|stock_locations|stock-locations|stock locations)$/.test(topico) && /^\d{4,20}$/.test(conta)) {
      const agora = Date.now(), k = 'full:' + conta
      if (agora - (ultimo.get(k) || 0) > 300000) { ultimo.set(k, agora); EdgeRuntime.waitUntil(avisar(conta, 'full', String(b?.resource || ''))) }
    }
    else if (/^(orders_feedback|orders feedback)$/.test(topico) && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(avaliacao(conta, String(b?.resource || '')))
    }
  }
  return new Response('ok', { status: 200 })
})
