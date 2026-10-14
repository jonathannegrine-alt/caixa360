-- Totais do Resumo Financeiro: as canceladas passam a vir também separadas em valor dos produtos ('bruto') e frete do
-- comprador ('frete_comp'), para a tela somar o frete só quando "Considerar frete do comprador" estiver marcado
-- (igual às aprovadas) e bater com o DRE e o fechamento do mês. 'valor' (bruto + frete) continua para a tela antiga.
create or replace function public.vendas_ml_totais(p_de date, p_ate date, p_pedido text default null, p_titulo text default null, p_sku text default null, p_modalidade text default null, p_envio text default null, p_custo text default null, p_conta text default null)
returns jsonb language sql stable as $function$
  with base as (
    select * from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.dia between p_de and p_ate
      and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
      and (coalesce(p_pedido, '') = '' or c.order_txt like '%' || p_pedido || '%' or c.pack_txt like '%' || p_pedido || '%')
      and (coalesce(p_titulo, '') = '' or c.titulo ilike '%' || p_titulo || '%' or c.item_id ilike '%' || p_titulo || '%')
      and (coalesce(p_sku, '') = '' or c.sku ilike '%' || p_sku || '%')
      and (coalesce(p_modalidade, '') = '' or c.modalidade = p_modalidade)
      and (coalesce(p_envio, '') = '' or c.envio = p_envio)
      and (coalesce(p_custo, '') = ''
           or (p_custo = 'sem-custo'   and not c.tem_custo)
           or (p_custo = 'sem-imposto' and not c.tem_imposto)
           or (p_custo = 'sem-um'      and (not c.tem_custo or not c.tem_imposto))
           or (p_custo = 'sem-ambos'   and not c.tem_custo and not c.tem_imposto))
  )
  select jsonb_build_object(
    'linhas', (select count(*) from base),
    'aprov', (select jsonb_build_object(
        'qtd', count(*), 'un', coalesce(sum(qtd), 0), 'bruto', coalesce(sum(bruto), 0),
        'frete_comp', coalesce(sum(frete_comprador), 0), 'frete_vend', coalesce(sum(frete_vendedor), 0),
        'tarifa', coalesce(sum(tarifa), 0), 'custo', coalesce(sum(custo), 0), 'imposto', coalesce(sum(imposto), 0),
        'mc', coalesce(sum(mc), 0),
        'sem_custo', count(*) filter (where not tem_custo or not tem_imposto),
        'sem_frete', count(*) filter (where frete_vendedor is null))
      from base where situacao = 'aprovada'),
    'canc', (select jsonb_build_object('qtd', count(*), 'un', coalesce(sum(qtd), 0),
        'valor', coalesce(sum(bruto + coalesce(frete_comprador, 0)), 0),
        'bruto', coalesce(sum(bruto), 0), 'frete_comp', coalesce(sum(frete_comprador), 0))
      from base where situacao = 'cancelada'),
    'pend', (select count(*) from base where situacao = 'pendente'),
    'por_envio', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select envio, count(*) as qtd, coalesce(sum(bruto), 0) as bruto, coalesce(sum(frete_comprador), 0) as frete_comp
        from base where situacao = 'aprovada' group by envio) x),
    'envios_todos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select envio, count(*) as qtd from base group by envio) x)
  );
$function$;
