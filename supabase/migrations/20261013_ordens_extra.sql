alter table public.olist_ordens add column if not exists extra jsonb;   -- dados da ordem criada no Caixa 360: condição, parcelas, frete, desconto, loja, observações
