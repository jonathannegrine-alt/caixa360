-- Imposto por loja: quando preenchido em vendas_cfg.imposto_pct, as vendas NOVAS da loja recebem esse percentual
-- (no lugar do imposto do cadastro do produto). Aplicar às vendas já feitas é um passo separado, pedido pelo usuário.
alter table public.vendas_cfg add column if not exists imposto_pct numeric;

create or replace function public.vendas_ml_carimbar(p_usuario uuid default null::uuid)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare uid uuid := coalesce(auth.uid(), p_usuario); n integer;
begin
  if uid is null then return 0; end if;
  -- imposto da loja primeiro; o que sobrar vazio pega o do cadastro do produto
  update public.vendas_ml v set imposto_pct = c.imposto_pct
    from public.vendas_cfg c
   where v.usuario_id = uid and c.usuario_id = uid and c.ml_user_id = v.ml_user_id and c.imposto_pct is not null and v.imposto_pct is null;
  update public.vendas_ml v
     set custo_unit  = case when v.custo_unit  is null and k.custo   > 0 then k.custo   else v.custo_unit  end,
         imposto_pct = case when v.imposto_pct is null and k.imposto > 0 then k.imposto else v.imposto_pct end
    from public.skus k
   where v.usuario_id = uid and k.usuario_id = uid and upper(trim(k.sku)) = upper(trim(v.sku))
     and ((v.custo_unit is null and k.custo > 0) or (v.imposto_pct is null and k.imposto > 0));
  get diagnostics n = row_count;
  begin perform public.custo_peps_recalcular(uid); exception when others then null; end;
  return n;
end $function$;

-- Quantas vendas da loja têm imposto diferente do informado (para mostrar antes de aplicar)
create or replace function public.vendas_ml_imposto_loja_conta(p_conta text, p_pct numeric)
returns integer language sql stable as $$
  select count(*)::int from public.vendas_ml v where v.usuario_id = auth.uid() and v.ml_user_id = p_conta and v.imposto_pct is distinct from p_pct
$$;
grant execute on function public.vendas_ml_imposto_loja_conta(text, numeric) to authenticated;

-- Grava o imposto da loja em TODAS as vendas dela (passadas também). Só roda quando o usuário pede.
create or replace function public.vendas_ml_imposto_loja(p_conta text, p_pct numeric)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null or p_pct is null or p_pct < 0 or p_pct > 60 then return 0; end if;
  update public.vendas_ml v set imposto_pct = p_pct where v.usuario_id = uid and v.ml_user_id = p_conta and v.imposto_pct is distinct from p_pct;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.vendas_ml_imposto_loja(text, numeric) to authenticated;
