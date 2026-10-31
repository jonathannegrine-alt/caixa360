-- EQUIPE: colaborador "visualizar e alterar" (equipe.alterar) + registro de quem fez cada alteração.
-- Com alterar = false (padrão) nada muda: só leitura. Com alterar = true o colaborador grava, na conta do dono, só o
-- que as telas liberadas gravam: Pedidos = marcação "conferir"; Estoque = movimentações (ajuste, contagem,
-- transferência, envio ao Full), contagens, envios ao Full e fotos. Depósitos (estrutura) continuam só com o dono.
alter table public.equipe add column if not exists alterar boolean not null default false;
grant update (nome, paginas, ativo, alterar, atualizado_em) on public.equipe to authenticated;

create or replace function public.equipe_dono_alt(p_pagina text) returns uuid
language sql stable security definer set search_path = public as $$
  select dono_id from public.equipe where membro_id = auth.uid() and ativo and alterar and p_pagina = any(paginas)
$$;
revoke all on function public.equipe_dono_alt(text) from public, anon;
grant execute on function public.equipe_dono_alt(text) to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
      ('vendas_conferir', 'pedidos', 'insert'), ('vendas_conferir', 'pedidos', 'update'), ('vendas_conferir', 'pedidos', 'delete'),
      ('estoque_mov', 'estoque', 'insert'), ('estoque_mov', 'estoque', 'delete'),
      ('estoque_contagens', 'estoque', 'insert'), ('estoque_contagens', 'estoque', 'update'),
      ('estoque_envios_full', 'estoque', 'insert'), ('estoque_envios_full', 'estoque', 'update'), ('estoque_envios_full', 'estoque', 'delete'),
      ('sku_fotos_manual', 'estoque', 'insert'), ('sku_fotos_manual', 'estoque', 'update'), ('sku_fotos_manual', 'estoque', 'delete')
    ) v(tabela, pagina, cmd) loop
    execute format('drop policy if exists %I on public.%I', r.tabela || '_equipe_' || r.cmd, r.tabela);
    if r.cmd = 'insert' then
      execute format('create policy %I on public.%I for insert to authenticated with check (usuario_id = (select public.equipe_dono_alt(%L)))', r.tabela || '_equipe_' || r.cmd, r.tabela, r.pagina);
    elsif r.cmd = 'update' then
      execute format('create policy %I on public.%I for update to authenticated using (usuario_id = (select public.equipe_dono_alt(%L))) with check (usuario_id = (select public.equipe_dono_alt(%L)))', r.tabela || '_equipe_' || r.cmd, r.tabela, r.pagina, r.pagina);
    else
      execute format('create policy %I on public.%I for delete to authenticated using (usuario_id = (select public.equipe_dono_alt(%L)))', r.tabela || '_equipe_' || r.cmd, r.tabela, r.pagina);
    end if;
  end loop;
end $$;

-- quem fez: gravado pelo banco com o login de quem estava no site (dono ou colaborador); nulo = rotina automática
create or replace function public.feito_por_marcar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.feito_por := coalesce(auth.uid(), new.feito_por);
  else
    if auth.uid() is not null then new.alterado_por := auth.uid(); new.alterado_em := now(); end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['estoque_mov', 'estoque_contagens', 'estoque_envios_full', 'vendas_conferir'] loop
    execute format('alter table public.%I add column if not exists feito_por uuid', t);
    execute format('alter table public.%I add column if not exists alterado_por uuid', t);
    execute format('alter table public.%I add column if not exists alterado_em timestamptz', t);
    execute format('drop trigger if exists feito_por_ins on public.%I', t);
    execute format('create trigger feito_por_ins before insert on public.%I for each row execute function public.feito_por_marcar()', t);
    execute format('drop trigger if exists feito_por_upd on public.%I', t);
    execute format('create trigger feito_por_upd before update on public.%I for each row execute function public.feito_por_marcar()', t);
  end loop;
end $$;

-- nomes para mostrar "feito por": o dono vê os nomes da equipe; o colaborador vê o próprio e o dono
create or replace function public.equipe_nomes() returns table(uid uuid, nome text, dono boolean)
language sql stable security definer set search_path = public as $$
  with eu as (select coalesce((select dono_id from public.equipe where membro_id = auth.uid()), auth.uid()) as dono)
  select e.membro_id, coalesce(nullif(e.nome, ''), e.email), false from public.equipe e, eu where e.dono_id = eu.dono
  union all
  select eu.dono, 'Dono da conta', true from eu
$$;
revoke all on function public.equipe_nomes() from public, anon;
grant execute on function public.equipe_nomes() to authenticated;
