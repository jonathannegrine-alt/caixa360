-- O mapeamento vale para o anúncio COM o SKU que ele tinha ao mapear (sku_mapa.sku_anuncio; nulo = qualquer SKU).
-- Motivo: o mesmo anúncio pode ter vendido outro produto antes (SKU trocado no ML); essas vendas não podem mudar.
alter table public.sku_mapa add column if not exists sku_anuncio text;

create or replace function public.sku_mapa_vendas(uid uuid, p_item text, p_variation bigint)
returns setof bigint language sql stable security definer set search_path = public as $$
  select v.order_id from public.vendas_ml v
    join public.sku_mapa m on m.usuario_id = uid and m.item_id = p_item and m.variation_id = p_variation
   where v.usuario_id = uid and v.item_id = p_item and not coalesce(v.sku_fixo, false)
     and (m.sku_anuncio is null or upper(trim(coalesce(v.sku_anuncio, v.sku, ''))) = upper(trim(m.sku_anuncio)))
     and (
       (p_variation = 0 and not exists (select 1 from public.sku_mapa x where x.usuario_id = uid and x.item_id = p_item and x.variation_id <> 0
                                          and (x.variation_id = v.variation_id
                                               or (v.variation_id is null and upper(trim(coalesce(v.sku_anuncio, v.sku))) =
                                                   (select upper(trim(a.sku_anuncio)) from public.ml_anuncios a where a.usuario_id = uid and a.item_id = p_item and a.variation_id = x.variation_id)))))
       or (p_variation <> 0 and v.variation_id = p_variation)
       or (p_variation <> 0 and v.variation_id is null and upper(trim(coalesce(v.sku_anuncio, v.sku))) =
           (select upper(trim(a.sku_anuncio)) from public.ml_anuncios a where a.usuario_id = uid and a.item_id = p_item and a.variation_id = p_variation))
     )
$$;
revoke all on function public.sku_mapa_vendas(uuid, text, bigint) from public, anon, authenticated;

-- desfazer precisa ler as vendas ANTES de apagar o mapeamento (a função acima depende dele)
create or replace function public.sku_mapa_desfazer(p_item text, p_variation bigint default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ids bigint[]; n integer;
begin
  if uid is null then return 0; end if;
  select array_agg(x) into ids from public.sku_mapa_vendas(uid, p_item, p_variation) x;
  delete from public.sku_mapa where usuario_id = uid and item_id = p_item and variation_id = p_variation;
  update public.vendas_ml v set sku = v.sku_anuncio
   where v.usuario_id = uid and v.order_id = any(coalesce(ids, '{}')) and v.sku_anuncio is not null and v.sku is distinct from v.sku_anuncio;
  get diagnostics n = row_count;
  if p_variation <> 0 then perform public.sku_mapa_aplicar(p_item, 0); end if;
  if n > 0 then perform public.vendas_ml_carimbar(uid); end if;
  return n;
end $$;
grant execute on function public.sku_mapa_desfazer(text, bigint) to authenticated;
