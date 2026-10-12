-- Avisos do Mercado Livre sobre anúncios (tópico items): o ml-webhook grava aqui o preço, a situação e o estoque
-- do anúncio na hora em que mudam, sem precisar consultar.
alter table public.ml_itens_base add column if not exists estoque numeric;
alter table public.ml_itens_base add column if not exists situacao text;
alter table public.ml_itens_base add column if not exists aviso_em timestamptz;
