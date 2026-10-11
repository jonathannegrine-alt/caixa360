-- Pós-venda com IA: reclamações, mediações e mensagens do Mercado Livre lidas pela API, analisadas por IA
-- com as regras do usuário, e resolvidas direto (quando a regra permite) ou depois da aprovação dele.

create table if not exists public.pos_venda_cfg (
  usuario_id     uuid primary key references auth.users(id) on delete cascade,
  ativo          boolean not null default false,   -- a rodada automática (cron) só roda para quem ligou
  regras         text not null default '',         -- orientação da IA: postura, regras por produto, textos prontos
  auto_msg       boolean not null default false,   -- pode enviar mensagem sozinha quando a regra manda passar direto
  auto_dinheiro  boolean not null default false,   -- pode reembolsar / liberar devolução sozinha quando a regra manda
  limite         numeric not null default 150,     -- venda acima deste valor sempre vai para a fila
  ultima_rodada  timestamptz,
  ultimo_resumo  jsonb,
  atualizado_em  timestamptz not null default now()
);
alter table public.pos_venda_cfg enable row level security;
drop policy if exists pos_venda_cfg_proprio on public.pos_venda_cfg;
create policy pos_venda_cfg_proprio on public.pos_venda_cfg for all to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
grant select, insert, update on public.pos_venda_cfg to authenticated;
grant all on public.pos_venda_cfg to service_role;

create table if not exists public.pos_venda_casos (
  id             bigserial primary key,
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  ml_user_id     text not null,
  tipo           text not null,                    -- 'reclamacao' | 'mensagem'
  ref            text not null,                    -- id da reclamação ou do pacote de mensagens
  venda          text,                             -- número da venda
  produto        text,
  sku            text,
  valor          numeric,
  estagio        text,                             -- claim | dispute (mediação) | mensagem
  motivo         text,                             -- o problema, como o ML descreve
  prazo          timestamptz,
  resumo         text,                             -- leitura da IA
  evidencia      text,
  categoria      text,                             -- reclamação / mensagem / NF / devolução / flex ...
  acao           text,                             -- mensagem_comprador | mensagem_mediador | reembolso_total | reembolso_parcial | liberar_devolucao | manual | nenhuma
  acao_texto     text,
  acao_dados     jsonb,                            -- percentual, imagem, instrução manual, ações disponíveis no ML
  caminho        text,                             -- direto | fila
  motivo_caminho text,
  situacao       text not null default 'fila',     -- fila | executado | recusado | manual_feito | sem_acao | encerrado | erro
  decisao        text,                             -- APROVADO | RECUSADO | CORRIGIDO | DIRETO
  correcao       text,
  resultado      text,
  aprendizado    text,
  ml_atualizado  text,                             -- last_updated do ML na hora da análise (evita analisar duas vezes)
  analisado_em   timestamptz,
  executado_em   timestamptz,
  criado_em      timestamptz not null default now(),
  unique (usuario_id, tipo, ref)
);
create index if not exists pos_venda_casos_fila on public.pos_venda_casos (usuario_id, situacao, prazo);
alter table public.pos_venda_casos enable row level security;
drop policy if exists pos_venda_casos_proprio on public.pos_venda_casos;
create policy pos_venda_casos_proprio on public.pos_venda_casos for select to authenticated using (auth.uid() = usuario_id);
grant select on public.pos_venda_casos to authenticated;
grant all on public.pos_venda_casos to service_role;
grant usage, select on sequence public.pos_venda_casos_id_seq to service_role;

-- registro de tudo que aconteceu em cada caso (substitui o registro-pos-venda.csv)
create table if not exists public.pos_venda_log (
  id          bigserial primary key,
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  caso_id     bigint references public.pos_venda_casos(id) on delete cascade,
  quando      timestamptz not null default now(),
  quem        text not null,                       -- ia | usuario | sistema
  o_que       text not null,
  detalhe     jsonb
);
create index if not exists pos_venda_log_caso on public.pos_venda_log (usuario_id, caso_id, quando);
alter table public.pos_venda_log enable row level security;
drop policy if exists pos_venda_log_proprio on public.pos_venda_log;
create policy pos_venda_log_proprio on public.pos_venda_log for select to authenticated using (auth.uid() = usuario_id);
grant select on public.pos_venda_log to authenticated;
grant all on public.pos_venda_log to service_role;
grant usage, select on sequence public.pos_venda_log_id_seq to service_role;

-- imagens de apoio que a IA pode anexar (ex.: passo a passo de um produto): pasta <usuario_id>/
insert into storage.buckets (id, name, public) values ('pos-venda', 'pos-venda', false) on conflict (id) do nothing;
drop policy if exists "pos-venda do usuario" on storage.objects;
create policy "pos-venda do usuario" on storage.objects for all to authenticated
  using (bucket_id = 'pos-venda' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'pos-venda' and (storage.foldername(name))[1] = auth.uid()::text);
