-- Sugestao de compras: unidades vendidas (vendas aprovadas) por SKU e por dia, num unico JSON
-- { "SKU": { "t": titulo, "d": { "2026-10-01": 12, ... }, "c": { "ml_user_id": unidades } } }
create or replace function public.vendas_ml_sku_dia(p_de date, p_ate date, p_conta text default null)
returns jsonb language sql stable security invoker as $$
  with base as (
    select coalesce(nullif(trim(c.sku), ''), '(sem SKU)') as sku, c.dia, c.ml_user_id, c.qtd, c.titulo
    from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao = 'aprovada'
      and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  ),
  dias as (select sku, dia, sum(qtd) as un from base group by sku, dia),
  contas as (select sku, ml_user_id, sum(qtd) as un from base group by sku, ml_user_id),
  tit as (select sku, max(titulo) as titulo from base group by sku)
  select coalesce(jsonb_object_agg(t.sku, jsonb_build_object(
    't', t.titulo,
    'd', (select jsonb_object_agg(d.dia::text, d.un) from dias d where d.sku = t.sku),
    'c', (select jsonb_object_agg(x.ml_user_id, x.un) from contas x where x.sku = t.sku)
  )), '{}'::jsonb)
  from tit t;
$$;
grant execute on function public.vendas_ml_sku_dia(date, date, text) to authenticated;
