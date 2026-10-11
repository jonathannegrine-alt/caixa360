-- Avisos em tempo real (perguntas e mensagens do Mercado Livre) e caixa de sugestões para o administrador.

-- Cada notificação do ML de pergunta/mensagem vira uma linha; a tela consulta de minuto em minuto e mostra o selo.
create table if not exists public.ml_avisos (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  topico text not null,            -- questions | messages
  recurso text,
  em timestamptz not null default now()
);
create index if not exists ml_avisos_usuario on public.ml_avisos (usuario_id, topico, em desc);
alter table public.ml_avisos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ml_avisos' and policyname = 'ml_avisos_dono') then
    create policy ml_avisos_dono on public.ml_avisos for select using (usuario_id = auth.uid());
  end if;
end $$;

-- Sugestões: quem administra o sistema vê as de todos os usuários e marca como lidas.
create table if not exists public.app_admin (email text primary key);
alter table public.app_admin enable row level security;     -- sem política: só as funções abaixo leem
insert into public.app_admin (email) values ('jonathannegrine@gmail.com') on conflict do nothing;
alter table public.feedbacks add column if not exists lido boolean not null default false;

create or replace function public.eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admin a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
grant execute on function public.eh_admin() to authenticated;

create or replace function public.feedbacks_todos()
returns table (id text, email text, mensagem text, pagina text, criado timestamptz, lido boolean)
language sql stable security definer set search_path = public as $$
  select f.id::text, u.email::text, f.mensagem, f.pagina, f.created_at, f.lido
  from feedbacks f left join auth.users u on u.id = f.usuario_id
  where public.eh_admin()
  order by f.created_at desc limit 300
$$;
grant execute on function public.feedbacks_todos() to authenticated;

create or replace function public.feedbacks_lidos() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.eh_admin() then return 0; end if;
  update feedbacks set lido = true where not lido;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.feedbacks_lidos() to authenticated;

-- A conta de demonstração é só de leitura: as tabelas novas com usuario_id recebem a mesma trava.
do $$ declare t text; begin
  for t in select unnest(array['ml_avisos', 'frete_conferidos']) loop
    execute format('drop trigger if exists demo_so_leitura on public.%I', t);
    execute format('create trigger demo_so_leitura before insert or update or delete on public.%I for each row execute function demo.bloqueia()', t);
  end loop;
end $$;
