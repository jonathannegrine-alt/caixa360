-- Cupom de desconto bancado pelo VENDEDOR (GET /orders/{id}/discounts, type "coupon", amounts.seller).
-- Não vem no unit_price nem no paid_amount do pedido: sem ele a margem ficava maior que a real (caso conta 65308826,
-- 2026-10-23: R$ 221,78 com cupom do vendedor de R$ 63,87). A oferta (type "discount") já está no unit_price.
-- cupom_vendedor: total da linha (todas as unidades); nulo = ainda não lido no ML. vendas_ml_dias.cupom_lido marca o dia relido.
alter table public.vendas_ml add column if not exists cupom_vendedor numeric;
alter table public.vendas_ml_dias add column if not exists cupom_lido boolean not null default false;

-- "bruto" (valor dos produtos) passa a ser o que o vendedor recebe pelos produtos: preço × qtd − cupom do vendedor.
-- A base do imposto continua no preço do anúncio.
create or replace view public.vendas_ml_calc with (security_invoker = true) as
SELECT v.usuario_id,
    v.order_id,
    v.pack_id,
    v.data_venda,
    v.status,
    v.comprador_id,
    v.comprador_apelido,
    v.comprador_nome,
    v.item_id,
    v.titulo,
    v.sku,
    v.variacao,
    v.qtd,
    v.preco_unit,
    v.tarifa,
    v.listing_type,
    v.shipping_id,
    v.logistic_type,
    v.frete_vendedor,
    v.frete_comprador,
    v.total_pago,
    COALESCE(v.thumbnail, ft.thumbnail) AS thumbnail,
    v.atualizado_em,
    v.ml_user_id,
    v.custo_unit,
    v.imposto_pct,
    v.sku_fixo,
    v.order_id::text AS order_txt,
    COALESCE(v.pack_id::text, ''::text) AS pack_txt,
    (v.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date AS dia,
        CASE v.status
            WHEN 'paid'::text THEN 'aprovada'::text
            WHEN 'cancelled'::text THEN 'cancelada'::text
            ELSE 'pendente'::text
        END AS situacao,
        CASE v.logistic_type
            WHEN 'fulfillment'::text THEN 'Full'::text
            WHEN 'self_service'::text THEN 'Flex'::text
            WHEN 'cross_docking'::text THEN 'Coleta'::text
            WHEN 'drop_off'::text THEN 'Agência'::text
            WHEN 'xd_drop_off'::text THEN 'Places'::text
            ELSE 'Outros'::text
        END AS envio,
        CASE v.listing_type
            WHEN 'gold_pro'::text THEN 'Premium'::text
            WHEN 'gold_premium'::text THEN 'Premium'::text
            WHEN 'gold_special'::text THEN 'Clássico'::text
            WHEN 'free'::text THEN 'Grátis'::text
            ELSE COALESCE(v.listing_type, '—'::text)
        END AS modalidade,
    round(v.preco_unit * v.qtd::numeric - COALESCE(v.cupom_vendedor, 0::numeric), 2) AS bruto,
    round(c.cu * v.qtd::numeric, 2) AS custo,
    round(c.base * c.ip / 100::numeric, 2) AS imposto,
    c.cu > 0::numeric AS tem_custo,
    c.ip > 0::numeric OR v.logistic_type = 'self_service'::text AND g.flex_imposto IS FALSE AS tem_imposto,
    round(v.preco_unit * v.qtd::numeric - COALESCE(v.cupom_vendedor, 0::numeric) - c.cu * v.qtd::numeric - c.base * c.ip / 100::numeric - v.tarifa - COALESCE(v.frete_vendedor, 0::numeric) + c.fr - c.fc, 2) AS mc,
        CASE
            WHEN (v.preco_unit * v.qtd::numeric - COALESCE(v.cupom_vendedor, 0::numeric)) > 0::numeric THEN round((v.preco_unit * v.qtd::numeric - COALESCE(v.cupom_vendedor, 0::numeric) - c.cu * v.qtd::numeric - c.base * c.ip / 100::numeric - v.tarifa - COALESCE(v.frete_vendedor, 0::numeric) + c.fr - c.fc) / (v.preco_unit * v.qtd::numeric - COALESCE(v.cupom_vendedor, 0::numeric)) * 100::numeric, 2)
            ELSE 0::numeric
        END AS mc_pct,
    round(c.fr, 2) AS flex_repasse,
    round(c.fc, 2) AS flex_custo,
    round(COALESCE(v.cupom_vendedor, 0::numeric), 2) AS cupom_vendedor
   FROM vendas_ml v
     LEFT JOIN vendas_fotos ft ON ft.usuario_id = v.usuario_id AND ft.item_id = v.item_id
     LEFT JOIN LATERAL ( SELECT k.custo,
            k.imposto
           FROM skus k
          WHERE (v.custo_unit IS NULL OR v.imposto_pct IS NULL) AND k.usuario_id = v.usuario_id AND upper(TRIM(BOTH FROM k.sku)) = upper(TRIM(BOTH FROM v.sku))
         LIMIT 1) s ON true
     LEFT JOIN vendas_cfg g ON g.usuario_id = v.usuario_id AND g.ml_user_id = v.ml_user_id
     CROSS JOIN LATERAL ( SELECT COALESCE(v.custo_unit, s.custo, 0::numeric) AS cu,
                CASE
                    WHEN v.logistic_type = 'self_service'::text AND g.flex_imposto IS FALSE THEN 0::numeric
                    ELSE COALESCE(v.imposto_pct, s.imposto, 0::numeric)
                END AS ip,
            v.preco_unit * v.qtd::numeric +
                CASE
                    WHEN COALESCE(g.frete_no_imposto, false) THEN COALESCE(v.frete_comprador, 0::numeric)
                    ELSE 0::numeric
                END AS base,
                CASE
                    WHEN v.logistic_type = 'self_service'::text AND COALESCE(g.flex_custo, 0::numeric) > 0::numeric THEN COALESCE(v.frete_flex, 0::numeric)
                    ELSE 0::numeric
                END AS fr,
                CASE
                    WHEN v.logistic_type = 'self_service'::text AND COALESCE(g.flex_custo, 0::numeric) > 0::numeric THEN g.flex_custo / GREATEST(COALESCE(v.envio_n::integer, 1), 1)::numeric
                    ELSE 0::numeric
                END AS fc) c;

-- o resumo por dia é refeito quando o cupom muda
CREATE OR REPLACE FUNCTION public.vendas_resumo_marcar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into vendas_resumo_pend select distinct n.usuario_id, coalesce(n.ml_user_id, ''), (n.data_venda at time zone 'America/Sao_Paulo')::date
      from novas n where n.data_venda is not null on conflict do nothing;
  elsif tg_op = 'DELETE' then
    insert into vendas_resumo_pend select distinct o.usuario_id, coalesce(o.ml_user_id, ''), (o.data_venda at time zone 'America/Sao_Paulo')::date
      from antigas o where o.data_venda is not null on conflict do nothing;
  else
    -- só o que muda algum total; foto, título, rastreio, cidade etc. não mexem no resumo
    insert into vendas_resumo_pend
    select distinct x.u, x.c, x.d from (
      select n.usuario_id u, coalesce(n.ml_user_id, '') c, (n.data_venda at time zone 'America/Sao_Paulo')::date d, o.usuario_id ou, coalesce(o.ml_user_id, '') oc, (o.data_venda at time zone 'America/Sao_Paulo')::date od
        from novas n join antigas o on o.usuario_id = n.usuario_id and o.order_id = n.order_id
       where (n.status, n.qtd, n.preco_unit, n.tarifa, n.frete_vendedor, n.frete_comprador, n.frete_flex, n.custo_unit, n.imposto_pct, n.logistic_type, n.envio_n, n.data_venda, n.ml_user_id, n.sku, n.cupom_vendedor)
             is distinct from (o.status, o.qtd, o.preco_unit, o.tarifa, o.frete_vendedor, o.frete_comprador, o.frete_flex, o.custo_unit, o.imposto_pct, o.logistic_type, o.envio_n, o.data_venda, o.ml_user_id, o.sku, o.cupom_vendedor)
    ) m cross join lateral (values (m.u, m.c, m.d), (m.ou, m.oc, m.od)) as x(u, c, d)
    where x.d is not null on conflict do nothing;
  end if;
  return null;
end $function$;
