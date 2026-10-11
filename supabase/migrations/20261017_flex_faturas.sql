-- Conferência das faturas do transportador do Flex: cada fatura enviada fica guardada com as linhas e o resultado.
create table if not exists public.flex_faturas (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  numero text,
  transportador text,
  emitida date,
  de date,
  ate date,
  total numeric,
  arquivo text,
  linhas jsonb not null default '[]'::jsonb,      -- [{ envio, coleta, codigo, frete, cat, ... }]
  resumo jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists flex_faturas_usuario on public.flex_faturas (usuario_id, criado_em desc);
alter table public.flex_faturas enable row level security;
drop policy if exists flex_faturas_dono on public.flex_faturas;
create policy flex_faturas_dono on public.flex_faturas for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.flex_faturas to authenticated;
grant all on public.flex_faturas to service_role;
