-- NOTAS FISCAIS RECEBIDAS (19/10/2026): consulta à SEFAZ (Distribuição de DF-e, Ambiente Nacional) com o certificado
-- A1 de cada loja. Função de borda: nfe. Só consulta: nada é lançado sozinho.
--
-- Certificado: o .pfx e a senha ficam cifrados (AES-GCM, chave NFE_CERT_KEY só na função). A tabela não tem nenhuma
-- política para o usuário: nem o navegador consegue ler. A tela vê só os dados públicos pela RPC nfe_certificados_meus.
create table if not exists public.nfe_certificados (
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  cnpj         text not null,
  loja         text,                         -- ml_user_id da loja deste CNPJ
  titular      text,
  validade     timestamptz,
  pfx          text not null,                -- cifrado (base64)
  senha        text not null,                -- cifrada (base64)
  criado_em    timestamptz not null default now(),
  primary key (usuario_id, cnpj)
);
alter table public.nfe_certificados enable row level security;
revoke all on public.nfe_certificados from anon, authenticated;

create or replace function public.nfe_certificados_meus()
returns table (cnpj text, loja text, titular text, validade timestamptz, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select cnpj, loja, titular, validade, criado_em from nfe_certificados where usuario_id = auth.uid() order by criado_em
$$;
grant execute on function public.nfe_certificados_meus() to authenticated;

-- onde parou a consulta de cada CNPJ (NSU) e até quando a SEFAZ pediu para esperar
create table if not exists public.nfe_dist (
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  cnpj          text not null,
  ult_nsu       text not null default '000000000000000',
  max_nsu       text,
  esperar_ate   timestamptz,
  consultado_em timestamptz,
  status        text,                        -- última resposta (cStat e motivo)
  primary key (usuario_id, cnpj)
);
alter table public.nfe_dist enable row level security;
drop policy if exists nfe_dist_ler on public.nfe_dist;
create policy nfe_dist_ler on public.nfe_dist for select to authenticated using (usuario_id = auth.uid());
grant select on public.nfe_dist to authenticated;

-- uma linha por nota recebida (resumo; com a nota completa depois da Ciência, os itens e as duplicatas)
create table if not exists public.nfe_recebidas (
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  chave        text not null,
  cnpj_dest    text not null,
  loja         text,
  nsu          text,
  emit_cnpj    text,
  emit_nome    text,
  emit_ie      text,
  emissao      timestamptz,
  valor        numeric,
  tipo         smallint,                     -- 0 entrada, 1 saída (do ponto de vista do emitente)
  situacao     smallint,                     -- 1 autorizada, 2 denegada, 3 cancelada
  completa     boolean not null default false,
  ciencia_em   timestamptz,
  itens        jsonb,
  duplicatas   jsonb,
  xml_path     text,                         -- XML completo compactado no Storage (nfe/<usuario>/<chave>.xml.gz)
  importada    jsonb,                        -- o que foi feito com a nota (ordem de compra, contas, estoque)
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, chave)
);
create index if not exists nfe_recebidas_emissao on public.nfe_recebidas (usuario_id, emissao desc);
alter table public.nfe_recebidas enable row level security;
drop policy if exists nfe_recebidas_ler on public.nfe_recebidas;
create policy nfe_recebidas_ler on public.nfe_recebidas for select to authenticated using (usuario_id = auth.uid());
drop policy if exists nfe_recebidas_marcar on public.nfe_recebidas;
create policy nfe_recebidas_marcar on public.nfe_recebidas for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, update (importada, atualizado_em) on public.nfe_recebidas to authenticated;

-- cron (pg_cron em UTC): 07:13, 11:13, 15:13 e 19:13 de Brasília. Mesmo formato do ml-envios (copia o comando dele).
select cron.schedule('nfe-dist', '13 10,14,18,22 * * *', replace((select command from cron.job where jobname = 'ml-envios'), 'ml-envios', 'nfe'));

-- XML completo das notas (privado)
insert into storage.buckets (id, name, public) values ('nfe', 'nfe', false) on conflict (id) do nothing;

select 1 ok;

-- a função nfe grava com service_role: sem este grant dava 42501 ao guardar o certificado
grant select, insert, update, delete on public.nfe_certificados, public.nfe_dist, public.nfe_recebidas, public.fornecedores to service_role;


-- UF (código IBGE) do CNPJ de cada certificado: a Distribuição pede cUFAutor
alter table public.nfe_certificados add column if not exists uf text;
-- 1 consulta por dia (07:13 de Brasília); a mesma execução repete enquanto houver mais de 50 documentos
select cron.alter_job((select jobid from cron.job where jobname='nfe-dist'), schedule := '13 10 * * *');


-- continuação: a cada 10 min, só enquanto algum CNPJ tiver fila (ult_nsu < max_nsu) e a SEFAZ não pediu espera
select cron.schedule('nfe-dist-continua', '*/10 * * * *', 'select case when exists (select 1 from public.nfe_dist where max_nsu is not null and ult_nsu < max_nsu and (esperar_ate is null or esperar_ate < now())) then (' || rtrim(replace((select command from cron.job where jobname = 'nfe-dist'), 'SELECT ', 'select '), ';') || ') end');


-- o usuário lê (baixa) o XML das próprias notas: nfe/<usuario>/<chave>.xml.gz
drop policy if exists nfe_xml_ler on storage.objects;
create policy nfe_xml_ler on storage.objects for select to authenticated using (bucket_id = 'nfe' and (storage.foldername(name))[1] = auth.uid()::text);

