-- TELA DE PEDIDOS: prazo de envio e subestado de cada venda que sai do galpão (preenchidos pelo ml-envios a cada 15 min).
--   envio_limite    = até quando o pacote precisa sair (lead_time.estimated_schedule_limit do envio no ML)
--   envio_substatus = detalhe do estado (buffered, ready_to_print, printed, ready_for_pickup, in_hub...)
-- Pedido atrasado = sem enviado_em, não cancelado e envio_limite já passou.
alter table public.vendas_ml add column if not exists envio_limite timestamptz;
alter table public.vendas_ml add column if not exists envio_substatus text;
create index if not exists vendas_ml_pendentes on public.vendas_ml (usuario_id, envio_limite) where enviado_em is null;
