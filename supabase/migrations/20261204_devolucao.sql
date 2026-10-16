-- DEVOLUÇÃO E FRETE DE IDA DAS VENDAS CANCELADAS
-- Na venda cancelada depois de enviada o Mercado Livre estorna a tarifa de venda e devolve o valor ao comprador, mas
-- fica cobrando do vendedor o frete de ida (a tarifa de envio cheia: a parte do vendedor + a que o comprador pagou e
-- recebeu de volta) e, quando há devolução, a tarifa de devolução. Essas cobranças estão na fatura, ligadas à venda
-- (conferido em 16/10/2026: 25 de 25 vendas batem centavo a centavo com o relatório de conciliação).
-- A função ml-fatura lê as cobranças de cada venda cancelada (GET /billing/integration/group/ML/order/details, 20 vendas
-- por consulta) e grava aqui só as de envio e de devolução, uma linha por cobrança, no dia em que ela aconteceu.
--   tipo 'ida' = tarifa de envio e o estorno dela; 'dev' = tarifa de devolução e o estorno dela (estorno = valor negativo)
create table if not exists public.vendas_ml_cobr (
  usuario_id uuid not null, ml_user_id text not null, detail_id bigint not null, order_id bigint not null,
  dia date not null, tipo text not null check (tipo in ('ida', 'dev')), sub_type text, valor numeric not null, descricao text,
  primary key (usuario_id, ml_user_id, detail_id));
create index if not exists vendas_ml_cobr_dia on public.vendas_ml_cobr (usuario_id, dia);
create index if not exists vendas_ml_cobr_venda on public.vendas_ml_cobr (usuario_id, order_id);
alter table public.vendas_ml_cobr enable row level security;
drop policy if exists vendas_ml_cobr_ler on public.vendas_ml_cobr;
create policy vendas_ml_cobr_ler on public.vendas_ml_cobr for select to authenticated using (usuario_id = auth.uid());
grant select on public.vendas_ml_cobr to authenticated;

-- quando cada venda cancelada foi lida. As cobranças chegam aos poucos (a devolução só depois que o pacote volta, o
-- estorno às vezes semanas depois): a venda é lida até 4 vezes, com 7, 20 e 45 dias de intervalo.
create table if not exists public.vendas_ml_cobr_lida (
  usuario_id uuid not null, ml_user_id text not null, order_id bigint not null,
  lido_em timestamptz not null default now(), leituras smallint not null default 1,
  primary key (usuario_id, ml_user_id, order_id));
alter table public.vendas_ml_cobr_lida enable row level security;
drop policy if exists vendas_ml_cobr_lida_ler on public.vendas_ml_cobr_lida;
create policy vendas_ml_cobr_lida_ler on public.vendas_ml_cobr_lida for select to authenticated using (usuario_id = auth.uid());
grant select on public.vendas_ml_cobr_lida to authenticated;

-- vendas canceladas de uma conta que precisam ser lidas (a função de borda chama com a chave de serviço).
-- Envio cancelado = o pacote não saiu: não há cobrança (conferido: 194 de 194 sem cobrança).
create or replace function public.vendas_ml_cobr_pendentes(p_uid uuid, p_conta text, p_dias int default 100, p_limite int default 200)
returns table (order_id bigint)
language sql stable security definer set search_path to 'public' as $$
  select v.order_id
  from public.vendas_ml v
  left join public.vendas_ml_cobr_lida l on l.usuario_id = v.usuario_id and l.ml_user_id = v.ml_user_id and l.order_id = v.order_id
  where v.usuario_id = p_uid and v.ml_user_id = p_conta and v.status = 'cancelled'
    and coalesce(v.envio_status, '') <> 'cancelled'
    and v.data_venda > now() - make_interval(days => greatest(p_dias, 1))
    and (l.order_id is null
      or (l.leituras = 1 and l.lido_em < now() - interval '7 days')
      or (l.leituras = 2 and l.lido_em < now() - interval '20 days')
      or (l.leituras = 3 and l.lido_em < now() - interval '45 days'))
  order by l.order_id is not null, v.data_venda desc
  limit greatest(p_limite, 1)
$$;
revoke all on function public.vendas_ml_cobr_pendentes(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.vendas_ml_cobr_pendentes(uuid, text, int, int) to service_role;

-- DRE: por mês do dia da cobrança. Devolução entra sempre; frete de ida só se a venda está cancelada
-- (na venda aprovada o frete já entra pela própria venda).
create or replace function public.vendas_ml_cobr_mes(p_ano int, p_conta text default null)
returns table (mes int, ida numeric, dev numeric, vendas bigint)
language sql stable security definer set search_path to 'public' as $$
  select extract(month from c.dia)::int,
    round(coalesce(sum(c.valor) filter (where c.tipo = 'ida' and v.status = 'cancelled'), 0), 2),
    round(coalesce(sum(c.valor) filter (where c.tipo = 'dev'), 0), 2),
    count(distinct c.order_id)
  from public.vendas_ml_cobr c
  left join public.vendas_ml v on v.usuario_id = c.usuario_id and v.order_id = c.order_id
  where c.usuario_id = auth.uid() and (p_conta is null or c.ml_user_id = p_conta)
    and c.dia >= make_date(p_ano, 1, 1) and c.dia <= make_date(p_ano, 12, 31)
  group by 1
$$;
revoke all on function public.vendas_ml_cobr_mes(int, text) from public, anon;
grant execute on function public.vendas_ml_cobr_mes(int, text) to authenticated;

-- marca as vendas do lote como lidas (soma uma leitura)
create or replace function public.vendas_ml_cobr_marcar(p_uid uuid, p_conta text, p_vendas bigint[])
returns void language sql security definer set search_path to 'public' as $$
  insert into public.vendas_ml_cobr_lida (usuario_id, ml_user_id, order_id, lido_em, leituras)
  select p_uid, p_conta, x, now(), 1 from unnest(p_vendas) x
  on conflict (usuario_id, ml_user_id, order_id) do update set lido_em = now(), leituras = least(vendas_ml_cobr_lida.leituras + 1, 9)
$$;
revoke all on function public.vendas_ml_cobr_marcar(uuid, text, bigint[]) from public, anon, authenticated;
grant execute on function public.vendas_ml_cobr_marcar(uuid, text, bigint[]) to service_role;

grant select, insert, update, delete on public.vendas_ml_cobr, public.vendas_ml_cobr_lida to service_role;
