-- Conciliação: a tarifa de venda do ML inclui o custo do parcelamento que o vendedor assume
-- ("Taxa de parcelamento" menos o acréscimo pago pelo comprador). Sem isso, vendas parceladas sem juros
-- apareciam como "tarifa menor no ML" sem haver diferença nenhuma.
create or replace function public.concil_base(p_de date, p_ate date, p_conta text)
returns table (g text, vendas int, order_id text, dia date, sku text, titulo text, item_id text, logistica text, status text,
  s_prod numeric, s_tar numeric, s_fre numeric, s_fc numeric, s_flex numeric,
  tem_venda boolean, tem_envio boolean, m_bruto numeric, m_prod numeric, m_tar numeric, m_fre numeric, m_dev numeric, m_outros numeric, m_liq numeric, m_status text,
  tem_lib boolean, lib numeric, lib_em date, lib_est numeric)
language sql stable security definer set search_path to 'public' as $$
  with v as (
    select coalesce(shipping_id::text, 'o' || order_id::text) g, order_id::text o, shipping_id::text ship,
           (data_venda at time zone 'America/Sao_Paulo')::date dia, sku, titulo, item_id, logistic_type, status,
           preco_unit * qtd prod, coalesce(tarifa, 0) tar, coalesce(frete_vendedor, 0) fv, coalesce(frete_comprador, 0) fc, coalesce(frete_flex, 0) flex
    from public.vendas_ml
    where usuario_id = auth.uid() and ml_user_id = p_conta
      and data_venda >= (p_de::timestamp at time zone 'America/Sao_Paulo') and data_venda < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), grp as (
    select g, count(*)::int vendas, min(o) order_id, min(dia) dia, min(sku) sku, min(titulo) titulo, min(item_id) item_id, min(logistic_type) logistica,
           case when bool_and(status = 'cancelled') then 'cancelled' else max(status) filter (where status <> 'cancelled') end status,
           sum(prod) filter (where status <> 'cancelled') s_prod, sum(tar) filter (where status <> 'cancelled') s_tar,
           sum(fv) filter (where status <> 'cancelled') s_fre, sum(fc) filter (where status <> 'cancelled') s_fc, sum(flex) filter (where status <> 'cancelled') s_flex
    from v group by g
  ), refs as (
    select g, o ref from v union select g, ship from v where ship is not null
  ), lv as (
    select r.g, bool_or(l.tipo = 'Venda' and l.bruto <> 0) tem_venda, bool_or(l.t_envio <> 0) tem_envio,
           sum(l.bruto) m_bruto, sum(l.bruto - l.env_comp - l.parc_comp) m_prod, sum(l.t_venda + l.t_mp + l.t_parcel - l.parc_comp) m_tar,
           sum(l.t_envio) t_envio, sum(l.env_comp) env_comp, sum(l.t_dev) m_dev, sum(l.t_outros) m_outros, sum(l.liquido) m_liq,
           max(l.status) m_status
    from refs r join public.concil_linhas l on l.usuario_id = auth.uid() and l.ml_user_id = p_conta and l.ref = r.ref and l.origem = 'v'
    group by r.g
  ), ll as (
    select r.g, sum(l.liquido) lib, max(l.data) lib_em, coalesce(sum(l.liquido) filter (where l.tipo like 'Estorno%'), 0) lib_est
    from refs r join public.concil_linhas l on l.usuario_id = auth.uid() and l.ml_user_id = p_conta and l.ref = r.ref and l.origem = 'l'
    group by r.g
  )
  select grp.g, grp.vendas, grp.order_id, grp.dia, grp.sku, grp.titulo, grp.item_id, grp.logistica, grp.status,
         coalesce(grp.s_prod, 0), coalesce(grp.s_tar, 0), coalesce(grp.s_fre, 0), coalesce(grp.s_fc, 0), coalesce(grp.s_flex, 0),
         coalesce(lv.tem_venda, false), coalesce(lv.tem_envio, false), lv.m_bruto, lv.m_prod, lv.m_tar,
         -- sem a linha da venda no arquivo (venda de um mês, frete cobrado no outro), o frete do comprador vem do sistema
         case when lv.g is null then null when lv.tem_venda then lv.t_envio - lv.env_comp else lv.t_envio - lv.env_comp - coalesce(grp.s_fc, 0) end,
         lv.m_dev, lv.m_outros, lv.m_liq, lv.m_status,
         ll.g is not null, ll.lib, ll.lib_em, ll.lib_est
  from grp left join lv on lv.g = grp.g left join ll on ll.g = grp.g
$$;
