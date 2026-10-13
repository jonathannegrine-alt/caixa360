# Previsão de Full: o que já se aprendeu

Diário do que foi descoberto sobre a sugestão de envio do Mercado Livre e de como a regra do Caixa 360
(`src/previsao-full.js`) chegou onde está. Serve para a próxima rodada de calibragem não recomeçar do zero.
Atualizar a cada rodada; registrar a data, o que foi medido e o que mudou na regra.

## Fontes

| Fonte | O que traz |
|---|---|
| Tela do ML: Anúncios → Gestão de estoque Full → Planejamento de envios | Sugestão, urgência, mínimo, "Histórico de vendas semanais" (6 semanas + selo de tendência, só produto Estrela) e o "Saiba mais" de cada produto com a explicação do cálculo |
| "Relatório de Planejamento de envios" (xlsx) | Vendas 30 d, aptas, recebimento pendente, mínimo, sugestão, prazo limite, urgência. É o que se importa na tela |
| "Relatório geral de estoque" (xlsx, aba Resumo) | Desde outubro/2026 tem o bloco "Informações para planejar" (urgência, estoque a enviar, mínimo). Antes disso não tem |
| YouTube, canal Vendedores Mercado Livre Brasil, websérie "Desmistificando Full" (EP 01, EP 02) e live "Full na prática: como ser estratégico com Produtos Estrela" | Os critérios declarados pelo ML |
| API do ML | Só o estoque atual (`/inventories/{id}/stock/fulfillment`). Não foi encontrado endpoint da sugestão (dez tentativas, sem ler a documentação oficial) |

## O que o Mercado Livre declara

- **Fórmula (texto do "Saiba mais", 13/10/2026):** sugestão = estoque para cobrir **o mínimo e 4 semanas de vendas**,
  "de acordo com sua frequência de envio", menos o **estoque atual**, mais a **demanda estimada por datas especiais**
  (no dia: Esquenta Black Friday, Black Friday, Natal).
- **Três perguntas do algoritmo (EP 02):** histórico recente (subindo, estável, caindo); estoque atual frente ao ritmo,
  para não faltar antes da próxima reposição; contexto e sazonalidade.
- **Olha o produto individualmente, não a categoria** (live).
- **Falta de estoque reduz a recomendação:** sem estoque as vendas param e o número fica menor que o potencial (EP 02).
- **Urgência** considera unidades aptas, a caminho e já adicionadas ao envio.
- **Mínimo** = piso que habilita o estoque distribuído pelo país; a recomendação é o mínimo mais semanas extras.
- **Produto Estrela** = vendas dos últimos 60 dias (consistência), giro alto e reputação. Enviado na quantidade
  sugerida ou acima fica isento da tarifa de estoque antigo.
- A sugestão é recalculada no fim de semana (mudou entre sábado 10/10 16h36 e domingo 11/10 21h09) e fica
  congelada durante a semana.

## O que foi medido (MKSTORE, relatório de 13/10/2026, 52 produtos com sugestão ou venda)

- As 6 semanas do gráfico do ML são blocos de 7 dias terminando na véspera, e batem com as vendas Full do sistema.
- Faixas de urgência pela cobertura (estoque ÷ demanda semanal): até 2 semanas "esta semana"; até 4 "próxima semana";
  até 4,6 "em 2 semanas"; acima disso, sugestão zero.
- O selo de tendência ("+N% por alta demanda") não segue uma conta única que se tenha achado. Aproximação em uso:
  0,6 × (média das 2 últimas semanas ÷ média das 6 − 1), limitada entre 0 e 40%.
- **Demanda que o ML prevê**, tirada da sugestão: (sugestão − mínimo + estoque) ÷ 4. Comparada com a média das 6 semanas:

| Produto | Previsão do ML por semana | Vezes a média das 6 semanas |
|---|---|---|
| J-2001 | 564 | 1,21 |
| J-2010-Vermelho | 161 | 1,26 |
| J-2010-Azul | 130 | 1,45 |
| J-2019-Palmeira-Marrom | 59 | 1,57 |
| J-2020-Adão-Bege | 73 | 1,68 |
| J-2020-Adão-Marrom | 104 | 1,83 |
| J-2005-Branco | 436 | 2,30 |
| J-2012-Branco-2 | 340 | 2,35 |
| J-2010-Rosa | 294 | 3,39 |

  Esse multiplicador é a soma de tendência e datas especiais. Varia de 1,2 a 3,4 e é por produto: é a parte que ainda
  não se sabe prever.
- **Outubro rosa:** o pendente de cerejeira rosa (J-2006-ROSA em 2025, hoje J-2005-Rosa) foi a 47% das vendas do
  branco na semana de 27/10 a 02/11/2025 e voltou a cerca de 30% em novembro. Em 2026 a razão sobe do mesmo jeito.
  A Black Friday puxou o branco (pico de 399 na semana de 17 a 23/11/2025), não o rosa. O histórico guardado começa
  em 12/10/2025, então o início de outubro de 2025 não é visível.

## Regras testadas

| Regra | Proximidade* | Mesma decisão de enviar |
|---|---|---|
| 1. Ritmo de 7 e 30 dias, "completar até N dias" descontando o estoque | 33% a 49% | 42 de 52 |
| 2. Média de 6 semanas + tendência, faixas de cobertura, lote de 34 dias (em uso) | 79% a 80% | 47 de 52 |
| Fórmula declarada (mínimo + 4 semanas − estoque) sem fator de datas especiais | 61% | — |
| Fórmula declarada com fator único de 1,4 (conta à mão, só Estrela) | cerca de 71% | — |

\* 100% − (soma das diferenças por produto ÷ soma das sugestões do ML). Medida com uma única semana de uma única
conta: pode cair em outras semanas.

## Onde a regra em uso ainda erra

- J-2010-Rosa: 937 unidades entre Full e transferência (8 semanas pela média) e o ML pede 420. É o maior multiplicador.
- J-2012-Branco-2 e J-2005-Branco: o ML pede perto de 7 semanas; o sistema pede menos.
- Produto zerado de baixo giro: sem a correção de ruptura o número fica perto do ML, mas abaixo do que o produto venderia.
- Florevi: só um produto com gráfico (zerado, semanas 126/194/80/25/16/2, sugestão 500; o sistema calcula perto de 430).

## Próximos passos

1. Importar o relatório toda segunda, de todas as contas. A cada importação, guardar o multiplicador de cada produto
   (a tela já mostra no dica da coluna "Mercado Livre") e acompanhar como ele se move até a Black Friday e depois dela.
2. Com quatro ou mais semanas: trocar a regra 2 pela fórmula declarada, usando o multiplicador aprendido por produto.
3. Ligar SKU antigo ao novo para a sazonalidade usar o ano anterior (conhecido: J-2006-ROSA → J-2005-Rosa).
4. Campo de "datas especiais" na tela, para ajuste manual antes de eventos.
5. Entender "de acordo com sua frequência de envio": as 4 semanas podem mudar para quem envia com outra frequência.
6. Ler o EP 03 (estoque distribuído) e a documentação oficial da API, para confirmar se a sugestão existe por lá.
