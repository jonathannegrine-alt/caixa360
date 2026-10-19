-- full_conta_skus(skus): em quais lojas do usuário cada SKU do relatório aparece (anúncio em ml_itens_base ou venda pelo
--                 Full nos últimos 120 dias). A tela usa para avisar quando o relatório importado parece ser de outra loja.
-- full_relatorios(conta): relatórios do Mercado Livre já importados na loja, um por data, com os totais.
create or replace function public.full_conta_skus(p_skus text[])
returns table(ml_user_id text, achados integer)
language sql stable security definer set search_path = public as $$
  with s as (select distinct upper(trim(x)) sku from unnest(p_skus) x where coalesce(trim(x), '') <> ''),
  a as (select i.ml_user_id, upper(trim(i.sku)) sku from ml_itens_base i where i.usuario_id = auth.uid() and coalesce(trim(i.sku), '') <> ''
        union
        select v.ml_user_id, upper(trim(v.sku)) from vendas_ml v
         where v.usuario_id = auth.uid() and v.logistic_type = 'fulfillment' and v.data_venda >= now() - interval '120 days' and coalesce(trim(v.sku), '') <> '')
  select a.ml_user_id, count(distinct a.sku)::integer from a join s on s.sku = a.sku group by a.ml_user_id;
$$;
revoke all on function public.full_conta_skus(text[]) from public, anon;
grant execute on function public.full_conta_skus(text[]) to authenticated;

create or replace function public.full_relatorios(p_conta text)
returns table(referencia date, origem text, produtos integer, com_sugestao integer, unidades bigint, importado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select s.referencia, max(s.origem), count(*)::integer, count(*) filter (where s.sugestao > 0)::integer,
         coalesce(sum(s.sugestao), 0)::bigint, max(s.importado_em)
    from full_sugestoes s where s.usuario_id = auth.uid() and s.ml_user_id = p_conta
   group by s.referencia order by s.referencia desc limit 60;
$$;
revoke all on function public.full_relatorios(text) from public, anon;
grant execute on function public.full_relatorios(text) to authenticated;
select 1 ok;
