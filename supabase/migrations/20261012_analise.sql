-- Análise de vendas: estado do comprador em cada venda e consulta agregada (compradores, estados, cancelamentos).

alter table public.vendas_ml add column if not exists uf text;     -- UF de entrega (vem do envio; preenchido pelo ml-envios)
create index if not exists vendas_ml_sem_uf on public.vendas_ml (usuario_id, ml_user_id, data_venda desc) where uf is null and shipping_id is not null;
create index if not exists vendas_ml_comprador on public.vendas_ml (usuario_id, comprador_id);

create or replace function public.vendas_ml_analise(p_de date, p_ate date, p_conta text default null)
returns jsonb language sql stable security invoker as $$
  with base as (
    select * from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.dia between p_de and p_ate
      and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  ),
  ap as (select * from base where situacao = 'aprovada'),
  comp as (
    select comprador_id, max(comprador_apelido) as apelido,
           count(distinct coalesce(nullif(pack_txt, ''), order_txt)) as pedidos,
           sum(qtd) as un, sum(bruto) as bruto, min(dia) as primeira, max(dia) as ultima
    from ap where comprador_id is not null group by 1
  ),
  est as (
    select coalesce(v.uf, '?') as uf, count(*) as vendas, sum(v.qtd) as un, sum(round(v.preco_unit * v.qtd, 2)) as bruto
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and v.status = 'paid'
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
    group by 1
  ),
  canc as (
    select coalesce(nullif(sku, ''), '(sem SKU)') as sku, max(titulo) as titulo,
           count(*) filter (where situacao = 'cancelada') as canc,
           count(*) filter (where situacao in ('aprovada', 'cancelada')) as total,
           coalesce(sum(bruto) filter (where situacao = 'cancelada'), 0) as valor
    from base group by 1
  )
  select jsonb_build_object(
    'compradores', jsonb_build_object(
      'total', (select count(*) from comp),
      'recorrentes', (select count(*) from comp where pedidos > 1),
      'bruto', (select coalesce(sum(bruto), 0) from comp),
      'bruto_recorrentes', (select coalesce(sum(bruto), 0) from comp where pedidos > 1),
      'ja_clientes', (select count(*) from comp c where exists (
          select 1 from public.vendas_ml v where v.usuario_id = auth.uid() and v.comprador_id = c.comprador_id and v.status = 'paid'
            and (v.data_venda at time zone 'America/Sao_Paulo')::date < p_de)),
      'top', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select * from comp order by pedidos desc, bruto desc limit 50) x)),
    'estados', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select * from est order by bruto desc) x),
    'cancelamentos', jsonb_build_object(
      'qtd', (select count(*) from base where situacao = 'cancelada'),
      'total', (select count(*) from base where situacao in ('aprovada', 'cancelada')),
      'valor', (select coalesce(sum(bruto), 0) from base where situacao = 'cancelada'),
      'por_produto', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select * from canc where canc > 0 order by canc desc limit 60) x),
      'por_envio', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select envio, count(*) filter (where situacao = 'cancelada') as canc, count(*) filter (where situacao in ('aprovada', 'cancelada')) as total
          from base group by envio) x))
  );
$$;
grant execute on function public.vendas_ml_analise(date, date, text) to authenticated;
