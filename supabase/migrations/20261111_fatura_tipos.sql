-- Tipos de cobrança da fatura descobertos na primeira leitura, com a classe certa
-- (a sondagem automática classifica tipo novo como 'outros' ou 'venda'; estes foram conferidos pelo nome).
insert into public.ml_fatura_tipos (sub_type, rotulo, classe) values
  ('BESM', 'Cancelamento da tarifa de manutenção da loja', 'loja'),
  ('CDLIT', 'Publicidade de seguidores (afiliados)', 'pub'),
  ('CFCBE', 'Custo do serviço de coleta Full', 'full'),
  ('CFCBI', 'Custo do serviço de coleta Full', 'full'),
  ('CFRS', 'Custo por retirada de estoque Full', 'full')
on conflict (sub_type) do update set classe = excluded.classe, rotulo = excluded.rotulo;
