-- Estoque → aba do Full: venda do Full por conta e SKU do anúncio (unidades no período), para a venda média e a
-- cobertura em dias. Só vendas pagas que saíram pelo Full (logistic_type = 'fulfillment'); kit não é aberto, porque
-- o estoque do Full também é por anúncio.
create or replace function public.vendas_full_sku(p_de date, p_ate date)
returns table (ml_user_id text, sku text, un numeric) language sql stable security invoker as $$
  select v.ml_user_id::text, coalesce(nullif(trim(v.sku), ''), '(sem SKU)'), sum(v.qtd)::numeric
  from public.vendas_ml v
  where v.usuario_id = auth.uid() and v.status = 'paid' and v.logistic_type = 'fulfillment'
    and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  group by 1, 2;
$$;
grant execute on function public.vendas_full_sku(date, date) to authenticated;
