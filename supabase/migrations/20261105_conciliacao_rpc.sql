-- Conciliação: compara cada venda do sistema com o que o Mercado Livre registrou nos relatórios importados.
-- A unidade é o ENVIO (uma venda, ou as vendas de um carrinho que saíram no mesmo pacote), porque o frete é
-- cobrado por envio. p_de/p_ate = data da venda.
--   tarifa de venda no ML  = "Custo por vender" + "Custo por cobrar no Mercado Pago" + "Taxa de recebimento"
--   frete do vendedor no ML = tarifas de envio menos o frete que o comprador pagou (o ML cobra o frete inteiro
--                             do vendedor e devolve a parte do comprador no valor bruto)
--   valor do produto no ML  = valor bruto menos frete do comprador e menos acréscimo de parcelamento
drop function if exists public.concil_base(date, date, text) cascade;
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
           sum(l.bruto) m_bruto, sum(l.bruto - l.env_comp - l.parc_comp) m_prod, sum(l.t_venda + l.t_mp) m_tar,
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
revoke all on function public.concil_base(date, date, text) from public, anon;
grant execute on function public.concil_base(date, date, text) to authenticated;

-- Divergências: uma linha por envio que não fechou, com os motivos.
--   canc_cobrada  venda cancelada em que o ML ficou com frete ou tarifa de devolução
--   estornada     venda paga cujo dinheiro foi liberado e estornado depois
--   nao_liberada  venda paga há mais de 20 dias (contados do fim do relatório) com menos da metade liberada
--   frete         frete cobrado diferente do que o sistema gravou
--   tarifa        tarifa de venda diferente da que o sistema gravou
--   produto       valor da venda diferente (reembolso parcial, quantidade)
--   devolucao     tarifa de devolução cobrada numa venda que continua paga
-- valor > 0 = contra você (o ML cobrou mais ou pagou menos do que o sistema esperava).
create or replace function public.concil_divergencias(p_de date, p_ate date, p_conta text)
returns table (g text, vendas int, order_id text, dia date, sku text, titulo text, item_id text, logistica text, status text, classes text[], valor numeric,
  s_prod numeric, s_tar numeric, s_fre numeric, m_prod numeric, m_tar numeric, m_fre numeric, m_dev numeric, m_liq numeric, esperado numeric, lib numeric, lib_em date, lib_est numeric)
language sql stable security definer set search_path to 'public' as $$
  with cob as (select min(data) de, max(data) ate from public.concil_linhas where usuario_id = auth.uid() and ml_user_id = p_conta and origem = 'l'),
  b as (select c.*, case when c.logistica = 'self_service' then c.s_prod - c.s_tar else c.s_prod - c.s_tar - c.s_fre end esp from public.concil_base(p_de, p_ate, p_conta) c),
  x as (
    select b.*, array_remove(array[
      case when b.status = 'cancelled' and abs(coalesce(b.m_bruto, 0)) < 0.02 and b.m_liq < -0.02 then 'canc_cobrada' end,
      case when b.status = 'paid' and b.tem_lib and b.lib_est < -0.02 and b.lib < b.esp * 0.5 then 'estornada' end,
      case when b.status = 'paid' and b.dia <= (select ate from cob) - 20 and b.dia >= (select de from cob)
                and ((b.tem_lib and b.lib_est >= -0.02 and b.lib < b.esp * 0.5) or not b.tem_lib) and b.esp > 0.5 then 'nao_liberada' end,
      case when b.status <> 'cancelled' and b.tem_envio and b.logistica <> 'self_service' and abs(b.m_fre - b.s_fre) >= 0.03 then 'frete' end,
      case when b.status = 'paid' and b.tem_venda and abs(b.m_tar - b.s_tar) >= 0.03 and abs(b.m_prod - b.s_prod) < 0.5 then 'tarifa' end,
      case when b.status <> 'cancelled' and b.tem_venda and abs(b.m_prod - b.s_prod) >= 0.5 then 'produto' end,
      case when b.status <> 'cancelled' and coalesce(b.m_dev, 0) > 0.02 then 'devolucao' end
    ], null) classes from b
  )
  select x.g, x.vendas, x.order_id, x.dia, x.sku, x.titulo, x.item_id, x.logistica, x.status, x.classes,
    round(case
      when 'canc_cobrada' = any(x.classes) then -x.m_liq
      when 'estornada' = any(x.classes) or 'nao_liberada' = any(x.classes) then x.esp - coalesce(x.lib, 0)
      else (case when 'frete' = any(x.classes) then x.m_fre - x.s_fre else 0 end) + (case when 'tarifa' = any(x.classes) then x.m_tar - x.s_tar else 0 end)
         + (case when 'produto' = any(x.classes) then (x.s_prod - x.s_tar) - (x.m_prod - x.m_tar) else 0 end) + (case when 'devolucao' = any(x.classes) then x.m_dev else 0 end)
    end, 2),
    x.s_prod, x.s_tar, x.s_fre, x.m_prod, x.m_tar, x.m_fre, x.m_dev, x.m_liq, x.esp, x.lib, x.lib_em, x.lib_est
  from x where cardinality(x.classes) > 0
  order by x.dia, x.order_id
$$;
revoke all on function public.concil_divergencias(date, date, text) from public, anon;
grant execute on function public.concil_divergencias(date, date, text) to authenticated;

-- Resumo do período: quantas vendas foram conferidas e as cobranças que não são de venda (publicidade, armazenagem
-- do Full, DIFAL, juros...), que não aparecem em venda nenhuma mas saem do seu dinheiro.
create or replace function public.concil_resumo(p_de date, p_ate date, p_conta text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with b as materialized (select * from public.concil_base(p_de, p_ate, p_conta)),
  av as (
    select tipo, coalesce(nome, tipo) nome, count(*) n, sum(case when pos <> 0 then pos else -liquido end) valor
    from public.concil_linhas where usuario_id = auth.uid() and ml_user_id = p_conta and origem = 'v' and data between p_de and p_ate and tipo not in ('Venda', 'Envio')
    group by 1, 2
  ), dias as (
    select data, tipo, sum(liquido) v, count(*) n from public.concil_linhas
    where usuario_id = auth.uid() and ml_user_id = p_conta and origem = 'l' and data between p_de and p_ate group by 1, 2
  )
  select jsonb_build_object(
    'vendas', (select count(*) from b),
    'conferidas', (select count(*) from b where m_liq is not null),
    'com_liberacao', (select count(*) from b where tem_lib),
    'canceladas', (select count(*) from b where status = 'cancelled'),
    's_prod', (select sum(s_prod) from b),
    's_tar', (select sum(s_tar) from b where tem_venda and status <> 'cancelled'), 'm_tar', (select sum(m_tar) from b where tem_venda and status <> 'cancelled'),
    's_fre', (select sum(s_fre) from b where tem_envio and status <> 'cancelled' and logistica <> 'self_service'), 'm_fre', (select sum(m_fre) from b where tem_envio and status <> 'cancelled' and logistica <> 'self_service'),
    'liberado', (select sum(lib) from b where tem_lib),
    'avulsas', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'nome', nome, 'n', n, 'valor', valor) order by valor desc) from av), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('data', data, 'tipo', tipo, 'v', v, 'n', n) order by data, tipo) from dias), '[]'::jsonb)
  )
$$;
revoke all on function public.concil_resumo(date, date, text) from public, anon;
grant execute on function public.concil_resumo(date, date, text) to authenticated;
