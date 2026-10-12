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
    const hist = s.status_history || {}, status = String(s.status)
    const saiu = ['shipped', 'delivered', 'not_delivered'].includes(status) || !!hist.date_shipped
    const campos: Record<string, unknown> = { envio_status: status }
    const quando = hist.date_shipped || hist.date_delivered || (saiu ? (s.last_updated || new Date().toISOString()) : null)
    if (saiu && quando) campos.enviado_em = quando
    if (s.tracking_number) campos.rastreio = String(s.tracking_number)
    await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${t.usuario_id}&ml_user_id=eq.${conta}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify(campos) }).catch(() => null)
  }
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
    }
    else if ((topico === 'questions' || topico === 'messages') && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(avisar(conta, topico, String(b?.resource || '')))
    }
    // reclamação/devolução aberta ou com ação pendente: aviso para o Pós-venda (os dois tópicos viram "claims")
    else if (/^(claims|claims_actions|post_purchase)$/.test(topico) && /^\d{4,20}$/.test(conta)) {
      EdgeRuntime.waitUntil(avisar(conta, 'claims', String(b?.resource || '')))
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
  }
  return new Response('ok', { status: 200 })
})
