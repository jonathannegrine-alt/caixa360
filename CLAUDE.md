# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Caixa 360** — SPA de fluxo de caixa para e-commerce integrado com Mercado Livre.  
Produção: https://jonathannegrine-alt.github.io/caixa360/  
Repositório: https://github.com/jonathannegrine-alt/caixa360  
Clone local: `G:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\gestaomk\`

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
    vendas-ml.js      ← páginas Vendas (renderVendas) e Resumo Financeiro (renderResumoFin);
                        lê a tabela vendas_ml e chama a Edge Function ml-vendas
    dash-painel.js    ← painel "Caixa projetado" (renderPainelCaixa) — desenha em .view.active .pc-host
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
<script src="src/vendas-ml.js"></script>
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

`inicio` (página inicial) · `dashboard` · `planilha` · `pagar` · `receber` · `simulador` · `vendas` · `resumo-fin` · `skus` · `estoque` · `ordens-compra` · `analise` · `resultado` · `patrimonio` · `config`  
Cada página → `id="view-{page}"` em `index.html` e `render{Page}()` em `renders.js`

## Development workflow

**Editar diretamente os arquivos em `gestaomk/src/` ou `gestaomk/index.html`.**  
O `index.html` pai em `G:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\index.html` é backup obsoleto — não editar.

**Validar JS antes de deployar:**
```
node --check src/nome-do-arquivo.js
```

**Deploy:**
```
cd "G:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\gestaomk"
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
  extrato_historico, snapshots_ml, vendas_ml (migrations em supabase/migrations/)
- Edge Functions (supabase/functions/): ml-callback, ml-sync, ml-snapshot (cron diário 06:00 BRT), ml-vendas,
  ml-inventory, cfo-chat. Deploy: `supabase functions deploy <nome> --project-ref qasrccmtrllotukyeiax`
  (ml-sync, ml-snapshot, ml-vendas e ml-callback com `--no-verify-jwt`)
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
