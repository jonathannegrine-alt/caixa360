-- FATURA DO ML: guardar só os totais das faturas fechadas
-- O DRE e a conciliação só usam a soma por dia e por tipo de cobrança. As linhas (44 mil, 12 MB) só são necessárias
-- enquanto a fatura está aberta, porque ela é relida do começo e a regravação é por linha. Fatura FECHADA e lida por
-- inteiro vira total em ml_fatura_totais e as linhas dela são apagadas (ml_fatura_compactar, cron diário 02:10 BRT).
create table if not exists public.ml_fatura_totais (
  usuario_id uuid not null, ml_user_id text not null, periodo date not null, dia date not null, sub_type text not null,
  valor numeric not null default 0, linhas bigint not null default 0, descricao text,
  primary key (usuario_id, ml_user_id, periodo, dia, sub_type));
alter table public.ml_fatura_totais enable row level security;
drop policy if exists ml_fatura_totais_ler on public.ml_fatura_totais;
create policy ml_fatura_totais_ler on public.ml_fatura_totais for select to authenticated using (usuario_id = auth.uid());
grant select on public.ml_fatura_totais to authenticated;
alter table public.ml_fatura_periodos add column if not exists compactado boolean not null default false;

create or replace function public.ml_fatura_compactar() returns integer
language plpgsql security definer set search_path = public as $$
declare p record; n integer := 0;
begin
  for p in select usuario_id, ml_user_id, periodo from ml_fatura_periodos
            where situacao = 'CLOSED' and completo and lido_ok and not compactado order by periodo limit 60 loop
    insert into ml_fatura_totais (usuario_id, ml_user_id, periodo, dia, sub_type, valor, linhas, descricao)
    select l.usuario_id, l.ml_user_id, l.periodo, l.dia, l.sub_type, sum(l.valor), count(*), max(l.descricao)
      from ml_fatura_linhas l where l.usuario_id = p.usuario_id and l.ml_user_id = p.ml_user_id and l.periodo = p.periodo
     group by 1, 2, 3, 4, 5
    on conflict (usuario_id, ml_user_id, periodo, dia, sub_type) do update set valor = excluded.valor, linhas = excluded.linhas, descricao = excluded.descricao;
    delete from ml_fatura_linhas l where l.usuario_id = p.usuario_id and l.ml_user_id = p.ml_user_id and l.periodo = p.periodo;
    update ml_fatura_periodos set compactado = true where usuario_id = p.usuario_id and ml_user_id = p.ml_user_id and periodo = p.periodo;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ml_fatura_compactar() from public, anon, authenticated;

-- leitura: linhas (fatura aberta) + totais (faturas fechadas)
create or replace view public.ml_fatura_tudo with (security_invoker = false) as
  select usuario_id, ml_user_id, dia, sub_type, valor, 1::bigint as linhas, descricao from public.ml_fatura_linhas
  union all
  select usuario_id, ml_user_id, dia, sub_type, valor, linhas, descricao from public.ml_fatura_totais;
revoke all on public.ml_fatura_tudo from public, anon, authenticated;

create or replace function public.ml_fatura_detalhe(p_de date, p_ate date, p_conta text default null)
returns table(classe text, sub_type text, rotulo text, valor numeric, linhas bigint)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(t.classe, 'outros'), l.sub_type, coalesce(t.rotulo, max(l.descricao)), round(sum(l.valor), 2), sum(l.linhas)::bigint
  from public.ml_fatura_tudo l left join public.ml_fatura_tipos t on t.sub_type = l.sub_type
  where l.usuario_id = auth.uid() and (p_conta is null or l.ml_user_id = p_conta) and l.dia between p_de and p_ate
  group by 1, 2, t.rotulo
$$;

create or replace function public.ml_fatura_mes(p_ano integer, p_conta text default null)
returns table(mes integer, classe text, valor numeric, linhas bigint)
language sql stable security definer set search_path to 'public' as $$
  select extract(month from l.dia)::int, coalesce(t.classe, 'outros'), round(sum(l.valor), 2), sum(l.linhas)::bigint
  from public.ml_fatura_tudo l left join public.ml_fatura_tipos t on t.sub_type = l.sub_type
  where l.usuario_id = auth.uid() and (p_conta is null or l.ml_user_id = p_conta)
    and l.dia >= make_date(p_ano, 1, 1) and l.dia <= make_date(p_ano, 12, 31) and coalesce(t.classe, 'outros') <> 'venda'
  group by 1, 2
$$;

create or replace function public.ml_fatura_situacao()
returns table(ml_user_id text, faturas bigint, pendentes bigint, faltam bigint, lido_ate date, lido_em timestamp with time zone)
language sql stable security definer set search_path to 'public' as $$
  select p.ml_user_id, count(*), count(*) filter (where not p.completo), count(*) filter (where not p.lido_ok),
         (select max(l.dia) from public.ml_fatura_tudo l where l.usuario_id = auth.uid() and l.ml_user_id = p.ml_user_id), max(p.lido_em)
  from public.ml_fatura_periodos p where p.usuario_id = auth.uid() group by 1
$$;
-- cron: select cron.schedule('ml-fatura-compactar', '10 5 * * *', 'select public.ml_fatura_compactar()');
select 1 ok;
