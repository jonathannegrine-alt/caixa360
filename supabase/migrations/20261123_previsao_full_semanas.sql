-- PREVISÃO DE FULL, regra 2: o Mercado Livre trabalha com 6 semanas de venda e um percentual de tendência
-- (visto na tela "Planejamento de envios", no gráfico "Histórico de vendas semanais"). A função passa a devolver
-- as 6 semanas (blocos de 7 dias terminando ontem; sem[1] = a mais antiga, sem[6] = a mais recente).
drop function if exists public.full_previsao_base(text, integer);
create function public.full_previsao_base(p_conta text, p_dias integer default 35)
returns table(sku text, titulo text, sem integer[], s30 bigint, d30 integer, ano_base bigint, ano_prox bigint, ano_dias integer)
language sql stable security definer set search_path = public as $$
  with h as (select (now() at time zone 'America/Sao_Paulo')::date hoje, greatest(least(coalesce(p_dias, 35), 120), 7) n),
  v as (select upper(trim(x.sku)) sku, (x.data_venda at time zone 'America/Sao_Paulo')::date dia, x.qtd, x.titulo
          from vendas_ml x, h
         where x.usuario_id = auth.uid() and x.ml_user_id = p_conta and x.status = 'paid' and x.logistic_type = 'fulfillment' and coalesce(trim(x.sku), '') <> ''
           and (x.data_venda >= (h.hoje - 43)::timestamp at time zone 'America/Sao_Paulo'
             or (x.data_venda >= (h.hoje - 366)::timestamp at time zone 'America/Sao_Paulo' and x.data_venda < (h.hoje - 364 + h.n)::timestamp at time zone 'America/Sao_Paulo')))
  select v.sku, max(v.titulo),
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
select 1 ok;
