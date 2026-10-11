-- REGRAS DE CÁLCULO DAS VENDAS, por loja (como nas Configurações do Mercado Turbo) + margem real do Flex.
--   flex_imposto      vendas Flex pagam imposto? (false = não emite nota no Flex, imposto zero)
--   flex_custo        quanto o vendedor paga ao transportador por envio Flex (0 = não ajusta a margem)
--   frete_no_imposto  o frete pago pelo comprador entra na base do imposto?
-- No Flex o vendedor é o transportador: o Mercado Livre credita a ele o valor do frete do envio
-- (vendas_ml.frete_flex = o que o comprador pagou + o que o ML bancou). Margem real do Flex =
-- margem normal + esse repasse − o que foi pago ao transportador.

create table if not exists public.vendas_cfg (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  flex_imposto boolean not null default true,
  flex_custo numeric not null default 0,
  frete_no_imposto boolean not null default false,
  primary key (usuario_id, ml_user_id)
);
alter table public.vendas_cfg enable row level security;
drop policy if exists vendas_cfg_dono on public.vendas_cfg;
create policy vendas_cfg_dono on public.vendas_cfg for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.vendas_cfg to authenticated;
grant all on public.vendas_cfg to service_role;

alter table public.vendas_ml add column if not exists frete_flex numeric;      -- repasse do ML pelo envio Flex (parte desta venda)
alter table public.vendas_ml add column if not exists envio_n smallint;        -- quantas vendas dividem o mesmo envio

create or replace view public.vendas_ml_calc with (security_invoker = true) as
select
  v.usuario_id, v.order_id, v.pack_id, v.data_venda, v.status, v.comprador_id, v.comprador_apelido, v.comprador_nome,
  v.item_id, v.titulo, v.sku, v.variacao, v.qtd, v.preco_unit, v.tarifa, v.listing_type, v.shipping_id, v.logistic_type,
  v.frete_vendedor, v.frete_comprador, v.total_pago, v.thumbnail, v.atualizado_em, v.ml_user_id, v.custo_unit, v.imposto_pct, v.sku_fixo,
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
  round(c.cu * v.qtd, 2)                             as custo,
  round(c.base * c.ip / 100, 2)                      as imposto,
  c.cu > 0                                           as tem_custo,
  c.ip > 0                                           as tem_imposto,
  round(v.preco_unit * v.qtd - c.cu * v.qtd - c.base * c.ip / 100 - v.tarifa - coalesce(v.frete_vendedor, 0) + c.fr - c.fc, 2) as mc,
  case when v.preco_unit * v.qtd > 0 then
    round((v.preco_unit * v.qtd - c.cu * v.qtd - c.base * c.ip / 100 - v.tarifa - coalesce(v.frete_vendedor, 0) + c.fr - c.fc) / (v.preco_unit * v.qtd) * 100, 2)
  else 0 end                                         as mc_pct,
  round(c.fr, 2)                                     as flex_repasse,
  round(c.fc, 2)                                     as flex_custo
from public.vendas_ml v
left join lateral (
  select k.custo, k.imposto from public.skus k
  where (v.custo_unit is null or v.imposto_pct is null) and k.usuario_id = v.usuario_id and upper(trim(k.sku)) = upper(trim(v.sku))
  limit 1
) s on true
left join public.vendas_cfg g on g.usuario_id = v.usuario_id and g.ml_user_id = v.ml_user_id
cross join lateral (
  select coalesce(v.custo_unit, s.custo, 0) as cu,
         case when v.logistic_type = 'self_service' and g.flex_imposto is false then 0 else coalesce(v.imposto_pct, s.imposto, 0) end as ip,
         v.preco_unit * v.qtd + case when coalesce(g.frete_no_imposto, false) then coalesce(v.frete_comprador, 0) else 0 end as base,
         -- o ajuste do Flex só entra quando o custo do transportador foi informado
         case when v.logistic_type = 'self_service' and coalesce(g.flex_custo, 0) > 0 then coalesce(v.frete_flex, 0) else 0 end as fr,
         case when v.logistic_type = 'self_service' and coalesce(g.flex_custo, 0) > 0 then g.flex_custo / greatest(coalesce(v.envio_n, 1), 1) else 0 end as fc
) c;
grant select on public.vendas_ml_calc to authenticated;

-- DRE mês a mês: acrescenta o ajuste do Flex (pago ao transportador − repasse do ML; positivo = despesa)
drop function if exists public.vendas_ml_por_mes(integer, text);
create function public.vendas_ml_por_mes(p_ano integer, p_conta text default null)
returns table(mes integer, faturamento numeric, canceladas numeric, imposto numeric, frete_vendedor numeric, custo numeric, tarifa numeric, vendas bigint,
              flex_repasse numeric, flex_custo numeric, flex_envios bigint)
language sql stable as $$
  select extract(month from c.dia)::integer as mes,
    coalesce(sum(c.bruto), 0)                                                              as faturamento,
    coalesce(sum(c.bruto) filter (where c.situacao = 'cancelada'), 0)                      as canceladas,
    coalesce(sum(c.imposto) filter (where c.situacao = 'aprovada'), 0)                     as imposto,
    coalesce(sum(coalesce(c.frete_vendedor, 0)) filter (where c.situacao = 'aprovada'), 0) as frete_vendedor,
    coalesce(sum(c.custo) filter (where c.situacao = 'aprovada'), 0)                       as custo,
    coalesce(sum(c.tarifa) filter (where c.situacao = 'aprovada'), 0)                      as tarifa,
    count(*) filter (where c.situacao = 'aprovada')::bigint                                as vendas,
    coalesce(sum(c.flex_repasse) filter (where c.situacao = 'aprovada'), 0)                as flex_repasse,
    coalesce(sum(c.flex_custo) filter (where c.situacao = 'aprovada'), 0)                  as flex_custo,
    count(*) filter (where c.situacao = 'aprovada' and c.logistic_type = 'self_service')::bigint as flex_envios
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and c.situacao in ('aprovada', 'cancelada')
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  group by 1 order by 1;
$$;
revoke all on function public.vendas_ml_por_mes(integer, text) from public, anon;
grant execute on function public.vendas_ml_por_mes(integer, text) to authenticated;
