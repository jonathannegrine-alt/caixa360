-- Reprocessar/nivelar custo e imposto também por tipo de envio (Full, coleta e agência, Flex); empréstimo com valor liberado (IOF em linha própria).
drop function if exists public.vendas_ml_ajustar(date, date, text, text, text, numeric, text, numeric, boolean, boolean);
CREATE OR REPLACE FUNCTION public.vendas_ml_ajustar(p_de date, p_ate date, p_sku text DEFAULT NULL::text, p_conta text DEFAULT NULL::text, p_custo_modo text DEFAULT 'nada'::text, p_custo numeric DEFAULT NULL::numeric, p_imp_modo text DEFAULT 'nada'::text, p_imposto numeric DEFAULT NULL::numeric, p_so_vazias boolean DEFAULT false, p_simular boolean DEFAULT false, p_envio text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'não autenticado'; end if;
  if p_custo_modo = 'valor' and p_custo is null then raise exception 'informe o custo'; end if;
  if p_imp_modo = 'valor' and p_imposto is null then raise exception 'informe o imposto'; end if;

  create temp table _alvo on commit drop as
  select v.ctid as id,
         case when p_custo_modo = 'valor' then p_custo when p_custo_modo = 'cadastro' then nullif(k.custo, 0) end as c,
         case when p_imp_modo = 'valor' then p_imposto when p_imp_modo = 'cadastro' then nullif(k.imposto, 0) end as i,
         -- mexe no custo / no imposto desta venda?
         (p_custo_modo = 'limpar' or p_custo_modo = 'valor' or (p_custo_modo = 'cadastro' and k.custo > 0))
           and (not p_so_vazias or v.custo_unit is null) as fc,
         (p_imp_modo = 'limpar' or p_imp_modo = 'valor' or (p_imp_modo = 'cadastro' and k.imposto > 0))
           and (not p_so_vazias or v.imposto_pct is null) as fi,
         v.custo_unit as c0, v.imposto_pct as i0
    from public.vendas_ml v
    left join lateral (select s.custo, s.imposto from public.skus s
                        where s.usuario_id = uid and upper(trim(s.sku)) = upper(trim(v.sku)) limit 1) k on true
   where v.usuario_id = uid
     and v.data_venda >= (p_de::timestamp at time zone 'America/Sao_Paulo')
     and v.data_venda <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
     and (coalesce(p_sku, '') = '' or upper(trim(v.sku)) = upper(trim(p_sku)))
     and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
     -- tipo de envio: full | ag (coleta e agência) | flex
     and (coalesce(p_envio, '') = '' or (p_envio = 'full' and v.logistic_type = 'fulfillment') or (p_envio = 'flex' and v.logistic_type = 'self_service')
          or (p_envio = 'ag' and coalesce(v.logistic_type, '') not in ('fulfillment', 'self_service')));

  delete from _alvo a
   where not ( (coalesce(a.fc, false) and a.c is distinct from a.c0) or (coalesce(a.fi, false) and a.i is distinct from a.i0) );
  select count(*) into n from _alvo;
  if p_simular or n = 0 then return n; end if;

  update public.vendas_ml v
     set custo_unit  = case when coalesce(a.fc, false) then a.c else v.custo_unit  end,
         imposto_pct = case when coalesce(a.fi, false) then a.i else v.imposto_pct end,
         custo_manual = case when coalesce(a.fc, false) then (p_custo_modo = 'valor') else v.custo_manual end
    from _alvo a
   where v.ctid = a.id and v.usuario_id = uid;
  get diagnostics n = row_count;
  return n;
end $function$
;
grant execute on function public.vendas_ml_ajustar(date, date, text, text, text, numeric, text, numeric, boolean, boolean, text) to authenticated;
alter table public.emprestimos add column if not exists valor_liberado numeric;
