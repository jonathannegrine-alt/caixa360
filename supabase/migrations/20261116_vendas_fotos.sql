-- FOTO UMA VEZ POR ANÚNCIO
-- Cada venda guardava o link da foto do anúncio (23 MB em 160 mil vendas, a maior coluna da tabela). Agora a foto
-- fica em vendas_fotos (uma linha por anúncio) e a view vendas_ml_calc devolve a mesma coluna "thumbnail" de antes.
-- A função ml-vendas grava a foto aqui e relê do Mercado Livre a cada 7 dias (se a capa mudar, muda em todas as vendas).
create table if not exists public.vendas_fotos (
  usuario_id uuid not null, item_id text not null, thumbnail text, atualizado_em timestamptz not null default now(),
  primary key (usuario_id, item_id));
alter table public.vendas_fotos enable row level security;
drop policy if exists vendas_fotos_ler on public.vendas_fotos;
create policy vendas_fotos_ler on public.vendas_fotos for select to authenticated using (usuario_id = auth.uid());
grant select on public.vendas_fotos to authenticated;

insert into public.vendas_fotos (usuario_id, item_id, thumbnail)
select distinct on (v.usuario_id, v.item_id) v.usuario_id, v.item_id, replace(v.thumbnail, 'http://', 'https://')
  from public.vendas_ml v where v.thumbnail is not null and v.item_id is not null
 order by v.usuario_id, v.item_id, v.data_venda desc
on conflict (usuario_id, item_id) do nothing;

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
    round(v.preco_unit * v.qtd::numeric, 2) AS bruto,
    round(c.cu * v.qtd::numeric, 2) AS custo,
    round(c.base * c.ip / 100::numeric, 2) AS imposto,
    c.cu > 0::numeric AS tem_custo,
    c.ip > 0::numeric OR v.logistic_type = 'self_service'::text AND g.flex_imposto IS FALSE AS tem_imposto,
    round(v.preco_unit * v.qtd::numeric - c.cu * v.qtd::numeric - c.base * c.ip / 100::numeric - v.tarifa - COALESCE(v.frete_vendedor, 0::numeric) + c.fr - c.fc, 2) AS mc,
        CASE
            WHEN (v.preco_unit * v.qtd::numeric) > 0::numeric THEN round((v.preco_unit * v.qtd::numeric - c.cu * v.qtd::numeric - c.base * c.ip / 100::numeric - v.tarifa - COALESCE(v.frete_vendedor, 0::numeric) + c.fr - c.fc) / (v.preco_unit * v.qtd::numeric) * 100::numeric, 2)
            ELSE 0::numeric
        END AS mc_pct,
    round(c.fr, 2) AS flex_repasse,
    round(c.fc, 2) AS flex_custo
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

CREATE OR REPLACE FUNCTION public.sku_fotos(p_skus text[])
 RETURNS TABLE(sku text, foto text)
 LANGUAGE sql
 STABLE
AS $function$
  with alvo as (select distinct lower(btrim(x)) as s from unnest(p_skus) x),
  vendas as (select lower(btrim(v.sku)) as s, coalesce(v.thumbnail, ft.thumbnail) as thumbnail, v.data_venda from public.vendas_ml v
              left join public.vendas_fotos ft on ft.usuario_id = v.usuario_id and ft.item_id = v.item_id
              where v.usuario_id = auth.uid() and coalesce(v.thumbnail, ft.thumbnail) is not null and v.data_venda > now() - interval '180 days'),
  cand as (
    select a.s, m.url as thumbnail, now() as data_venda, -1 as pr from alvo a join public.sku_fotos_manual m on m.usuario_id = auth.uid() and m.sku_norm = a.s
    union all
    select a.s, replace(b.thumbnail, 'http://', 'https://'), b.lido_em, 0 from alvo a join public.ml_itens_base b on b.usuario_id = auth.uid() and lower(btrim(b.sku)) = a.s and b.thumbnail is not null
    union all
    select a.s, v.thumbnail, v.data_venda, 1 from alvo a join vendas v on v.s = a.s
    union all
    select a.s, v.thumbnail, v.data_venda, 2 from alvo a
      join public.sku_composicao c on c.usuario_id = auth.uid() and lower(btrim(c.sku_componente)) = a.s
      join vendas v on v.s = lower(btrim(c.sku_comercial))
  )
  select distinct on (s) s, thumbnail from cand order by s, pr, data_venda desc;
$function$
;

CREATE OR REPLACE FUNCTION public.vendas_ml_recompra(p_de date, p_ate date, p_conta text DEFAULT NULL::text)
 RETURNS TABLE(item_id text, titulo text, thumbnail text, compradores bigint, pedidos bigint, bruto numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with ap as (
    select v.comprador_id, v.item_id, v.titulo, coalesce(v.thumbnail, ft.thumbnail) as thumbnail, coalesce(v.pack_id, v.order_id) as pedido, round(v.preco_unit * v.qtd, 2) as bruto
    from public.vendas_ml v
    left join public.vendas_fotos ft on ft.usuario_id = v.usuario_id and ft.item_id = v.item_id
    where v.usuario_id = auth.uid() and v.status = 'paid' and v.comprador_id is not null
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
  ),
  rec as (select comprador_id from ap group by 1 having count(distinct pedido) > 1)
  select a.item_id, max(a.titulo), max(a.thumbnail), count(distinct a.comprador_id), count(distinct a.pedido), sum(a.bruto)
  from ap a join rec r using (comprador_id)
  where a.item_id is not null
  group by a.item_id order by 5 desc, 6 desc limit 30
$function$
;

select (select count(*) from public.vendas_fotos) fotos;
