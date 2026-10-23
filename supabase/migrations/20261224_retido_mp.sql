-- Retido pelo Mercado Pago (geralmente parcela de empréstimo descontada de cada venda; MON_ART ~30%, ULTIEXPRESS ~25% em
-- 2026-10-23). NÃO entra na margem nem no DRE: só informação no cartão da venda. Gravado pelo ml-vendas (passos 4c e 5b).
-- pago_mp = total_paid_amount − finance_fee; liquido_mp = net_received_amount (GET /collections/{pagamento}).
alter table public.vendas_ml add column if not exists pago_mp numeric, add column if not exists liquido_mp numeric, add column if not exists retido_mp numeric;

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
    round(COALESCE(v.cupom_vendedor, 0::numeric), 2) AS cupom_vendedor,
    v.liquido_mp,
    v.retido_mp
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

-- relê os últimos 30 dias para preencher (o cron usa a mesma marca do cupom)
update public.vendas_ml_dias d set cupom_lido = false where d.dia >= current_date - 30
  and exists (select 1 from public.ml_tokens t where t.usuario_id = d.usuario_id and t.ml_user_id = d.ml_user_id);  -- a conta demonstração é só leitura
