-- Central de promoções e conferência de frete.

-- Dados de cada anúncio para calcular a margem numa promoção: SKU, título, foto, custo e imposto mais recentes,
-- e a tarifa (% do preço) e o frete por unidade observados nas vendas dos últimos 60 dias.
create or replace function public.ml_itens_margem(p_itens text[], p_conta text default null)
returns table (item_id text, sku text, titulo text, thumbnail text, custo numeric, imposto_pct numeric, tarifa_pct numeric, frete_un numeric, vendas bigint, preco_medio numeric)
language sql stable as $$
  with v as (
    select c.* from public.vendas_ml_calc c
    where c.usuario_id = auth.uid() and c.item_id = any(p_itens) and c.situacao = 'aprovada'
      and c.dia >= (current_date - 60) and (coalesce(p_conta, '') = '' or c.ml_user_id = p_conta)
  ),
  ult as (select distinct on (item_id) item_id, sku, titulo, thumbnail, custo_unit, imposto_pct from v order by item_id, data_venda desc)
  select u.item_id, u.sku, u.titulo, u.thumbnail, u.custo_unit, u.imposto_pct,
         (select case when sum(x.preco_unit * x.qtd) > 0 then sum(x.tarifa) / sum(x.preco_unit * x.qtd) end from v x where x.item_id = u.item_id),
         (select case when sum(x.qtd) > 0 then sum(coalesce(x.frete_vendedor, 0)) / sum(x.qtd) end from v x where x.item_id = u.item_id),
         (select count(*) from v x where x.item_id = u.item_id),
         (select round(avg(x.preco_unit), 2) from v x where x.item_id = u.item_id)
  from ult u
$$;
grant execute on function public.ml_itens_margem(text[], text) to authenticated;

-- Conferência de frete. Compara cada venda com as vizinhas DO MESMO anúncio, mesma quantidade e mesma faixa de preço
-- (envios com um item só; Flex fica de fora porque o frete é do transportador).
--   isoladas: a venda cobrou um frete diferente e as vendas de antes e de depois cobraram o mesmo valor entre si
--             ("100 vendas a R$ 20, uma a R$ 28, a seguinte a R$ 20 de novo").
--   mudancas: o frete mudou e continuou no valor novo (reajuste de tabela ou mudança de peso/medida no cadastro do ML).
create or replace function public.frete_conferencia(p_de date, p_ate date, p_conta text default null)
returns jsonb language sql stable as $$
  with base as (
    select v.order_id, v.item_id, v.sku, v.titulo, v.qtd, v.preco_unit, v.frete_vendedor as frete, v.logistic_type, v.data_venda, v.ml_user_id, v.shipping_id,
           count(*) over (partition by v.shipping_id) as itens_no_envio,
           case when v.preco_unit * v.qtd >= 79 then 4 when v.preco_unit * v.qtd >= 50 then 3 when v.preco_unit * v.qtd >= 29 then 2 else 1 end as faixa
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and v.status = 'paid' and v.shipping_id is not null and v.item_id is not null
      and coalesce(v.frete_vendedor, 0) > 0 and coalesce(v.logistic_type, '') <> 'self_service'
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between (p_de - 20) and p_ate
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
  ),
  s as (
    select b.*, (b.data_venda at time zone 'America/Sao_Paulo')::date as dia,
           lag(b.frete) over w as antes, lead(b.frete) over w as depois, lag(b.frete, 2) over w as antes2, lead(b.frete, 2) over w as depois2,
           count(*) over (partition by b.ml_user_id, b.item_id, b.qtd, b.faixa) as n_grupo
    from base b where b.itens_no_envio = 1
    window w as (partition by b.ml_user_id, b.item_id, b.qtd, b.faixa order by b.data_venda)
  ),
  iso as (
    select * from s where dia >= p_de and antes is not null and depois is not null
      and antes = depois and abs(frete - antes) >= 0.5 and n_grupo >= 5
      and (antes2 is null or antes2 = antes or depois2 is null or depois2 = depois)
  ),
  mud as (
    select * from s where dia >= p_de and antes is not null and depois is not null
      and abs(frete - antes) >= 0.5 and frete = depois and (antes2 is null or antes2 = antes) and n_grupo >= 5
  ),
  mud_dia as (select dia, count(distinct item_id) as itens from mud group by 1),
  ativos as (select count(distinct item_id) as n from s where dia >= p_de)
  select jsonb_build_object(
    'conferidas', (select count(*) from s where dia >= p_de),
    'anuncios', (select n from ativos),
    'isoladas', (select coalesce(jsonb_agg(x order by x.data_venda desc), '[]'::jsonb) from (
        select order_id, item_id, sku, titulo, qtd, preco_unit, frete, antes as esperado, round(frete - antes, 2) as dif, data_venda, ml_user_id, logistic_type from iso order by data_venda desc limit 400) x),
    'mudancas', (select coalesce(jsonb_agg(x order by x.data_venda desc), '[]'::jsonb) from (
        select m.order_id, m.item_id, m.sku, m.titulo, m.qtd, m.preco_unit, m.antes as de, m.frete as para, round(m.frete - m.antes, 2) as dif, m.data_venda, m.ml_user_id, m.logistic_type,
               d.itens as itens_no_dia, (d.itens::numeric / greatest(1, (select n from ativos)) >= 0.25) as geral
        from mud m join mud_dia d using (dia) order by m.data_venda desc limit 400) x)
  )
$$;
grant execute on function public.frete_conferencia(date, date, text) to authenticated;

-- "já conferi": marca uma ocorrência como vista (fica só para quem marcou)
create table if not exists public.frete_conferidos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint not null,
  em timestamptz not null default now(),
  primary key (usuario_id, order_id)
);
alter table public.frete_conferidos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'frete_conferidos' and policyname = 'frete_conferidos_dono') then
    create policy frete_conferidos_dono on public.frete_conferidos for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
  end if;
end $$;

-- Frete atual de cada produto (valor mais frequente nas últimas vendas de 1 unidade, envio com um item só, R$ 79 ou mais),
-- para comparar produtos que usam a mesma embalagem.
create or replace function public.frete_por_sku(p_conta text default null)
returns table (sku text, titulo text, ml_user_id text, logistic_type text, frete numeric, vendas bigint, ultima date)
language sql stable as $$
  with base as (
    select v.sku, v.titulo, v.ml_user_id, v.logistic_type, v.frete_vendedor as frete, v.data_venda,
           count(*) over (partition by v.shipping_id) as itens_no_envio
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and v.status = 'paid' and v.shipping_id is not null and coalesce(v.sku, '') <> ''
      and coalesce(v.frete_vendedor, 0) > 0 and coalesce(v.logistic_type, '') <> 'self_service'
      and v.qtd = 1 and v.preco_unit >= 79 and v.data_venda >= now() - interval '45 days'
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
  )
  select b.sku, max(b.titulo), b.ml_user_id, b.logistic_type, mode() within group (order by b.frete), count(*), max((b.data_venda at time zone 'America/Sao_Paulo')::date)
  from base b where b.itens_no_envio = 1 group by b.sku, b.ml_user_id, b.logistic_type having count(*) >= 3
$$;
grant execute on function public.frete_por_sku(text) to authenticated;
