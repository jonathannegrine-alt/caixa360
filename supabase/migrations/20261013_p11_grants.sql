-- As tabelas do cadastro de kits/componentes existiam com RLS, mas sem permissão de leitura e gravação para o
-- usuário logado: nada era gravado no banco (os kits ficavam só no navegador). Corrige as permissões.
grant select, insert, update, delete on public.sku_composicao, public.sku_componentes, public.vendas_sku, public.estoque_componentes to authenticated;
grant select, insert, update, delete on public.sku_composicao, public.sku_componentes, public.vendas_sku, public.estoque_componentes to service_role;
