-- Olist API v3 (aplicativo OAuth): usada para as ORDENS DE COMPRA, que a API v2 (token fixo) não tem.
-- O usuário cria um aplicativo no Olist (Configurações → Aplicativos API), cola Client ID e Client Secret
-- aqui e autoriza. O acesso vale 4 horas e a renovação 1 dia: o cron "olist-token" renova a cada 2 horas.

alter table public.olist_config alter column token drop not null;   -- quem usa só a v3 não tem token v2
alter table public.olist_config add column if not exists client_id     text;
alter table public.olist_config add column if not exists client_secret text;
alter table public.olist_config add column if not exists oauth_state   text;
alter table public.olist_config add column if not exists access_token  text;
alter table public.olist_config add column if not exists refresh_token text;
alter table public.olist_config add column if not exists expira_em     timestamptz;
alter table public.olist_config add column if not exists v3_em         timestamptz;   -- quando autorizou
alter table public.olist_config add column if not exists v3_erro       text;

-- o navegador grava as chaves e o "state", mas só consegue ler as datas e o erro (nunca chave nem token)
grant select (v3_em, v3_erro) on public.olist_config to authenticated;
grant update (client_id, client_secret, oauth_state, v3_erro) on public.olist_config to authenticated;

-- ordens de compra do Olist, com os itens (guardadas para não buscar o detalhe toda vez)
create table if not exists public.olist_ordens (
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  id            bigint not null,
  numero        text,
  data          date,
  data_prevista date,
  situacao      int,             -- 0 em aberto · 1 atendido · 2 cancelado · 3 em andamento
  fornecedor    text,
  total         numeric,
  itens         jsonb,           -- [{ sku, descricao, qtd, valor }]
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, id)
);
alter table public.olist_ordens enable row level security;
drop policy if exists olist_ordens_dono on public.olist_ordens;
create policy olist_ordens_dono on public.olist_ordens for select to authenticated using (usuario_id = auth.uid());
grant select on public.olist_ordens to authenticated;
grant select, insert, update, delete on public.olist_ordens to service_role;

-- conferência de chegada feita no Caixa 360: cada linha é uma quantidade recebida de um item de uma ordem
create table if not exists public.compras_recebimentos (
  id            bigint generated always as identity primary key,
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  ordem_id      bigint not null,          -- id da ordem no Olist
  sku           text not null,
  qtd           numeric not null,
  recebido_em   timestamptz not null default now(),
  obs           text
);
create index if not exists compras_recebimentos_ordem on public.compras_recebimentos (usuario_id, ordem_id);
alter table public.compras_recebimentos enable row level security;
drop policy if exists compras_recebimentos_dono on public.compras_recebimentos;
create policy compras_recebimentos_dono on public.compras_recebimentos for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, delete on public.compras_recebimentos to authenticated;
grant select, insert, update, delete on public.compras_recebimentos to service_role;

-- o Client ID nao e segredo: o navegador precisa dele para montar o endereco de autorizacao
grant select (client_id) on public.olist_config to authenticated;

-- se a chegada somou no estoque do galpao (false = chegada antiga, ja contada na lista importada)
alter table public.compras_recebimentos add column if not exists somou boolean not null default true;
