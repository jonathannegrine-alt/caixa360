-- Vendas do Mercado Livre (1 linha por venda/pedido). Alimentada pela Edge Function ml-vendas.
create table if not exists public.vendas_ml (
  usuario_id        uuid        not null references auth.users(id) on delete cascade,
  order_id          bigint      not null,
  pack_id           bigint,
  data_venda        timestamptz not null,
  status            text,
  comprador_id      bigint,
  comprador_apelido text,
  comprador_nome    text,
  item_id           text,
  titulo            text,
  sku               text,
  variacao          text,
  qtd               integer     not null default 1,
  preco_unit        numeric     not null default 0,
  tarifa            numeric     not null default 0,
  listing_type      text,
  shipping_id       bigint,
  logistic_type     text,
  frete_vendedor    numeric,
  frete_comprador   numeric,
  total_pago        numeric,
  thumbnail         text,
  atualizado_em     timestamptz not null default now(),
  primary key (usuario_id, order_id)
);
create index if not exists vendas_ml_usuario_data on public.vendas_ml (usuario_id, data_venda desc);
alter table public.vendas_ml enable row level security;
drop policy if exists vendas_ml_select_proprio on public.vendas_ml;
create policy vendas_ml_select_proprio on public.vendas_ml for select using (auth.uid() = usuario_id);
grant select on public.vendas_ml to authenticated;
grant all on public.vendas_ml to service_role;
