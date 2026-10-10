-- CONTROLE DE ESTOQUE DO CAIXA 360 (modelo inspirado na UpSeller)
--
-- Vários depósitos por usuário (ex.: Galpão e Full). O saldo de cada produto num depósito é a SOMA das
-- movimentações (estoque_mov): nada altera saldo sem deixar uma linha com motivo e referência.
--   físico      = soma das movimentações
--   ocupado     = vendido e ainda não enviado + envio ao Full em preparação (calculado, não é movimentação)
--   disponível  = físico − ocupado
-- O depósito do tipo 'full' não tem movimentações: o saldo dele vem da API do Mercado Livre.
-- A UpSeller continua sendo o sistema da expedição; o Caixa 360 é conferido contra ela por contagem.

create table if not exists public.estoque_depositos (
  id         bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nome       text not null,
  tipo       text not null default 'proprio' check (tipo in ('proprio', 'full')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (usuario_id, nome)
);

create table if not exists public.estoque_mov (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  deposito_id bigint not null references public.estoque_depositos(id) on delete cascade,
  sku         text not null,                       -- como foi escrito
  sku_norm    text generated always as (lower(btrim(sku))) stored,
  qtd         numeric not null,                    -- positivo entra, negativo sai
  motivo      text not null check (motivo in ('carga_inicial', 'compra', 'venda', 'envio_full', 'contagem', 'ajuste', 'transferencia', 'devolucao')),
  ref         text,                                -- nº da ordem, do pedido, do envio ou da contagem
  obs         text,
  custo_unit  numeric,                             -- custo da entrada (compra), para o custo médio
  criado_em   timestamptz not null default now()
);
create index if not exists estoque_mov_saldo on public.estoque_mov (usuario_id, deposito_id, sku_norm);
create index if not exists estoque_mov_data on public.estoque_mov (usuario_id, criado_em desc);
-- uma venda (ou um envio) só baixa uma vez cada produto: repetir a sincronização não duplica
create unique index if not exists estoque_mov_unica on public.estoque_mov (usuario_id, deposito_id, motivo, ref, sku_norm)
  where motivo in ('venda', 'envio_full', 'carga_inicial') and ref is not null;

create or replace view public.estoque_saldo with (security_invoker = true) as
  select usuario_id, deposito_id, sku_norm, max(sku) as sku, sum(qtd) as fisico, max(criado_em) as ultima_mov
  from public.estoque_mov group by usuario_id, deposito_id, sku_norm;

-- contagem de estoque: o que o sistema dizia, o que foi contado e a diferença; ao aplicar, gera movimentações
create table if not exists public.estoque_contagens (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  deposito_id bigint not null references public.estoque_depositos(id) on delete cascade,
  origem      text,                                -- 'manual' | 'planilha UpSeller' | 'planilha modelo'
  obs         text,
  itens       jsonb not null default '[]',         -- [{ sku, sistema, real, obs }]
  aplicada_em timestamptz,
  criado_em   timestamptz not null default now()
);

-- envio ao Full: sai do galpão produto a produto (kit aberto nos componentes) e fica "a caminho do Full"
create table if not exists public.estoque_envios_full (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  deposito_id   bigint not null references public.estoque_depositos(id) on delete cascade,   -- de onde sai
  numero        text not null,                     -- nº do envio no Mercado Livre
  titulo        text not null,                     -- "Full 77794050", padrão usado na UpSeller
  ml_user_id    text,
  data_prevista date,
  situacao      text not null default 'preparando' check (situacao in ('preparando', 'saiu', 'recebido', 'cancelado')),
  itens         jsonb not null default '[]',       -- [{ anuncio_sku, codigo_ml, qtd, componentes: [{ sku, qtd }] }]
  saiu_em       timestamptz,
  criado_em     timestamptz not null default now(),
  unique (usuario_id, numero)
);

-- situação do envio de cada venda (para baixar o galpão quando o pedido é ENVIADO, como faz a UpSeller)
alter table public.vendas_ml add column if not exists envio_status text;
alter table public.vendas_ml add column if not exists enviado_em   timestamptz;

do $$
declare t text;
begin
  foreach t in array array['estoque_depositos', 'estoque_mov', 'estoque_contagens', 'estoque_envios_full'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_dono', t);
    execute format('create policy %I on public.%I for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', t || '_dono', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.estoque_saldo to authenticated, service_role;

-- envio ao Full: marca se ocupa o estoque enquanto está em preparação (escolha do usuário ao importar)
alter table public.estoque_envios_full add column if not exists ocupar boolean not null default true;

-- ordens de compra: previsão de chegada preenchida no Caixa 360 (quando o Olist não tem) e ordens criadas aqui (id negativo)
alter table public.olist_ordens add column if not exists data_prevista_local date;
alter table public.olist_ordens add column if not exists origem text not null default 'olist';
drop policy if exists olist_ordens_local on public.olist_ordens;
create policy olist_ordens_local on public.olist_ordens for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant insert, update, delete on public.olist_ordens to authenticated;
