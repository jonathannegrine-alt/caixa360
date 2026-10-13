-- ADMINISTRAÇÃO: valor combinado com cada conta e crédito pré-pago de IA
-- assinaturas.valor_combinado: o que foi negociado com a pessoa (nulo = vale o valor calculado). É o que aparece para ela
--   em "Minha assinatura" depois do teste grátis.
-- ia_recargas: histórico das recargas de crédito de IA (pacote pré-pago). O saldo fica em pos_venda_cfg.credito (reais),
--   que a função pos-venda já debita a cada caso analisado; pos_venda_cfg.gasto acumula o consumo.
alter table public.assinaturas add column if not exists valor_combinado numeric;
create table if not exists public.ia_recargas (
  id bigint generated always as identity primary key, usuario_id uuid not null, valor numeric not null, nota text, em timestamptz not null default now());
alter table public.ia_recargas enable row level security;
grant usage, select on sequence public.ia_recargas_id_seq to authenticated;

create or replace function public.cobranca_calc(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ped integer; v_lojas integer; v_pl record; v_ass record; v_cfg record; v_teste date; v_bruto numeric; v_tab numeric; v_desc integer := 0; v_sit text;
        v_total numeric; v_calc numeric; v_ia record; v_demo uuid := (select id from auth.users where email = 'demo@caixa360.app');
begin
  select * into v_cfg from cobranca_cfg where id = 1;
  select coalesce(sum(vendas), 0)::integer into v_ped from vendas_resumo_dia where usuario_id = p_uid and dia >= (now() at time zone 'America/Sao_Paulo')::date - 30;
  select count(*) into v_lojas from ml_tokens where usuario_id = p_uid;
  select * into v_pl from planos where ativo and (pedidos_max is null or pedidos_max >= v_ped) order by coalesce(pedidos_max, 2147483647) limit 1;
  select * into v_ass from assinaturas where usuario_id = p_uid;
  v_teste := (v_ass.teste_inicio + make_interval(days => v_cfg.teste_dias))::date;
  v_tab := coalesce(v_pl.preco, 0) + greatest(v_lojas - coalesce(v_pl.lojas, 1), 0) * coalesce(v_pl.loja_extra, 0);
  if v_cfg.modo = 'custo' then
    -- pedidos de todas as contas que têm loja conectada (a demonstração fica de fora)
    select coalesce(sum(r.vendas), 0) into v_total from vendas_resumo_dia r
     where r.dia >= (now() at time zone 'America/Sao_Paulo')::date - 30 and r.usuario_id is distinct from v_demo
       and exists (select 1 from ml_tokens t where t.usuario_id = r.usuario_id);
    v_bruto := case when v_total > 0 and v_lojas > 0 then round(v_cfg.custo_usd * v_cfg.cambio * v_ped / v_total, 2) else 0 end;
  else v_bruto := v_tab; end if;
  if v_ass.usuario_id is not null and v_ass.desconto_pct > 0 and (v_ass.desconto_ate is null or v_ass.desconto_ate >= current_date) then v_desc := v_ass.desconto_pct; end if;
  v_sit := case when v_lojas = 0 then 'sem loja' when coalesce(v_ass.cortesia, false) then 'cortesia' when v_ass.teste_inicio is null then 'aguardando acesso'
                when current_date <= v_teste then 'teste' when v_desc >= 100 then 'cupom' when v_desc > 0 then 'desconto' else 'a cobrar' end;
  v_calc := round(v_bruto * (100 - v_desc) / 100.0, 2);
  select liberado, credito, gasto into v_ia from pos_venda_cfg where usuario_id = p_uid;
  return jsonb_build_object('valor_calculado', v_calc, 'valor_combinado', v_ass.valor_combinado,
    'ia_liberado', coalesce(v_ia.liberado, false), 'ia_credito', v_ia.credito, 'ia_gasto', coalesce(v_ia.gasto, 0),
    'ia_recargas', (select coalesce(sum(valor), 0) from ia_recargas where usuario_id = p_uid), 'pedidos_30d', v_ped, 'lojas', v_lojas, 'plano', v_pl.nome, 'preco_tabela', v_bruto, 'tabela_planos', v_tab, 'modo', v_cfg.modo, 'desconto_pct', v_desc,
    'a_pagar', case when v_sit in ('cortesia', 'teste', 'sem loja', 'aguardando acesso') then 0 else coalesce(v_ass.valor_combinado, v_calc) end,
    'situacao', v_sit, 'teste_ate', v_teste, 'cupom', v_ass.cupom, 'desconto_ate', v_ass.desconto_ate);
end $$;
revoke all on function public.cobranca_calc(uuid) from public, anon, authenticated;

create or replace function public.admin_valor_combinado(p_usuario uuid, p_valor numeric default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  insert into assinaturas (usuario_id, valor_combinado) values (p_usuario, p_valor)
  on conflict (usuario_id) do update set valor_combinado = excluded.valor_combinado, atualizado_em = now();
end $$;
grant execute on function public.admin_valor_combinado(uuid, numeric) to authenticated;

-- recarga de crédito de IA: soma ao saldo e libera o uso; valor negativo corrige um lançamento errado
create or replace function public.admin_ia_recarga(p_usuario uuid, p_valor numeric, p_nota text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  if coalesce(p_valor, 0) = 0 then raise exception 'Informe o valor da recarga.'; end if;
  insert into ia_recargas (usuario_id, valor, nota) values (p_usuario, p_valor, p_nota);
  insert into pos_venda_cfg (usuario_id, liberado, credito) values (p_usuario, true, greatest(p_valor, 0))
  on conflict (usuario_id) do update set liberado = true, credito = greatest(coalesce(pos_venda_cfg.credito, 0) + p_valor, 0)
  returning credito into v;
  return v;
end $$;
grant execute on function public.admin_ia_recarga(uuid, numeric, text) to authenticated;
select (select count(*) from public.ia_recargas) recargas, public.cobranca_calc('d8a29095-56ad-447a-b72f-e463df5ccf78') calc;
