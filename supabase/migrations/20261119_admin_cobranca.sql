-- PAINEL DO ADMINISTRADOR E COBRANÇA (fase 1: sem pagamento real)
-- planos        faixas por pedidos/mês e número de lojas (editável pelo administrador)
-- cupons        um por pessoa, uso único, com desconto e validade
-- assinaturas   situação de cada usuário (teste de 30 dias a partir do cadastro, cupom aplicado, cortesia)
-- Só quem está em app_admin chama as funções admin_*. O usuário comum vê só a própria situação (minha_assinatura).
create table if not exists public.planos (
  id integer generated always as identity primary key, nome text not null, pedidos_max integer, lojas integer not null default 1,
  preco numeric not null default 0, loja_extra numeric not null default 10, ordem integer not null default 0, ativo boolean not null default true);
create table if not exists public.cupons (
  codigo text primary key, desconto_pct integer not null check (desconto_pct between 1 and 100), meses integer, valido_ate date,
  para_usuario uuid, nota text, usado_por uuid, usado_em timestamptz, criado_em timestamptz not null default now());
create table if not exists public.assinaturas (
  usuario_id uuid primary key, cortesia boolean not null default false, cupom text, desconto_pct integer not null default 0,
  desconto_ate date, obs text, atualizado_em timestamptz not null default now());
alter table public.planos enable row level security;
alter table public.cupons enable row level security;
alter table public.assinaturas enable row level security;
drop policy if exists planos_ler on public.planos;
create policy planos_ler on public.planos for select to authenticated using (ativo);
grant select on public.planos to authenticated;

insert into public.planos (nome, pedidos_max, lojas, preco, loja_extra, ordem)
select * from (values ('Até 500 pedidos', 500, 1, 49, 10, 1), ('Até 2.000 pedidos', 2000, 1, 99, 10, 2), ('Até 5.000 pedidos', 5000, 2, 179, 10, 3),
                      ('Até 10.000 pedidos', 10000, 2, 279, 10, 4), ('Acima de 10.000 pedidos', null, 3, 399, 10, 5)) v(nome, pedidos_max, lojas, preco, loja_extra, ordem)
where not exists (select 1 from public.planos);
insert into public.assinaturas (usuario_id, cortesia, obs)
select u.id, true, 'Dono do sistema' from auth.users u join public.app_admin a on lower(a.email) = lower(u.email) on conflict do nothing;

-- uso e preço de um usuário: pedidos (linhas de venda) nos últimos 30 dias, lojas, plano que cabe e quanto pagaria
create or replace function public.cobranca_calc(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ped integer; v_lojas integer; v_pl record; v_ass record; v_criado timestamptz; v_teste date; v_bruto numeric; v_desc integer := 0; v_sit text;
begin
  select coalesce(sum(vendas), 0)::integer into v_ped from vendas_resumo_dia where usuario_id = p_uid and dia >= (now() at time zone 'America/Sao_Paulo')::date - 30;
  select count(*) into v_lojas from ml_tokens where usuario_id = p_uid;
  select * into v_pl from planos where ativo and (pedidos_max is null or pedidos_max >= v_ped) order by coalesce(pedidos_max, 2147483647) limit 1;
  select * into v_ass from assinaturas where usuario_id = p_uid;
  select created_at into v_criado from auth.users where id = p_uid;
  v_teste := (v_criado + interval '30 days')::date;
  v_bruto := coalesce(v_pl.preco, 0) + greatest(v_lojas - coalesce(v_pl.lojas, 1), 0) * coalesce(v_pl.loja_extra, 0);
  if v_ass.usuario_id is not null and v_ass.desconto_pct > 0 and (v_ass.desconto_ate is null or v_ass.desconto_ate >= current_date) then v_desc := v_ass.desconto_pct; end if;
  v_sit := case when coalesce(v_ass.cortesia, false) then 'cortesia' when current_date <= v_teste then 'teste' when v_desc >= 100 then 'cupom' when v_desc > 0 then 'desconto' else 'a cobrar' end;
  return jsonb_build_object('pedidos_30d', v_ped, 'lojas', v_lojas, 'plano', v_pl.nome, 'preco_tabela', v_bruto, 'desconto_pct', v_desc,
    'a_pagar', case when v_sit in ('cortesia', 'teste') then 0 else round(v_bruto * (100 - v_desc) / 100.0, 2) end,
    'situacao', v_sit, 'teste_ate', v_teste, 'cupom', v_ass.cupom, 'desconto_ate', v_ass.desconto_ate);
end $$;
revoke all on function public.cobranca_calc(uuid) from public, anon, authenticated;

create or replace function public.minha_assinatura() returns jsonb
language sql stable security definer set search_path = public as $$ select public.cobranca_calc(auth.uid()) $$;
grant execute on function public.minha_assinatura() to authenticated;

create or replace function public.cupom_usar(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  select * into c from cupons where codigo = upper(trim(p_codigo)) for update;
  if c.codigo is null then raise exception 'Cupom não encontrado.'; end if;
  if c.usado_por is not null then raise exception 'Este cupom já foi usado.'; end if;
  if c.valido_ate is not null and c.valido_ate < current_date then raise exception 'Este cupom venceu.'; end if;
  if c.para_usuario is not null and c.para_usuario <> v_uid then raise exception 'Este cupom é de outra conta.'; end if;
  update cupons set usado_por = v_uid, usado_em = now() where codigo = c.codigo;
  insert into assinaturas (usuario_id, cupom, desconto_pct, desconto_ate) values (v_uid, c.codigo, c.desconto_pct, case when c.meses is null then null else (current_date + make_interval(months => c.meses))::date end)
  on conflict (usuario_id) do update set cupom = excluded.cupom, desconto_pct = excluded.desconto_pct, desconto_ate = excluded.desconto_ate, atualizado_em = now();
  return public.cobranca_calc(v_uid);
end $$;
grant execute on function public.cupom_usar(text) to authenticated;

-- ── administrador ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_painel() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  select jsonb_build_object(
    'contas', (select coalesce(jsonb_agg(x order by x->>'criado'), '[]'::jsonb) from (
       select jsonb_build_object('id', u.id, 'email', u.email, 'criado', u.created_at, 'ultimo_acesso', u.last_sign_in_at,
         'lojas', (select coalesce(jsonb_agg(coalesce(t.apelido, t.ml_user_id::text)), '[]'::jsonb) from ml_tokens t where t.usuario_id = u.id),
         'vendas_guardadas', (select count(*) from vendas_ml v where v.usuario_id = u.id),
         'historico_dias', (select coalesce(min(n), 0) from (select (select count(*) from vendas_ml_dias d where d.usuario_id = t.usuario_id and d.ml_user_id::text = t.ml_user_id::text and d.completo and d.dia >= current_date - 365) n from ml_tokens t where t.usuario_id = u.id) q),
         'contas_pagar', (select count(*) from pagamentos p where p.usuario_id = u.id),
         'tarefas_7d', (select count(*) from tarefas t where t.usuario_id = u.id),
         'pos_venda_casos', (select count(*) from pos_venda_casos c where c.usuario_id = u.id),
         'cobranca', public.cobranca_calc(u.id)) x
       from auth.users u where u.email <> 'demo@caixa360.app') s),
    'saude', (select coalesce(jsonb_agg(to_jsonb(s) order by s.em desc), '[]'::jsonb) from (select * from sistema_saude order by em desc limit 36) s),
    'capacidade', jsonb_build_object('pedidos_30d', (select coalesce(sum(vendas), 0) from vendas_resumo_dia where dia >= current_date - 30 and usuario_id <> coalesce((select id from auth.users where email = 'demo@caixa360.app'), '00000000-0000-0000-0000-000000000000'::uuid)), 'teto', 30000,
       'banco_mb', (pg_database_size(current_database()) / 1048576)::integer, 'banco_teto_mb', 8192,
       'arquivos_mb', (select coalesce(sum((metadata->>'size')::bigint), 0) / 1048576 from storage.objects)::integer, 'arquivos_teto_mb', 102400, 'custo_usd', 30),
    'planos', (select coalesce(jsonb_agg(to_jsonb(p) order by p.ordem), '[]'::jsonb) from planos p),
    'cupons', (select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'desconto_pct', c.desconto_pct, 'meses', c.meses, 'valido_ate', c.valido_ate, 'nota', c.nota, 'criado_em', c.criado_em, 'usado_em', c.usado_em,
        'para', (select email from auth.users where id = c.para_usuario), 'usado_por', (select email from auth.users where id = c.usado_por)) order by c.criado_em desc), '[]'::jsonb) from cupons c),
    'sugestoes', (select coalesce(jsonb_agg(jsonb_build_object('em', f.created_at, 'pagina', f.pagina, 'mensagem', f.mensagem, 'lido', f.lido, 'email', (select email from auth.users where id = f.usuario_id)) order by f.created_at desc), '[]'::jsonb) from (select * from feedbacks order by created_at desc limit 40) f),
    'erros', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select left(e.erro, 160) erro, e.pagina, count(*) n, max(e.created_at) ultimo, count(distinct e.usuario_id) usuarios from erros_log e where e.created_at > now() - interval '14 days' group by 1, 2 order by max(e.created_at) desc limit 30) x)
  ) into v;
  return v;
end $$;
grant execute on function public.admin_painel() to authenticated;

create or replace function public.admin_cupom_criar(p_desconto integer, p_meses integer default null, p_validade_dias integer default 30, p_email text default null, p_nota text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_cod text; v_para uuid;
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  if p_email is not null and trim(p_email) <> '' then
    select id into v_para from auth.users where lower(email) = lower(trim(p_email));
    if v_para is null then raise exception 'Não há conta com esse e-mail.'; end if;
  end if;
  v_cod := 'C360-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4));
  insert into cupons (codigo, desconto_pct, meses, valido_ate, para_usuario, nota)
  values (v_cod, p_desconto, nullif(p_meses, 0), case when coalesce(p_validade_dias, 0) > 0 then current_date + p_validade_dias end, v_para, left(p_nota, 200));
  return v_cod;
end $$;
grant execute on function public.admin_cupom_criar(integer, integer, integer, text, text) to authenticated;

create or replace function public.admin_cupom_apagar(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  delete from cupons where codigo = p_codigo and usado_por is null;
end $$;
grant execute on function public.admin_cupom_apagar(text) to authenticated;

create or replace function public.admin_plano_salvar(p_id integer, p_nome text, p_pedidos integer, p_lojas integer, p_preco numeric, p_extra numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  update planos set nome = p_nome, pedidos_max = nullif(p_pedidos, 0), lojas = greatest(p_lojas, 1), preco = p_preco, loja_extra = p_extra where id = p_id;
end $$;
grant execute on function public.admin_plano_salvar(integer, text, integer, integer, numeric, numeric) to authenticated;

create or replace function public.admin_cortesia(p_usuario uuid, p_sim boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  insert into assinaturas (usuario_id, cortesia) values (p_usuario, p_sim)
  on conflict (usuario_id) do update set cortesia = excluded.cortesia, atualizado_em = now();
end $$;
grant execute on function public.admin_cortesia(uuid, boolean) to authenticated;
select (select count(*) from public.planos) planos;
