-- Vendas ML: cálculo no banco (para períodos longos o app pede só a página atual e os totais).

-- Dias já sincronizados com o ML (controle de cache da Edge Function ml-vendas)
create table if not exists public.vendas_ml_dias (
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  dia             date not null,
  vendas          integer not null default 0,
  completo        boolean not null default false,   -- todos os fretes buscados
  sincronizado_em timestamptz not null default now(),
  primary key (usuario_id, dia)
);
alter table public.vendas_ml_dias enable row level security;
drop policy if exists vendas_ml_dias_select_proprio on public.vendas_ml_dias;
create policy vendas_ml_dias_select_proprio on public.vendas_ml_dias for select using (auth.uid() = usuario_id);
grant select on public.vendas_ml_dias to authenticated;
grant all on public.vendas_ml_dias to service_role;

-- Venda + custo/imposto do cadastro de produtos + margem de contribuição
create or replace view public.vendas_ml_calc with (security_invoker = true) as
select
  v.*,
  v.order_id::text                                   as order_txt,
  coalesce(v.pack_id::text, '')                      as pack_txt,
  (v.data_venda at time zone 'America/Sao_Paulo')::date as dia,
  case v.status when 'paid' then 'aprovada' when 'cancelled' then 'cancelada' else 'pendente' end as situacao,
  case v.logistic_type
    when 'fulfillment' then 'Full' when 'self_service' then 'Flex' when 'cross_docking' then 'Coleta'
    when 'drop_off' then 'Agência' when 'xd_drop_off' then 'Places' else 'Outros' end as envio,
  case v.listing_type
    when 'gold_pro' then 'Premium' when 'gold_premium' then 'Premium' when 'gold_special' then 'Clássico'
    when 'free' then 'Grátis' else coalesce(v.listing_type, '—') end as modalidade,
  round(v.preco_unit * v.qtd, 2)                     as bruto,
  round(coalesce(s.custo, 0) * v.qtd, 2)             as custo,
  round(v.preco_unit * v.qtd * coalesce(s.imposto, 0) / 100, 2) as imposto,
  coalesce(s.custo, 0) > 0                           as tem_custo,
  coalesce(s.imposto, 0) > 0                         as tem_imposto,
  round(v.preco_unit * v.qtd - coalesce(s.custo, 0) * v.qtd
        - v.preco_unit * v.qtd * coalesce(s.imposto, 0) / 100
        - v.tarifa - coalesce(v.frete_vendedor, 0), 2) as mc,
  case when v.preco_unit * v.qtd > 0 then
    round((v.preco_unit * v.qtd - coalesce(s.custo, 0) * v.qtd
          - v.preco_unit * v.qtd * coalesce(s.imposto, 0) / 100
          - v.tarifa - coalesce(v.frete_vendedor, 0)) / (v.preco_unit * v.qtd) * 100, 2)
  else 0 end                                         as mc_pct
from public.vendas_ml v
left join lateral (
  select k.custo, k.imposto from public.skus k
  where k.usuario_id = v.usuario_id and upper(trim(k.sku)) = upper(trim(v.sku))
  limit 1
) s on true;
grant select on public.vendas_ml_calc to authenticated;

-- Totais do período (o status é separado dentro do resultado; os demais filtros se aplicam)
create or replace function public.vendas_ml_totais(
  p_de date, p_ate date,
  p_pedido text default null, p_titulo text default null, p_sku text default null,
  p_modalidade text default null, p_envio text default null, p_custo text default null
) returns jsonb language sql stable security invoker as $$
  with base as (
    select * from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.dia between p_de and p_ate
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
        'valor', coalesce(sum(bruto + coalesce(frete_comprador, 0)), 0))
      from base where situacao = 'cancelada'),
    'pend', (select count(*) from base where situacao = 'pendente'),
    'por_envio', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select envio, count(*) as qtd, coalesce(sum(bruto), 0) as bruto, coalesce(sum(frete_comprador), 0) as frete_comp
        from base where situacao = 'aprovada' group by envio) x),
    'envios_todos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select envio, count(*) as qtd from base group by envio) x)
  );
$$;
grant execute on function public.vendas_ml_totais(date, date, text, text, text, text, text, text) to authenticated;

-- Ranking de produtos do período (vendas aprovadas), agrupado por SKU ou por anúncio
create or replace function public.vendas_ml_ranking(p_de date, p_ate date, p_grupo text default 'sku')
returns table (chave text, titulo text, un bigint, vendas bigint, bruto numeric, mc numeric, mc_pct numeric)
language sql stable security invoker as $$
  select
    case when p_grupo = 'mlb' then coalesce(c.item_id, '(sem MLB)') else coalesce(nullif(c.sku, ''), '(sem SKU)') end as chave,
    max(c.titulo) as titulo, sum(c.qtd)::bigint as un, count(*)::bigint as vendas,
    sum(c.bruto) as bruto, sum(c.mc) as mc,
    case when sum(c.bruto) > 0 then round(sum(c.mc) / sum(c.bruto) * 100, 2) else 0 end as mc_pct
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao = 'aprovada'
  group by 1
  order by sum(c.bruto) desc
  limit 500;
$$;
grant execute on function public.vendas_ml_ranking(date, date, text) to authenticated;

-- Série diária (página Início)
create or replace function public.vendas_ml_por_dia(p_de date, p_ate date)
returns table (dia date, vendas bigint, bruto numeric, mc numeric)
language sql stable security invoker as $$
  select c.dia, count(*)::bigint, coalesce(sum(c.bruto), 0), coalesce(sum(c.mc), 0)
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao = 'aprovada'
  group by c.dia order by c.dia;
$$;
grant execute on function public.vendas_ml_por_dia(date, date) to authenticated;
