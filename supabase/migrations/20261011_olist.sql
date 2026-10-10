-- Ligação com o Olist (Tiny): contas a pagar pela API v2 (token fixo da empresa).
--  olist_config : token do usuário. O navegador grava, mas NÃO consegue ler o token de volta (só a data).
--  olist_contas : detalhes de cada conta (categoria, competência...) buscados uma vez, para não repetir chamadas.
--  pagamentos.competencia : mês a que a despesa pertence (AAAA-MM), que pode ser diferente do vencimento.

create table if not exists public.olist_config (
  usuario_id    uuid primary key references auth.users(id) on delete cascade,
  token         text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.olist_config enable row level security;
drop policy if exists olist_config_dono on public.olist_config;
create policy olist_config_dono on public.olist_config for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
revoke all on public.olist_config from anon, authenticated;
grant select (usuario_id, atualizado_em) on public.olist_config to authenticated;
grant insert, delete on public.olist_config to authenticated;
grant update (token, atualizado_em) on public.olist_config to authenticated;

create table if not exists public.olist_contas (
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  id            bigint not null,
  categoria     text,
  competencia   text,          -- AAAA-MM
  ocorrencia    text,
  nro_documento text,
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, id)
);
alter table public.olist_contas enable row level security;
drop policy if exists olist_contas_dono on public.olist_contas;
create policy olist_contas_dono on public.olist_contas for select to authenticated using (usuario_id = auth.uid());

alter table public.pagamentos add column if not exists competencia text;
