-- Pendências com o transportador do Flex: cada envio questionado numa fatura vira uma pendência que fica aberta até
-- o produto voltar, o valor ser abatido numa fatura ou você desistir. Uma por envio (a fatura retificada não duplica).
create table if not exists public.flex_pendencias (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  envio text not null,
  codigo text,
  fatura text,                       -- fatura em que foi questionado
  transportador text,
  conta text,                        -- ml_user_id da venda
  pedido text,
  sku text,
  titulo text,
  qtd numeric not null default 1,
  cat text,                          -- categoria da conferência (antes, nao_entregue, pnr...)
  pedir text,                        -- o que foi pedido ao transportador
  frete numeric not null default 0,  -- frete contestado
  frete_estornado boolean not null default false,
  valor numeric not null default 0,  -- valor a ressarcir pelo produto
  situacao text not null default 'aguardando' check (situacao in ('aguardando', 'devolvido', 'abatido', 'perdoado')),
  prazo date,
  devolvido_em date,
  conferido_por text,
  estado_produto text check (estado_produto in ('bom', 'avariado')),
  entrou_estoque boolean not null default false,
  abatido_fatura text,
  abatido_valor numeric,
  obs text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (usuario_id, envio)
);
create index if not exists flex_pendencias_aberto on public.flex_pendencias (usuario_id, situacao, prazo);
alter table public.flex_pendencias enable row level security;
drop policy if exists flex_pendencias_dono on public.flex_pendencias;
create policy flex_pendencias_dono on public.flex_pendencias for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.flex_pendencias to authenticated;
grant all on public.flex_pendencias to service_role;
drop trigger if exists demo_so_leitura on public.flex_pendencias;
do $$ declare s text; begin
  select n.nspname into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'bloqueia' limit 1;
  if s is not null then
    execute format('create trigger demo_so_leitura before insert or update or delete on public.flex_pendencias for each row execute function %I.bloqueia()', s);
  end if;
end $$;
select count(*) pendencias from public.flex_pendencias;
