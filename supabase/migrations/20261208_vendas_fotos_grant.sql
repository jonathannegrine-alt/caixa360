-- vendas_fotos foi criada só com leitura para authenticated: a função ml-vendas (service_role) não conseguia gravar
-- foto nova (o POST voltava 403 e era ignorado). Anúncio novo ficava sem foto desde 13/10/2026.
grant select, insert, update, delete on public.vendas_fotos to service_role;
