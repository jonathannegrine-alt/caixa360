-- PRODUTO QUE TROCOU DE SKU: liga o SKU antigo ao atual para a Previsão de Full enxergar o histórico inteiro
-- (ex.: a sazonalidade usa as vendas do ano passado, feitas com o SKU antigo). Cadastro na tela da Previsão de Full.
create table if not exists public.sku_trocas (
  usuario_id uuid not null default auth.uid(), sku_antigo text not null, sku_novo text not null, criado_em timestamptz not null default now(),
  primary key (usuario_id, sku_antigo));
alter table public.sku_trocas enable row level security;
drop policy if exists sku_trocas_dono on public.sku_trocas;
create policy sku_trocas_dono on public.sku_trocas for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.sku_trocas to authenticated;
drop trigger if exists demo_so_leitura on public.sku_trocas;
do $$ declare s text; begin
  select n.nspname into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'bloqueia' limit 1;
  if s is not null then
    execute format('create trigger demo_so_leitura before insert or update or delete on public.sku_trocas for each row execute function %I.bloqueia()', s);
  end if;
end $$;

drop function if exists public.full_previsao_base(text, integer);
create function public.full_previsao_base(p_conta text, p_dias integer default 35)
returns table(sku text, titulo text, sem integer[], s30 bigint, d30 integer, ano_base bigint, ano_prox bigint, ano_dias integer)
language sql stable security definer set search_path = public as $$
  with h as (select (now() at time zone 'America/Sao_Paulo')::date hoje, greatest(least(coalesce(p_dias, 35), 120), 7) n),
  v as (select coalesce(t.sku_novo, upper(trim(x.sku))) sku, (x.data_venda at time zone 'America/Sao_Paulo')::date dia, x.qtd, x.titulo
          from vendas_ml x
          cross join h
          left join sku_trocas t on t.usuario_id = x.usuario_id and t.sku_antigo = upper(trim(x.sku))
         where x.usuario_id = auth.uid() and x.ml_user_id = p_conta and x.status = 'paid' and x.logistic_type = 'fulfillment' and coalesce(trim(x.sku), '') <> ''
           and (x.data_venda >= (h.hoje - 43)::timestamp at time zone 'America/Sao_Paulo'
             or (x.data_venda >= (h.hoje - 366)::timestamp at time zone 'America/Sao_Paulo' and x.data_venda < (h.hoje - 364 + h.n)::timestamp at time zone 'America/Sao_Paulo')))
  select v.sku, (array_agg(v.titulo order by v.dia desc))[1],
    array[coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 42 and h.hoje - 36), 0)::integer,
          coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 35 and h.hoje - 29), 0)::integer,
          coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 28 and h.hoje - 22), 0)::integer,
          coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 21 and h.hoje - 15), 0)::integer,
          coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 14 and h.hoje - 8), 0)::integer,
          coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 7 and h.hoje - 1), 0)::integer],
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 30 and h.hoje - 1), 0)::bigint,
    count(distinct v.dia) filter (where v.dia between h.hoje - 30 and h.hoje - 1)::integer,
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 365 and h.hoje - 352), 0)::bigint,
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 365 and h.hoje - 366 + h.n), 0)::bigint,
    max(h.n)
  from v, h group by v.sku;
$$;
revoke all on function public.full_previsao_base(text, integer) from public, anon;
grant execute on function public.full_previsao_base(text, integer) to authenticated;
select count(*) trocas from public.sku_trocas;
