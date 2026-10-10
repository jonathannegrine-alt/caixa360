-- CONECTOR DE IA (MCP): permite que a IA do próprio usuário (Claude, ChatGPT...) consulte os dados do Caixa 360.
-- Somente leitura. A Edge Function "mcp" identifica o usuário por uma chave pessoal (guardamos só o hash)
-- e chama ia_consulta() com a service_role; toda consulta é filtrada pelo usuario_id dono da chave.

create table if not exists public.ia_chaves (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  hash        text not null unique,          -- sha256 da chave (a chave em si não é guardada)
  rotulo      text,
  criada_em   timestamptz not null default now(),
  ultimo_uso  timestamptz
);
alter table public.ia_chaves enable row level security;
drop policy if exists ia_chaves_proprio on public.ia_chaves;
create policy ia_chaves_proprio on public.ia_chaves for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
grant select, insert, delete on public.ia_chaves to authenticated;
grant all on public.ia_chaves to service_role;

create or replace function public.ia_consulta(p_usuario uuid, p_ferramenta text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_de date := coalesce(nullif(p->>'de', '')::date, (now() at time zone 'America/Sao_Paulo')::date - 29);
  v_ate date := coalesce(nullif(p->>'ate', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_conta text := nullif(p->>'conta', '');
  v_sku text := nullif(p->>'sku', '');
  v_lim int := least(greatest(coalesce((p->>'limite')::int, 100), 1), 500);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_res jsonb; v_dims text[]; v_sel text := ''; v_grp text := ''; v_ord text; d text; i int := 0; expr text;
begin
  if p_usuario is null then return jsonb_build_object('erro', 'usuário não identificado'); end if;

  if p_ferramenta = 'contas' then
    return (select coalesce(jsonb_agg(jsonb_build_object('conta', ml_user_id, 'apelido', apelido, 'ultima_sincronizacao', updated_at)), '[]'::jsonb)
            from ml_tokens where usuario_id = p_usuario);

  elsif p_ferramenta = 'vendas_resumo' then
    with base as (
      select * from vendas_ml_calc c where c.usuario_id = p_usuario and c.dia between v_de and v_ate
        and (v_conta is null or c.ml_user_id = v_conta) and (v_sku is null or c.sku ilike v_sku)
    )
    select jsonb_build_object(
      'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
      'aprovadas', (select jsonb_build_object('vendas', count(*), 'unidades', coalesce(sum(qtd),0), 'faturamento_produtos', coalesce(sum(bruto),0),
          'frete_pago_pelo_comprador', coalesce(sum(frete_comprador),0), 'frete_pago_pelo_vendedor', coalesce(sum(frete_vendedor),0),
          'tarifa_de_venda', coalesce(sum(tarifa),0), 'custo_dos_produtos', coalesce(sum(custo),0), 'imposto', coalesce(sum(imposto),0),
          'margem_de_contribuicao', coalesce(sum(mc),0),
          'margem_pct', case when sum(bruto) > 0 then round(sum(mc)/sum(bruto)*100, 2) else 0 end,
          'vendas_sem_custo_ou_imposto', count(*) filter (where not tem_custo or not tem_imposto))
        from base where situacao = 'aprovada'),
      'canceladas', (select jsonb_build_object('vendas', count(*), 'unidades', coalesce(sum(qtd),0), 'valor', coalesce(sum(bruto),0)) from base where situacao = 'cancelada'),
      'dias_com_vendas_importadas', (select count(distinct dia) from vendas_ml_dias where usuario_id = p_usuario and completo and dia between v_de and v_ate),
      'observacao', 'margem = produtos - custo - imposto - tarifa - frete do vendedor; custo e imposto são os gravados em cada venda'
    ) into v_res;
    return v_res;

  elsif p_ferramenta = 'vendas_agrupadas' then
    v_dims := array(select jsonb_array_elements_text(coalesce(p->'agrupar_por', '["dia"]'::jsonb)));
    if array_length(v_dims, 1) is null or array_length(v_dims, 1) > 3 then return jsonb_build_object('erro', 'informe de 1 a 3 dimensões em agrupar_por'); end if;
    foreach d in array v_dims loop
      expr := case d
        when 'dia' then 'c.dia::text' when 'semana' then 'to_char(date_trunc(''week'', c.dia), ''YYYY-MM-DD'')'
        when 'mes' then 'to_char(c.dia, ''YYYY-MM'')' when 'sku' then 'coalesce(nullif(trim(c.sku), ''''), ''(sem SKU)'')'
        when 'anuncio' then 'coalesce(c.item_id, ''(sem MLB)'')' when 'envio' then 'c.envio' when 'modalidade' then 'c.modalidade'
        when 'conta' then 'c.ml_user_id' when 'situacao' then 'c.situacao' when 'dia_da_semana' then 'to_char(c.dia, ''ID'')'
        when 'hora' then 'to_char(c.data_venda at time zone ''America/Sao_Paulo'', ''HH24'')'
        else null end;
      if expr is null then return jsonb_build_object('erro', 'dimensão inválida: ' || d, 'validas', 'dia, semana, mes, sku, anuncio, envio, modalidade, conta, situacao, dia_da_semana, hora'); end if;
      i := i + 1;
      v_sel := v_sel || expr || ' as ' || quote_ident(d) || ', ';
      v_grp := v_grp || case when i > 1 then ', ' else '' end || i::text;
    end loop;
    v_ord := case coalesce(p->>'ordenar_por', '')
      when 'faturamento' then 'faturamento desc' when 'margem' then 'margem desc' when 'unidades' then 'unidades desc'
      when 'vendas' then 'vendas desc' when 'margem_pct' then 'margem_pct desc' else v_grp end;
    execute format($q$
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select %s count(*) as vendas, coalesce(sum(c.qtd),0) as unidades, coalesce(sum(c.bruto),0) as faturamento,
               coalesce(sum(c.custo),0) as custo, coalesce(sum(c.imposto),0) as imposto, coalesce(sum(c.tarifa),0) as tarifa,
               coalesce(sum(c.frete_vendedor),0) as frete_vendedor, coalesce(sum(c.mc),0) as margem,
               case when sum(c.bruto) > 0 then round(sum(c.mc)/sum(c.bruto)*100, 2) else 0 end as margem_pct
        from vendas_ml_calc c
        where c.usuario_id = $1 and c.dia between $2 and $3
          and ($4::text is null or c.ml_user_id = $4) and ($5::text is null or c.sku ilike $5)
          and c.situacao = any($6)
        group by %s order by %s limit %s) x $q$, v_sel, v_grp, v_ord, v_lim)
    into v_res using p_usuario, v_de, v_ate, v_conta, v_sku,
      case when 'situacao' = any(v_dims) then array['aprovada','cancelada','pendente'] else array[coalesce(nullif(p->>'situacao', ''), 'aprovada')] end;
    return jsonb_build_object('periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'linhas', v_res);

  elsif p_ferramenta = 'vendas_lista' then
    return (select jsonb_build_object('periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'linhas', coalesce(jsonb_agg(x), '[]'::jsonb)) from (
      select c.order_id as venda, c.pack_id as carrinho, c.dia, to_char(c.data_venda at time zone 'America/Sao_Paulo', 'HH24:MI') as hora,
             c.situacao, c.titulo, c.sku, c.item_id as anuncio, c.qtd, c.preco_unit, c.bruto, c.frete_comprador, c.frete_vendedor, c.tarifa,
             c.custo, c.imposto, c.mc as margem, c.mc_pct as margem_pct, c.envio, c.modalidade, c.comprador_apelido, c.ml_user_id as conta
      from vendas_ml_calc c
      where c.usuario_id = p_usuario and c.dia between v_de and v_ate
        and (v_conta is null or c.ml_user_id = v_conta) and (v_sku is null or c.sku ilike v_sku)
        and (nullif(p->>'situacao', '') is null or c.situacao = p->>'situacao')
      order by c.data_venda desc limit least(v_lim, 200)) x);

  elsif p_ferramenta = 'dre_mensal' then
    return jsonb_build_object(
      'ano', coalesce((p->>'ano')::int, extract(year from v_hoje)::int),
      'vendas_ml_por_mes', (select coalesce(jsonb_agg(x order by x.mes), '[]'::jsonb) from (
        select extract(month from c.dia)::int as mes, coalesce(sum(c.bruto),0) as faturamento,
          coalesce(sum(c.bruto) filter (where c.situacao = 'cancelada'),0) as vendas_canceladas,
          coalesce(sum(c.imposto) filter (where c.situacao = 'aprovada'),0) as imposto,
          coalesce(sum(coalesce(c.frete_vendedor,0)) filter (where c.situacao = 'aprovada'),0) as frete_vendedor,
          coalesce(sum(c.custo) filter (where c.situacao = 'aprovada'),0) as custo_dos_produtos,
          coalesce(sum(c.tarifa) filter (where c.situacao = 'aprovada'),0) as tarifa_de_venda
        from vendas_ml_calc c where c.usuario_id = p_usuario and c.situacao in ('aprovada','cancelada')
          and extract(year from c.dia) = coalesce((p->>'ano')::int, extract(year from v_hoje)::int)
          and (v_conta is null or c.ml_user_id = v_conta)
        group by 1) x),
      'despesas_por_categoria_e_mes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select coalesce(nullif(pg.cat, ''), 'Sem categoria') as categoria,
               coalesce(ct.dre_grupo, case when ct.impacta_dre then 'fixo' else 'fora' end, 'fora') as grupo_no_dre,
               extract(month from pg.data)::int as mes, sum(pg.val) as valor, count(*) as lancamentos
        from pagamentos pg left join categorias ct on ct.usuario_id = pg.usuario_id and ct.nome = pg.cat
        where pg.usuario_id = p_usuario and extract(year from pg.data) = coalesce((p->>'ano')::int, extract(year from v_hoje)::int)
        group by 1, 2, 3 order by 1, 3) x),
      'observacao', 'grupo_no_dre: variavel = custo operacional, fixo = custo fixo, fora = não entra no DRE. Margem de contribuição = faturamento - canceladas - imposto - frete - custo - tarifa - despesas variáveis; lucro = margem - despesas fixas.');

  elsif p_ferramenta = 'contas_a_pagar' then
    return (with base as (
      select * from pagamentos pg where pg.usuario_id = p_usuario
        and (nullif(p->>'de', '') is null or pg.data >= (p->>'de')::date) and (nullif(p->>'ate', '') is null or pg.data <= (p->>'ate')::date)
        and (nullif(p->>'categoria', '') is null or pg.cat ilike p->>'categoria')
        and (nullif(p->>'fornecedor', '') is null or pg.forn ilike '%' || (p->>'fornecedor') || '%')
        and case coalesce(nullif(p->>'status', ''), 'abertas')
              when 'abertas' then not coalesce(pg.pago, false) when 'pagas' then coalesce(pg.pago, false)
              when 'atrasadas' then not coalesce(pg.pago, false) and pg.data < v_hoje else true end)
      select jsonb_build_object('total', (select coalesce(sum(val),0) from base), 'quantidade', (select count(*) from base),
        'por_categoria', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select coalesce(nullif(cat,''),'Sem categoria') as categoria, sum(val) as valor, count(*) as lancamentos from base group by 1 order by 2 desc) x),
        'lancamentos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select data as vencimento, descricao, forn as fornecedor, cat as categoria, val as valor, coalesce(pago,false) as pago, parcela from base order by data limit v_lim) x)));

  elsif p_ferramenta = 'recebiveis_ml' then
    return (select jsonb_build_object(
      'total_confirmado', coalesce(sum(l.val),0),
      'por_dia', coalesce(jsonb_agg(jsonb_build_object('data', l.data, 'valor', l.val, 'conta', l.ml_user_id) order by l.data), '[]'::jsonb),
      'observacao', 'liberações futuras de vendas já realizadas no Mercado Livre/Mercado Pago')
      from liberacoes l where l.usuario_id = p_usuario and l.data >= v_hoje and (v_conta is null or l.ml_user_id = v_conta));

  elsif p_ferramenta = 'recebimentos_historico' then
    return (select jsonb_build_object('periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
      'por_dia', coalesce(jsonb_agg(jsonb_build_object('data', e.data, 'valor_liquido', e.val_liquido, 'pagamentos', e.qtd_pedidos, 'conta', e.ml_user_id) order by e.data), '[]'::jsonb))
      from extrato_historico e where e.usuario_id = p_usuario and e.data between v_de and v_ate and (v_conta is null or e.ml_user_id = v_conta));

  elsif p_ferramenta = 'produtos' then
    return (select coalesce(jsonb_agg(jsonb_build_object('sku', k.sku, 'titulo', k.titulo, 'custo', k.custo, 'imposto_pct', k.imposto) order by k.sku), '[]'::jsonb)
      from skus k where k.usuario_id = p_usuario and (nullif(p->>'busca', '') is null or k.sku ilike '%' || (p->>'busca') || '%' or k.titulo ilike '%' || (p->>'busca') || '%'));

  elsif p_ferramenta = 'caixa' then
    return (select jsonb_build_object(
      'saldo_mercado_pago', coalesce((c.cfg->>'saldoMP')::numeric, 0), 'saldo_outros_bancos', coalesce((c.cfg->>'saldoOutros')::numeric, 0),
      'reserva_minima', coalesce((c.cfg->>'reservaMinima')::numeric, 0), 'atualizado_em', c.updated_at,
      'a_receber_ml_confirmado', (select coalesce(sum(val),0) from liberacoes where usuario_id = p_usuario and data >= v_hoje),
      'contas_em_aberto_30_dias', (select coalesce(sum(val),0) from pagamentos where usuario_id = p_usuario and not coalesce(pago,false) and data between v_hoje and v_hoje + 30),
      'contas_em_atraso', (select coalesce(sum(val),0) from pagamentos where usuario_id = p_usuario and not coalesce(pago,false) and data < v_hoje),
      'observacao', 'os saldos são os informados pelo usuário no Painel financeiro')
      from configuracoes c where c.usuario_id = p_usuario);
  end if;

  return jsonb_build_object('erro', 'ferramenta desconhecida: ' || coalesce(p_ferramenta, ''));
end $$;
revoke all on function public.ia_consulta(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ia_consulta(uuid, text, jsonb) to service_role;
