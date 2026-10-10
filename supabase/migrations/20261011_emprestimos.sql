-- EMPRÉSTIMOS: cadastro por contrato.
--  modo 'vincular': as parcelas já vêm do sistema financeiro ligado (Olist); o contrato só as reconhece pelo
--                   trecho em "vinculo" (ex.: "Sicoob FGI") para mostrar pagas, a pagar e saldo devedor.
--  modo 'gerar'   : para quem não usa Olist; o contrato gera as parcelas no Contas a pagar
--                   (amortização e juros em linhas separadas, fonte 'emprestimo', tiny_key 'emp:<id>:<n>:a|j').

create table if not exists public.emprestimos (
  id              bigint generated always as identity primary key,
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  nome            text not null,
  credor          text,
  numero_contrato text,
  valor           numeric not null default 0,
  taxa_mes        numeric not null default 0,        -- % ao mês
  parcelas        int not null default 1,
  primeira        date,
  sistema         text not null default 'price' check (sistema in ('price', 'sac', 'outro')),
  dono            text not null default 'empresa',   -- empresa | socio | ligada (para o balanço de terceiros)
  modo            text not null default 'vincular' check (modo in ('vincular', 'gerar')),
  vinculo         text,                              -- trecho da descrição/fornecedor das parcelas no Contas a pagar
  obs             text,
  criado_em       timestamptz not null default now()
);
alter table public.emprestimos enable row level security;
drop policy if exists emprestimos_dono on public.emprestimos;
create policy emprestimos_dono on public.emprestimos for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.emprestimos to authenticated;
grant select, insert, update, delete on public.emprestimos to service_role;
