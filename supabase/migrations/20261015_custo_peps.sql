-- CUSTO POR LOTE (PEPS: primeiro que entra, primeiro que sai)
-- Cada produto (componente) tem uma fila de lotes: o lote inicial (estoque na data de partida, ao custo do cadastro)
-- e depois uma chegada de ordem de compra por lote, ao preço da ordem. As vendas feitas a partir da data de partida
-- consomem a fila na ordem; o custo de cada venda é o do lote de onde a unidade saiu. Kits somam os componentes.
-- Lançar uma chegada com atraso (com a data certa) reordena a fila e o recálculo corrige as vendas.

create table if not exists public.custo_peps_cfg (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  desde timestamptz not null,
  ativo boolean not null default true
);
create table if not exists public.custo_lotes (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  sku_norm text generated always as (lower(btrim(sku))) stored,
  data timestamptz not null default now(),
  qtd numeric not null,
  custo_unit numeric not null,
  origem text not null default 'inicial',      -- inicial | manual
  obs text,
  criado_em timestamptz not null default now()
);
create index if not exists custo_lotes_sku on public.custo_lotes (usuario_id, sku_norm, data);
alter table public.custo_peps_cfg enable row level security;
alter table public.custo_lotes enable row level security;
do $$ declare t text; begin
  foreach t in array array['custo_peps_cfg', 'custo_lotes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_dono', t);
    execute format('create policy %I on public.%I for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', t || '_dono', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- venda com custo digitado à mão: o PEPS não regrava (mas a unidade continua contando na fila)
alter table public.vendas_ml add column if not exists custo_manual boolean not null default false;
-- chegada com data informada (lançamento com atraso)
alter table public.compras_recebimentos alter column recebido_em set default now();

-- monta as tabelas temporárias _lot (fila de lotes, com faixa acumulada) e _con (consumo das vendas por componente)
create or replace function public._custo_peps_montar(uid uuid, d timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  drop table if exists _lot; drop table if exists _con;
  create temp table _lot on commit drop as
  with l as (
    select c.sku_norm, c.sku, c.data, 0 as ordem, c.id, c.qtd, c.custo_unit as custo, c.origem, c.obs as ref
      from custo_lotes c where c.usuario_id = uid and c.qtd > 0
    union all
    select lower(btrim(r.sku)), r.sku, r.recebido_em, 1, r.id, r.qtd, (j.i->>'valor')::numeric, 'compra', 'OC ' || coalesce(o.numero, o.id::text)
      from compras_recebimentos r
      join olist_ordens o on o.usuario_id = r.usuario_id and o.id = r.ordem_id
      cross join lateral (select x as i from jsonb_array_elements(case when jsonb_typeof(o.itens) = 'array' then o.itens else '[]'::jsonb end) x
                           where lower(btrim(x->>'sku')) = lower(btrim(r.sku)) limit 1) j
     where r.usuario_id = uid and r.recebido_em >= d and r.qtd > 0 and coalesce((j.i->>'valor')::numeric, 0) > 0
  )
  select l.*, sum(l.qtd) over w - l.qtd as de, sum(l.qtd) over w as ate,
         row_number() over (partition by l.sku_norm order by l.data desc, l.ordem desc, l.id desc) = 1 as ultimo
    from l window w as (partition by l.sku_norm order by l.data, l.ordem, l.id rows between unbounded preceding and current row);

  create temp table _con on commit drop as
  with base as (
    select v.order_id, v.data_venda, v.qtd, lower(btrim(v.sku)) as s
      from vendas_ml v
     where v.usuario_id = uid and v.data_venda >= d and v.status is distinct from 'cancelled' and v.qtd > 0 and coalesce(btrim(v.sku), '') <> ''
  ), ex as (
    select b.order_id, b.data_venda, b.qtd, coalesce(k.comp, b.s) as comp, b.qtd * coalesce(k.qty, 1) as un
      from base b
      left join (select lower(btrim(sku_comercial)) as kit, lower(btrim(sku_componente)) as comp, sum(qty) as qty
                   from sku_composicao where usuario_id = uid group by 1, 2) k on k.kit = b.s
  )
  select e.order_id, e.qtd, e.comp, e.un, sum(e.un) over w - e.un as de, sum(e.un) over w as ate
    from ex e window w as (partition by e.comp order by e.data_venda, e.order_id rows between unbounded preceding and current row);
end $$;
revoke all on function public._custo_peps_montar(uuid, timestamptz) from public, anon, authenticated;

-- regrava o custo das vendas feitas desde a data de partida. Devolve quantas vendas mudaram.
create or replace function public.custo_peps_recalcular(p_usuario uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(auth.uid(), p_usuario); d timestamptz; n integer;
begin
  if uid is null then return 0; end if;
  select c.desde into d from custo_peps_cfg c where c.usuario_id = uid and c.ativo;
  if d is null then return 0; end if;
  perform _custo_peps_montar(uid, d);

  with fim as (select sku_norm, max(ate) as ate, max(custo) filter (where ultimo) as custo from _lot group by 1),
  pc as (
    select c.order_id, c.qtd,
           case when f.sku_norm is null then null else
             coalesce((select sum((least(c.ate, l.ate) - greatest(c.de, l.de)) * l.custo) from _lot l
                        where l.sku_norm = c.comp and l.de < c.ate and l.ate > c.de), 0)
             + greatest(0, c.ate - greatest(c.de, f.ate)) * f.custo      -- acabou a fila: segue no custo do último lote
           end as custo
      from _con c left join fim f on f.sku_norm = c.comp
  ),
  por as (select order_id, round(sum(custo) / max(qtd), 4) as cu from pc group by order_id having bool_and(custo is not null))
  update vendas_ml v set custo_unit = p.cu
    from por p
   where v.usuario_id = uid and v.order_id = p.order_id and not v.custo_manual and p.cu > 0 and v.custo_unit is distinct from p.cu;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.custo_peps_recalcular(uuid) from public, anon;
grant execute on function public.custo_peps_recalcular(uuid) to authenticated, service_role;

-- situação da fila: cada lote com quanto já foi consumido e quanto resta
create or replace function public.custo_peps_lotes()
returns table(sku text, sku_norm text, data timestamptz, origem text, ref text, lote_id bigint, qtd numeric, custo numeric, consumido numeric, restante numeric, vendido numeric)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d timestamptz;
begin
  if uid is null then return; end if;
  select c.desde into d from custo_peps_cfg c where c.usuario_id = uid;
  if d is null then return; end if;
  perform _custo_peps_montar(uid, d);
  return query
    select l.sku, l.sku_norm, l.data, l.origem, l.ref, l.id, l.qtd, l.custo,
           least(l.ate, coalesce(t.un, 0)) - least(l.de, coalesce(t.un, 0)),
           l.qtd - (least(l.ate, coalesce(t.un, 0)) - least(l.de, coalesce(t.un, 0))),
           coalesce(t.un, 0)
      from _lot l left join (select comp, max(ate) as un from _con group by 1) t on t.comp = l.sku_norm
     order by l.sku_norm, l.data, l.ordem, l.id;
end $$;
revoke all on function public.custo_peps_lotes() from public, anon;
grant execute on function public.custo_peps_lotes() to authenticated;

-- carimbar (roda a cada sincronização de vendas) passa a aplicar o PEPS em seguida
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
  begin perform public.custo_peps_recalcular(uid); exception when others then null; end;
  return n;
end $$;

-- custo digitado numa venda fica marcado como manual
create or replace function public.vendas_ml_custo_venda(p_pedido text, p_sku text, p_custo numeric default null, p_imposto numeric default null)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'não autenticado'; end if;
  update public.vendas_ml v
     set custo_unit = coalesce(p_custo, v.custo_unit), imposto_pct = coalesce(p_imposto, v.imposto_pct),
         custo_manual = v.custo_manual or p_custo is not null
   where v.usuario_id = uid and v.order_id::text = p_pedido
     and (coalesce(trim(p_sku), '') = '' or upper(trim(v.sku)) = upper(trim(p_sku)));
  get diagnostics n = row_count;
  return n;
end $$;
