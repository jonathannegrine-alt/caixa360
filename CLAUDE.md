# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Caixa 360** — SPA de fluxo de caixa para e-commerce integrado com Mercado Livre.  
Produção: https://jonathannegrine-alt.github.io/caixa360/  
Repositório: https://github.com/jonathannegrine-alt/caixa360  
Clone local: `H:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\gestaomk\`

## Architecture

Aplicação multi-arquivo. **Não há build step, bundler nem framework.** GitHub Pages serve os arquivos diretamente.

```
gestaomk/
  index.html          ← HTML estrutural (2344 linhas): <head> + <body> + <link>/<script src>
  src/
    style.css         ← CSS base (729 linhas)
    theme.css         ← TEMA: tokens claro/escuro (html[data-theme]), barra lateral, componentes,
                        estilos de Vendas/Resumo, painel de caixa (.pc-*) e Início (.ini-*).
                        Carregado DEPOIS de style.css. Cores novas: usar var(--surface), var(--text), etc.
    tema.js           ← alternarTema()/aplicarTema() — tema salvo em localStorage mk_tema
    ordenar.js        ← QUALQUER tabela: clique no título ordena; arrastar o título muda a coluna de lugar (mk_col_ordem,
                        largura vai junto via colunasMover); dois cliques voltam a ordem original. Tabela de estrutura fixa:
                        marcar com data-sem-ordem. Título com onclick próprio continua com a ordenação dele
    rolagem.js        ← mantém a rolagem no lugar por 2,5 s depois de editar um campo ou clicar num botão de tabela
                        (telas que se redesenham ou recarregam após salvar voltavam ao topo). Carregado logo depois de tema.js
    supabase-auth.js  ← Supabase client, auth UI, onAuthStateChange, carregarDoSupabase,
                        salvarSupabase, carregarP11Supabase, salvarP11Supabase, feedback, erros
    state.js          ← Todas as variáveis globais (let), carregarDadosExemplo
    utils.js          ← dateStr, parseDate, fmt, sortTableByCol, makeSortable, getEntrada,
                        getPag, calcScore, calcPiorSaldo, P3 centro de decisão, P1 regressão
    nav.js            ← nav(page) — mostra/esconde .view divs
    renders.js        ← renderDashboard, renderPlanilha, renderPagar, renderCalendario,
                        renderReceber, renderSKUs, renderConfig e auxiliares
    modals.js         ← abrirModalLanc, salvarLanc, deletarLanc, modal SKU, modal kit, etc.
    storage.js        ← salvar(), carregar(), salvarCfg() — localStorage
    import-ml.js      ← exportCSV, importCSV, importJSON, A Receber ML, ML OAuth
    categorias-tiny.js← gerenciarCategorias, importar Tiny XLS
    pagar-import.js   ← dashboardResumo, calendárioClique, importarCSVPagar, parcelado/recorrente,
                        histórico fornecedor, modal série, delay calculado, importar JSON ML
    simulador-views.js← renderSimulador, renderKanbanPagar, renderCalPagar, renderRecCal,
                        seleção múltipla pagar
    relatorios-cfo.js ← fmtM/fmtP utils, alertas internos, P5 DRE, P6 Comparativo Mensal,
                        P12 Saúde Patrimonial, CFO Conselheiro (IA)
    lojas.js          ← LOJAS SEPARADAS: pagamentosTodos (tudo) x pagamentos (recorte da loja ativa), saldosLoja,
                        lojaPadrao; pagTodos()/lojasAbrir()/lojasFechar() para quem precisa do conjunto completo;
                        lista de contas ML em Configurações (desconectar, loja padrão); toast()
    curva.js          ← curva de maturação dos recebíveis (snapshots_ml x extrato); curvaFator(dias) usado em getEntrada
    pagar-form.js     ← formulário de conta a pagar no modelo Olist (substitui abrirModalLanc/editarLanc/abrirModalSerie)
    analise.js        ← página Análise de vendas (anRender): 12 meses, produtos, compradores, estados, cancelamentos, ADS
    pos-venda.js      ← página Pós-venda com IA (fila, histórico, regras, automação) — Edge Function pos-venda
    compras-lista.js  ← marcar produtos na Sugestão de compras e gerar lista em PDF (jsPDF sob demanda)
    conciliacao.js    ← Conciliação do ML (página 'conciliacao'): lê no navegador os relatórios "por vendas" e "por liberação"
                        (Excel), grava em concil_linhas e compara com vendas_ml (RPCs concil_resumo / concil_divergencias)
    gestao.js         ← abas da Análise de vendas: Lucro real (margem − ADS), Degrau do frete, Venda perdida
    fatura-ml.js      ← fatura do ML no DRE: soma por mês (RPC ml_fatura_mes), modo comprasCfg.faturaDre ('auto' | 'pagar'),
                        categoria com dreGrupo 'fatura' = "só caixa" (sai do DRE nos meses em que a fatura entrou)
    opinioes.js       ← aba Opiniões da Análise de vendas (função ml-opinioes) + texto pronto para colar numa IA
    sistema.js        ← página "Estamos atualizando" (tabela sistema_status) e faixa de conta ainda carregando o histórico
    admin.js          ← painel do administrador (contas, cobrança simulada, cupons, servidor) e cartão "Minha assinatura"
    tarefas.js        ← fila de tarefas pesadas com aviso no sininho: tarefaPedir(), tfTotaisRpc() (tabela tarefas)
    gestao-fin.js     ← ponto de equilíbrio por dia e custo da dívida (Início e Empréstimos) + fechamento do mês em PDF
    contas-ml.js      ← GRUPOS DE CONTAS ML: contasML, contaAtiva ("" = todas), liberacoesTodas/extratoTodos,
                        aplicarContaAtiva() recorta liberacoes e extratoHistorico; seletor na barra lateral
    vendas-ml.js      ← páginas Vendas (renderVendas, gráfico comparativo) e Resumo Financeiro (renderResumoFin,
                        nivelar/reprocessar custo, ranking consolidado). Dados: view vendas_ml_calc + RPCs;
                        a página pede só a página atual e os totais ao banco
    atendimento.js    ← Perguntas e Mensagens do ML (Edge Function ml-atendimento) + pop-up de reconexão
    dre-anual.js      ← DRE mês a mês (aba padrão de "DRE e resultado"): RPC vendas_ml_por_mes + pagamentos
    dre-simples.js    ← MODO SIMPLIFICADO do DRE (aba "Despesas simples"): tabela dre_simples; com comprasCfg.dreSimples ligado,
                        dreDespesas() usa dsDespesas() no lugar de Contas a pagar e gfParcelas/gfForaDoDre devolvem zero
    config-abas.js    ← coloca os blocos de Configurações em abas pelo título do card
    compras.js        ← Sugestão de compras (regras do módulo "Balanço e Compras"); parâmetros em comprasCfg
    ia-conector.js    ← Configurações → IA: gera/revoga a chave do conector MCP (Edge Function mcp)
    dash-painel.js    ← painel "Caixa projetado" (renderPainelCaixa) — desenha em .view.active .pc-host
    pedidos.js        ← página Pedidos (renderPedidos): vendas do galpão até o envio, atrasados pelo prazo
                        (vendas_ml.envio_limite, gravado pelo ml-envios) e alerta no Início (pdAlertaInicio)
    inicio.js         ← página Início (renderInicio): visão geral de caixa, vendas, contas e alertas
    init.js           ← renderConfig, autosave, Enter=Tab em inputs, botão voltar do browser
    p11-motor.js      ← P11 Motor de Reposição, Estoque Full ML (busca API)
    p11-galpao.js     ← Estoque Galpão (aba completa, 1767 linhas — candidato a split futuro)
                        + PWA service worker + START (supa.auth.getSession)
```

### Ordem de carregamento dos scripts (crítica)

```html
<script src="src/tema.js"></script>
<script src="src/supabase-auth.js"></script>  ← define supa, entrarNoApp
<script src="src/state.js"></script>           ← define pagamentos[], liberacoes[], etc.
<script src="src/utils.js"></script>           ← usa state
<script src="src/nav.js"></script>             ← usa renders
<script src="src/renders.js"></script>
<script src="src/modals.js"></script>
<script src="src/storage.js"></script>
<script src="src/import-ml.js"></script>
<script src="src/categorias-tiny.js"></script>
<script src="src/pagar-import.js"></script>
<script src="src/simulador-views.js"></script>
<script src="src/relatorios-cfo.js"></script>
<script src="src/contas-ml.js"></script>
<script src="src/vendas-ml.js"></script>
<script src="src/atendimento.js"></script>
<script src="src/dre-anual.js"></script>
<script src="src/config-abas.js"></script>
<script src="src/compras.js"></script>
<script src="src/ia-conector.js"></script>
<script src="src/dash-painel.js"></script>
<script src="src/inicio.js"></script>
<script src="src/init.js"></script>
<script src="src/p11-motor.js"></script>
<script src="src/p11-galpao.js"></script>      ← último: chama supa.auth.getSession()
```

### Key data structures

```js
// Contas a pagar
pagamentos = [{ desc, forn, val, data, cat, pago, tipo, grupo_id, parcela, valorPago }]

// Recebíveis ML importados
liberacoes = [{ data, val }]   // data: "YYYY-MM-DD"

// Config vars (persisted via salvarCfg())
saldoMP, saldoOutros, cfgDelay, cfgPct, reservaMinima, periodoHistorico
```

### Core projection logic (`getEntrada(data)`) — em `utils.js`

Returns `{ conf, proj, total }` per day:
- `conf` = sum de `liberacoes` para aquela data (D+1–7, confirmado)
- `proj` = média histórica × `cfgPct` via `MAX(conf, projeção prudencial)` (D+8+)

### Persistence

Dados em `localStorage` (sync) + Supabase (async, fire-and-forget):
- `mk_pagamentos` → `pagamentos[]`
- `mk_liberacoes` → `liberacoes[]`
- `mk_skus` → `skus[]`
- `mk_categorias` → `categorias[]`
- `mk_config` → `{ saldoMP, saldoOutros, cfgDelay, cfgPct, reservaMinima, periodoHistorico }`

### Navigation pages

`inicio` (página inicial) · `pedidos` · `dashboard` · `planilha` · `pagar` · `emprestimos` · `receber` · `simulador` · `vendas` · `resumo-fin` · `posvenda` · `perguntas` · `mensagens` · `compras` · `skus` · `estoque` · `ordens-compra` · `analise` · `resultado` · `patrimonio` · `config`  
Cada página → `id="view-{page}"` em `index.html` e `render{Page}()` em `renders.js`

Menu lateral (19/10/2026), grupos `data-sec`, um aberto por vez (toggleNavSec): ven Vendas (vendas, pedidos, resumo-fin
"Lucro das vendas", analise, promocoes) · atd Atendimento (perguntas, mensagens, posvenda) · est Estoque e Full (skus,
estoque, full) · cmp Compras (compras, ordens-compra, simulador) · cx Caixa (dashboard, planilha, pagar, receber,
emprestimos) · conf Conferências (conciliacao, frete, flex) · res Resultado (resultado, patrimonio) · sis Sistema.

## Development workflow

**Editar diretamente os arquivos em `gestaomk/src/` ou `gestaomk/index.html`.**  
O `index.html` pai em `H:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\index.html` é backup obsoleto — não editar.

**Validar JS antes de deployar:**
```
node --check src/nome-do-arquivo.js
```

**Deploy:**
```
cd "H:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\gestaomk"
git add src/ index.html
git commit -m "descrição"
git push origin main
```
GitHub Pages publica automaticamente em ~1 min em https://jonathannegrine-alt.github.io/caixa360/

## Backend (Supabase — em produção)

- URL: https://qasrccmtrllotukyeiax.supabase.co
- Anon key: sb_publishable_7TU_CA9JlPgoYTpKHkH8dA_FSBgvPVd
- Auth: email/senha, sessão persistente, reset por e-mail
- Tabelas: pagamentos, liberacoes, skus, categorias, configuracoes, ml_tokens, erros_log, feedbacks,
  extrato_historico, snapshots_ml, vendas_ml, vendas_ml_dias, ia_chaves (migrations em supabase/migrations/)
- Edge Functions (supabase/functions/): ml-callback, ml-sync, ml-snapshot (cron diário 06:00 BRT), ml-vendas
  (cron ml-vendas-sync a cada 15 min), ml-atendimento, mcp (conector de IA, chave pessoal), ml-inventory, cfo-chat. Deploy: `supabase functions deploy <nome> --project-ref qasrccmtrllotukyeiax`
  (ml-sync, ml-snapshot, ml-vendas, ml-atendimento, mcp e ml-callback com `--no-verify-jwt`)
- GRAVAÇÃO POR LINHA: salvarSupabase() compara com a base lida do banco (_sinc.base) e só inclui/altera/exclui o que
  mudou (pagamentos, categorias, skus); nunca apagar-tudo-e-inserir. Depois de gravar avisa as outras abas
  (BroadcastChannel 'caixa360'), que recarregam sozinhas (sincRecarregar). Leitura paginada com supaTudo().
- LOJAS: pagamentos.loja / emprestimos.loja = ml_user_id (vazio = loja padrão em cfg.lojaPadrao). Código que varre
  TODAS as contas a pagar deve usar pagTodos() ou lojasAbrir()/lojasFechar(), nunca o array pagamentos direto.
- PÓS-VENDA: tabelas pos_venda_cfg/casos/log; função pos-venda (--no-verify-jwt; cron 'pos-venda' aos 12 e 42 min, só
  para pos_venda_cfg.ativo). Nada é enviado ao ML sem aprovação, a não ser com auto_msg/auto_dinheiro ligados.
- CONCILIAÇÃO: no relatório "por vendas" cada linha é um evento do dia (a venda num dia, o frete quando o pacote sai);
  a tarifa de envio vem cheia e o frete pago pelo comprador entra no valor bruto; "Cancelamento ..." abate a tarifa.
  A comparação é por envio (carrinho = um envio). Reimportar não duplica (chave por linha).
- FATURA DO ML (ml-fatura, cron a cada minuto): a API /billing/integration aceita 5 consultas por minuto para o
  APLICATIVO INTEIRO (medido em 12/10/2026), por isso a função faz 4 consultas por chamada e guarda onde parou
  (ml_fatura_periodos.prox). Lista de faturas: limit máximo 12. Linhas: limit 1000, filtro detail_sub_types=A,B,C.
  Só grava cobranças fora das vendas (ml_fatura_tipos.classe <> 'venda'); bonificação entra negativa. O DRE só usa a
  fatura depois da primeira leitura completa (lido_ok). DIFAL não traz a venda nem o estado.
- CAPACIDADE (desde 13/10/2026): plano Pro, máquina Micro (1 GB). Em 12/10 o banco caiu por falta de recurso. Regras:
  nada de cron por minuto chamando função de borda nem carga longa de dia; rotina pesada vai para a madrugada ou
  para a fila (tarefas). Antes de operação pesada, olhar public.sistema_saude (retrato a cada 10 min).
- RESUMO DAS VENDAS: vendas_ml_por_mes / vendas_ml_por_dia leem vendas_resumo_dia (totais por usuário, conta e dia).
  Gatilhos em vendas_ml, vendas_cfg e skus marcam o dia em vendas_resumo_pend; a leitura refaz na hora se for pouco
  (≤ 45 dias) ou calcula direto das vendas se for muito; o cron 'vendas-resumo' (SQL) refaz o resto. Coluna nova que
  entre na margem precisa entrar em vendas_resumo_calc E na lista de colunas do gatilho vendas_resumo_marcar.
- FOTO DO ANÚNCIO: fica em vendas_fotos (uma por anúncio); vendas_ml.thumbnail é nulo e a view vendas_ml_calc devolve
  a coluna. Ler foto pela view, nunca pela tabela vendas_ml.
- FILA (tarefas): tipos 'nivelar' e 'totais'; cron 'tarefas' (SQL, a cada minuto) executa como o usuário dono.
  Tipo novo = incluir em tarefa_criar e em tarefas_cron.
- FATURA: fatura fechada e lida vira total em ml_fatura_totais (ml_fatura_compactar, cron diário) e as linhas somem;
  ler sempre pela view ml_fatura_tudo. Só a fatura aberta mantém linhas.
- MANUTENÇÃO: update public.sistema_status set manutencao = true where id = 1 → o site mostra "Estamos atualizando".
- GRUPO DA CATEGORIA (categorias[].dreGrupo): fixo | variavel | emprestimo | fora | fatura. Editável em Contas a pagar
  (pfGrupoGravar) e em DRE → Configurar categorias. "emprestimo" = devolução do valor: fora do DRE, mas conta no ponto de
  equilíbrio e no custo da dívida (gfEhPrincipal). Empréstimo com sistema "aberto" = sem data, saldo × taxa ao mês.
- FLEX NO DRE: repasse do ML (vendas_ml.frete_flex, valor cheio da tabela do Flex) entra como redução de custo; o
  transportador vem de Contas a pagar em categoria com "Flex" no nome e, no mês sem lançamento, de flex_custo × entregas.
- SELOS do menu (avisos.js): avReal = pendência real (perguntas sem resposta, conversas não lidas, casos na fila).
  Mensagens: "não lida" manual fica em localStorage mk_msg_naolidas; "lida" chama ml-atendimento com marcar_lida.
- ADMINISTRAÇÃO (src/admin.js, só app_admin): RPC admin_painel; planos, cupons (uso único), assinaturas; cobranca_calc
  simula a mensalidade pelos pedidos de 30 dias (vendas_resumo_dia). Nada é cobrado de verdade ainda (fase 1).
- PREVISÃO DE FULL (src/previsao-full.js, aba da Análise de vendas): RPC full_previsao_base (vendas Full por SKU: 7 d, 7 d
  anteriores, 30 d, dias com venda, mesmo período do ano passado) + tabela full_sugestoes (sugestão do ML importada do
  relatório de planejamento ou do relatório geral de estoque). A regra fica no topo do arquivo e no rodapé da tela.
  Antes de mexer na regra, ler docs/previsao-full-aprendizado.md (fontes, fórmula declarada pelo ML, regras já testadas
  e o que cada uma acertou) e registrar ali o resultado de cada nova calibragem.
  Importação com mais de uma loja: janela pflConfirmarLoja (o xlsx do ML não diz a loja); RPC full_conta_skus conta em quais
  lojas os SKUs têm anúncio/venda Full e já marca a mais provável. Lista "Relatórios importados" (RPC full_relatorios, apagar por data).
  Envio com data marcada (pfl.envio): projeta o estoque até o dia em que o envio fica disponível. sku_trocas liga SKU antigo ao atual.
  Envios do planejamento interno (estoque_envios_full situação 'preparando', por anuncio_sku) entram em "A caminho" (pfl.progUsar,
  padrão ligado): o ML não os mostra antes de liberar a data; ao lançar a saída deixam de contar. Cada um fica disponível em
  data_prevista + pfl.entrada; se o estoque de agora zera antes, faltaProg avisa no "Acaba em" e o estoque efetivo é o que dura até acabar.
  Coluna "No galpão" = estLinhas(depósito próprio).disp (kit pelos componentes, esoAbrir). Botão "Carregar nos envios ao Full"
  (pflParaEnvios) abre esoRevisarEnvio com numero "Previsão dd/mm hh:mm". Importar o PDF oficial do ML NUNCA substitui nem apaga
  envio planejado (decisão do usuário, 19/10/2026: ele exclui à mão o que não serve); só o mesmo número de envio é atualizado.
- ORDENS DE COMPRA (src/compras-ordens.js + compras-ordens-local.js, tabela olist_ordens; id > 0 = Olist, id < 0 = criada aqui):
  qualquer ordem pode ser editada (ocEditar). Ordem do Olist editada ganha extra.editada e excluída ganha extra.excluida (não
  sai do banco); olist-compras pula as duas ao sincronizar. Lista com busca, caixas de marcar e ações em lote (PDF uma ordem
  por página, planilha, excluir). Com ordens guardadas a tela funciona sem o Olist (ocGuardadas).
- FORNECEDORES (src/fornecedores.js, página 'fornecedores' no grupo Compras, tabela fornecedores): cadastro por loja
  (loja = ml_user_id, vazio = padrão). Casa contas a pagar (p.forn) e ordens (olist_ordens.fornecedor) pelo nome, razão
  social, fantasia ou apelidos (fnChave: sem acento, pontuação e LTDA/ME/EPP). CNPJ: BrasilAPI (/api/cnpj/v1) + IE pela
  publica.cnpj.ws (3/min), chamadas do navegador. Junta Comercial não tem consulta pública.
- NOTAS RECEBIDAS (src/nfe.js + função nfe, cron nfe-dist 4x/dia): Distribuição de DF-e da SEFAZ (Ambiente Nacional,
  SOAP 1.2, TLS com o certificado A1 do cliente via Deno.createHttpClient com http2:false — o AN recusa HTTP/2).
  Certificado por loja em nfe_certificados, .pfx e senha cifrados com AES-GCM (secret NFE_CERT_KEY); a tabela não tem
  política para authenticated (tela usa a RPC nfe_certificados_meus). nfe_dist guarda ult_nsu e esperar_ate (cStat 137
  ou ultNSU = maxNSU → esperar 1 h; consultar antes dá 656). Notas em nfe_recebidas; XML completo em Storage nfe/.
  Só consulta. Ciência da operação (evento 210210, XML assinado) e importar a compra ficam para a etapa seguinte.
- FOTO EM TABELA: toda lista de produto usa fotoLinha(sku, html) / fotoCel(sku) de src/estoque.js (busca e preenche a foto sozinha).
- ÚLTIMO ACESSO (admin): maior entre login, auth.sessions e assinaturas.ultimo_acesso (gravado por assinatura_acesso ao abrir).
- assinaturas.valor_combinado = valor negociado (vale no lugar do calculado); crédito de IA pré-pago = pos_venda_cfg.credito, recarga por admin_ia_recarga (histórico em ia_recargas).
- PÓS-VENDA NA HORA: ml-webhook (claims) chama pos-venda { cron, secret, usuario } para quem tem ativo = true; a função ignora se rodou há menos de 5 min.
- ml-promos acao "ativas": promoções em andamento de até 120 anúncios (selo da lista Por anúncio); /items original_price não serve para isso.
- ETIQUETA DE ENVIO: ml-envios guarda o ZPL compactado (Storage etiquetas/<usuario>/<envio>.zpl.gz, ~1,3 KB; PDF só se o ZPL
  falhar e nas cópias anteriores a 16/10/2026). ml-venda {acao:'etiqueta', formato:'zpl'} devolve o texto; a tela reconstrói com
  zpl-renderer-js 4.0.0 (WASM pelo jsDelivr, grayscaleOutput) e monta a folha de controle com vendas_ml. O renderizador ignora ^MU (não dá para dobrar a resolução).
- CONTAGEM PELA UPSELLER (investigado em 19/10/2026 no Relatório do Estoque da UpSeller): a UpSeller tira do "Estoque Atual"
  quando o pedido vai para "Para Retirada"/"Para Enviar" (etiqueta), horas ou dias antes de o ML marcar o envio; o Caixa 360
  baixa pelo enviado_em do ML. Por isso a planilha é lida pelo Disponível: físico = Disponível + pedidos nossos ainda sem baixa
  (esoUpsellerFisico). Usar o Estoque Atual baixava em dobro os pedidos já despachados e ainda não marcados pelo ML.
  ml-webhook não reescreve enviado_em (a hora de "shipped" vem depois da coleta).
- COBERTURA NO ESTOQUE (src/estoque.js): Total e galpão usam comprasVendas (vendas_ml_sku_dia, kits abertos); a aba do Full usa
  a RPC vendas_full_sku (só logistic_type fulfillment, por conta e SKU do anúncio). Período em localStorage mk_est_periodo.
- VENDA CANCELADA DEPOIS DE ENVIADA (vendas_ml_cobr): o ML estorna a tarifa de venda e devolve o valor ao comprador, mas fica a
  tarifa de envio CHEIA (parte do vendedor + a do comprador, que é reembolsada a ele) e a tarifa de devolução. ml-fatura (passo 4)
  lê GET /billing/integration/group/ML/order/details de 20 vendas canceladas por consulta (a resposta corta em 250 linhas no total),
  grava só envio ('ida': CFFE, CXDE… e estornos) e devolução ('dev': CXDED, CDSDB… e estornos) no dia da cobrança e marca
  vendas_ml_cobr_lida (relê com 7, 20 e 45 dias). Envio cancelado = sem cobrança. DRE: RPC vendas_ml_cobr_mes (ida só de venda
  cancelada); tela de Vendas: cartão da cancelada mostra o resultado negativo. Conferido com a conciliação de set/2026: 25 de 25.
- HISTÓRICO POR CONTA (src/historico.js): ml_tokens.historico_desde = primeiro dia que ml-vendas, ml-snapshot (extrato) e ml-fatura
  (faturas e cobranças) buscam. Conta nova = hoje − 30 (padrão da coluna); nulo = conta antiga, 365 dias. Reconectar não encolhe
  (gatilho ml_tokens_historico usa o 1º dia já importado). Histórico mais antigo = pedido em reprocessos (ml-vendas acao
  hist_orcar/hist_pedir conta os pedidos em orders/search paging.total; preço reprocesso_valor = R$ preco_mil por 1.000, mínimo),
  bloqueado até admin_reprocesso_decidir (Administração → Histórico pago), que recua historico_desde. Código novo que busca
  histórico no ML precisa respeitar historico_desde.
- ml-sonda: função só para o administrador que faz GET na API do ML e devolve um resumo (estudo de endpoints).
- mercado_resumo: resumo por mês e produto com a conta trocada por número (estudo de sazonalidade; só administração).
- ml-opinioes: /reviews/item/{id} só responde com o token da conta dona do anúncio (403 com outra); ?rating=N
  filtra por nota (sem isso vêm as mais relevantes, quase todas nota 5).
- ml-webhook também trata: items (ml_itens_base.situacao/estoque/preco), fbm_stock_operations (aviso 'full'),
  orders_feedback (aviso 'avaliacao' só para nota negativa ou neutra).
- Outras funções novas: ml-ads (anúncios pagos), ml-envios também grava vendas_ml.uf (estado do comprador).
- TABELA NOVA gravada por função de borda: dar `grant select, insert, update, delete ... to service_role` na migration.
  Neste projeto o service_role não recebe acesso sozinho (deu 42501 em vendas_fotos e em nfe_certificados).
- VÁRIAS CONTAS ML POR USUÁRIO: ml_tokens tem PK (usuario_id, ml_user_id). Todo PATCH/DELETE em ml_tokens e toda
  gravação em liberacoes/extrato_historico/snapshots_ml/vendas_ml/vendas_ml_dias precisa do ml_user_id.
- Custo por venda: vendas_ml.custo_unit/imposto_pct ficam gravados (RPC vendas_ml_carimbar); mudar o cadastro
  não altera o passado. Reprocessar/nivelar: RPCs vendas_ml_reprocessar, vendas_ml_nivelar, vendas_ml_nivelar_sku.
- Depois de um deploy o navegador pode manter index.html/JS antigos por até 10 min (cache do GitHub Pages):
  código novo que depende de arquivo novo deve tolerar a ausência dele (typeof x === "function").
- API do ML: buscar collections/search UM DIA POR VEZ (offsets profundos dão http 500) e nunca gravar
  resultado parcial; só `operation_type = regular_payment` é venda
- Site URL: https://jonathannegrine-alt.github.io/caixa360/
- Redirect URLs: caixa360/ + localhost:3000

## v2.0 spec

Full specification in `PROJETO-MK-GESTAO-v2.md`. Priorities:

1. **Bugs críticos** — CONCLUÍDO
2. **New projection logic** — CONCLUÍDO (D+1-7 confirmado, D+8+ MAX prudencial)
3. **UX** — CONCLUÍDO
4. **Backend Supabase** — CONCLUÍDO (auth + sync + reset senha)
5. **Refactoring** — CONCLUÍDO (2026-06-16, 9791 → multi-arquivo src/)

## Development principles

- Test each item before moving to the next
- Implement one feature at a time — do not make 5 changes without testing
- Never break working functionality
- Save a backup before large changes
- **Editar `src/*.js` diretamente** — não regenerar a partir do backup obsoleto
- `String.split(old).join(new)` em patch scripts, nunca `.replace()` (bug de `$'` em strings longas)
