-- Cartão da venda: dados de entrega e do comprador guardados na venda, e depósito das etiquetas.
alter table public.vendas_ml
  add column if not exists cidade text,
  add column if not exists cep text,
  add column if not exists rastreio text,
  add column if not exists comprador_doc text,          -- CPF/CNPJ do comprador (preenchido quando os detalhes da venda são abertos)
  add column if not exists etiqueta_em timestamptz;     -- quando a cópia da etiqueta foi guardada

create index if not exists vendas_ml_cidade on public.vendas_ml (usuario_id, uf, cidade);

-- Depósito privado das etiquetas (PDF). Só a função ml-venda/ml-envios lê e grava, com a chave de serviço.
-- As cópias ficam 12 meses (a limpeza é feita pela função ml-envios).
insert into storage.buckets (id, name, public) values ('etiquetas', 'etiquetas', false) on conflict (id) do nothing;
