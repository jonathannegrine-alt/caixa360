-- Permissões das tabelas novas (tabela criada por migração não herda as permissões padrão do projeto).
grant select on public.ml_avisos to authenticated;
grant all on public.ml_avisos to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on public.frete_conferidos to authenticated;
grant all on public.frete_conferidos to service_role;
grant all on public.app_admin to service_role;
