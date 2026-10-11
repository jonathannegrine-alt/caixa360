-- Venda Flex de loja configurada como "Flex não paga imposto" não é venda "sem imposto cadastrado".
do $$
declare d text;
begin
  d := pg_get_viewdef('public.vendas_ml_calc'::regclass, true);
  if position('c.ip > 0::numeric AS tem_imposto' in d) > 0 then
    d := replace(d, 'c.ip > 0::numeric AS tem_imposto', '(c.ip > 0::numeric OR v.logistic_type = ''self_service''::text AND g.flex_imposto IS FALSE) AS tem_imposto');
    execute 'create or replace view public.vendas_ml_calc with (security_invoker = true) as ' || d;
  end if;
end $$;
grant select on public.vendas_ml_calc to authenticated;

-- Foto de cada produto, tirada do anúncio da venda mais recente daquele SKU (para a folha de contagem).
create or replace function public.sku_fotos(p_skus text[])
returns table(sku text, foto text) language sql stable as $$
  select distinct on (lower(btrim(v.sku))) lower(btrim(v.sku)), v.thumbnail
    from public.vendas_ml v
   where v.usuario_id = auth.uid() and v.thumbnail is not null
     and lower(btrim(v.sku)) = any (select lower(btrim(x)) from unnest(p_skus) x)
   order by lower(btrim(v.sku)), v.data_venda desc;
$$;
revoke all on function public.sku_fotos(text[]) from public, anon;
grant execute on function public.sku_fotos(text[]) to authenticated;

-- versão final: se o produto só é vendido dentro de kit, usa a foto do anúncio de um kit que o contém
create or replace function public.sku_fotos(p_skus text[])
returns table(sku text, foto text) language sql stable as $$
  with alvo as (select distinct lower(btrim(x)) as s from unnest(p_skus) x),
  vendas as (select lower(btrim(v.sku)) as s, v.thumbnail, v.data_venda from public.vendas_ml v
              where v.usuario_id = auth.uid() and v.thumbnail is not null and v.data_venda > now() - interval '180 days'),
  cand as (
    select a.s, v.thumbnail, v.data_venda, 0 as pr from alvo a join vendas v on v.s = a.s
    union all
    select a.s, v.thumbnail, v.data_venda, 1 from alvo a
      join public.sku_composicao c on c.usuario_id = auth.uid() and lower(btrim(c.sku_componente)) = a.s
      join vendas v on v.s = lower(btrim(c.sku_comercial))
  )
  select distinct on (s) s, thumbnail from cand order by s, pr, data_venda desc;
$$;
