-- 1) GRUPOS DE CONTAS: várias contas do Mercado Livre no mesmo login.
--    Cada dado vindo do ML passa a guardar de qual conta veio (ml_user_id; '' = sem conta / importação manual).
-- 2) CUSTO POR VENDA: custo unitário e % de imposto ficam gravados em cada venda (valor da época).
--    Mudar o custo no cadastro vale dali para frente; "Reprocessar"/"Nivelar" alteram o passado de propósito.

-- ── contas ────────────────────────────────────────────────────────────────────
alter table public.ml_tokens add column if not exists apelido text;
alter table public.ml_tokens alter column ml_user_id set not null;
alter table public.ml_tokens drop constraint if exists ml_tokens_pkey;
alter table public.ml_tokens add primary key (usuario_id, ml_user_id);

alter table public.liberacoes        add column if not exists ml_user_id text not null default '';
alter table public.extrato_historico add column if not exists ml_user_id text not null default '';
alter table public.snapshots_ml      add column if not exists ml_user_id text not null default '';
alter table public.vendas_ml         add column if not exists ml_user_id text not null default '';
alter table public.vendas_ml_dias    add column if not exists ml_user_id text not null default '';

-- o que já existe pertence à única conta que cada usuário tinha
update public.liberacoes x        set ml_user_id = t.ml_user_id from public.ml_tokens t where x.usuario_id = t.usuario_id and x.ml_user_id = '';
update public.extrato_historico x set ml_user_id = t.ml_user_id from public.ml_tokens t where x.usuario_id = t.usuario_id and x.ml_user_id = '';
update public.snapshots_ml x      set ml_user_id = t.ml_user_id from public.ml_tokens t where x.usuario_id = t.usuario_id and x.ml_user_id = '';
update public.vendas_ml x         set ml_user_id = t.ml_user_id from public.ml_tokens t where x.usuario_id = t.usuario_id and x.ml_user_id = '';
update public.vendas_ml_dias x    set ml_user_id = t.ml_user_id from public.ml_tokens t where x.usuario_id = t.usuario_id and x.ml_user_id = '';

alter table public.extrato_historico drop constraint if exists extrato_historico_usuario_id_data_key;
alter table public.extrato_historico drop constraint if exists extrato_historico_usuario_conta_data_key;
alter table public.extrato_historico add constraint extrato_historico_usuario_conta_data_key unique (usuario_id, ml_user_id, data);

alter table public.vendas_ml_dias drop constraint if exists vendas_ml_dias_pkey;
alter table public.vendas_ml_dias add primary key (usuario_id, ml_user_id, dia);

create index if not exists vendas_ml_usuario_conta_data on public.vendas_ml (usuario_id, ml_user_id, data_venda desc);
create index if not exists liberacoes_usuario_conta on public.liberacoes (usuario_id, ml_user_id, data);

-- ── custo por venda ───────────────────────────────────────────────────────────
alter table public.vendas_ml add column if not exists custo_unit  numeric;   -- null = ainda não carimbado
alter table public.vendas_ml add column if not exists imposto_pct numeric;   -- null = ainda não carimbado
alter table public.vendas_ml add column if not exists sku_fixo boolean not null default false;  -- SKU definido à mão (Nivelar SKU): a sincronização não troca

-- ── view de cálculo (recriada: colunas novas) ─────────────────────────────────
drop view if exists public.vendas_ml_calc;
create view public.vendas_ml_calc with (security_invoker = true) as
select
  v.*,
  v.order_id::text                                   as order_txt,
  coalesce(v.pack_id::text, '')                      as pack_txt,
  (v.data_venda at time zone 'America/Sao_Paulo')::date as dia,
  case v.status when 'paid' then 'aprovada' when 'cancelled' then 'cancelada' else 'pendente' end as situacao,
  case v.logistic_type
    when 'fulfillment' then 'Full' when 'self_service' then 'Flex' when 'cross_docking' then 'Coleta'
    when 'drop_off' then 'Agência' when 'xd_drop_off' then 'Places' else 'Outros' end as envio,
  case v.listing_type
    when 'gold_pro' then 'Premium' when 'gold_premium' then 'Premium' when 'gold_special' then 'Clássico'
    when 'free' then 'Grátis' else coalesce(v.listing_type, '—') end as modalidade,
  round(v.preco_unit * v.qtd, 2)                     as bruto,
  -- custo/imposto: o valor carimbado na venda; enquanto não houver, o cadastro atual
  round(c.cu * v.qtd, 2)                             as custo,
  round(v.preco_unit * v.qtd * c.ip / 100, 2)        as imposto,
  c.cu > 0                                           as tem_custo,
  c.ip > 0                                           as tem_imposto,
  round(v.preco_unit * v.qtd - c.cu * v.qtd - v.preco_unit * v.qtd * c.ip / 100
        - v.tarifa - coalesce(v.frete_vendedor, 0), 2) as mc,
  case when v.preco_unit * v.qtd > 0 then
    round((v.preco_unit * v.qtd - c.cu * v.qtd - v.preco_unit * v.qtd * c.ip / 100
          - v.tarifa - coalesce(v.frete_vendedor, 0)) / (v.preco_unit * v.qtd) * 100, 2)
  else 0 end                                         as mc_pct
from public.vendas_ml v
left join lateral (
  select k.custo, k.imposto from public.skus k
  where k.usuario_id = v.usuario_id and upper(trim(k.sku)) = upper(trim(v.sku))
  limit 1
) s on true
cross join lateral (
  select coalesce(v.custo_unit, s.custo, 0) as cu, coalesce(v.imposto_pct, s.imposto, 0) as ip
) c;
grant select on public.vendas_ml_calc to authenticated;

-- ── consultas (com filtro de conta) ───────────────────────────────────────────
drop function if exists public.vendas_ml_totais(date, date, text, text, text, text, text, text);
drop function if exists public.vendas_ml_ranking(date, date, text);
drop function if exists public.vendas_ml_por_dia(date, date);

create or replace function public.vendas_ml_totais(
  p_de date, p_ate date,
  p_pedido text default null, p_titulo text default null, p_sku text default null,
  p_modalidade text default null, p_envio text default null, p_custo text default null,
  p_conta text default null
) returns jsonb language sql stable security invoker as $$
  with base as (
    select * from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.dia between p_de and p_ate
      and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
      and (coalesce(p_pedido, '') = '' or c.order_txt like '%' || p_pedido || '%' or c.pack_txt like '%' || p_pedido || '%')
      and (coalesce(p_titulo, '') = '' or c.titulo ilike '%' || p_titulo || '%' or c.item_id ilike '%' || p_titulo || '%')
      and (coalesce(p_sku, '') = '' or c.sku ilike '%' || p_sku || '%')
      and (coalesce(p_modalidade, '') = '' or c.modalidade = p_modalidade)
      and (coalesce(p_envio, '') = '' or c.envio = p_envio)
      and (coalesce(p_custo, '') = ''
           or (p_custo = 'sem-custo'   and not c.tem_custo)
           or (p_custo = 'sem-imposto' and not c.tem_imposto)
           or (p_custo = 'sem-um'      and (not c.tem_custo or not c.tem_imposto))
           or (p_custo = 'sem-ambos'   and not c.tem_custo and not c.tem_imposto))
  )
  select jsonb_build_object(
    'linhas', (select count(*) from base),
    'aprov', (select jsonb_build_object(
        'qtd', count(*), 'un', coalesce(sum(qtd), 0), 'bruto', coalesce(sum(bruto), 0),
        'frete_comp', coalesce(sum(frete_comprador), 0), 'frete_vend', coalesce(sum(frete_vendedor), 0),
        'tarifa', coalesce(sum(tarifa), 0), 'custo', coalesce(sum(custo), 0), 'imposto', coalesce(sum(imposto), 0),
        'mc', coalesce(sum(mc), 0),
        'sem_custo', count(*) filter (where not tem_custo or not tem_imposto),
        'sem_frete', count(*) filter (where frete_vendedor is null))
      from base where situacao = 'aprovada'),
    'canc', (select jsonb_build_object('qtd', count(*), 'un', coalesce(sum(qtd), 0),
        'valor', coalesce(sum(bruto + coalesce(frete_comprador, 0)), 0))
      from base where situacao = 'cancelada'),
    'pend', (select count(*) from base where situacao = 'pendente'),
    'por_envio', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select envio, count(*) as qtd, coalesce(sum(bruto), 0) as bruto, coalesce(sum(frete_comprador), 0) as frete_comp
        from base where situacao = 'aprovada' group by envio) x),
    'envios_todos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select envio, count(*) as qtd from base group by envio) x)
  );
$$;
grant execute on function public.vendas_ml_totais(date, date, text, text, text, text, text, text, text) to authenticated;

-- Ranking de produtos (vendas aprovadas), por SKU ou por anúncio — base do "Consolidado"
create or replace function public.vendas_ml_ranking(p_de date, p_ate date, p_grupo text default 'sku', p_conta text default null)
returns table (chave text, titulo text, un bigint, vendas bigint, bruto numeric, custo numeric, mc numeric, mc_pct numeric)
language sql stable security invoker as $$
  select
    case when p_grupo = 'mlb' then coalesce(c.item_id, '(sem MLB)') else coalesce(nullif(c.sku, ''), '(sem SKU)') end as chave,
    max(c.titulo) as titulo, sum(c.qtd)::bigint as un, count(*)::bigint as vendas,
    sum(c.bruto) as bruto, sum(c.custo) as custo, sum(c.mc) as mc,
    case when sum(c.bruto) > 0 then round(sum(c.mc) / sum(c.bruto) * 100, 2) else 0 end as mc_pct
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao = 'aprovada'
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  group by 1
  order by sum(c.bruto) desc
  limit 1000;
$$;
grant execute on function public.vendas_ml_ranking(date, date, text, text) to authenticated;

-- Série diária (Início, gráfico comparativo de Vendas)
create or replace function public.vendas_ml_por_dia(p_de date, p_ate date, p_conta text default null)
returns table (dia date, vendas bigint, un bigint, bruto numeric, frete_comp numeric, mc numeric)
language sql stable security invoker as $$
  select c.dia, count(*)::bigint, coalesce(sum(c.qtd), 0)::bigint, coalesce(sum(c.bruto), 0),
         coalesce(sum(c.frete_comprador), 0), coalesce(sum(c.mc), 0)
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between p_de and p_ate and c.situacao = 'aprovada'
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  group by c.dia order by c.dia;
$$;
grant execute on function public.vendas_ml_por_dia(date, date, text) to authenticated;

-- Resumo mensal para o DRE (aprovadas e canceladas por mês)
create or replace function public.vendas_ml_por_mes(p_ano integer, p_conta text default null)
returns table (mes integer, faturamento numeric, canceladas numeric, imposto numeric, frete_vendedor numeric,
               custo numeric, tarifa numeric, vendas bigint)
language sql stable security invoker as $$
  select extract(month from c.dia)::integer as mes,
    coalesce(sum(c.bruto), 0)                                                                               as faturamento,   -- aprovadas + canceladas, sem frete do comprador
    coalesce(sum(c.bruto) filter (where c.situacao = 'cancelada'), 0)                                       as canceladas,
    coalesce(sum(c.imposto) filter (where c.situacao = 'aprovada'), 0)                                      as imposto,
    coalesce(sum(coalesce(c.frete_vendedor, 0)) filter (where c.situacao = 'aprovada'), 0)                  as frete_vendedor,
    coalesce(sum(c.custo) filter (where c.situacao = 'aprovada'), 0)                                        as custo,
    coalesce(sum(c.tarifa) filter (where c.situacao = 'aprovada'), 0)                                       as tarifa,
    count(*) filter (where c.situacao = 'aprovada')::bigint                                                 as vendas
  from public.vendas_ml_calc c
  where c.usuario_id = auth.uid() and c.dia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and c.situacao in ('aprovada', 'cancelada')
    and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  group by 1 order by 1;
$$;
grant execute on function public.vendas_ml_por_mes(integer, text) to authenticated;

-- ── custo por venda: carimbar / reprocessar / nivelar ─────────────────────────
-- Carimba o custo e o imposto do cadastro nas vendas que ainda não têm valor gravado.
-- p_usuario só é aceito quando chamado pelo servidor (service_role); o usuário carimba as próprias vendas.
create or replace function public.vendas_ml_carimbar(p_usuario uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(auth.uid(), p_usuario); n integer;
begin
  if uid is null then return 0; end if;
  update public.vendas_ml v
     set custo_unit  = case when v.custo_unit  is null and k.custo   > 0 then k.custo   else v.custo_unit  end,
         imposto_pct = case when v.imposto_pct is null and k.imposto > 0 then k.imposto else v.imposto_pct end
    from public.skus k
   where v.usuario_id = uid and k.usuario_id = uid and upper(trim(k.sku)) = upper(trim(v.sku))
     and ((v.custo_unit is null and k.custo > 0) or (v.imposto_pct is null and k.imposto > 0));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vendas_ml_carimbar(uuid) from public, anon;
grant execute on function public.vendas_ml_carimbar(uuid) to authenticated, service_role;

-- Reprocessar: regrava custo/imposto das vendas do período com o cadastro atual.
create or replace function public.vendas_ml_reprocessar(p_de date, p_ate date, p_sku text default null, p_conta text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'não autenticado'; end if;
  update public.vendas_ml v
     set custo_unit = nullif(k.custo, 0), imposto_pct = nullif(k.imposto, 0)
    from public.skus k
   where v.usuario_id = uid and k.usuario_id = uid and upper(trim(k.sku)) = upper(trim(v.sku))
     and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
     and (coalesce(p_sku, '') = '' or upper(trim(v.sku)) = upper(trim(p_sku)))
     and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vendas_ml_reprocessar(date, date, text, text) from public, anon;
grant execute on function public.vendas_ml_reprocessar(date, date, text, text) to authenticated;

-- Nivelar: grava nas vendas do SKU, no período, o custo e/ou o imposto informados (null = não mexe).
create or replace function public.vendas_ml_nivelar(p_de date, p_ate date, p_sku text, p_custo numeric default null, p_imposto numeric default null, p_conta text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'não autenticado'; end if;
  if coalesce(trim(p_sku), '') = '' then raise exception 'informe o SKU'; end if;
  update public.vendas_ml v
     set custo_unit = coalesce(p_custo, v.custo_unit), imposto_pct = coalesce(p_imposto, v.imposto_pct)
   where v.usuario_id = uid and upper(trim(v.sku)) = upper(trim(p_sku))
     and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
     and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vendas_ml_nivelar(date, date, text, numeric, numeric, text) from public, anon;
grant execute on function public.vendas_ml_nivelar(date, date, text, numeric, numeric, text) to authenticated;

-- Nivelar SKU: aplica um SKU em todas as vendas de um anúncio (MLB).
create or replace function public.vendas_ml_nivelar_sku(p_mlb text, p_sku text)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'não autenticado'; end if;
  if coalesce(trim(p_mlb), '') = '' or coalesce(trim(p_sku), '') = '' then raise exception 'informe o anúncio e o SKU'; end if;
  update public.vendas_ml v set sku = trim(p_sku), sku_fixo = true
   where v.usuario_id = uid and upper(v.item_id) = upper(trim(p_mlb));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vendas_ml_nivelar_sku(text, text) from public, anon;
grant execute on function public.vendas_ml_nivelar_sku(text, text) to authenticated;
