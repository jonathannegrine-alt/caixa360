-- Medidas de cada anúncio: as que o vendedor declarou (SELLER_PACKAGE_*) e as que o Mercado Livre mediu (PACKAGE_*).
-- O peso tarifável (ml_itens_base.peso_g) é o peso cúbico das medidas DECLARADAS: altura x largura x comprimento / 6.
alter table public.ml_itens_base
  add column if not exists decl_a numeric, add column if not exists decl_l numeric, add column if not exists decl_c numeric, add column if not exists decl_g numeric,
  add column if not exists ml_a numeric, add column if not exists ml_l numeric, add column if not exists ml_c numeric, add column if not exists ml_g numeric,
  add column if not exists ml_origem text;
-- força a releitura dos anúncios já lidos, para trazer as medidas
update public.ml_itens_base set lido_em = '2000-01-01' where decl_a is null and ml_a is null;
