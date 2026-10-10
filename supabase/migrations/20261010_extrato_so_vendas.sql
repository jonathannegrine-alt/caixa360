-- Marca os dias do extrato ja recalculados contando apenas vendas (regular_payment).
-- O cron ml-snapshot refaz aos poucos os dias antigos que ainda estao com so_vendas = false.
alter table public.extrato_historico add column if not exists so_vendas boolean not null default false;
