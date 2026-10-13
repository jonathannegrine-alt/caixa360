-- 1) DIÁRIO DE SAÚDE DO SERVIDOR
-- A cada 10 min grava um retrato leve do banco (cron 'sistema-saude', SQL puro): rotinas que falharam, conexões,
-- pendências do resumo, tarefas na fila e tamanho do banco. Serve para conferir a folga antes de uma operação pesada
-- e para ver, depois de uma queda, quando começou. Guarda 30 dias.
create table if not exists public.sistema_saude (
  em timestamptz primary key default now(),
  cron_falhas integer, cron_lentas integer, conexoes integer, resumo_pend integer, tarefas_fila integer, banco_mb integer);
alter table public.sistema_saude enable row level security;   -- sem políticas: só administração

create or replace function public.sistema_saude_gravar() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sistema_saude (cron_falhas, cron_lentas, conexoes, resumo_pend, tarefas_fila, banco_mb)
  select (select count(*) from cron.job_run_details d where d.start_time > now() - interval '10 minutes' and d.status = 'failed'),
         (select count(*) from cron.job_run_details d where d.start_time > now() - interval '10 minutes' and d.end_time - d.start_time > interval '5 seconds'),
         (select count(*) from pg_stat_activity),
         (select count(*) from vendas_resumo_pend),
         (select count(*) from tarefas where status in ('fila', 'rodando')),
         (pg_database_size(current_database()) / 1048576)::integer;
  delete from sistema_saude where em < now() - interval '30 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end $$;
revoke all on function public.sistema_saude_gravar() from public, anon, authenticated;
-- cron: select cron.schedule('sistema-saude', '*/10 * * * *', 'select public.sistema_saude_gravar()');

-- 2) RESUMO DE MERCADO, SEM IDENTIFICAR A CONTA
-- Para estudar sazonalidade e produtos: por mês e por produto (título do anúncio), quanto vendeu e quanto deu de
-- margem. A conta vira um número ("conta 1, 2, 3"); não entram comprador, número do anúncio nem SKU.
-- Só administração lê (sem políticas). Meses fechados não mudam; o mês atual e o anterior são refeitos todo dia.
create table if not exists public.mercado_contas (
  n integer generated always as identity primary key, usuario_id uuid not null, ml_user_id text not null, unique (usuario_id, ml_user_id));
create table if not exists public.mercado_resumo (
  conta_n integer not null, mes date not null, produto text not null,
  vendas bigint not null default 0, un bigint not null default 0, bruto numeric not null default 0, mc numeric not null default 0,
  canceladas bigint not null default 0, com_custo boolean not null default false,
  primary key (conta_n, mes, produto));
alter table public.mercado_contas enable row level security;
alter table public.mercado_resumo enable row level security;

create or replace function public.mercado_resumo_refazer(p_desde date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_de date := coalesce(p_desde, (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month')::date); n integer;
        v_demo uuid := (select id from auth.users where email = 'demo@caixa360.app');
begin
  insert into mercado_contas (usuario_id, ml_user_id)
  select distinct v.usuario_id, v.ml_user_id from vendas_ml v
   where v.ml_user_id is not null and v.usuario_id is distinct from v_demo on conflict do nothing;
  delete from mercado_resumo where mes >= date_trunc('month', v_de)::date;
  insert into mercado_resumo (conta_n, mes, produto, vendas, un, bruto, mc, canceladas, com_custo)
  select k.n, date_trunc('month', c.dia)::date, left(coalesce(nullif(trim(c.titulo), ''), '(sem título)'), 200),
         count(*) filter (where c.situacao = 'aprovada'), coalesce(sum(c.qtd) filter (where c.situacao = 'aprovada'), 0),
         coalesce(sum(c.bruto) filter (where c.situacao = 'aprovada'), 0), coalesce(sum(c.mc) filter (where c.situacao = 'aprovada'), 0),
         count(*) filter (where c.situacao = 'cancelada'), bool_and(c.tem_custo)
    from vendas_ml_calc c join mercado_contas k on k.usuario_id = c.usuario_id and k.ml_user_id = c.ml_user_id
   where c.dia >= date_trunc('month', v_de)::date and c.situacao in ('aprovada', 'cancelada')
   group by 1, 2, 3;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mercado_resumo_refazer(date) from public, anon, authenticated;
-- cron: select cron.schedule('mercado-resumo', '40 5 * * *', 'select public.mercado_resumo_refazer()');
select 1 ok;
