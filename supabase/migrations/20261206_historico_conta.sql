-- HISTÓRICO POR CONTA E REPROCESSAMENTO PAGO
-- Conta nova conectada carrega só os últimos 30 dias (vendas, extrato, fatura, cobranças) e segue dali para frente.
-- Histórico mais antigo é um "reprocessamento": o usuário pede, vê o preço (pela quantidade de pedidos do período,
-- contada no Mercado Livre) e o pedido fica bloqueado até o administrador autorizar. Autorizado, a data inicial da
-- conta recua e as rotinas de sempre (ml-vendas, ml-snapshot, ml-fatura) buscam o período sozinhas.
--   ml_tokens.historico_desde: primeiro dia que as rotinas buscam. Nulo = conta antiga, até 365 dias (como antes).

alter table public.ml_tokens add column if not exists historico_desde date;
-- o padrão só vale para linha nova (as contas que já existem ficam nulas = sem mudança)
alter table public.ml_tokens alter column historico_desde set default (current_date - 30);

-- reconectar uma conta que já tem vendas importadas não encolhe o histórico que ela já tinha
create or replace function public.ml_tokens_historico() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v date;
begin
  select min(d.dia) into v from public.vendas_ml_dias d where d.usuario_id = new.usuario_id and d.ml_user_id = new.ml_user_id and d.completo;
  if v is not null and new.historico_desde is not null and v < new.historico_desde then new.historico_desde := v; end if;
  return new;
end $$;
drop trigger if exists ml_tokens_historico on public.ml_tokens;
create trigger ml_tokens_historico before insert on public.ml_tokens for each row execute function public.ml_tokens_historico();

-- preço (fictício por enquanto): R$ preco_mil a cada 1.000 pedidos, no mínimo R$ minimo
create table if not exists public.reprocesso_cfg (
  id int primary key default 1 check (id = 1), preco_mil numeric not null default 1, minimo numeric not null default 1);
insert into public.reprocesso_cfg (id) values (1) on conflict do nothing;
alter table public.reprocesso_cfg enable row level security;

create or replace function public.reprocesso_valor(p_pedidos int) returns numeric
language sql stable security definer set search_path to 'public' as $$
  select greatest(c.minimo, round(greatest(p_pedidos, 0) / 1000.0 * c.preco_mil, 2)) from public.reprocesso_cfg c where c.id = 1
$$;
grant execute on function public.reprocesso_valor(int) to authenticated, service_role;

create table if not exists public.reprocessos (
  id bigserial primary key, usuario_id uuid not null, ml_user_id text not null,
  desde date not null, ate date not null, pedidos int not null, valor numeric not null,
  situacao text not null default 'pedido' check (situacao in ('pedido', 'autorizado', 'recusado', 'cancelado')),
  criado_em timestamptz not null default now(), decidido_em timestamptz, nota text);
create index if not exists reprocessos_usuario on public.reprocessos (usuario_id, criado_em desc);
alter table public.reprocessos enable row level security;
drop policy if exists reprocessos_ler on public.reprocessos;
create policy reprocessos_ler on public.reprocessos for select to authenticated using (usuario_id = auth.uid());
grant select on public.reprocessos to authenticated;
grant select, insert, update on public.reprocessos to service_role;
grant usage on sequence public.reprocessos_id_seq to service_role;

-- contas do usuário: desde quando há histórico, quantos dias já foram carregados e os pedidos de reprocessamento
create or replace function public.conta_historico()
returns table (ml_user_id text, apelido text, desde date, dias_previstos int, dias_carregados int, pedidos jsonb)
language sql stable security definer set search_path to 'public' as $$
  select t.ml_user_id, t.apelido, coalesce(t.historico_desde, current_date - 365),
    (current_date - coalesce(t.historico_desde, current_date - 365) + 1)::int,
    (select count(*) from public.vendas_ml_dias d where d.usuario_id = t.usuario_id and d.ml_user_id = t.ml_user_id and d.completo
       and d.dia >= coalesce(t.historico_desde, current_date - 365))::int,
    coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'desde', r.desde, 'ate', r.ate, 'pedidos', r.pedidos, 'valor', r.valor, 'situacao', r.situacao,
        'criado_em', r.criado_em, 'nota', r.nota) order by r.criado_em desc)
      from public.reprocessos r where r.usuario_id = t.usuario_id and r.ml_user_id = t.ml_user_id), '[]'::jsonb)
  from public.ml_tokens t where t.usuario_id = auth.uid()
$$;
revoke all on function public.conta_historico() from public, anon;
grant execute on function public.conta_historico() to authenticated;

-- o próprio usuário desiste de um pedido ainda não decidido
create or replace function public.reprocesso_cancelar(p_id bigint) returns void
language sql security definer set search_path to 'public' as $$
  update public.reprocessos set situacao = 'cancelado', decidido_em = now() where id = p_id and usuario_id = auth.uid() and situacao = 'pedido'
$$;
revoke all on function public.reprocesso_cancelar(bigint) from public, anon;
grant execute on function public.reprocesso_cancelar(bigint) to authenticated;

-- ---------- administração ----------
create or replace function public.admin_reprocessos()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  return jsonb_build_object(
    'cfg', (select to_jsonb(c) - 'id' from public.reprocesso_cfg c where c.id = 1),
    'lista', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'email', u.email, 'conta', r.ml_user_id, 'apelido', t.apelido, 'desde', r.desde, 'ate', r.ate,
        'pedidos', r.pedidos, 'valor', r.valor, 'situacao', r.situacao, 'criado_em', r.criado_em, 'decidido_em', r.decidido_em, 'nota', r.nota,
        'historico_desde', coalesce(t.historico_desde, current_date - 365)) order by (r.situacao = 'pedido') desc, r.criado_em desc)
      from public.reprocessos r left join auth.users u on u.id = r.usuario_id
      left join public.ml_tokens t on t.usuario_id = r.usuario_id and t.ml_user_id = r.ml_user_id), '[]'::jsonb));
end $$;
revoke all on function public.admin_reprocessos() from public, anon;
grant execute on function public.admin_reprocessos() to authenticated;

-- autorizar: a conta passa a ter histórico desde o início pedido e as rotinas buscam o período
create or replace function public.admin_reprocesso_decidir(p_id bigint, p_autorizar boolean, p_nota text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare r public.reprocessos;
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  select * into r from public.reprocessos where id = p_id for update;
  if r.id is null or r.situacao <> 'pedido' then raise exception 'Pedido não encontrado ou já decidido.'; end if;
  update public.reprocessos set situacao = case when p_autorizar then 'autorizado' else 'recusado' end, decidido_em = now(), nota = left(p_nota, 300) where id = p_id;
  if p_autorizar then
    update public.ml_tokens set historico_desde = least(historico_desde, r.desde)
     where usuario_id = r.usuario_id and ml_user_id = r.ml_user_id and historico_desde is not null;
  end if;
end $$;
revoke all on function public.admin_reprocesso_decidir(bigint, boolean, text) from public, anon;
grant execute on function public.admin_reprocesso_decidir(bigint, boolean, text) to authenticated;

create or replace function public.admin_reprocesso_cfg(p_preco_mil numeric, p_minimo numeric) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  update public.reprocesso_cfg set preco_mil = greatest(coalesce(p_preco_mil, 0), 0), minimo = greatest(coalesce(p_minimo, 0), 0) where id = 1;
end $$;
revoke all on function public.admin_reprocesso_cfg(numeric, numeric) from public, anon;
grant execute on function public.admin_reprocesso_cfg(numeric, numeric) to authenticated;
