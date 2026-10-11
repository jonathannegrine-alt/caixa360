-- As consultas de vendas (DRE, análise, resumo) passaram a estourar o tempo quando o cadastro de produtos cresceu:
-- a view procura o custo de cada venda no cadastro por upper(trim(sku)) sem índice, e filtra o dia sem índice.
create index if not exists skus_usuario_sku_norm on public.skus (usuario_id, upper(trim(sku)));
create index if not exists vendas_ml_usuario_dia on public.vendas_ml (usuario_id, ((data_venda at time zone 'America/Sao_Paulo')::date));
analyze public.skus;
analyze public.vendas_ml;

-- A view só precisa olhar o cadastro de produtos quando a venda ainda não tem custo ou imposto gravado.
do $$
declare d text;
begin
  d := pg_get_viewdef('public.vendas_ml_calc'::regclass, true);
  if position('v.custo_unit IS NULL OR v.imposto_pct IS NULL' in d) = 0 then
    d := replace(d, 'WHERE k.usuario_id = v.usuario_id AND', 'WHERE (v.custo_unit IS NULL OR v.imposto_pct IS NULL) AND k.usuario_id = v.usuario_id AND');
    execute 'create or replace view public.vendas_ml_calc with (security_invoker = true) as ' || d;
  end if;
end $$;
grant select on public.vendas_ml_calc to authenticated;
