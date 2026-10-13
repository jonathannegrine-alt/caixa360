-- Unidades vendidas por anúncio nos últimos N dias (para ordenar a lista "Por anúncio" da Central de promoções
-- por mais vendidos / menos vendidos). Lê pelo índice (usuario_id, ml_user_id, data_venda).
create or replace function public.vendas_por_anuncio(p_conta text, p_dias integer default 30)
returns table(item_id text, qtd bigint)
language sql stable security definer set search_path = public as $$
  select v.item_id, sum(v.qtd)::bigint
    from vendas_ml v
   where v.usuario_id = auth.uid() and v.ml_user_id = p_conta and v.status = 'paid' and v.item_id is not null
     and v.data_venda >= now() - make_interval(days => greatest(least(coalesce(p_dias, 30), 90), 1))
   group by v.item_id;
$$;
revoke all on function public.vendas_por_anuncio(text, integer) from public, anon;
grant execute on function public.vendas_por_anuncio(text, integer) to authenticated;
select 1 ok;
