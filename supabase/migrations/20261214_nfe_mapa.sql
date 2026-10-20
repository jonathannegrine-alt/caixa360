-- IMPORTAR COMPRA PELA NOTA (20/10/2026): de-para do código do produto do fornecedor (cProd da nota) para o SKU.
-- Guardado na 1ª importação e reaproveitado nas seguintes. "varia": o mesmo código serve para vários SKUs (cores) e a
-- quantidade de cada um vem da ordem de compra ligada à nota. "mult": unidades do nosso SKU por unidade da nota (caixa).
create table if not exists public.nfe_mapa (
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  emit_cnpj     text not null,
  codigo        text not null,
  sku           text,
  mult          numeric not null default 1,
  varia         boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, emit_cnpj, codigo)
);
alter table public.nfe_mapa enable row level security;
drop policy if exists nfe_mapa_dono on public.nfe_mapa;
create policy nfe_mapa_dono on public.nfe_mapa for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.nfe_mapa to authenticated, service_role;

select 1 ok;
