-- Categorias: competência padrão (em que mês a despesa entra no DRE quando a conta não tem competência própria)
alter table public.categorias add column if not exists competencia_padrao text not null default 'vencimento';   -- vencimento | anterior | emissao
