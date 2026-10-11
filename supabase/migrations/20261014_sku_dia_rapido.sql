-- Sugestão de compras: mesma consulta, lendo direto a tabela de vendas (não precisa de custo nem de margem),
-- para não estourar o tempo com 120 dias de vendas.
create or replace function public.vendas_ml_sku_dia(p_de date, p_ate date, p_conta text default null)
returns jsonb language sql stable security invoker as $$
  with base as (
    select coalesce(nullif(trim(v.sku), ''), '(sem SKU)') as sku, (v.data_venda at time zone 'America/Sao_Paulo')::date as dia, v.ml_user_id, v.qtd, v.titulo
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate and v.status = 'paid'
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
  ),
  dias as (select sku, jsonb_object_agg(dia::text, un) as d from (select sku, dia, sum(qtd) as un from base group by sku, dia) x group by sku),
  contas as (select sku, jsonb_object_agg(ml_user_id, un) as c from (select sku, ml_user_id, sum(qtd) as un from base group by sku, ml_user_id) x group by sku),
  tit as (select sku, max(titulo) as titulo from base group by sku)
  select coalesce(jsonb_object_agg(t.sku, jsonb_build_object('t', t.titulo, 'd', d.d, 'c', c.c)), '{}'::jsonb)
  from tit t left join dias d using (sku) left join contas c using (sku);
$$;
grant execute on function public.vendas_ml_sku_dia(date, date, text) to authenticated;
