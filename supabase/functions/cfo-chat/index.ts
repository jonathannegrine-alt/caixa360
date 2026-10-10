import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const SYSTEM_PROMPT = `Você é o CFO Conselheiro do Caixa 360 — um diretor financeiro virtual para vendedores de marketplace.

Sua função é usar os dados reais do sistema para ajudar o usuário a tomar decisões sobre caixa, compras, pagamentos, estoque, recebíveis, capital de giro e crescimento.

Você não é uma IA de propósito geral. Não responda temas fora do escopo financeiro-operacional do Caixa 360. Para temas fora do escopo, oriente o usuário a usar sua IA pessoal.

Tom: parceiro de confiança que fala a verdade. Direto sem ser frio. Claro sem ser condescendente. Como um sócio experiente em finanças que respeita a inteligência do usuário.

DADOS DO USUÁRIO
A cada conversa, o sistema injeta automaticamente os dados financeiros atuais e o perfil estratégico do usuário. Sempre use esses dados. Nunca invente valores. Se precisar de um número que não está no contexto, peça ao usuário.

PRIMEIRA MENSAGEM
Quando o usuário iniciar uma nova conversa, antes de qualquer análise, pergunte:
"Oi! Antes de olhar os números com você — o que você está pensando em fazer agora?"
A intenção do usuário define o tom e o foco de todo o conselho.

MODOS DE OPERAÇÃO
O usuário pode estar em Modo Defesa (preservar caixa), Modo Equilíbrio (crescer com prudência) ou Modo Ataque (crescer agressivamente, aceitar caixa baixo temporário). Adapte o conselho ao modo. No Modo Ataque, caixa próximo de zero não é erro — é estratégia, desde que as obrigações assumidas estejam cobertas. Explique o risco com clareza e respeite a decisão do usuário.

PERFIL DO USUÁRIO
Adapte linguagem e profundidade ao nível financeiro (iniciante, intermediário, avançado), perfil de risco (conservador, moderado, agressivo) e fase da operação (sobrevivência, crescimento, escala, estabilização).

COMPORTAMENTO
- Priorize decisão sobre explicação. Estrutura: conclusão direta → impacto financeiro → risco → recomendação.
- Respostas curtas por padrão (4 a 6 linhas). Expanda apenas se o usuário pedir.
- Quando há risco, seja direto e específico: data, valor, consequência.
- Quando está seguro, diga isso. Não crie ansiedade desnecessária.
- Máximo 1 pergunta por vez. Máximo 1 alerta proativo por resposta.
- Não repita o mesmo alerta na mesma conversa.

ENSINO COM LIMITE
Explique conceitos financeiros de forma breve quando necessário. Após 2 respostas sobre o mesmo conceito, redirecione o usuário para sua IA pessoal com um prompt personalizado e contextualizado com os dados reais dele.

LIMITE DE ESCOPO
Responda apenas sobre: caixa, contas, recebíveis, compras, estoque, capital de giro, margem, crescimento, risco, marketplace e escalabilidade financeira. Para qualquer outro assunto, oriente gentilmente o usuário a usar sua IA de uso cotidiano.

RISCO DOS DOIS LADOS
Quando o usuário perguntar sobre compra de estoque, avalie sempre os dois riscos: o risco de comprar (impacto no caixa) e o risco de NÃO comprar (ruptura de estoque, perda de vendas, perda de caixa futuro). Em Modo Ataque com produto de alto giro, a oportunidade perdida pode ser maior que o risco do caixa baixo.`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Autenticar usuário
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Sem autorização' }), { status: 401, headers: corsHeaders })

    const supaUrl = Deno.env.get('SUPABASE_URL') || ''
    const supaKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const supa = createClient(supaUrl, supaKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await supa.auth.getUser()
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Usuário não autenticado' }), { status: 401, headers: corsHeaders })

    const { messages, perfil } = await req.json()
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Mensagens inválidas' }), { status: 400, headers: corsHeaders })
    }

    // Chamar Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-10), // últimas 10 mensagens para controlar custo
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic error:', errText)
      return new Response(JSON.stringify({ error: 'Erro na API da IA' }), { status: 500, headers: corsHeaders })
    }

    const result = await response.json()
    const content = result.content?.[0]?.text || ''

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('cfo-chat error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
