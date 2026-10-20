-- LUCRO REAL POR ANÚNCIO (20/10/2026): custos medidos por venda, fora da margem de contribuição.
--  * comissão de afiliados: cada cobrança da fatura (classe 'afil', ex.: CVAF) aponta para a venda e o anúncio.
--    ml-fatura grava aqui (as linhas da fatura viram totais por dia e perdem a venda quando a fatura fecha).
--  * devoluções: vendas_ml_cobr (tarifa de devolução e frete de ida das vendas canceladas), já por venda.
-- Armazenagem, coleta e retirada do Full NÃO entram: a fatura não diz o produto (só seria possível estimar).
create table if not exists public.vendas_ml_afil (
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  ml_user_id  text not null,
  detail_id   bigint not null,
  order_id    bigint,
  item_id     text,
  dia         date not null,
  sub_type    text,
  valor       numeric not null,
  primary key (usuario_id, ml_user_id, detail_id)
);
create index if not exists vendas_ml_afil_dia on public.vendas_ml_afil (usuario_id, dia);
alter table public.vendas_ml_afil enable row level security;
drop policy if exists vendas_ml_afil_ler on public.vendas_ml_afil;
create policy vendas_ml_afil_ler on public.vendas_ml_afil for select to authenticated using (usuario_id = auth.uid());
grant select on public.vendas_ml_afil to authenticated;
grant select, insert, update, delete on public.vendas_ml_afil to service_role;

-- custos por anúncio no período (pelo dia da cobrança): afiliados e devoluções
create or replace function public.vendas_ml_lucro_extras(p_de date, p_ate date, p_conta text default null)
returns table (item_id text, ml_user_id text, afil numeric, dev numeric)
language sql stable security definer set search_path = public as $$
  with a as (
    select coalesce(f.item_id, v.item_id) item_id, f.ml_user_id, sum(f.valor) afil
      from vendas_ml_afil f left join vendas_ml v on v.usuario_id = f.usuario_id and v.order_id = f.order_id
     where f.usuario_id = auth.uid() and f.dia between p_de and p_ate and (p_conta is null or f.ml_user_id = p_conta)
     group by 1, 2
  ), d as (
    select v.item_id, c.ml_user_id, sum(c.valor) dev
      from vendas_ml_cobr c join vendas_ml v on v.usuario_id = c.usuario_id and v.order_id = c.order_id
     where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and (p_conta is null or c.ml_user_id = p_conta)
     group by 1, 2
  )
  select coalesce(a.item_id, d.item_id), coalesce(a.ml_user_id, d.ml_user_id), coalesce(a.afil, 0), coalesce(d.dev, 0)
    from a full join d on d.item_id = a.item_id and d.ml_user_id = a.ml_user_id
   where coalesce(a.item_id, d.item_id) is not null
$$;
grant execute on function public.vendas_ml_lucro_extras(date, date, text) to authenticated;

select 1 ok;
