-- Vendas marcadas para conferir na fatura (quadradinho na página Vendas): ex.: comprador diz que não recebeu um Flex.
-- A conferência da fatura do Flex destaca o envio marcado mesmo quando o Mercado Livre diz que foi entregue.
create table if not exists public.vendas_conferir (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint not null,
  ml_user_id text,
  shipping_id bigint,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, order_id)
);
create index if not exists vendas_conferir_envio on public.vendas_conferir (usuario_id, shipping_id);
alter table public.vendas_conferir enable row level security;
drop policy if exists vendas_conferir_dono on public.vendas_conferir;
create policy vendas_conferir_dono on public.vendas_conferir for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.vendas_conferir to authenticated;
grant all on public.vendas_conferir to service_role;
