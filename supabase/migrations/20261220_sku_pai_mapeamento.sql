-- ===== SKU PAI E VARIAÇÕES =====
-- O pai só agrupa: venda, custo, estoque e compra continuam pela variação (o SKU de sempre).
alter table public.skus add column if not exists pai text;
alter table public.skus add column if not exists variacao text;      -- o que diferencia a variação (ex.: Bege, 110v, 20 cm)

create table if not exists public.sku_pais (
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  codigo text not null,
  nome text,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, codigo)
);
alter table public.sku_pais enable row level security;
drop policy if exists sku_pais_dono on public.sku_pais;
create policy sku_pais_dono on public.sku_pais for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.sku_pais to authenticated;
grant all on public.sku_pais to service_role;

-- ===== ANÚNCIOS DO ML (lista para mapear; preenchida pela função ml-anuncios) =====
-- variation_id = 0: anúncio sem variação
create table if not exists public.ml_anuncios (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  item_id text not null,
  variation_id bigint not null default 0,
  titulo text,
  variacao text,
  sku_anuncio text,
  thumbnail text,
  status text,
  logistic_type text,
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, item_id, variation_id)
);
create index if not exists ml_anuncios_sku on public.ml_anuncios (usuario_id, upper(trim(sku_anuncio)));
alter table public.ml_anuncios enable row level security;
drop policy if exists ml_anuncios_dono on public.ml_anuncios;
create policy ml_anuncios_dono on public.ml_anuncios for select to authenticated using (usuario_id = auth.uid());
grant select on public.ml_anuncios to authenticated;
grant select, insert, update, delete on public.ml_anuncios to service_role;

-- ===== MAPEAMENTO ANÚNCIO → SKU DO PRODUTO =====
-- A venda do anúncio (ou da variação) usa o SKU mapeado, qualquer que seja o SKU escrito no anúncio.
-- variation_id = 0: vale para o anúncio inteiro (todas as variações sem mapeamento próprio)
create table if not exists public.sku_mapa (
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null,
  variation_id bigint not null default 0,
  sku text not null,
  ml_user_id text,
  criado_em timestamptz not null default now(),
  primary key (usuario_id, item_id, variation_id)
);
create index if not exists sku_mapa_sku on public.sku_mapa (usuario_id, upper(trim(sku)));
alter table public.sku_mapa enable row level security;
drop policy if exists sku_mapa_dono on public.sku_mapa;
create policy sku_mapa_dono on public.sku_mapa for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.sku_mapa to authenticated;
grant all on public.sku_mapa to service_role;

-- a venda guarda a variação vendida e o SKU que veio do anúncio (sku = SKU do produto, depois do mapeamento)
alter table public.vendas_ml add column if not exists variation_id bigint;
alter table public.vendas_ml add column if not exists sku_anuncio text;

-- vendas já gravadas que pertencem a um mapeamento (anúncio inteiro ou uma variação)
-- venda antiga sem variation_id: casa a variação pelo SKU que o anúncio tem nela
create or replace function public.sku_mapa_vendas(uid uuid, p_item text, p_variation bigint)
returns setof bigint language sql stable security definer set search_path = public as $$
  select v.order_id from public.vendas_ml v
   where v.usuario_id = uid and v.item_id = p_item and not coalesce(v.sku_fixo, false)
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

-- aplica o mapeamento às vendas já gravadas; vendas que estavam sem custo recebem o do produto mapeado
create or replace function public.sku_mapa_aplicar(p_item text, p_variation bigint default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); alvo text; n integer;
begin
  if uid is null then return 0; end if;
  select sku into alvo from public.sku_mapa where usuario_id = uid and item_id = p_item and variation_id = p_variation;
  if alvo is null then return 0; end if;
  update public.vendas_ml v set sku_anuncio = coalesce(v.sku_anuncio, v.sku), sku = alvo
   where v.usuario_id = uid and v.order_id in (select public.sku_mapa_vendas(uid, p_item, p_variation)) and v.sku is distinct from alvo;
  get diagnostics n = row_count;
  if n > 0 then perform public.vendas_ml_carimbar(uid); end if;
  return n;
end $$;
grant execute on function public.sku_mapa_aplicar(text, bigint) to authenticated;

-- desfaz: tira o mapeamento e devolve às vendas o SKU que veio do anúncio (ou o do anúncio inteiro, se houver)
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
