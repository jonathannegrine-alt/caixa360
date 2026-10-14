-- DRE NO MODO SIMPLIFICADO: despesas lançadas à mão (descrição, categoria, valor, mês, fixo ou variável), usadas pelo
-- DRE no lugar de Contas a pagar quando o usuário liga o modo (configuracoes.cfg → comprasCfg.dreSimples).
--   recorrencia 'unico'     vale só no mês "mes"
--               'sempre'    vale todo mês a partir de "mes", até "fim" (nulo = sem data para acabar)
--               'parcelado' "valor" é o total, dividido em "parcelas" meses a partir de "mes"
create table if not exists public.dre_simples (
  id bigint generated always as identity primary key,
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null default 'fixo' check (tipo in ('fixo', 'variavel')),
  descricao text not null,
  categoria text not null default '',
  valor numeric not null check (valor >= 0),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  recorrencia text not null default 'unico' check (recorrencia in ('unico', 'sempre', 'parcelado')),
  parcelas integer check (parcelas is null or parcelas between 1 and 120),
  fim text check (fim is null or fim ~ '^\d{4}-\d{2}$'),
  criado_em timestamptz not null default now()
);
create index if not exists dre_simples_usuario on public.dre_simples (usuario_id);
alter table public.dre_simples enable row level security;
drop policy if exists dre_simples_dono on public.dre_simples;
create policy dre_simples_dono on public.dre_simples for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.dre_simples to authenticated;
grant all on public.dre_simples to service_role;
grant usage, select on all sequences in schema public to service_role;
-- conta de demonstração é só de leitura
drop trigger if exists demo_so_leitura on public.dre_simples;
create trigger demo_so_leitura before insert or update or delete on public.dre_simples for each row execute function demo.bloqueia();
