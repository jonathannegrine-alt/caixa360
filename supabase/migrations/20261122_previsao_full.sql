-- PREVISÃO DE ENVIOS AO FULL
-- full_sugestoes: o que o Mercado Livre sugeriu em cada semana (importado do "Relatório de Planejamento de envios" ou do
--                 "Relatório geral de estoque", aba Resumo). Uma linha por conta, data do relatório e SKU. Fica guardado
--                 para comparar com a previsão do sistema e afinar a regra com o tempo.
-- full_previsao_base(conta, dias): por SKU, as vendas pelo Full que alimentam a previsão (ritmo recente, aceleração,
--                 dias com venda e o mesmo período do ano passado). A conta final é feita na tela (src/previsao-full.js).
create table if not exists public.full_sugestoes (
  usuario_id uuid not null default auth.uid(), ml_user_id text not null, referencia date not null, sku text not null,
  inventory_id text, produto text, v30 integer, aptas integer, caminho integer, minimo integer, sugestao integer,
  urgencia text, prazo text, estrela boolean, origem text, importado_em timestamptz not null default now(),
  primary key (usuario_id, ml_user_id, referencia, sku));
alter table public.full_sugestoes enable row level security;
drop policy if exists full_sugestoes_dono on public.full_sugestoes;
create policy full_sugestoes_dono on public.full_sugestoes for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.full_sugestoes to authenticated;
drop trigger if exists demo_so_leitura on public.full_sugestoes;
do $$ declare s text; begin
  select n.nspname into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'bloqueia' limit 1;
  if s is not null then
    execute format('create trigger demo_so_leitura before insert or update or delete on public.full_sugestoes for each row execute function %I.bloqueia()', s);
  end if;
end $$;
create or replace function public.full_previsao_base(p_conta text, p_dias integer default 45)
returns table(sku text, titulo text, s7 bigint, s7ant bigint, s30 bigint, d30 integer, ano_base bigint, ano_prox bigint, ano_dias integer)
language sql stable security definer set search_path = public as $$
  with h as (select (now() at time zone 'America/Sao_Paulo')::date hoje, greatest(least(coalesce(p_dias, 45), 120), 7) n),
  v as (select upper(trim(x.sku)) sku, (x.data_venda at time zone 'America/Sao_Paulo')::date dia, x.qtd, x.titulo
          from vendas_ml x, h
         where x.usuario_id = auth.uid() and x.ml_user_id = p_conta and x.status = 'paid' and x.logistic_type = 'fulfillment' and coalesce(trim(x.sku), '') <> ''
           and (x.data_venda >= (h.hoje - 31)::timestamp at time zone 'America/Sao_Paulo'
             or (x.data_venda >= (h.hoje - 366)::timestamp at time zone 'America/Sao_Paulo' and x.data_venda < (h.hoje - 364 + h.n)::timestamp at time zone 'America/Sao_Paulo')))
  select v.sku, max(v.titulo),
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 7 and h.hoje - 1), 0)::bigint,
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 14 and h.hoje - 8), 0)::bigint,
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 30 and h.hoje - 1), 0)::bigint,
    count(distinct v.dia) filter (where v.dia between h.hoje - 30 and h.hoje - 1)::integer,
    -- mesmo ponto do calendário no ano passado: as duas primeiras semanas servem de base, os dias seguintes de "o que veio depois"
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 365 and h.hoje - 352), 0)::bigint,
    coalesce(sum(v.qtd) filter (where v.dia between h.hoje - 365 and h.hoje - 366 + h.n), 0)::bigint,
    max(h.n)
  from v, h group by v.sku;
$$;
revoke all on function public.full_previsao_base(text, integer) from public, anon;
grant execute on function public.full_previsao_base(text, integer) to authenticated;
select 1 ok;
