-- BAIXA AUTOMÁTICA DO ESTOQUE DO GALPÃO (19/10/2026)
-- Antes a baixa das vendas enviadas só acontecia no navegador, ao abrir a página Estoque (esoBaixarVendas). Agora o
-- banco baixa sozinho no instante em que a venda ganha enviado_em (aviso da coleta do ML ou conferência ml-envios).
-- Mesma regra da tela:
--   * mapeamento de SKU (configuracoes.cfg.comprasCfg.equivalentes: de → para × mult) e depois o kit aberto nos
--     componentes (sku_composicao);
--   * depósito próprio ativo da loja da venda (lojas vazio = todas), o de menor id;
--   * só baixa o que saiu DEPOIS do último acerto do produto (carga inicial ou contagem; a hora vem da referência
--     "planilha-AAAA-MM-DDTHH:MM", em UTC, ou da gravação). Produto sem acerto não baixa.
--   * cada pedido baixa uma vez cada produto (índice estoque_mov_unica): repetir não duplica.
-- Diferença da tela: o acerto vale sem limite de data (a tela só olhava 40 dias).

create or replace function public.estoque_baixar_vendas(p_uid uuid, p_orders text[] default null, p_dias integer default 12)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with eqv as (
    select distinct on (lower(btrim(e->>'de'))) lower(btrim(e->>'de')) de, btrim(e->>'para') para,
           case when coalesce(e->>'mult', '') ~ '^[0-9]+([.,][0-9]+)?$' and replace(e->>'mult', ',', '.')::numeric > 0 then replace(e->>'mult', ',', '.')::numeric else 1 end mult
      from configuracoes c, jsonb_array_elements(case when jsonb_typeof(c.cfg->'comprasCfg'->'equivalentes') = 'array' then c.cfg->'comprasCfg'->'equivalentes' else '[]'::jsonb end) e
     where c.usuario_id = p_uid and coalesce(btrim(e->>'de'), '') <> '' and coalesce(btrim(e->>'para'), '') <> ''
  ), v as (
    select v.order_id::text ref, v.sku sku_venda, v.enviado_em, v.ml_user_id,
           coalesce(q.para, btrim(v.sku)) sku, (coalesce(v.qtd, 0) * coalesce(q.mult, 1))::numeric qtd
      from vendas_ml v left join eqv q on q.de = lower(btrim(v.sku))
     where v.usuario_id = p_uid and v.enviado_em is not null and v.status is distinct from 'cancelled'
       and coalesce(v.logistic_type, '') <> 'fulfillment' and coalesce(btrim(v.sku), '') <> '' and coalesce(v.qtd, 0) > 0
       and (p_orders is null or v.order_id = any(p_orders::bigint[])) and (p_orders is not null or v.enviado_em > now() - make_interval(days => p_dias))
  ), comp as (
    select v.ref, v.enviado_em, v.ml_user_id, coalesce(k.sku_componente, v.sku) sku,
           v.qtd * coalesce(nullif(k.qty, 0), 1) qtd,
           case when lower(btrim(coalesce(k.sku_componente, v.sku))) <> lower(btrim(v.sku_venda)) then 'Kit ' || v.sku_venda end obs
      from v left join sku_composicao k on k.usuario_id = p_uid and lower(btrim(k.sku_comercial)) = lower(btrim(v.sku))
  ), linhas as (
    select c.ref, lower(btrim(c.sku)) k, max(c.sku) sku, sum(c.qtd) qtd, max(c.obs) obs, max(c.enviado_em) enviado_em,
           (select d.id from estoque_depositos d where d.usuario_id = p_uid and d.tipo = 'proprio' and d.ativo
              and (d.lojas is null or jsonb_typeof(d.lojas) <> 'array' or jsonb_array_length(d.lojas) = 0 or d.lojas ? max(c.ml_user_id))
            order by d.id limit 1) dep
      from comp c group by c.ref, lower(btrim(c.sku))
  ), ok as (
    select l.* from linhas l
     where l.dep is not null and l.qtd > 0
       and l.enviado_em > (select max(coalesce((substring(m.ref from '(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})') || ':00+00')::timestamptz, m.criado_em))
                             from estoque_mov m where m.usuario_id = p_uid and m.deposito_id = l.dep and m.sku_norm = l.k
                              and m.motivo in ('carga_inicial', 'contagem'))
  )
  insert into estoque_mov (usuario_id, deposito_id, sku, qtd, motivo, ref, obs)
  select p_uid, dep, sku, -qtd, 'venda', ref, obs from ok
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.estoque_baixar_vendas(uuid, text[], integer) from public, anon, authenticated;

-- a tela chama esta (as do próprio usuário, enviadas nos últimos 12 dias): pega o que um aviso perdido deixou para trás
create or replace function public.estoque_baixar_minhas(p_dias integer default 12)
returns integer language sql security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else public.estoque_baixar_vendas(auth.uid(), null, least(greatest(coalesce(p_dias, 12), 1), 40)) end
$$;
grant execute on function public.estoque_baixar_minhas(integer) to authenticated;

-- gatilho: vendas que acabaram de ganhar enviado_em (ou já chegaram com ele)
create or replace function public.estoque_baixa_gatilho() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    for r in select usuario_id, array_agg(order_id::text) ids from novas where enviado_em is not null group by usuario_id loop
      perform public.estoque_baixar_vendas(r.usuario_id, r.ids);
    end loop;
  else
    for r in select n.usuario_id, array_agg(n.order_id::text) ids from novas n join antigas a on a.usuario_id = n.usuario_id and a.order_id = n.order_id
              where n.enviado_em is not null and (a.enviado_em is null or a.status is distinct from n.status or a.sku is distinct from n.sku)
              group by n.usuario_id loop
      perform public.estoque_baixar_vendas(r.usuario_id, r.ids);
    end loop;
  end if;
  return null;
exception when others then
  -- a baixa nunca pode impedir a gravação da venda; o que falhar a tela ou a próxima chamada refaz
  raise warning 'estoque_baixa_gatilho: %', sqlerrm;
  return null;
end $$;

drop trigger if exists estoque_baixa_ins on public.vendas_ml;
create trigger estoque_baixa_ins after insert on public.vendas_ml referencing new table as novas
  for each statement execute function public.estoque_baixa_gatilho();
drop trigger if exists estoque_baixa_upd on public.vendas_ml;
create trigger estoque_baixa_upd after update on public.vendas_ml referencing old table as antigas new table as novas
  for each statement execute function public.estoque_baixa_gatilho();

select 1 ok;
