// ler-contrato — lê o PDF de um contrato de empréstimo e devolve os dados para preencher o cadastro.
// O usuário confere e corrige antes de salvar: a IA só adianta a digitação.
//   entrada: { pdf: "<base64 do arquivo>" }   (até ~6 MB)
//   saída:   { ok, dados: { credor, nome, valor, taxa_mes, parcelas, primeira_parcela, sistema, valor_parcela, numero_contrato, observacao } }
// Usa a API da Anthropic (ANTHROPIC_API_KEY). Custa centavos por contrato e só roda quando o usuário envia um PDF.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const resp = (body: object, status = 200) => new Response(JSON.stringify(body), { headers: CORS, status })

const INSTRUCAO = `Você recebe o PDF de um contrato ou cédula de crédito bancário brasileiro (empréstimo, capital de giro, Pronampe, FGI, financiamento).
Extraia os dados do empréstimo e responda SOMENTE com um objeto JSON, sem texto antes ou depois, com estes campos:
{
  "credor": "nome do banco ou instituição que emprestou",
  "nome": "nome curto para identificar o contrato, ex.: 'Pronampe Sicoob' ou 'FGI Sicredi'",
  "numero_contrato": "número do contrato ou da cédula, como está no documento",
  "valor": número (VALOR FINANCIADO / valor total devido no ato: a dívida inteira, incluindo IOF, tarifas e seguro quando entram no financiamento; em reais, com ponto decimal),
  "valor_liberado": número (valor líquido liberado ao cliente, se o contrato informar; senão null),
  "cet_mes": número (Custo Efetivo Total AO MÊS em porcentagem, se o contrato informar; senão null),
  "taxa_mes": número (taxa de JUROS do contrato AO MÊS em porcentagem — não é o CET; se o contrato só informar taxa ao ano, converta: ((1+anual/100)^(1/12)-1)*100; se houver indexador como Selic ou CDI, informe só a parte fixa),
  "parcelas": número inteiro de parcelas de amortização,
  "primeira_parcela": "AAAA-MM-DD" (vencimento da primeira parcela de amortização),
  "sistema": "price" (parcelas iguais), "sac" (amortização constante) ou "outro",
  "valor_parcela": número (valor da parcela, se o contrato informar; senão null),
  "observacao": "em uma frase: carência, indexador (Selic, CDI), seguro, tarifa ou qualquer condição que mude o cálculo"
}
Use null no campo que o documento não informar. Não invente valores.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!, anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const chave = Deno.env.get('ANTHROPIC_API_KEY') || ''
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return resp({ error: 'Não autenticado' }, 401)
    const jwtRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authHeader } })
    if (!jwtRes.ok) return resp({ error: 'Sessão inválida — faça login novamente.' }, 401)
    if (!chave) return resp({ error: 'A leitura por IA não está configurada neste servidor.' }, 500)

    const body = await req.json().catch(() => ({}))
    const pdf = String(body?.pdf || '').replace(/^data:application\/pdf;base64,/, '')
    if (pdf.length < 1000) return resp({ error: 'Envie o PDF do contrato.' }, 400)
    if (pdf.length > 8_500_000) return resp({ error: 'O PDF é grande demais (limite de cerca de 6 MB).' }, 413)

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5', max_tokens: 900,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
          { type: 'text', text: INSTRUCAO },
        ] }],
      }),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok) return resp({ error: 'A IA não conseguiu ler o documento: ' + String(j?.error?.message || 'http ' + r.status).slice(0, 200) }, 502)
    const texto = (j?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
    const m = texto.match(/\{[\s\S]*\}/)
    let dados: any = null
    try { dados = m ? JSON.parse(m[0]) : null } catch { dados = null }
    if (!dados) return resp({ error: 'A IA respondeu em um formato que não consegui aproveitar. Preencha à mão.', bruto: texto.slice(0, 400) }, 502)
    return resp({ ok: true, dados, tokens: { entrada: j?.usage?.input_tokens || 0, saida: j?.usage?.output_tokens || 0 } })
  } catch (err) {
    console.error('ler-contrato error:', err)
    return resp({ error: String(err) }, 500)
  }
})
