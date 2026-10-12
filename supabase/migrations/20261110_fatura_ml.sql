-- Fatura do Mercado Livre (API de faturamento): cobranças que NÃO são descontadas de uma venda — publicidade,
-- armazenagem do Full, DIFAL, mensalidade da loja — gravadas uma a uma, com o dia em que aconteceram.
-- Quem lê é a função ml-fatura (o ML aceita só 5 consultas por minuto: ela trabalha aos poucos, pelo cron).
-- O DRE soma por mês do dia da cobrança (competência exata), não pelo período quebrado da fatura.

-- tipos de cobrança conhecidos. classe: pub | full | difal | loja | outros | venda (venda = já está na venda, não lê)
create table if not exists public.ml_fatura_tipos (
  sub_type text primary key,
  rotulo text,
  classe text not null,
  visto_em timestamptz not null default now()
);
alter table public.ml_fatura_tipos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ml_fatura_tipos' and policyname = 'ml_fatura_tipos_ler') then
    create policy ml_fatura_tipos_ler on public.ml_fatura_tipos for select using (true);
  end if;
end $$;
grant select on public.ml_fatura_tipos to authenticated;
grant all on public.ml_fatura_tipos to service_role;
insert into public.ml_fatura_tipos (sub_type, rotulo, classe) values
  ('PADS', 'Campanhas de publicidade - Product Ads', 'pub'),
  ('BPAD', 'Bonificação de publicidade - Product Ads', 'pub'),
  ('CFWA', 'Armazenamento no Full', 'full'),
  ('CFBA', 'Armazenamento prolongado no Full', 'full'),
  ('CFPB', 'Custo por inconformidade nos envios ao Full', 'full'),
  ('CDIFAL', 'Diferencial de alíquota (ICMS-DIFAL)', 'difal'),
  ('CESM', 'Tarifa de manutenção da loja (eShop)', 'loja'),
  ('CV', 'Tarifa de venda', 'venda'), ('CVVPRC', 'Tarifa de venda', 'venda'), ('CVVML', 'Tarifa de venda', 'venda'),
  ('CVVFNU', 'Tarifa de venda', 'venda'), ('CVVFN', 'Tarifa de venda', 'venda'),
  ('BVVPRC', 'Estorno de tarifa de venda', 'venda'), ('BVVML', 'Estorno de tarifa de venda', 'venda'),
  ('BVVFNU', 'Estorno de tarifa de venda', 'venda'), ('BVVFN', 'Estorno de tarifa de venda', 'venda'),
  ('CFFI', 'Tarifa de envio', 'venda'), ('CFFE', 'Tarifa de envio', 'venda'), ('BFFI', 'Estorno de envio', 'venda'), ('BFFE', 'Estorno de envio', 'venda'),
  ('CXDE', 'Tarifa de envio', 'venda'), ('BXDE', 'Estorno de envio', 'venda'),
  ('CXDED', 'Tarifa de devolução', 'venda'), ('BXDED', 'Estorno de tarifa de devolução', 'venda'), ('CXDID', 'Tarifa de devolução', 'venda'),
  ('CFONPN', 'Tarifa de venda', 'venda'), ('BFONPN', 'Estorno de tarifa de venda', 'venda'),
  ('CPYE', 'Tarifa de venda', 'venda'), ('CDSDB', 'Tarifa pela devolução', 'venda')
on conflict (sub_type) do nothing;

create table if not exists public.ml_fatura_periodos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  periodo date not null,            -- chave da fatura no ML (AAAA-MM-01)
  de date, ate date,
  total numeric, aberto numeric,
  situacao text,                    -- OPEN | CLOSED
  vencimento date,
  tipos text[],                     -- tipos fora das vendas que esta fatura tem (null = ainda não li o resumo)
  prox int not null default 0,      -- próxima linha a ler
  completo boolean not null default false,
  lido_em timestamptz,
  primary key (usuario_id, ml_user_id, periodo)
);
alter table public.ml_fatura_periodos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ml_fatura_periodos' and policyname = 'ml_fatura_periodos_dono') then
    create policy ml_fatura_periodos_dono on public.ml_fatura_periodos for select using (usuario_id = auth.uid());
  end if;
end $$;
grant select on public.ml_fatura_periodos to authenticated;
grant all on public.ml_fatura_periodos to service_role;

create table if not exists public.ml_fatura_linhas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  detail_id bigint not null,
  periodo date not null,
  dia date not null,                -- dia em que a cobrança aconteceu (competência)
  quando timestamp,
  sub_type text not null,
  valor numeric not null,           -- cobrança positiva, bonificação negativa
  descricao text,
  bonifica bigint,                  -- cobrança que esta bonificação anula
  primary key (usuario_id, ml_user_id, detail_id)
);
create index if not exists ml_fatura_linhas_dia on public.ml_fatura_linhas (usuario_id, ml_user_id, dia);
alter table public.ml_fatura_linhas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ml_fatura_linhas' and policyname = 'ml_fatura_linhas_dono') then
    create policy ml_fatura_linhas_dono on public.ml_fatura_linhas for select using (usuario_id = auth.uid());
  end if;
end $$;
grant select on public.ml_fatura_linhas to authenticated;
grant all on public.ml_fatura_linhas to service_role;

drop trigger if exists demo_so_leitura on public.ml_fatura_periodos;
create trigger demo_so_leitura before insert or update or delete on public.ml_fatura_periodos for each row execute function demo.bloqueia();
drop trigger if exists demo_so_leitura on public.ml_fatura_linhas;
create trigger demo_so_leitura before insert or update or delete on public.ml_fatura_linhas for each row execute function demo.bloqueia();

-- soma por mês e classe, para o DRE (p_conta null = todas as contas)
create or replace function public.ml_fatura_mes(p_ano int, p_conta text default null)
returns table (mes int, classe text, valor numeric, linhas bigint)
language sql stable security definer set search_path to 'public' as $$
  select extract(month from l.dia)::int, coalesce(t.classe, 'outros'), round(sum(l.valor), 2), count(*)
  from public.ml_fatura_linhas l left join public.ml_fatura_tipos t on t.sub_type = l.sub_type
  where l.usuario_id = auth.uid() and (p_conta is null or l.ml_user_id = p_conta)
    and l.dia >= make_date(p_ano, 1, 1) and l.dia <= make_date(p_ano, 12, 31) and coalesce(t.classe, 'outros') <> 'venda'
  group by 1, 2
$$;
revoke all on function public.ml_fatura_mes(int, text) from public, anon;
grant execute on function public.ml_fatura_mes(int, text) to authenticated;

-- situação da leitura: por conta, até que dia há cobrança lida e quantas faturas faltam
create or replace function public.ml_fatura_situacao()
returns table (ml_user_id text, faturas bigint, pendentes bigint, lido_ate date, lido_em timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select p.ml_user_id, count(*), count(*) filter (where not p.completo),
         (select max(l.dia) from public.ml_fatura_linhas l where l.usuario_id = auth.uid() and l.ml_user_id = p.ml_user_id), max(p.lido_em)
  from public.ml_fatura_periodos p where p.usuario_id = auth.uid() group by 1
$$;
revoke all on function public.ml_fatura_situacao() from public, anon;
grant execute on function public.ml_fatura_situacao() to authenticated;

-- detalhe de um mês por tipo de cobrança (tela de conferência)
create or replace function public.ml_fatura_detalhe(p_de date, p_ate date, p_conta text default null)
returns table (classe text, sub_type text, rotulo text, valor numeric, linhas bigint)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(t.classe, 'outros'), l.sub_type, coalesce(t.rotulo, max(l.descricao)), round(sum(l.valor), 2), count(*)
  from public.ml_fatura_linhas l left join public.ml_fatura_tipos t on t.sub_type = l.sub_type
  where l.usuario_id = auth.uid() and (p_conta is null or l.ml_user_id = p_conta) and l.dia between p_de and p_ate
  group by 1, 2, t.rotulo
$$;
revoke all on function public.ml_fatura_detalhe(date, date, text) from public, anon;
grant execute on function public.ml_fatura_detalhe(date, date, text) to authenticated;
