-- SIMULAÇÕES SALVAS do Simulador de compras (bloco "Várias compras juntas"): nome e a lista de compras
-- [{ desc, valor, data, prazos }]. Uma linha por simulação, por usuário.
create table if not exists public.simulacoes (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  nome          text not null,
  compras       jsonb not null default '[]'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists simulacoes_usuario on public.simulacoes (usuario_id, atualizado_em desc);
alter table public.simulacoes enable row level security;
drop policy if exists simulacoes_dono on public.simulacoes;
create policy simulacoes_dono on public.simulacoes for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.simulacoes to authenticated, service_role;

select 1 ok;
