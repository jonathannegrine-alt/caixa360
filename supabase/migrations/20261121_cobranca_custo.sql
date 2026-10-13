-- COBRANÇA: modo "rateio do custo" e teste grátis a partir do próximo acesso
-- cobranca_cfg (uma linha): modo 'custo' = o custo do servidor em reais é dividido entre as contas com loja conectada,
-- na proporção dos pedidos dos últimos 30 dias; modo 'tabela' = vale a tabela de planos.
-- assinaturas.teste_inicio = primeiro acesso depois desta mudança (RPC assinatura_acesso, chamada quando o sistema abre);
-- o teste grátis vale cobranca_cfg.teste_dias a partir daí. Nada é bloqueado quando o teste acaba.
create table if not exists public.cobranca_cfg (
  id integer primary key default 1 check (id = 1), modo text not null default 'custo' check (modo in ('custo', 'tabela')),
  custo_usd numeric not null default 30, cambio numeric not null default 5.5, teste_dias integer not null default 30);
insert into public.cobranca_cfg (id) values (1) on conflict do nothing;
alter table public.cobranca_cfg enable row level security;
alter table public.assinaturas add column if not exists teste_inicio timestamptz;
update public.assinaturas set cortesia = false, obs = null where obs = 'Dono do sistema';

create or replace function public.assinatura_acesso() returns void
language sql security definer set search_path = public as $$
  insert into assinaturas (usuario_id, teste_inicio) select auth.uid(), now() where auth.uid() is not null
  on conflict (usuario_id) do update set teste_inicio = coalesce(assinaturas.teste_inicio, now());
$$;
grant execute on function public.assinatura_acesso() to authenticated;

create or replace function public.cobranca_calc(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ped integer; v_lojas integer; v_pl record; v_ass record; v_cfg record; v_teste date; v_bruto numeric; v_tab numeric; v_desc integer := 0; v_sit text;
        v_total numeric; v_demo uuid := (select id from auth.users where email = 'demo@caixa360.app');
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
  return jsonb_build_object('pedidos_30d', v_ped, 'lojas', v_lojas, 'plano', v_pl.nome, 'preco_tabela', v_bruto, 'tabela_planos', v_tab, 'modo', v_cfg.modo, 'desconto_pct', v_desc,
    'a_pagar', case when v_sit in ('cortesia', 'teste', 'sem loja', 'aguardando acesso') then 0 else round(v_bruto * (100 - v_desc) / 100.0, 2) end,
    'situacao', v_sit, 'teste_ate', v_teste, 'cupom', v_ass.cupom, 'desconto_ate', v_ass.desconto_ate);
end $$;
revoke all on function public.cobranca_calc(uuid) from public, anon, authenticated;

create or replace function public.admin_cobranca_cfg(p_modo text default null, p_custo_usd numeric default null, p_cambio numeric default null, p_teste_dias integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  update cobranca_cfg set modo = coalesce(p_modo, modo), custo_usd = coalesce(p_custo_usd, custo_usd), cambio = coalesce(p_cambio, cambio), teste_dias = coalesce(p_teste_dias, teste_dias) where id = 1;
  return (select to_jsonb(c) from cobranca_cfg c where id = 1);
end $$;
grant execute on function public.admin_cobranca_cfg(text, numeric, numeric, integer) to authenticated;
select (select modo from public.cobranca_cfg) modo;
create or replace function public.admin_cfg_ler() returns jsonb language sql stable security definer set search_path = public as $$ select case when public.eh_admin() then (select to_jsonb(c) from cobranca_cfg c where id = 1) end $$;
grant execute on function public.admin_cfg_ler() to authenticated;
