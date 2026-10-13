-- PÁGINA "ESTAMOS ATUALIZANDO" e aviso de conta ainda carregando o histórico
-- sistema_status: uma linha só. manutencao = true → o site mostra a página de atualização para todo mundo
-- (src/sistema.js confere ao abrir e a cada minuto). Ligar/desligar:
--   update public.sistema_status set manutencao = true, mensagem = '...', atualizado_em = now() where id = 1;
create table if not exists public.sistema_status (
  id integer primary key default 1 check (id = 1),
  manutencao boolean not null default false,
  mensagem text,
  atualizado_em timestamptz not null default now());
insert into public.sistema_status (id) values (1) on conflict do nothing;
alter table public.sistema_status enable row level security;
drop policy if exists sistema_status_ler on public.sistema_status;
create policy sistema_status_ler on public.sistema_status for select to anon, authenticated using (true);
grant select on public.sistema_status to anon, authenticated;

-- quantos dias do histórico (últimos 365) cada conta do usuário já importou
create or replace function public.ml_importacao_situacao()
returns table(ml_user_id text, dias integer, total integer)
language sql stable security definer set search_path = public as $$
  select t.ml_user_id::text,
         (select count(*)::integer from vendas_ml_dias d where d.usuario_id = t.usuario_id and d.ml_user_id::text = t.ml_user_id::text and d.completo
            and d.dia >= (now() at time zone 'America/Sao_Paulo')::date - 365),
         365
  from ml_tokens t where t.usuario_id = auth.uid();
$$;
revoke all on function public.ml_importacao_situacao() from public, anon;
grant execute on function public.ml_importacao_situacao() to authenticated;
select (select count(*) from public.sistema_status) linhas;
