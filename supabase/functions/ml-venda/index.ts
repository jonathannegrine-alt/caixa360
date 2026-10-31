// ml-venda — detalhes de UMA venda, lidos na hora no Mercado Livre (só leitura no ML).
//
//   { acao: 'detalhe',  pedido }   entrega (envio, rastreio, prazo, pacote, destinatário), pagamento e comprador.
//                                  Guarda em vendas_ml: cidade, cep, uf, rastreio e documento do comprador.
//   { acao: 'etiqueta', pedido }   etiqueta do envio em PDF (base64). Usa a cópia guardada no depósito "etiquetas";
//                                  se não houver, pede ao ML (só entrega enquanto o pacote não saiu) e guarda.
//                                  Com formato: 'zpl' devolve o código da impressora térmica (texto ZPL), guardado
//                                  compactado em etiquetas/<usuario>/<envio>.zpl.gz (~1,3 KB contra ~40 KB do PDF);
//                                  a tela reconstrói a imagem a partir dele.
//   { acao: 'nota',     pedido }   nota fiscal que o ML conhece: Full (emissor do ML) e coleta (nota enviada ao ML).
//
// O token do ML nunca sai do servidor.
import { unzipSync, gzipSync, gunzipSync, strFromU8, strToU8 } from 'https://esm.sh/fflate@0.8.2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })
const ML = 'https://api.mercadolibre.com'

async function token(supaUrl: string, dbH: Record<string, string>, userId: string, conta: string, clientId: string, secret: string) {
  const rows = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&ml_user_id=eq.${conta}&select=access_token,refresh_token,expires_at,ml_user_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
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

const b64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }

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
    let { id: userId } = await jwtRes.json()
    // colaborador (tabela equipe) com a tela Pedidos: consulta a venda na conta do dono; nada além de ver
    const eq = await fetch(`${supaUrl}/rest/v1/equipe?membro_id=eq.${userId}&ativo=is.true&select=dono_id,paginas`, { headers: dbH }).then(r => r.json()).catch(() => [])
    if (Array.isArray(eq) && eq[0]) {
      if (!(eq[0].paginas || []).includes('pedidos') || !['detalhe', 'etiqueta', 'danfe', 'nota', ''].includes(String(body?.acao || ''))) return resp({ error: 'Sem permissão para isso.' }, 403)
      userId = eq[0].dono_id
    }

    // visitas dos anúncios por dia (soma das contas pedidas), para a aba "Visitas e conversão"
    if (body?.acao === 'visitas') {
      const dias = Math.min(150, Math.max(7, Number(body?.dias) || 30))
      const contas = await fetch(`${supaUrl}/rest/v1/ml_tokens?usuario_id=eq.${userId}&select=ml_user_id`, { headers: dbH }).then(r => r.json()).catch(() => [])
      const porDia: Record<string, number> = {}
      let lidas = 0
      for (const c of (Array.isArray(contas) ? contas : [])) {
        if (body?.conta && String(body.conta) !== String(c.ml_user_id)) continue
        const tkc = await token(supaUrl, dbH, userId, String(c.ml_user_id), clientId, secret)
        if (!tkc) continue
        const r = await fetch(`${ML}/users/${c.ml_user_id}/items_visits/time_window?last=${dias}&unit=day`, { headers: { Authorization: 'Bearer ' + tkc } }).catch(() => null)
        const j = r && r.ok ? await r.json().catch(() => null) : null
        if (!j) continue
        lidas++
        for (const x of (j.results || [])) { const d = String(x.date || '').substring(0, 10); if (d) porDia[d] = (porDia[d] || 0) + (Number(x.total) || 0) }
      }
      if (!lidas) return resp({ ok: false, motivo: 'O Mercado Livre não devolveu as visitas agora. Tente de novo em instantes.' })
      return resp({ ok: true, dias: Object.keys(porDia).sort().map(d => ({ dia: d, visitas: porDia[d] })) })
    }

    const pedido = String(body?.pedido || '').replace(/\D/g, '')
    if (!pedido) return resp({ error: 'Informe o número da venda.' }, 400)
    const linhas = await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&order_id=eq.${pedido}&select=order_id,pack_id,shipping_id,ml_user_id,logistic_type,etiqueta_em&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
    const v = Array.isArray(linhas) ? linhas[0] : null
    if (!v) return resp({ error: 'Venda não encontrada.' }, 404)
    const tk = await token(supaUrl, dbH, userId, String(v.ml_user_id), clientId, secret)
    if (!tk) return resp({ error: 'A conta do Mercado Livre desta venda está desconectada. Reconecte em Configurações.' }, 400)
    const g = async (url: string) => { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk, 'x-format-new': 'true' } }).catch(() => null); return r && r.ok ? await r.json().catch(() => null) : null }
    const sid = v.shipping_id ? String(v.shipping_id) : ''

    if (body?.acao === 'etiqueta') {
      if (!sid) return resp({ error: 'Esta venda não tem envio pelo Mercado Envios.' }, 400)
      // SÓ CONSULTA (2026-10-24): o Caixa 360 não tem função de logística. Baixar a etiqueta no ML marca "impressa" e muda a
      // etapa no sistema de expedição do cliente; por isso só entrega cópia guardada ou etiqueta que já foi impressa antes.
      const pedeMl = async () => {
        const sh = await g(`${ML}/shipments/${sid}`)
        return !!(sh && (sh.date_first_printed || sh.status_history?.date_first_printed || String(sh.substatus || '') === 'printed'))
      }
      const naoImpressa = { ok: false, motivo: 'Esta etiqueta ainda não foi impressa. Por enquanto o Caixa 360 só consulta: a etiqueta aparece aqui depois de impressa no sistema que vocês usam para a expedição (assim nada muda na operação).' }
      if (body?.formato === 'zpl') {
        const cz = `etiquetas/${userId}/${sid}.zpl.gz`
        const gz = await fetch(`${supaUrl}/storage/v1/object/${cz}`, { headers: dbH }).catch(() => null)
        if (gz && gz.ok) return resp({ ok: true, origem: 'guardada', formato: 'zpl', zpl: strFromU8(gunzipSync(new Uint8Array(await gz.arrayBuffer()))), envio: sid })
        if (!await pedeMl()) return resp(naoImpressa)
        const r = await fetch(`${ML}/shipment_labels?shipment_ids=${sid}&response_type=zpl2`, { headers: { Authorization: 'Bearer ' + tk } }).catch(() => null)
        const zb = r && r.ok ? new Uint8Array(await r.arrayBuffer()) : null
        let zpl = ''
        if (zb && zb[0] === 0x50 && zb[1] === 0x4b) { const arq = unzipSync(zb); const nome = Object.keys(arq).find(n => /.txt$/i.test(n)); zpl = nome ? strFromU8(arq[nome]) : '' }
        else if (zb) zpl = strFromU8(zb)
        if (!zpl.includes('^XA')) return resp({ ok: false, motivo: 'O Mercado Livre não entregou o código da etiqueta (ZPL) deste envio.' })
        await fetch(`${supaUrl}/storage/v1/object/${cz}`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gzipSync(strToU8(zpl)) }).catch(() => null)
        return resp({ ok: true, origem: 'mercado_livre', formato: 'zpl', zpl, envio: sid })
      }
      const caminho = `etiquetas/${userId}/${sid}.pdf`
      const guardada = await fetch(`${supaUrl}/storage/v1/object/${caminho}`, { headers: dbH }).catch(() => null)
      if (guardada && guardada.ok) return resp({ ok: true, origem: 'guardada', pdf: b64(await guardada.arrayBuffer()), envio: sid })
      if (v.logistic_type !== 'fulfillment' && !await pedeMl()) return resp(naoImpressa)
      const r = await fetch(`${ML}/shipment_labels?shipment_ids=${sid}&response_type=pdf`, { headers: { Authorization: 'Bearer ' + tk } }).catch(() => null)
      if (!r || !r.ok || !(r.headers.get('content-type') || '').includes('pdf')) {
        return resp({ ok: false, motivo: v.logistic_type === 'fulfillment'
          ? 'Venda do Full: quem etiqueta e envia é o Mercado Livre, então não existe etiqueta para imprimir.'
          : 'O Mercado Livre só entrega a etiqueta enquanto o pacote não saiu, e não havia cópia guardada desta venda. As etiquetas passaram a ser guardadas automaticamente em 11/10/2026; as anteriores a essa data só existem na UpSeller.' })
      }
      const buf = await r.arrayBuffer()
      const up = await fetch(`${supaUrl}/storage/v1/object/${caminho}`, { method: 'POST', headers: { ...dbH, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: buf }).catch(() => null)
      if (up && up.ok) await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&shipping_id=eq.${sid}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ etiqueta_em: new Date().toISOString() }) })
      return resp({ ok: true, origem: 'mercado_livre', pdf: b64(buf), envio: sid })
    }

    // DANFE (PDF da nota) para imprimir: só existe para nota que o emissor do Mercado Livre conhece
    if (body?.acao === 'danfe') {
      const inv = await g(`${ML}/users/${v.ml_user_id}/invoices/orders/${pedido}`)
      const loc = String(inv?.attributes?.danfe_location || '')
      const candidatos = [loc ? (loc.startsWith('http') ? loc : ML + (loc.startsWith('/') ? '' : '/') + loc) : '', inv?.id ? `${ML}/users/${v.ml_user_id}/invoices/documents/danfe/${inv.id}` : ''].filter(Boolean)
      for (const url of candidatos) {
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tk } }).catch(() => null)
        if (r && r.ok && (r.headers.get('content-type') || '').includes('pdf')) return resp({ ok: true, pdf: b64(await r.arrayBuffer()) })
      }
      return resp({ ok: false, motivo: 'O Mercado Livre não entregou o PDF desta nota. Use a chave de acesso para consultar e imprimir no portal da nota fiscal.' })
    }

    if (body?.acao === 'nota') {
      const inv = await g(`${ML}/users/${v.ml_user_id}/invoices/orders/${pedido}`)
      if (inv && (inv.attributes?.invoice_key || inv.invoice_number)) {
        const a = inv.attributes || {}
        return resp({ ok: true, origem: 'emissor do Mercado Livre', numero: inv.invoice_number || '', serie: inv.invoice_series || '', chave: a.invoice_key || '', emitida: inv.issued_date || a.authorization_date || '', valor: Number(inv.amount) || 0, situacao: a.status_description || inv.status || '', danfe: a.danfe_location || '', xml: a.xml_location || '' })
      }
      const d = sid ? await g(`${ML}/shipments/${sid}/invoice_data?siteId=MLB`) : null
      if (d && (d.fiscal_key || d.invoice_number)) {
        return resp({ ok: true, origem: 'nota enviada ao Mercado Livre', numero: d.invoice_number || '', serie: d.invoice_serie || '', chave: d.fiscal_key || '', emitida: d.invoice_date || '', valor: Number(d.invoice_amount) || 0, situacao: d.status || '', danfe: '', xml: '' })
      }
      return resp({ ok: false, motivo: v.logistic_type === 'self_service'
        ? 'Venda Flex: a nota é emitida fora do Mercado Livre e não é enviada para lá, então não há o que consultar aqui.'
        : 'O Mercado Livre não tem nota fiscal registrada para esta venda.' })
    }

    // detalhe
    const [o, b, s, si] = await Promise.all([g(`${ML}/orders/${pedido}`), g(`${ML}/orders/${pedido}/billing_info`), sid ? g(`${ML}/shipments/${sid}`) : Promise.resolve(null), sid ? g(`${ML}/shipments/${sid}/items`) : Promise.resolve(null)])
    const meuItem = (Array.isArray(si) ? si : []).find((x: any) => String(x?.order_id) === String(pedido)) || (Array.isArray(si) ? si[0] : null)
    const end = s?.destination?.shipping_address || {}
    const info = (b?.billing_info?.additional_info || []) as any[]
    const ad = (k: string) => String((info.find(x => x?.type === k) || {}).value || '')
    const nomeFiscal = [ad('FIRST_NAME'), ad('LAST_NAME')].filter(Boolean).join(' ') || ad('BUSINESS_NAME')
    const doc = String(b?.billing_info?.doc_number || '')
    const pags = (o?.payments || []) as any[]
    const p0 = pags[0] || {}
    const soma = (k: string) => pags.reduce((t, p) => t + (Number(p?.[k]) || 0), 0)
    const ufm = String(end?.state?.id || '').match(/([A-Z]{2})$/)
    const entrega = s ? {
      envio: sid, tipo: s.logistic?.type || v.logistic_type || '', status: s.status || '', substatus: s.substatus || '',
      transportadora: s.tracking_method || '', rastreio: s.tracking_number || '',
      prevista: s.lead_time?.estimated_delivery_time?.date || s.lead_time?.estimated_delivery_final?.date || '',
      limite_envio: s.lead_time?.estimated_schedule_limit?.date || '',
      altura: Number(s.dimensions?.height) || 0, largura: Number(s.dimensions?.width) || 0, comprimento: Number(s.dimensions?.length) || 0, peso: Number(s.dimensions?.weight) || 0,
      valor_declarado: Number(s.declared_value) || 0,
      // medidas do produto registradas pelo ML neste envio e quanto do pacote é desta venda (menos de 100 = pacote dividido com outra venda)
      item: meuItem ? { altura: Number(meuItem.dimensions?.height) || 0, largura: Number(meuItem.dimensions?.width) || 0, comprimento: Number(meuItem.dimensions?.length) || 0, peso: Number(meuItem.dimensions?.weight) || 0, parte: meuItem.item_ponderation == null ? null : Number(meuItem.item_ponderation), origem: meuItem.dimensions_source?.origin || '' } : null,
      destinatario: s.destination?.receiver_name || '', endereco: end.address_line || [end.street_name, end.street_number].filter(Boolean).join(', '),
      complemento: end.comment || '', bairro: end.neighborhood?.name || '', cidade: end.city?.name || '', uf: ufm ? ufm[1] : '', cep: end.zip_code || '',
    } : null
    const pagamento = pags.length ? {
      criado: p0.date_created || '', aprovado: p0.date_approved || '', tipo: p0.payment_type || '', meio: p0.payment_method_id || '', parcelas: Number(p0.installments) || 0,
      status: p0.status || '', detalhe: p0.status_detail || '', produtos: soma('transaction_amount'), total: soma('total_paid_amount'), reembolsado: soma('transaction_amount_refunded'), a_mais: soma('overpaid_amount'), frete: soma('shipping_cost'), qtd: pags.length,
    } : null
    const comprador = { id: o?.buyer?.id || '', apelido: o?.buyer?.nickname || '', nome: nomeFiscal || [o?.buyer?.first_name, o?.buyer?.last_name].filter(Boolean).join(' '), doc_tipo: b?.billing_info?.doc_type || '', doc }
    // guarda o que serve para busca e relatórios
    const campos: Record<string, unknown> = {}
    if (doc) campos.comprador_doc = doc
    if (entrega?.cidade) campos.cidade = entrega.cidade
    if (entrega?.cep) campos.cep = entrega.cep
    if (entrega?.uf) campos.uf = entrega.uf
    if (entrega?.rastreio) campos.rastreio = entrega.rastreio
    if (entrega?.status) campos.envio_status = entrega.status
    if (Object.keys(campos).length) {
      const filtro = sid ? `shipping_id=eq.${sid}` : `order_id=eq.${pedido}`
      await fetch(`${supaUrl}/rest/v1/vendas_ml?usuario_id=eq.${userId}&${filtro}`, { method: 'PATCH', headers: { ...dbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(campos) }).catch(() => null)
    }
    return resp({ ok: true, entrega, pagamento, comprador, tem_etiqueta: !!v.etiqueta_em })
  } catch (err) {
    console.error('ml-venda error:', err)
    return resp({ error: String(err) }, 500)
  }
})
