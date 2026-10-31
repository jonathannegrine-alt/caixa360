-- EQUIPE: tela Estoque para colaborador (perfil Logística = Pedidos + Estoque). Só leitura, como em 20261229_equipe.
-- Vendas: quem tem Pedidos ou Estoque lê (o Estoque usa as vendas para o ocupado e a cobertura).
drop policy if exists vendas_ml_equipe on public.vendas_ml;
create policy vendas_ml_equipe on public.vendas_ml for select to authenticated
  using (usuario_id = (select public.equipe_dono('pedidos')) or usuario_id = (select public.equipe_dono('estoque')));
drop policy if exists vendas_fotos_equipe on public.vendas_fotos;
create policy vendas_fotos_equipe on public.vendas_fotos for select to authenticated
  using (usuario_id = (select public.equipe_dono('pedidos')) or usuario_id = (select public.equipe_dono('estoque')));
drop policy if exists sku_fotos_manual_equipe on public.sku_fotos_manual;
create policy sku_fotos_manual_equipe on public.sku_fotos_manual for select to authenticated
  using (usuario_id = (select public.equipe_dono('pedidos')) or usuario_id = (select public.equipe_dono('estoque')));

-- tabelas que a tela Estoque lê (depósitos, movimentações, contagens, envios ao Full, cadastro e kits, ordens a caminho)
do $$
declare t text;
begin
  foreach t in array array['estoque_depositos','estoque_mov','estoque_contagens','estoque_envios_full','skus','sku_componentes',
                           'sku_composicao','estoque_componentes','olist_ordens','compras_recebimentos','vendas_ml_dias'] loop
    execute format('drop policy if exists %I on public.%I', t || '_equipe', t);
    execute format('create policy %I on public.%I for select to authenticated using (usuario_id = (select public.equipe_dono(''estoque'')))', t || '_equipe', t);
  end loop;
end $$;

-- funções de leitura usadas pelo Estoque: para colaborador valem pela conta do dono
do $$
declare f text;
begin
  foreach f in array array['public.vendas_full_sku', 'public.vendas_ml_sku_dia'] loop
    execute replace(pg_get_functiondef(f::regproc), 'auth.uid()', 'coalesce(public.equipe_dono(''estoque''), auth.uid())');
  end loop;
  execute replace(pg_get_functiondef('public.sku_fotos'::regproc), 'coalesce(public.equipe_dono(''pedidos''), auth.uid())',
                  'coalesce(public.equipe_dono(''pedidos''), public.equipe_dono(''estoque''), auth.uid())');
end $$;
