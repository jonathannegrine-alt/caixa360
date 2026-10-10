-- DRE anual: grupo de cada categoria de despesa ('variavel' | 'fixo' | 'fora'); null = segue impacta_dre.
alter table public.categorias add column if not exists dre_grupo text;
-- Produtos: o titulo passa a ser guardado (antes se perdia ao recarregar do banco).
alter table public.skus add column if not exists titulo text;
