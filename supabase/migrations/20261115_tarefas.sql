-- FILA DE TAREFAS PESADAS (com aviso no sininho)
-- O que é pesado e raro não roda mais na hora da tela (limite de ~8 s por consulta): entra na fila, o cron 'tarefas'
-- (SQL puro, a cada minuto) executa sem esse limite e a tela avisa quando terminar (src/tarefas.js).
--   tipos: 'nivelar'  → vendas_ml_nivelar (custo/imposto de um SKU num período longo)
--          'totais'   → vendas_ml_totais  (totais do Resumo Financeiro / Vendas num período longo); resultado em jsonb
create table if not exists public.tarefas (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  tipo text not null,
  rotulo text,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'fila',          -- fila | rodando | pronto | erro
  resultado jsonb,
  erro text,
  visto boolean not null default false,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  terminado_em timestamptz);
create index if not exists tarefas_fila on public.tarefas (id) where status = 'fila';
create index if not exists tarefas_usuario on public.tarefas (usuario_id, id desc);
alter table public.tarefas enable row level security;
drop policy if exists tarefas_ler on public.tarefas;
create policy tarefas_ler on public.tarefas for select to authenticated using (usuario_id = auth.uid());
grant select on public.tarefas to authenticated;

create or replace function public.tarefa_criar(p_tipo text, p_params jsonb, p_rotulo text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if p_tipo not in ('nivelar', 'totais') then raise exception 'Tipo de tarefa desconhecido'; end if;
  -- a mesma tarefa já na fila ou rodando: devolve a que existe
  select id into v_id from tarefas where usuario_id = v_uid and tipo = p_tipo and params = p_params and status in ('fila', 'rodando') limit 1;
  if v_id is not null then return v_id; end if;
  if (select count(*) from tarefas where usuario_id = v_uid and status in ('fila', 'rodando')) >= 8 then raise exception 'Já há muitas tarefas na fila. Espere terminar.'; end if;
  insert into tarefas (usuario_id, tipo, params, rotulo) values (v_uid, p_tipo, coalesce(p_params, '{}'::jsonb), left(p_rotulo, 200)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.tarefa_vista(p_id bigint default null)
returns void language sql security definer set search_path = public as $$
  update tarefas set visto = true where usuario_id = auth.uid() and status in ('pronto', 'erro') and not visto and (p_id is null or id = p_id);
$$;

-- executa até 3 tarefas por rodada, cada uma como o usuário dono (auth.uid() das RPCs existentes continua valendo)
create or replace function public.tarefas_cron() returns integer
language plpgsql security definer set search_path = public as $$
declare t record; n integer := 0; v_res jsonb; p jsonb;
begin
  -- tarefa que ficou "rodando" por mais de 30 min (queda do servidor): volta para a fila uma vez
  update tarefas set status = 'erro', erro = 'Interrompida (o servidor reiniciou). Peça de novo.', terminado_em = now()
   where status = 'rodando' and iniciado_em < now() - interval '30 minutes';
  for i in 1..3 loop
    select * into t from tarefas where status = 'fila' order by id limit 1 for update skip locked;
    exit when not found;
    update tarefas set status = 'rodando', iniciado_em = now() where id = t.id;
    p := t.params; v_res := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', t.usuario_id, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', t.usuario_id::text, true);
      if t.tipo = 'nivelar' then
        v_res := jsonb_build_object('vendas', vendas_ml_nivelar((p->>'de')::date, (p->>'ate')::date, p->>'sku', (p->>'custo')::numeric, (p->>'imposto')::numeric, nullif(p->>'conta', '')));
      elsif t.tipo = 'totais' then
        v_res := vendas_ml_totais((p->>'p_de')::date, (p->>'p_ate')::date, p->>'p_pedido', p->>'p_titulo', p->>'p_sku', p->>'p_modalidade', p->>'p_envio', p->>'p_custo', nullif(p->>'p_conta', ''));
      end if;
      update tarefas set status = 'pronto', resultado = v_res, terminado_em = now() where id = t.id;
    exception when others then
      update tarefas set status = 'erro', erro = left(sqlerrm, 300), terminado_em = now() where id = t.id;
    end;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    n := n + 1;
  end loop;
  -- limpeza: resultado grande não fica guardado (7 dias)
  delete from tarefas where terminado_em < now() - interval '7 days';
  return n;
end $$;

revoke all on function public.tarefas_cron() from public, anon, authenticated;
revoke all on function public.tarefa_criar(text, jsonb, text) from public, anon;
revoke all on function public.tarefa_vista(bigint) from public, anon;
grant execute on function public.tarefa_criar(text, jsonb, text) to authenticated;
grant execute on function public.tarefa_vista(bigint) to authenticated;
-- cron: select cron.schedule('tarefas', '* * * * *', 'select public.tarefas_cron()');
select 1 ok;
