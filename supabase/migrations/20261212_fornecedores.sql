-- FORNECEDORES (19/10/2026): cadastro por loja (loja = ml_user_id; vazio = loja padrão, como em pagamentos.loja).
-- O nome é o que aparece em Contas a pagar e nas Ordens de compra; "apelidos" junta os outros jeitos de escrever o
-- mesmo fornecedor. Os dados da Receita (consulta pelo CNPJ na tela) ficam em "receita".
create table if not exists public.fornecedores (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  loja         text,
  nome         text not null,
  apelidos     text[] not null default '{}',
  cnpj         text,
  razao_social text,
  fantasia     text,
  ie           text,
  situacao     text,
  contato      text,
  telefone     text,
  email        text,
  endereco     text,
  cidade       text,
  uf           text,
  cep          text,
  condicao     text,                 -- condição de pagamento combinada (ex.: 30/60/90)
  prazo_dias   integer,              -- prazo de entrega em dias
  obs          text,
  receita      jsonb,                -- resposta da consulta do CNPJ (sócios, CNAE, capital, abertura…)
  receita_em   timestamptz,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists fornecedores_usuario on public.fornecedores (usuario_id, loja);
alter table public.fornecedores enable row level security;
drop policy if exists fornecedores_dono on public.fornecedores;
create policy fornecedores_dono on public.fornecedores for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.fornecedores to authenticated;

select 1 ok;

-- grupo: vários CNPJs do mesmo fornecedor (ex.: QX Flores) somam juntos na lista e na ficha
alter table public.fornecedores add column if not exists grupo text;

-- fator da nota: custo real = valor na nota × fator (fornecedor que emite a nota abaixo do valor pago)
alter table public.fornecedores add column if not exists fator_nf numeric;

