-- Lucro real por anúncio: margem das vendas aprovadas e o peso dos cancelamentos, por MLB.
-- O gasto com publicidade vem da Edge Function ml-ads e é abatido no navegador (src/analise.js, aba "Lucro real").
create or replace function public.vendas_ml_lucro_mlb(p_de date, p_ate date, p_conta text default null)
returns table (item_id text, ml_user_id text, titulo text, sku text, un bigint, vendas bigint, bruto numeric, mc numeric, sem_custo bigint, canceladas bigint, canc_bruto numeric)
language sql stable security invoker as $$
  select coalesce(c.item_id, '(sem MLB)'), max(c.ml_user_id), max(c.titulo), max(c.sku),
    coalesce(sum(c.qtd) filter (where c.situacao = 'aprovada'), 0)::bigint,
    count(*) filter (where c.situacao = 'aprovada')::bigint,
    coalesce(sum(c.bruto) filter (where c.situacao = 'aprovada'), 0),
    coalesce(sum(c.mc) filter (where c.situacao = 'aprovada'), 0),
    count(*) filter (where c.situacao = 'aprovada' and coalesce(c.custo, 0) = 0)::bigint,
    count(*) filter (where c.situacao = 'cancelada')::bigint,
    coalesce(sum(c.bruto) filter (where c.situacao = 'cancelada'), 0)
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao in ('aprovada', 'cancelada')
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  group by 1
$$;
grant execute on function public.vendas_ml_lucro_mlb(date, date, text) to authenticated;
