-- Conferência de chegada da ordem de compra: nome de quem conferiu (sai no PDF da conferência)
alter table public.compras_recebimentos add column if not exists conferido_por text;
