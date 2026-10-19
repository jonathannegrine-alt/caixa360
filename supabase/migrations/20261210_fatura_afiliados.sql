-- COMISSÃO DE AFILIADOS NO DRE (19/10/2026)
-- "Cargo por venta con afiliados" (CVAF) aponta para uma venda, por isso a sondagem a classificou como 'venda' e a
-- fatura nunca foi lida. Mas ela NÃO é descontada da venda (debited_from_operation = NO): é cobrada na fatura.
-- Nova classe 'afil' para ela e para a publicidade de seguidores (CDLIT e o cancelamento BDLIT), que estava em 'pub'.
update public.ml_fatura_tipos set classe = 'afil'
 where sub_type in ('CVAF', 'CDLIT', 'BDLIT') or rotulo ilike '%afiliad%' or rotulo ilike '%seguidores%';

-- releitura só de alguns tipos numa fatura já lida (ml-fatura, passo 3b). Fatura compactada: as linhas lidas entram
-- em ml_fatura_linhas e o período volta a compactado = false; ml_fatura_compactar soma de novo só o que está em
-- linhas (o total de cada dia e tipo é regravado pela chave, os outros tipos ficam como estão).
alter table public.ml_fatura_periodos add column if not exists reler_tipos text[], add column if not exists reler_prox integer not null default 0;
update public.ml_fatura_periodos set reler_tipos = array['CVAF'], reler_prox = 0;

select 1 ok;
