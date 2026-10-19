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
2. ~~Com quatro ou mais semanas: trocar a regra 2 pela fórmula declarada, usando o multiplicador aprendido por produto.~~ Em 19/10 o multiplicador mudou muito de uma semana para outra e a fórmula com ele acertou menos (69% x 83%). Reavaliar só com 4 semanas.
3. Feito em 13/10/2026: tabela sku_trocas e quadro "Produto que trocou de SKU" na tela. Falta o usuário cadastrar J-2006-ROSA → J-2005-Rosa e medir se a sazonalidade melhora o acerto.
4. Feito em 13/10/2026: campo "Reforço para data especial" (percentual único para todos os produtos). O ideal é por produto, com o multiplicador aprendido.
5. Entender "de acordo com sua frequência de envio": as 4 semanas podem mudar para quem envia com outra frequência.
6. Ler o EP 03 (estoque distribuído) e a documentação oficial da API, para confirmar se a sugestão existe por lá.

## Rodada de 13/10/2026 (tarde)

- Filtros com os nomes do ML (esta semana, próxima semana, 2 semanas ou mais). Contagem do sistema: 32 / 5 / 2; tela do ML no mesmo dia: 31 / 6 / 2.
- Envio com data marcada: o estoque é projetado até a data do envio mais os dias de conferência (padrão 2) e o lote é calculado com essa sobra. A comparação com o ML continua sendo feita com a conta de hoje (80%).
- O ML tem dois status que o sistema não reproduz: "Urgente" (zerado, "o quanto antes") e "Excedente" / "não repor por estoque antigo" (sugestão zero mesmo com cobertura baixa).

## Rodada de 19/10/2026 (segunda semana MKSTORE, primeira Florevi)

Conta feita fora da tela (sem a sazonalidade do ano passado), por isso os números diferem um pouco do que a tela mostra.

| Loja / relatório | Produtos | Sugestão ML | Regra 2 | Proximidade | Mesma decisão |
|---|---|---|---|---|---|
| MKSTORE 13/10 | 52 | 8.439 | 8.214 | 81% | 47 de 52 |
| MKSTORE 19/10 | 52 | 12.271 | 11.950 | 82% | 48 de 52 |
| Florevi 19/10 | 13 | 979 | 530 | 51% | 10 de 13 |

- **O multiplicador por produto não se repete de uma semana para a outra.** J-2010-Rosa 3,39 → 2,01; J-2012-Branco-2 2,35 → 1,47;
  J-2001 1,21 → 0,94 (zerou no Full). Teste: fórmula declarada (mínimo + 4 semanas × multiplicador de 13/10 − estoque) aplicada em
  19/10 deu 68% a 69%, contra 83% da regra 2 nos mesmos 15 produtos. O passo 2 dos próximos passos (trocar pela fórmula declarada
  com multiplicador aprendido) **não se sustenta com estes dados**; a regra 2 continua.
- A sugestão total da MKSTORE subiu 45% (8.439 → 12.271), puxada por J-2010-Branco (0 → 2.400, estoque caiu de 1.553 para 868)
  e pelos produtos que zeraram (J-2010-Vermelho e Azul). A regra 2 subiu junto (8.214 → 11.950): o aumento é estoque, não reforço de data especial.
- Novos status do ML no relatório: "Urgente" (zerado) e "Excedente".
- **Florevi: produto novo.** Costelas de Adão com 1 a 2 semanas de venda: o ML usa o ritmo recente (J-V03-PED-PRT: 15 na última
  semana, sugere 53), a regra 2 dilui nas 6 semanas (sugere 19). Contar só as semanas desde a primeira venda sobe a proximidade da
  Florevi de 51% para 54% e não muda a MKSTORE (82%). Ganho pequeno; esperar mais semanas antes de mudar.
- Florevi J-2026-220V: ML pede 200 com 5,4 semanas de cobertura pela média (multiplicador 2,99, venda saltou para 33 na última semana).
- Nenhum outro usuário importou relatório até 19/10.
