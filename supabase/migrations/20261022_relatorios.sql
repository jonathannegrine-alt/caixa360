-- Relatórios da Análise de vendas: cidades de um estado e anúncios que geram recompra.

create or replace function public.vendas_ml_cidades(p_de date, p_ate date, p_uf text, p_conta text default null)
returns table (cidade text, vendas bigint, bruto numeric)
language sql stable as $$
  select coalesce(nullif(v.cidade, '--'), '(cidade ainda não buscada)') as cidade, count(*) as vendas, sum(round(v.preco_unit * v.qtd, 2)) as bruto
  from public.vendas_ml v
  where v.usuario_id = auth.uid() and v.status = 'paid' and v.uf = p_uf
    and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
  group by 1 order by 3 desc
$$;
grant execute on function public.vendas_ml_cidades(date, date, text, text) to authenticated;

-- Anúncios comprados por quem fez mais de um pedido no período.
create or replace function public.vendas_ml_recompra(p_de date, p_ate date, p_conta text default null)
returns table (item_id text, titulo text, thumbnail text, compradores bigint, pedidos bigint, bruto numeric)
language sql stable as $$
  with ap as (
    select v.comprador_id, v.item_id, v.titulo, v.thumbnail, coalesce(v.pack_id, v.order_id) as pedido, round(v.preco_unit * v.qtd, 2) as bruto
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and v.status = 'paid' and v.comprador_id is not null
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
  ),
  rec as (select comprador_id from ap group by 1 having count(distinct pedido) > 1)
  select a.item_id, max(a.titulo), max(a.thumbnail), count(distinct a.comprador_id), count(distinct a.pedido), sum(a.bruto)
  from ap a join rec r using (comprador_id)
  where a.item_id is not null
  group by a.item_id order by 5 desc, 6 desc limit 30
$$;
grant execute on function public.vendas_ml_recompra(date, date, text) to authenticated;
