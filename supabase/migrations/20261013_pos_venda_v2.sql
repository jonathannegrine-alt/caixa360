-- Pós-venda v2: horários programados, liberação por usuário (crédito) e chave de IA própria.

alter table public.pos_venda_cfg
  add column if not exists horarios jsonb,                      -- ["08:00","11:00",...] horário de Brasília; vazio = toda execução do cron
  add column if not exists liberado boolean not null default false,  -- o dono do sistema liberou o uso da IA do servidor
  add column if not exists credito  numeric,                    -- saldo em reais; null = sem limite
  add column if not exists gasto    numeric not null default 0; -- quanto já consumiu (estimativa)

-- o usuário altera as próprias regras e chaves de automação, mas NÃO a liberação nem o crédito
revoke insert, update on public.pos_venda_cfg from authenticated;
grant insert (usuario_id, ativo, regras, auto_msg, auto_dinheiro, limite, horarios, atualizado_em) on public.pos_venda_cfg to authenticated;
grant update (ativo, regras, auto_msg, auto_dinheiro, limite, horarios, atualizado_em) on public.pos_venda_cfg to authenticated;

-- chave da Anthropic do próprio usuário: só o servidor lê
create table if not exists public.pos_venda_segredos (
  usuario_id    uuid primary key references auth.users(id) on delete cascade,
  chave         text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.pos_venda_segredos enable row level security;
revoke all on public.pos_venda_segredos from anon, authenticated;
grant all on public.pos_venda_segredos to service_role;
