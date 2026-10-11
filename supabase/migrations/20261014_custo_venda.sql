-- Custo e imposto de UMA venda (sem mexer no cadastro do produto nem nas outras vendas).
create or replace function public.vendas_ml_custo_venda(p_pedido text, p_sku text, p_custo numeric default null, p_imposto numeric default null)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'não autenticado'; end if;
  update public.vendas_ml v
     set custo_unit = coalesce(p_custo, v.custo_unit), imposto_pct = coalesce(p_imposto, v.imposto_pct)
   where v.usuario_id = uid and v.order_id::text = p_pedido
     and (coalesce(trim(p_sku), '') = '' or upper(trim(v.sku)) = upper(trim(p_sku)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vendas_ml_custo_venda(text, text, numeric, numeric) from public, anon;
grant execute on function public.vendas_ml_custo_venda(text, text, numeric, numeric) to authenticated;
