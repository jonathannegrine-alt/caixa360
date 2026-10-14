-- CONFERÊNCIA DO FULL: o que o Mercado Livre contou ao receber o envio, para confrontar com o que saiu do galpão.
--   conferencia = { itens: [{ anuncio_sku, codigo_ml, enviado, recebido }], obs }
--   conferido_em = quando a contagem do Full foi lançada (o envio passa a "recebido")
alter table public.estoque_envios_full add column if not exists conferencia jsonb;
alter table public.estoque_envios_full add column if not exists conferido_em timestamptz;
