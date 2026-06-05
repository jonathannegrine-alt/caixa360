# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Caixa 360** — SPA de fluxo de caixa para e-commerce integrado com Mercado Livre.  
Produção: https://jonathannegrine-alt.github.io/caixa360/  
Repositório: https://github.com/jonathannegrine-alt/caixa360  
Clone local: `G:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\gestaomk\` (pasta ainda com nome antigo — cosmético)

## Architecture

The entire application is a single file: **`index.html`** (~3000 lines). No build step, no bundler, no framework. Sections are laid out in this order:

1. **`<head>`** — imports only `xlsx.full.min.js` (CDN) for XLS import
2. **`<style>`** — all CSS inline, ~1200 lines. CSS custom properties defined in `:root`
3. **`<body>`** — HTML structure: fixed `.sidebar` + `.main` content area. Each page is a `<div class="view" id="view-{page}">` toggled with `display:none/block`
4. **`<script>`** — all JS inline, starts at line ~1218

### JavaScript layout (all inline, no modules)

| Section | What it does |
|---|---|
| Global state (~1218) | `pagamentos[]`, `liberacoes[]`, `skus[]`, `categorias[]`, config vars |
| Utils (~1284) | `dateStr()`, `parseDate()`, `ptDate()`, `fmt()`, `addDias()`, etc. |
| Calculations (~1337) | `getEntrada()`, `getPag()`, `calcScore()`, `calcPiorSaldo()` |
| Navigation (~1405) | `nav(page)` — shows/hides `.view` divs, calls page render function |
| Render functions (~1426) | One `render*()` per page: `renderDashboard()`, `renderPlanilha()`, `renderPagar()`, `renderCalendario()`, `renderReceber()`, `renderSKUs()` |
| CRUD modals (~1939) | `abrirModalLanc()`, `salvarLanc()`, `deletarLanc()` and equivalents |
| Storage (~2057) | `salvar()` / `carregar()` — reads/writes `localStorage` as JSON |
| Import/Export (~2106) | CSV, JSON backup, XLS Tiny ERP, JSON ML |
| Simulator (~2868) | `simular()`, `simularSaldo()`, `renderPlanilhaSimulador()` |
| Kanban/Cal views (~2946) | `renderKanbanPagar()`, `renderCalPagar()`, `renderRecCal()` |
| `init()` (~3129) | Entry point — calls `carregar()`, sets today's date, calls `renderDashboard()` |

### Key data structures

```js
// Contas a pagar
pagamentos = [{ desc, forn, val, data, cat, pago, tipo, grupo_id, parcela, valorPago }]

// Recebíveis ML importados
liberacoes = [{ data, val }]   // data: "YYYY-MM-DD"

// Config vars (persisted via salvarCfg())
saldoMP, saldoOutros, cfgDelay, cfgPct, reservaMinima, periodoHistorico
```

### Core projection logic (`getEntrada(data)`)

Returns `{ conf, proj, total }` per day:
- `conf` = sum of `liberacoes` for that date
- `proj` = historical daily average × `cfgPct`, applied only when `diasAteData > cfgDelay`
- `total` = `conf + proj`

The v2.0 spec replaces this with `MAX(conf, projeção prudencial)` with D+1–7 / D+8+ confidence bands.

### Persistence

All data lives in `localStorage`:
- Key `mk_pagamentos` → `pagamentos[]`
- Key `mk_liberacoes` → `liberacoes[]`
- Key `mk_skus` → `skus[]`
- Key `mk_categorias` → `categorias[]`
- Key `mk_config` → config object `{ saldoMP, saldoOutros, cfgDelay, cfgPct, reservaMinima, periodoHistorico }`

### Navigation pages

`dashboard` · `planilha` · `pagar` · `receber` · `simulador` · `skus` · `config`  
Each maps to `id="view-{page}"` in HTML and a `render{Page}()` JS function.

## Development workflow

No build step. Edit `index.html` directly and open in browser.

**Validate JS before deploying:**
```
node --check index.html
```
(This only catches syntax errors — manual browser testing is required for logic.)

**Deploy:** push to `main` branch on GitHub; GitHub Pages serves automatically.

## Backend (Supabase — em produção)

- URL: https://qasrccmtrllotukyeiax.supabase.co
- Anon key: sb_publishable_7TU_CA9JlPgoYTpKHkH8dA_FSBgvPVd
- Auth: email/senha, sessão persistente, reset por e-mail
- Tabelas: pagamentos, liberacoes, skus, categorias, configuracoes, ml_tokens, erros_log, feedbacks
- Site URL: https://jonathannegrine-alt.github.io/caixa360/
- Redirect URLs: caixa360/ + localhost:3000

## Deploy

```
cd "G:\Meu Drive\1. NEGÓCIOS\E-commerce\App Financeiro Claude\gestaomk"
copy ..\index.html .
git add index.html
git commit -m "descrição"
git push origin main
```
GitHub Pages publica automaticamente em ~1 min em https://jonathannegrine-alt.github.io/caixa360/

## v2.0 spec

Full specification in `PROJETO-MK-GESTAO-v2.md`. Priorities:

1. **Bugs críticos** — CONCLUÍDO
2. **New projection logic** — CONCLUÍDO (D+1-7 confirmado, D+8+ MAX prudencial)
3. **UX** — CONCLUÍDO
4. **Backend Supabase** — CONCLUÍDO (auth + sync + reset senha)

## Development principles

- Test each item before moving to the next
- Implement one feature at a time — do not make 5 changes without testing
- Never break working functionality
- Save a backup before large changes
