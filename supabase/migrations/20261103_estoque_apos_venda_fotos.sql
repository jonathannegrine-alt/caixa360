-- Estoque disponível logo depois de cada venda (gravado pela sincronização quando a venda entra) e foto do produto vinda do anúncio.
alter table public.vendas_ml add column if not exists est_anuncio_apos numeric, add column if not exists est_galpao_apos numeric;
CREATE OR REPLACE FUNCTION public.sku_fotos(p_skus text[])
 RETURNS TABLE(sku text, foto text)
 LANGUAGE sql
 STABLE
AS $function$
  with alvo as (select distinct lower(btrim(x)) as s from unnest(p_skus) x),
  vendas as (select lower(btrim(v.sku)) as s, v.thumbnail, v.data_venda from public.vendas_ml v
              where v.usuario_id = auth.uid() and v.thumbnail is not null and v.data_venda > now() - interval '180 days'),
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
