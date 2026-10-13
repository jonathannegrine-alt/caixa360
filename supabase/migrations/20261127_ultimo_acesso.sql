-- ÚLTIMO ACESSO DE VERDADE: auth.users.last_sign_in_at só muda quando a pessoa digita a senha; quem fica com a sessão
-- aberta aparecia como "há 128 dias". Passa a valer o mais recente entre: o login, a última renovação da sessão
-- (auth.sessions, renovada sozinha enquanto o sistema está aberto) e assinaturas.ultimo_acesso (gravado quando o sistema abre).
alter table public.assinaturas add column if not exists ultimo_acesso timestamptz;
create or replace function public.assinatura_acesso() returns void
language sql security definer set search_path = public as $$
  insert into assinaturas (usuario_id, teste_inicio, ultimo_acesso) select auth.uid(), now(), now() where auth.uid() is not null
  on conflict (usuario_id) do update set teste_inicio = coalesce(assinaturas.teste_inicio, now()), ultimo_acesso = now();
$$;
grant execute on function public.assinatura_acesso() to authenticated;

create or replace function public.admin_painel() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v jsonb;
begin
  if not public.eh_admin() then raise exception 'Só o administrador.'; end if;
  select jsonb_build_object(
    'contas', (select coalesce(jsonb_agg(x order by x->>'criado'), '[]'::jsonb) from (
       select jsonb_build_object('id', u.id, 'email', u.email, 'criado', u.created_at, 'ultimo_acesso', greatest(u.last_sign_in_at, (select max(coalesce(s.refreshed_at at time zone 'UTC', s.updated_at)) from auth.sessions s where s.user_id = u.id), (select a.ultimo_acesso from assinaturas a where a.usuario_id = u.id)),
         'ultimo_login', u.last_sign_in_at,
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
select u.created_at::date criado, u.last_sign_in_at::date login, (select max(coalesce(s.refreshed_at at time zone 'UTC', s.updated_at)) from auth.sessions s where s.user_id = u.id) sessao from auth.users u where u.email <> 'demo@caixa360.app' order by u.created_at;
