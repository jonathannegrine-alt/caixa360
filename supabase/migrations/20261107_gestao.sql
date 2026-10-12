-- Ferramentas de gestão (src/gestao.js): degrau do frete e venda perdida por falta de estoque.

-- Degrau do frete: para cada anúncio, o preço e o frete que mais se repetiram nas vendas de 1 unidade dos últimos
-- 14 dias (o que o Mercado Livre realmente cobrou), mais o volume de 30 dias. A sugestão é calculada no navegador
-- com a tabela oficial de frete.
create or replace function public.vendas_ml_degrau(p_conta text default null)
returns table (item_id text, ml_user_id text, titulo text, sku text, thumbnail text, preco numeric, frete numeric, n bigint, tarifa_pct numeric, imposto_pct numeric, un30 bigint, logistica text)
language sql stable security invoker as $$
  with b as (
    select c.item_id, c.ml_user_id, c.preco_unit preco, c.frete_vendedor frete, count(*) n, max(c.titulo) titulo, max(c.sku) sku, max(c.thumbnail) thumbnail,
           avg(c.tarifa / nullif(c.preco_unit, 0)) * 100 tarifa_pct, avg(coalesce(c.imposto_pct, 0)) imposto_pct, max(c.logistic_type) logistica
    from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.situacao = 'aprovada' and c.qtd = 1 and c.dia >= current_date - 14
      and coalesce(c.logistic_type, '') <> 'self_service' and coalesce(c.frete_vendedor, 0) > 0 and c.item_id is not null
      and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
    group by 1, 2, 3, 4
  ), top as (select distinct on (item_id, ml_user_id) * from b order by item_id, ml_user_id, n desc, preco),
  v as (
    select c.item_id, c.ml_user_id, sum(c.qtd) un30 from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.situacao = 'aprovada' and c.dia >= current_date - 30 and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
    group by 1, 2
  )
  select top.item_id, top.ml_user_id, top.titulo, top.sku, top.thumbnail, top.preco, top.frete, top.n, round(top.tarifa_pct, 2), round(top.imposto_pct, 2), coalesce(v.un30, 0)::bigint, top.logistica
  from top left join v on v.item_id = top.item_id and v.ml_user_id = top.ml_user_id
$$;
grant execute on function public.vendas_ml_degrau(text) to authenticated;

-- Vendas por dia de cada anúncio (para achar os dias sem venda de quem vende todo dia). est = menor estoque do
-- anúncio registrado logo depois de uma venda naquele dia (vendas_ml.est_anuncio_apos; só existe em vendas novas).
create or replace function public.vendas_ml_dias_item(p_dias integer default 90, p_conta text default null) returns jsonb
language sql stable security invoker as $$
  with d as (
    select c.item_id, c.ml_user_id, c.dia, sum(c.qtd) un, sum(c.bruto) bruto, sum(c.mc) mc
    from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.situacao = 'aprovada' and c.dia >= current_date - p_dias and c.item_id is not null
      and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
    group by 1, 2, 3
  ), e as (
    select v.item_id, v.ml_user_id, (v.data_venda at time zone 'America/Sao_Paulo')::date dia, min(v.est_anuncio_apos) est
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and v.est_anuncio_apos is not null and v.data_venda >= now() - make_interval(days => p_dias)
    group by 1, 2, 3
  ), i as (
    select d.item_id, d.ml_user_id, sum(d.un) un, jsonb_object_agg(d.dia, jsonb_build_array(d.un, round(d.bruto, 2), round(d.mc, 2), e.est)) dias
    from d left join e on e.item_id = d.item_id and e.ml_user_id = d.ml_user_id and e.dia = d.dia
    group by 1, 2 having sum(d.un) >= p_dias
  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'conta', i.ml_user_id, 'un', i.un, 'dias', i.dias,
      'titulo', b.titulo, 'sku', b.sku, 'thumbnail', b.thumbnail, 'logistica', b.logistica)), '[]'::jsonb)
  from i left join public.ml_itens_base b on b.usuario_id = auth.uid() and b.ml_user_id = i.ml_user_id and b.item_id = i.item_id
$$;
grant execute on function public.vendas_ml_dias_item(integer, text) to authenticated;
