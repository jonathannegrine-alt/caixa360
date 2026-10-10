// mcp — conector de IA do Caixa 360 (Model Context Protocol, transporte HTTP "streamable", sem sessão).
// A IA do usuário (Claude, ChatGPT...) chama este endereço para consultar os dados dele. SOMENTE LEITURA.
//
// Endereço:  https://<projeto>.supabase.co/functions/v1/mcp?k=<chave pessoal>
//            (também aceita a chave em "Authorization: Bearer <chave>")
// A chave é gerada em Configurações → IA; aqui só comparamos o sha256 dela com a tabela ia_chaves.
// Toda consulta passa por public.ia_consulta(usuario, ferramenta, parametros), filtrada pelo dono da chave.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, accept',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const periodo = {
  de: { type: 'string', description: 'Data inicial AAAA-MM-DD (padrão: 30 dias atrás)' },
  ate: { type: 'string', description: 'Data final AAAA-MM-DD (padrão: hoje)' },
  conta: { type: 'string', description: 'ID da conta do Mercado Livre (veja a ferramenta "contas"). Em branco = todas as contas.' },
}
const FERRAMENTAS = [
  { name: 'contas', description: 'Lista as contas do Mercado Livre conectadas ao Caixa 360 (ID, apelido e última sincronização).', inputSchema: { type: 'object', properties: {} } },
  { name: 'vendas_resumo', description: 'Totais de vendas do Mercado Livre no período: vendas aprovadas e canceladas, unidades, faturamento, fretes, tarifa, custo dos produtos, imposto e margem de contribuição.',
    inputSchema: { type: 'object', properties: { ...periodo, sku: { type: 'string', description: 'Filtra por SKU (aceita % como coringa, ex.: J-2010%)' } } } },
  { name: 'vendas_agrupadas', description: 'Vendas do período agrupadas por até 3 dimensões, com vendas, unidades, faturamento, custo, imposto, tarifa, frete do vendedor, margem e margem %. Use para rankings, séries no tempo e comparações (ex.: por mês e SKU; por dia da semana; por tipo de envio).',
    inputSchema: { type: 'object', required: ['agrupar_por'], properties: { ...periodo,
      agrupar_por: { type: 'array', items: { type: 'string', enum: ['dia', 'semana', 'mes', 'sku', 'anuncio', 'envio', 'modalidade', 'conta', 'situacao', 'dia_da_semana', 'hora'] }, description: 'De 1 a 3 dimensões' },
      sku: { type: 'string', description: 'Filtra por SKU (aceita % como coringa)' },
      situacao: { type: 'string', enum: ['aprovada', 'cancelada', 'pendente'], description: 'Padrão: aprovada (ignorado se "situacao" estiver em agrupar_por)' },
      ordenar_por: { type: 'string', enum: ['faturamento', 'margem', 'margem_pct', 'unidades', 'vendas'], description: 'Padrão: ordem das dimensões' },
      limite: { type: 'integer', description: 'Máximo de linhas (padrão 100, até 500)' } } } },
  { name: 'vendas_lista', description: 'Lista vendas individuais do período (até 200), com produto, SKU, valores, frete, tarifa, custo, imposto, margem, tipo de envio e comprador.',
    inputSchema: { type: 'object', properties: { ...periodo, sku: { type: 'string' }, situacao: { type: 'string', enum: ['aprovada', 'cancelada', 'pendente'] }, limite: { type: 'integer' } } } },
  { name: 'dre_mensal', description: 'Dados do DRE de um ano: linhas do Mercado Livre por mês (faturamento, canceladas, imposto, frete, custo, tarifa) e despesas de Contas a pagar por categoria e mês, com o grupo de cada categoria (variável, fixo ou fora do DRE).',
    inputSchema: { type: 'object', properties: { ano: { type: 'integer', description: 'Padrão: ano atual' }, conta: periodo.conta } } },
  { name: 'contas_a_pagar', description: 'Contas a pagar: total, soma por categoria e lançamentos (vencimento, descrição, fornecedor, categoria, valor, pago).',
    inputSchema: { type: 'object', properties: { de: { type: 'string', description: 'Vencimento a partir de AAAA-MM-DD' }, ate: { type: 'string', description: 'Vencimento até AAAA-MM-DD' },
      status: { type: 'string', enum: ['abertas', 'pagas', 'atrasadas', 'todas'], description: 'Padrão: abertas' }, categoria: { type: 'string' }, fornecedor: { type: 'string' }, limite: { type: 'integer' } } } },
  { name: 'recebiveis_ml', description: 'Valores a receber do Mercado Livre já confirmados (liberações futuras), por dia.', inputSchema: { type: 'object', properties: { conta: periodo.conta } } },
  { name: 'recebimentos_historico', description: 'Valor líquido de vendas liberado pelo Mercado Pago em cada dia do período (histórico de recebimentos).', inputSchema: { type: 'object', properties: { ...periodo } } },
  { name: 'produtos', description: 'Cadastro de produtos (SKU, título, custo unitário e % de imposto).', inputSchema: { type: 'object', properties: { busca: { type: 'string', description: 'Trecho do SKU ou do título' } } } },
  { name: 'caixa', description: 'Posição de caixa: saldos informados (Mercado Pago e outros bancos), reserva mínima, a receber confirmado do ML, contas em aberto nos próximos 30 dias e contas em atraso.', inputSchema: { type: 'object', properties: {} } },
  { name: 'estoque', description: 'Estoque físico dos depósitos próprios (ex.: galpão), por produto. Não inclui o Full, que é lido direto do Mercado Livre.', inputSchema: { type: 'object', properties: { sku: { type: 'string', description: 'Filtra por SKU (aceita % como coringa, ex.: J-2010%)' } } } },
  { name: 'estoque_movimentacoes', description: 'Histórico de entradas e saídas do estoque (carga inicial, chegada de compra, venda enviada, envio ao Full, contagem, ajuste), do mais recente para o mais antigo.',
    inputSchema: { type: 'object', properties: { sku: { type: 'string', description: 'Filtra por SKU (aceita %)' }, motivo: { type: 'string', enum: ['carga_inicial', 'compra', 'venda', 'envio_full', 'contagem', 'ajuste', 'transferencia', 'devolucao'] }, limite: { type: 'integer', description: 'Padrão 100, até 500' } } } },
  { name: 'ordens_de_compra', description: 'Ordens de compra (vindas do Olist ou criadas no Caixa 360) com os itens, o que foi comprado e o que já foi conferido na chegada. Comprado menos recebido é o estoque a caminho.',
    inputSchema: { type: 'object', properties: { so_pendentes: { type: 'string', enum: ['true', 'false'], description: 'true = só as em aberto ou em andamento' } } } },
  { name: 'envios_ao_full', description: 'Envios ao Full do Mercado Livre lançados no Caixa 360: em preparação, que saíram do galpão ou recebidos, com os produtos de cada um (kits abertos nos componentes).', inputSchema: { type: 'object', properties: {} } },
  { name: 'emprestimos', description: 'Contratos de empréstimo cadastrados (credor, valor, juros, parcelas) e o trecho que identifica as parcelas de cada um em contas_a_pagar.', inputSchema: { type: 'object', properties: {} } },
].map(t => ({ ...t, annotations: { readOnlyHint: true } }))
const DO_ESTOQUE = new Set(['estoque', 'estoque_movimentacoes', 'ordens_de_compra', 'envios_ao_full', 'emprestimos'])

const INSTRUCOES = 'Dados do Caixa 360, sistema de gestão financeira de um vendedor do Mercado Livre. Tudo é somente leitura. Valores em reais (BRL), datas em AAAA-MM-DD no fuso de Brasília. ' +
  'Margem de contribuição = valor dos produtos − custo − imposto − tarifa de venda − frete pago pelo vendedor. Custo e imposto ficam gravados em cada venda (valor da época). ' +
  'Vendas sem custo cadastrado deixam a margem superestimada: avise quando "vendas_sem_custo_ou_imposto" for relevante. O histórico de vendas é importado aos poucos; confira "dias_com_vendas_importadas" antes de comparar períodos.'

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  // Sem fluxo de eventos iniciado pelo servidor: só POST
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } })

  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const dbH = { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' }

  // ── quem é o usuário (chave pessoal) ──────────────────────────────────────
  const url = new URL(req.url)
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const chave = (url.searchParams.get('k') || (bearer.startsWith('c360_') ? bearer : '')).trim()
  if (!/^c360_[A-Za-z0-9]{32,80}$/.test(chave)) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Chave de conexão ausente ou inválida. Gere uma em Caixa 360 → Configurações → IA.' } }, 401)
  const hash = await sha256(chave)
  const linhas = await fetch(`${supaUrl}/rest/v1/ia_chaves?hash=eq.${hash}&select=id,usuario_id&limit=1`, { headers: dbH }).then(r => r.json()).catch(() => [])
  const dono = Array.isArray(linhas) ? linhas[0] : null
  if (!dono) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Chave de conexão revogada ou desconhecida.' } }, 401)

  let msg: any
  try { msg = await req.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }, 400) }
  if (Array.isArray(msg)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Lotes não são aceitos' } }, 400)
  const { id, method, params } = msg || {}
  const ok = (result: unknown) => json({ jsonrpc: '2.0', id, result })
  const erro = (code: number, message: string) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

  // notificações (sem id) não têm resposta
  if (id === undefined || id === null) return new Response(null, { status: 202, headers: CORS })

  if (method === 'initialize') {
    return ok({
      protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'caixa360', title: 'Caixa 360', version: '1.0.0' },
      instructions: INSTRUCOES,
    })
  }
  if (method === 'ping') return ok({})
  if (method === 'tools/list') return ok({ tools: FERRAMENTAS })

  if (method === 'tools/call') {
    const nome = String(params?.name || '')
    if (!FERRAMENTAS.some(t => t.name === nome)) return erro(-32602, `Ferramenta desconhecida: ${nome}`)
    const r = await fetch(`${supaUrl}/rest/v1/rpc/${DO_ESTOQUE.has(nome) ? 'ia_consulta_estoque' : 'ia_consulta'}`, {
      method: 'POST', headers: dbH,
      body: JSON.stringify({ p_usuario: dono.usuario_id, p_ferramenta: nome, p: params?.arguments || {} })
    })
    const texto = await r.text()
    // registra o uso (sem bloquear a resposta)
    fetch(`${supaUrl}/rest/v1/ia_chaves?id=eq.${dono.id}`, { method: 'PATCH', headers: { ...dbH, Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_uso: new Date().toISOString() }) }).catch(() => null)
    if (!r.ok) return ok({ content: [{ type: 'text', text: `Erro na consulta: ${texto.slice(0, 400)}` }], isError: true })
    return ok({ content: [{ type: 'text', text: texto }] })
  }

  return erro(-32601, `Método não suportado: ${method}`)
})
