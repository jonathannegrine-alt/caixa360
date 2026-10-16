-- Ranking de produtos: respeita os mesmos filtros do Resumo Financeiro (pedido, título, SKU, modalidade, envio, custo).
-- Os parâmetros novos têm padrão nulo: a chamada antiga (p_de, p_ate, p_grupo, p_conta) continua funcionando.
drop function if exists public.vendas_ml_ranking(date, date, text, text);
create or replace function public.vendas_ml_ranking(p_de date, p_ate date, p_grupo text default 'sku', p_conta text default null,
  p_pedido text default null, p_titulo text default null, p_sku text default null, p_modalidade text default null,
  p_envio text default null, p_custo text default null)
returns table (chave text, titulo text, un bigint, vendas bigint, bruto numeric, custo numeric, mc numeric, mc_pct numeric)
language sql stable as $$
  select
    case when p_grupo = 'mlb' then coalesce(c.item_id, '(sem MLB)') else coalesce(nullif(c.sku, ''), '(sem SKU)') end as chave,
    max(c.titulo) as titulo, sum(c.qtd)::bigint as un, count(*)::bigint as vendas,
    sum(c.bruto) as bruto, sum(c.custo) as custo, sum(c.mc) as mc,
    case when sum(c.bruto) > 0 then round(sum(c.mc) / sum(c.bruto) * 100, 2) else 0 end as mc_pct
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao = 'aprovada'
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
    and (coalesce(p_pedido, '') = '' or c.order_txt like '%' || p_pedido || '%' or c.pack_txt like '%' || p_pedido || '%')
    and (coalesce(p_titulo, '') = '' or c.titulo ilike '%' || p_titulo || '%' or c.item_id ilike '%' || p_titulo || '%')
    and (coalesce(p_sku, '') = '' or c.sku ilike '%' || p_sku || '%')
    and (coalesce(p_modalidade, '') = '' or c.modalidade = p_modalidade)
    and (coalesce(p_envio, '') = '' or c.envio = any(string_to_array(p_envio, ',')))
    and (coalesce(p_custo, '') = ''
         or (p_custo = 'sem-custo'   and not c.tem_custo)
         or (p_custo = 'sem-imposto' and not c.tem_imposto)
         or (p_custo = 'sem-um'      and (not c.tem_custo or not c.tem_imposto))
         or (p_custo = 'sem-ambos'   and not c.tem_custo and not c.tem_imposto))
  group by 1
  order by sum(c.bruto) desc
  limit 1000;
$$;
grant execute on function public.vendas_ml_ranking(date, date, text, text, text, text, text, text, text, text) to authenticated;
