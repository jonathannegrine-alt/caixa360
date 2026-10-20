-- LISTAS DE COMPRA SALVAS (Sugestão de compras → Lista de compras): nome, os itens [{ sku, nome, forn, qtd, preco, origem }]
-- e os campos do PDF (título, para, observação). Uma linha por lista, por usuário.
create table if not exists public.listas_compra (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  nome          text not null,
  itens         jsonb not null default '[]'::jsonb,
  titulo        text,
  para          text,
  obs           text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists listas_compra_usuario on public.listas_compra (usuario_id, atualizado_em desc);
alter table public.listas_compra enable row level security;
drop policy if exists listas_compra_dono on public.listas_compra;
create policy listas_compra_dono on public.listas_compra for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.listas_compra to authenticated, service_role;

select 1 ok;
