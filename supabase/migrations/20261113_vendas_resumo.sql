-- RESUMO PRONTO DAS VENDAS POR DIA
-- Início, DRE e Análise somavam o ano inteiro de vendas (160 mil linhas) a cada abertura: 2,5 a 7 s numa máquina
-- pequena, e foi isso que derrubou o banco em 12/10/2026. Agora os totais ficam prontos por (usuário, conta, dia).
--   vendas_resumo_dia   totais do dia (mesmas contas da view vendas_ml_calc)
--   vendas_resumo_pend  dias que mudaram e precisam ser refeitos (gatilhos em vendas_ml, vendas_cfg e skus)
-- Quem lê (vendas_ml_por_mes / vendas_ml_por_dia): sem pendência no período → lê o resumo; pendência pequena → refaz
-- na hora; pendência grande (reprocessar custo do ano, conta nova importando) → calcula direto das vendas, como antes.
-- O cron 'vendas-resumo' (SQL puro, a cada 2 min) refaz as pendências aos poucos. O resumo nunca mostra número velho.

create table if not exists public.vendas_resumo_dia (
  usuario_id uuid not null, ml_user_id text not null default '', dia date not null,
  bruto_aprov numeric not null default 0, bruto_canc numeric not null default 0,
  imposto numeric not null default 0, frete_vendedor numeric not null default 0, custo numeric not null default 0,
  tarifa numeric not null default 0, vendas bigint not null default 0, un bigint not null default 0,
  frete_comp numeric not null default 0, mc numeric not null default 0,
  flex_repasse numeric not null default 0, flex_custo numeric not null default 0, flex_envios bigint not null default 0,
  feito_em timestamptz not null default now(),
  primary key (usuario_id, ml_user_id, dia));
create table if not exists public.vendas_resumo_pend (
  usuario_id uuid not null, ml_user_id text not null default '', dia date not null,
  primary key (usuario_id, ml_user_id, dia));
alter table public.vendas_resumo_dia enable row level security;
alter table public.vendas_resumo_pend enable row level security;
-- sem políticas: só as funções abaixo (security definer) leem e gravam

-- ── cálculo direto (o que as RPCs faziam antes): serve de reserva e de conferência ─────────────────────────────
create or replace function public.vendas_resumo_calc(p_uid uuid, p_de date, p_ate date, p_conta text default null)
returns table(ml_user_id text, dia date, bruto_aprov numeric, bruto_canc numeric, imposto numeric, frete_vendedor numeric, custo numeric,
  tarifa numeric, vendas bigint, un bigint, frete_comp numeric, mc numeric, flex_repasse numeric, flex_custo numeric, flex_envios bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(c.ml_user_id, ''), c.dia,
    coalesce(sum(c.bruto) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.bruto) filter (where c.situacao = 'cancelada'), 0),
    coalesce(sum(c.imposto) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(coalesce(c.frete_vendedor, 0)) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.custo) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.tarifa) filter (where c.situacao = 'aprovada'), 0),
    count(*) filter (where c.situacao = 'aprovada')::bigint,
    coalesce(sum(c.qtd) filter (where c.situacao = 'aprovada'), 0)::bigint,
    coalesce(sum(c.frete_comprador) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.mc) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.flex_repasse) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.flex_custo) filter (where c.situacao = 'aprovada'), 0),
    count(*) filter (where c.situacao = 'aprovada' and c.logistic_type = 'self_service')::bigint
  from public.vendas_ml_calc c
  where c.usuario_id = p_uid and c.dia between p_de and p_ate and c.situacao in ('aprovada', 'cancelada')
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  group by 1, 2;
$$;

-- ── refaz até p_max dias pendentes de um usuário (os mais recentes primeiro) ───────────────────────────────────
create or replace function public.vendas_resumo_atualizar(p_uid uuid, p_max integer default 60)
returns integer language plpgsql security definer set search_path = public as $$
declare v_c text[]; v_d date[]; v_de date; v_ate date;
begin
  if not exists (select 1 from vendas_resumo_pend where usuario_id = p_uid) then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('vendas_resumo'), hashtext(p_uid::text));
  with alvo as (select ml_user_id, dia from vendas_resumo_pend where usuario_id = p_uid order by dia desc limit greatest(p_max, 1)),
       tirou as (delete from vendas_resumo_pend p using alvo a where p.usuario_id = p_uid and p.ml_user_id = a.ml_user_id and p.dia = a.dia returning p.ml_user_id, p.dia)
  select array_agg(ml_user_id), array_agg(dia), min(dia), max(dia) into v_c, v_d, v_de, v_ate from tirou;
  if v_d is null then return 0; end if;
  delete from vendas_resumo_dia r using unnest(v_c, v_d) as p(c, d)
   where r.usuario_id = p_uid and r.ml_user_id = p.c and r.dia = p.d;
  insert into vendas_resumo_dia (usuario_id, ml_user_id, dia, bruto_aprov, bruto_canc, imposto, frete_vendedor, custo, tarifa, vendas, un, frete_comp, mc, flex_repasse, flex_custo, flex_envios)
  select p_uid, k.* from vendas_resumo_calc(p_uid, v_de, v_ate) k
   where exists (select 1 from unnest(v_c, v_d) as p(c, d) where p.c = k.ml_user_id and p.d = k.dia);
  return array_length(v_d, 1);
end $$;

-- ── cron: todas as pendências, aos poucos ──────────────────────────────────────────────────────────────────────
create or replace function public.vendas_resumo_cron() returns integer
language plpgsql security definer set search_path = public as $$
declare u uuid; n integer := 0;
begin
  for u in select distinct usuario_id from vendas_resumo_pend limit 20 loop
    n := n + vendas_resumo_atualizar(u, 120);
  end loop;
  return n;
end $$;

-- ── gatilhos: marcam o dia que mudou ───────────────────────────────────────────────────────────────────────────
create or replace function public.vendas_resumo_marcar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into vendas_resumo_pend select distinct n.usuario_id, coalesce(n.ml_user_id, ''), (n.data_venda at time zone 'America/Sao_Paulo')::date
      from novas n where n.data_venda is not null on conflict do nothing;
  elsif tg_op = 'DELETE' then
    insert into vendas_resumo_pend select distinct o.usuario_id, coalesce(o.ml_user_id, ''), (o.data_venda at time zone 'America/Sao_Paulo')::date
      from antigas o where o.data_venda is not null on conflict do nothing;
  else
    -- só o que muda algum total; foto, título, rastreio, cidade etc. não mexem no resumo
    insert into vendas_resumo_pend
    select distinct x.u, x.c, x.d from (
      select n.usuario_id u, coalesce(n.ml_user_id, '') c, (n.data_venda at time zone 'America/Sao_Paulo')::date d, o.usuario_id ou, coalesce(o.ml_user_id, '') oc, (o.data_venda at time zone 'America/Sao_Paulo')::date od
        from novas n join antigas o on o.usuario_id = n.usuario_id and o.order_id = n.order_id
       where (n.status, n.qtd, n.preco_unit, n.tarifa, n.frete_vendedor, n.frete_comprador, n.frete_flex, n.custo_unit, n.imposto_pct, n.logistic_type, n.envio_n, n.data_venda, n.ml_user_id, n.sku)
             is distinct from (o.status, o.qtd, o.preco_unit, o.tarifa, o.frete_vendedor, o.frete_comprador, o.frete_flex, o.custo_unit, o.imposto_pct, o.logistic_type, o.envio_n, o.data_venda, o.ml_user_id, o.sku)
    ) m cross join lateral (values (m.u, m.c, m.d), (m.ou, m.oc, m.od)) as x(u, c, d)
    where x.d is not null on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists vendas_resumo_ins on public.vendas_ml;
drop trigger if exists vendas_resumo_upd on public.vendas_ml;
drop trigger if exists vendas_resumo_del on public.vendas_ml;
create trigger vendas_resumo_ins after insert on public.vendas_ml referencing new table as novas for each statement execute function public.vendas_resumo_marcar();
create trigger vendas_resumo_upd after update on public.vendas_ml referencing old table as antigas new table as novas for each statement execute function public.vendas_resumo_marcar();
create trigger vendas_resumo_del after delete on public.vendas_ml referencing old table as antigas for each statement execute function public.vendas_resumo_marcar();

-- configuração da conta (imposto no Flex, frete na base do imposto, custo do Flex) muda a conta de todos os dias dela
create or replace function public.vendas_resumo_marcar_cfg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_u uuid; v_c text;
begin
  if tg_op = 'DELETE' then v_u := old.usuario_id; v_c := coalesce(old.ml_user_id, ''); else v_u := new.usuario_id; v_c := coalesce(new.ml_user_id, ''); end if;
  insert into vendas_resumo_pend select d.usuario_id, d.ml_user_id, d.dia from vendas_resumo_dia d
   where d.usuario_id = v_u and d.ml_user_id = v_c on conflict do nothing;
  return null;
end $$;
drop trigger if exists vendas_resumo_cfg on public.vendas_cfg;
create trigger vendas_resumo_cfg after insert or update or delete on public.vendas_cfg for each row execute function public.vendas_resumo_marcar_cfg();

-- cadastro do produto: só afeta vendas ainda sem custo/imposto gravado (as carimbadas não mudam)
create or replace function public.vendas_resumo_marcar_sku() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- por comando (não por linha): salvar 400 produtos de uma vez faz uma única busca
  insert into vendas_resumo_pend
  select distinct v.usuario_id, coalesce(v.ml_user_id, ''), (v.data_venda at time zone 'America/Sao_Paulo')::date
    from (select distinct usuario_id, upper(trim(sku)) s from mudou) m
    join vendas_ml v on v.usuario_id = m.usuario_id and upper(trim(v.sku)) = m.s
   where (v.custo_unit is null or v.imposto_pct is null) and v.data_venda is not null
  on conflict do nothing;
  return null;
end $$;
create index if not exists vendas_ml_sem_carimbo on public.vendas_ml (usuario_id, upper(trim(sku))) where custo_unit is null or imposto_pct is null;
drop trigger if exists vendas_resumo_sku on public.skus;
drop trigger if exists vendas_resumo_sku_i on public.skus;
drop trigger if exists vendas_resumo_sku_u on public.skus;
drop trigger if exists vendas_resumo_sku_d on public.skus;
create trigger vendas_resumo_sku_i after insert on public.skus referencing new table as mudou for each statement execute function public.vendas_resumo_marcar_sku();
create trigger vendas_resumo_sku_u after update on public.skus referencing new table as mudou for each statement execute function public.vendas_resumo_marcar_sku();
create trigger vendas_resumo_sku_d after delete on public.skus referencing old table as mudou for each statement execute function public.vendas_resumo_marcar_sku();

-- ── RPCs da tela: mesma assinatura e mesmo resultado de antes ──────────────────────────────────────────────────
create or replace function public.vendas_resumo_ler(p_de date, p_ate date, p_conta text default null)
returns table(ml_user_id text, dia date, bruto_aprov numeric, bruto_canc numeric, imposto numeric, frete_vendedor numeric, custo numeric,
  tarifa numeric, vendas bigint, un bigint, frete_comp numeric, mc numeric, flex_repasse numeric, flex_custo numeric, flex_envios bigint)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_pend integer;
begin
  if v_uid is null then return; end if;
  select count(*) into v_pend from vendas_resumo_pend p where p.usuario_id = v_uid and p.dia between p_de and p_ate;
  if v_pend > 0 and v_pend <= 45 then
    perform vendas_resumo_atualizar(v_uid, 60);
    select count(*) into v_pend from vendas_resumo_pend p where p.usuario_id = v_uid and p.dia between p_de and p_ate;
  end if;
  if v_pend > 0 then
    return query select * from vendas_resumo_calc(v_uid, p_de, p_ate, p_conta);
  else
    return query select r.ml_user_id, r.dia, r.bruto_aprov, r.bruto_canc, r.imposto, r.frete_vendedor, r.custo, r.tarifa, r.vendas, r.un, r.frete_comp, r.mc, r.flex_repasse, r.flex_custo, r.flex_envios
      from vendas_resumo_dia r where r.usuario_id = v_uid and r.dia between p_de and p_ate and (coalesce(p_conta, '') = '' or r.ml_user_id = p_conta);
  end if;
end $$;

drop function if exists public.vendas_ml_por_dia(date, date, text);
create function public.vendas_ml_por_dia(p_de date, p_ate date, p_conta text default null)
returns table(dia date, vendas bigint, un bigint, bruto numeric, frete_comp numeric, mc numeric)
language sql security definer set search_path = public as $$
  select r.dia, sum(r.vendas)::bigint, sum(r.un)::bigint, sum(r.bruto_aprov), sum(r.frete_comp), sum(r.mc)
  from public.vendas_resumo_ler(p_de, p_ate, p_conta) r group by r.dia having sum(r.vendas) > 0 order by r.dia;
$$;

drop function if exists public.vendas_ml_por_mes(integer, text);
create function public.vendas_ml_por_mes(p_ano integer, p_conta text default null)
returns table(mes integer, faturamento numeric, canceladas numeric, imposto numeric, frete_vendedor numeric, custo numeric, tarifa numeric, vendas bigint, flex_repasse numeric, flex_custo numeric, flex_envios bigint)
language sql security definer set search_path = public as $$
  select extract(month from r.dia)::integer, sum(r.bruto_aprov + r.bruto_canc), sum(r.bruto_canc), sum(r.imposto), sum(r.frete_vendedor), sum(r.custo), sum(r.tarifa),
         sum(r.vendas)::bigint, sum(r.flex_repasse), sum(r.flex_custo), sum(r.flex_envios)::bigint
  from public.vendas_resumo_ler(make_date(p_ano, 1, 1), make_date(p_ano, 12, 31), p_conta) r group by 1 order by 1;
$$;

revoke all on function public.vendas_resumo_calc(uuid, date, date, text) from public, anon, authenticated;
revoke all on function public.vendas_resumo_atualizar(uuid, integer) from public, anon, authenticated;
revoke all on function public.vendas_resumo_cron() from public, anon, authenticated;
grant execute on function public.vendas_resumo_ler(date, date, text) to authenticated;
grant execute on function public.vendas_ml_por_dia(date, date, text) to authenticated;
grant execute on function public.vendas_ml_por_mes(integer, text) to authenticated;

-- carga inicial: tudo pendente; o cron refaz aos poucos e, até lá, as RPCs calculam direto
insert into public.vendas_resumo_pend
select distinct v.usuario_id, coalesce(v.ml_user_id, ''), (v.data_venda at time zone 'America/Sao_Paulo')::date from public.vendas_ml v where v.data_venda is not null
on conflict do nothing;
select (select count(*) from public.vendas_resumo_pend) pendentes;
drop trigger if exists vendas_resumo_sku_u2 on public.skus;
create trigger vendas_resumo_sku_u2 after update on public.skus referencing old table as mudou for each statement execute function public.vendas_resumo_marcar_sku();

-- cron (SQL puro, sem função de borda): select cron.schedule('vendas-resumo', '*/2 * * * *', 'select public.vendas_resumo_cron()');
