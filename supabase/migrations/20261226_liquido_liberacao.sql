-- A retenção do Mercado Pago só aparece no net_received_amount quando o dinheiro é liberado (money_release_date).
-- ml-vendas guarda a data de liberação e relê o pagamento depois dela (liquido_final = lido já liberado).
alter table public.vendas_ml add column if not exists liberacao_mp timestamptz, add column if not exists liquido_final boolean not null default false;
create index if not exists vendas_ml_liberar_idx on public.vendas_ml (usuario_id, ml_user_id, data_venda) where status = 'paid' and liquido_final = false and liberacao_mp is not null;
-- o que foi lido antes desta coluna existir é lido de novo (sem a data de liberação não dá para saber se já valia)
update public.vendas_ml v set liquido_mp = null, pago_mp = null, retido_mp = null where liquido_mp is not null
  and exists (select 1 from public.ml_tokens t where t.usuario_id = v.usuario_id and t.ml_user_id = v.ml_user_id);
update public.vendas_ml_dias d set cupom_lido = false where d.dia >= current_date - 30
  and exists (select 1 from public.ml_tokens t where t.usuario_id = d.usuario_id and t.ml_user_id = d.ml_user_id);
