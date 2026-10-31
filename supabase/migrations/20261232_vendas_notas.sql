-- Anotações por venda no banco (antes ficavam no navegador, localStorage mk_vml_notas). Uma anotação por venda.
-- Aparecem em Vendas e no detalhe do pedido (Pedidos), em qualquer aparelho e para a equipe com a tela Pedidos.
create table if not exists public.vendas_notas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint not null,
  texto text not null,
  criado_em timestamptz not null default now(),
  feito_por uuid,
  alterado_por uuid,
  alterado_em timestamptz,
  primary key (usuario_id, order_id)
);
alter table public.vendas_notas enable row level security;
drop policy if exists vendas_notas_dono on public.vendas_notas;
create policy vendas_notas_dono on public.vendas_notas for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
drop policy if exists vendas_notas_equipe on public.vendas_notas;
create policy vendas_notas_equipe on public.vendas_notas for select to authenticated using (usuario_id = (select public.equipe_dono('pedidos')));
drop policy if exists vendas_notas_equipe_insert on public.vendas_notas;
create policy vendas_notas_equipe_insert on public.vendas_notas for insert to authenticated with check (usuario_id = (select public.equipe_dono_alt('pedidos')));
drop policy if exists vendas_notas_equipe_update on public.vendas_notas;
create policy vendas_notas_equipe_update on public.vendas_notas for update to authenticated using (usuario_id = (select public.equipe_dono_alt('pedidos'))) with check (usuario_id = (select public.equipe_dono_alt('pedidos')));
drop policy if exists vendas_notas_equipe_delete on public.vendas_notas;
create policy vendas_notas_equipe_delete on public.vendas_notas for delete to authenticated using (usuario_id = (select public.equipe_dono_alt('pedidos')));
grant select, insert, update, delete on public.vendas_notas to authenticated;
grant select, insert, update, delete on public.vendas_notas to service_role;
drop trigger if exists feito_por_ins on public.vendas_notas;
create trigger feito_por_ins before insert on public.vendas_notas for each row execute function public.feito_por_marcar();
drop trigger if exists feito_por_upd on public.vendas_notas;
create trigger feito_por_upd before update on public.vendas_notas for each row execute function public.feito_por_marcar();
