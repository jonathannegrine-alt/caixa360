-- Conector de IA: consultas de estoque, compras, envios ao Full e empréstimos (somente leitura).
-- Função separada da ia_consulta original para não mexer nela; a Edge Function "mcp" escolhe qual chamar.

create or replace function public.ia_consulta_estoque(p_usuario uuid, p_ferramenta text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sku text := nullif(lower(btrim(coalesce(p->>'sku', ''))), '');
begin
  if p_usuario is null then return jsonb_build_object('erro', 'usuário não identificado'); end if;

  if p_ferramenta = 'estoque' then
    return jsonb_build_object(
      'depositos', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo, 'conta_ml', ml_user_id) order by id), '[]'::jsonb)
                    from estoque_depositos where usuario_id = p_usuario and ativo),
      'saldos', (select coalesce(jsonb_agg(jsonb_build_object('deposito', d.nome, 'sku', s.sku, 'fisico', s.fisico, 'ultima_movimentacao', s.ultima_mov) order by s.fisico desc), '[]'::jsonb)
                 from estoque_saldo s join estoque_depositos d on d.id = s.deposito_id
                 where s.usuario_id = p_usuario and d.ativo and (v_sku is null or s.sku_norm like v_sku)),
      'observacao', 'Saldo físico dos depósitos próprios (soma das movimentações). Depósitos do tipo full não aparecem aqui: o estoque do Full é lido direto do Mercado Livre na tela e não fica gravado. Para o que está comprado e a caminho use "ordens_de_compra".');

  elsif p_ferramenta = 'estoque_movimentacoes' then
    return (select jsonb_build_object('linhas', coalesce(jsonb_agg(x), '[]'::jsonb)) from (
      select m.criado_em as quando, d.nome as deposito, m.sku, m.qtd, m.motivo, m.ref as referencia, m.obs as observacao
      from estoque_mov m join estoque_depositos d on d.id = m.deposito_id
      where m.usuario_id = p_usuario and (v_sku is null or m.sku_norm like v_sku)
        and (p->>'motivo' is null or m.motivo = p->>'motivo')
      order by m.criado_em desc limit least(coalesce((p->>'limite')::int, 100), 500)) x);

  elsif p_ferramenta = 'ordens_de_compra' then
    return (select jsonb_build_object('ordens', coalesce(jsonb_agg(x order by x.data desc), '[]'::jsonb)) from (
      select o.numero, o.data, coalesce(o.data_prevista_local, o.data_prevista) as previsao_de_chegada, o.fornecedor, o.total,
             case o.situacao when 0 then 'em aberto' when 1 then 'atendida' when 2 then 'cancelada' when 3 then 'em andamento' end as situacao_no_olist,
             o.origem,
             (select coalesce(jsonb_agg(jsonb_build_object('sku', i->>'sku', 'comprado', (i->>'qtd')::numeric, 'preco', (i->>'valor')::numeric,
                 'recebido', coalesce((select sum(r.qtd) from compras_recebimentos r where r.usuario_id = p_usuario and r.ordem_id = o.id and lower(r.sku) = lower(i->>'sku')), 0))), '[]'::jsonb)
              from jsonb_array_elements(coalesce(o.itens, '[]'::jsonb)) i) as itens
      from olist_ordens o
      where o.usuario_id = p_usuario and coalesce(o.situacao, 0) <> 2
        and (p->>'so_pendentes' is distinct from 'true' or o.situacao in (0, 3))) x);

  elsif p_ferramenta = 'envios_ao_full' then
    return (select jsonb_build_object('envios', coalesce(jsonb_agg(jsonb_build_object('titulo', titulo, 'numero', numero, 'situacao', situacao, 'saida_prevista', data_prevista,
              'saiu_em', saiu_em, 'ocupa_estoque', ocupar, 'itens', itens) order by id desc), '[]'::jsonb))
            from estoque_envios_full where usuario_id = p_usuario);

  elsif p_ferramenta = 'emprestimos' then
    return (select jsonb_build_object('contratos', coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'credor', credor, 'numero_contrato', numero_contrato, 'valor', valor,
              'juros_ao_mes_pct', taxa_mes, 'parcelas', parcelas, 'primeira_parcela', primeira, 'sistema', sistema, 'de_quem', dono, 'modo', modo,
              'trecho_que_identifica_as_parcelas', vinculo, 'observacao', obs) order by id), '[]'::jsonb),
            'observacao', 'As parcelas de cada contrato estão em "contas_a_pagar": procure pelo trecho que identifica as parcelas na descrição ou no fornecedor.')
            from emprestimos where usuario_id = p_usuario);
  end if;

  return jsonb_build_object('erro', 'ferramenta desconhecida: ' || coalesce(p_ferramenta, ''));
end $$;

revoke all on function public.ia_consulta_estoque(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ia_consulta_estoque(uuid, text, jsonb) to service_role;
