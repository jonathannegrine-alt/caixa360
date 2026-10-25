-- Demonstração completa (2026-10-25): demo.semear() passa a copiar também o que veio depois de 20/10, sempre descaracterizado
-- (códigos, nomes, números de venda/envio/anúncio trocados; quantidades x0,6; valores x0,75 ou x0,45).

-- número de venda/envio que vem como texto
create or replace function demo.numt(t text) returns text language sql immutable as $$
  select case when t ~ '^\d+$' then demo.num(t::bigint)::text else t end $$;
-- número curto (envio ao Full)
create or replace function demo.numcurto(t text) returns text language sql immutable as $$
  select case when t is null then null when t ~ '^\d+$' then ((t::bigint % 10000000) + 50000000)::text else 'EX-' || substr(md5(t), 1, 6) end $$;
-- variação do anúncio
create or replace function demo.var(x bigint) returns bigint language sql immutable as $$
  select case when x is null or x = 0 then x else (x % 100000000000) + 90000000000 end $$;
-- troca dentro de jsonb (itens de envios, contagens, promoções, listas): SKU, título, anúncio, nº de venda, loja; quantidades e valores reduzidos
create or replace function demo.jtroca(j jsonb, f_qtd numeric default 0.6, f_val numeric default 0.75) returns jsonb language plpgsql stable set search_path to public, demo as $$
declare k text; v jsonb; r jsonb; s text; t text;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'array' then
    select coalesce(jsonb_agg(demo.jtroca(e, f_qtd, f_val)), '[]'::jsonb) into r from jsonb_array_elements(j) e; return r;
  end if;
  if jsonb_typeof(j) <> 'object' then return j; end if;
  r := '{}'::jsonb;
  s := coalesce(j->>'sku', j->>'anuncio_sku', j->>'sku_componente');
  for k, v in select * from jsonb_each(j) loop
    t := v #>> '{}';
    r := r || jsonb_build_object(k, case
      when jsonb_typeof(v) in ('object', 'array') then demo.jtroca(v, f_qtd, f_val)
      when jsonb_typeof(v) = 'string' and k in ('sku', 'anuncio_sku', 'sku_componente', 'sku_comercial', 'sku_anuncio', 'pai') then to_jsonb(demo.sku(t))
      when jsonb_typeof(v) = 'string' and k in ('titulo', 'descricao', 'produto') then to_jsonb(case when s is not null then demo.tit(s) else 'Produto' end)
      when jsonb_typeof(v) = 'string' and k in ('item', 'item_id', 'mlb') then to_jsonb(demo.item(t))
      when k in ('codigo_ml', 'inventory_id') and t is not null then to_jsonb('EX' || upper(substr(md5(t), 1, 7)))
      when k in ('pedido', 'order_id', 'envio', 'shipping_id', 'pack_id') and t ~ '^\d+$' then to_jsonb(demo.num(t::bigint)::text)
      when jsonb_typeof(v) = 'string' and k in ('loja', 'conta', 'ml_user_id') then to_jsonb(demo.loja(t))
      when jsonb_typeof(v) = 'string' and k = 'fornecedor' then to_jsonb(demo.forn(t))
      when jsonb_typeof(v) = 'string' and k in ('obs', 'cnpj', 'nf', 'nota', 'conferido_por') then 'null'::jsonb
      when jsonb_typeof(v) = 'number' and k in ('qtd', 'enviado', 'recebido', 'real', 'sistema', 'aptas', 'quantidade') then to_jsonb(round(t::numeric * f_qtd))
      when jsonb_typeof(v) = 'number' and k in ('valor', 'preco', 'custo', 'original', 'total', 'preco_unit', 'custo_unit', 'frete') then to_jsonb(round(t::numeric * f_val, 2))
      else v end);
  end loop;
  return r;
end $$;

CREATE OR REPLACE FUNCTION demo.semear()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'demo', 'extensions'
AS $function$
declare o uuid; a uuid; pw text; t text; res jsonb := '{}'::jsonb; n integer; r record;
begin
  select origem, alvo, senha into o, a, pw from demo.cfg where id = 1;
  if a is null then raise exception 'demo.cfg vazio'; end if;
  perform set_config('demo.semeando', 'on', true);
  update auth.users set encrypted_password = crypt(pw, gen_salt('bf')), updated_at = now() where id = a;   -- se alguém trocar a senha, volta

  -- nomes genéricos (os já sorteados não mudam de um dia para o outro)
  insert into demo.mapa_loja (orig, novo, nome)
    select m.ml_user_id, (1000000000 + row_number() over (order by m.ml_user_id) + (select count(*) from demo.mapa_loja))::text, 'LOJA EXEMPLO ' || (row_number() over (order by m.ml_user_id) + (select count(*) from demo.mapa_loja))
      from (select distinct ml_user_id from ml_tokens where usuario_id = o) m where not exists (select 1 from demo.mapa_loja l where l.orig = m.ml_user_id);
  with f as (
    select lower(btrim(sku)) s from skus where usuario_id = o union select lower(btrim(sku)) from vendas_ml where usuario_id = o and sku is not null
    union select lower(btrim(sku_comercial)) from sku_composicao where usuario_id = o union select lower(btrim(sku_componente)) from sku_composicao where usuario_id = o
    union select sku_norm from estoque_mov where usuario_id = o union select lower(btrim(sku)) from estoque_componentes where usuario_id = o
    union select sku_norm from custo_lotes where usuario_id = o
    union select lower(btrim(pai)) from skus where usuario_id = o union select lower(btrim(codigo)) from sku_pais where usuario_id = o
    union select lower(btrim(sku_anuncio)) from ml_anuncios where usuario_id = o union select lower(btrim(sku)) from sku_mapa where usuario_id = o
    union select lower(btrim(sku)) from full_sugestoes where usuario_id = o
    union select lower(btrim(i->>'sku')) from olist_ordens oo, jsonb_array_elements(case when jsonb_typeof(oo.itens) = 'array' then oo.itens else '[]'::jsonb end) i where oo.usuario_id = o
  ), novos as (
    select f.s, exists (select 1 from sku_composicao c where c.usuario_id = o and lower(btrim(c.sku_comercial)) = f.s and lower(btrim(c.sku_componente)) <> f.s) as kit
      from f where f.s is not null and f.s <> '' and not exists (select 1 from demo.mapa_sku m where m.sku_norm = f.s)
  ), num as (
    select s, kit, row_number() over (partition by kit order by md5(s)) + (select count(*) from demo.mapa_sku m where m.kit = novos.kit) as k from novos
  )
  insert into demo.mapa_sku (sku_norm, novo, titulo, kit)
    select s, case when kit then 'KIT-' else 'PROD-' end || lpad(k::text, 3, '0'), case when kit then 'Kit ' else 'Produto ' end || lpad(k::text, 3, '0'), kit from num;
  with f as (select btrim(forn) fn from pagamentos where usuario_id = o union select btrim(fornecedor) from olist_ordens where usuario_id = o union select btrim(nome) from fornecedores where usuario_id = o),
  novos as (select f.fn, row_number() over (order by md5(f.fn)) + (select count(*) from demo.mapa_forn) k from f where f.fn is not null and f.fn <> '' and not exists (select 1 from demo.mapa_forn m where m.nome = f.fn))
  insert into demo.mapa_forn (nome, novo) select novos.fn, 'Fornecedor ' || lpad(novos.k::text, 2, '0') from novos;

  -- limpa a conta de demonstração
  for t in select c.table_name from information_schema.columns c join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name and b.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.column_name = 'usuario_id' and c.table_name <> 'demo_fonte' loop
    execute format('delete from public.%I where usuario_id = %L', t, a);
  end loop;

  insert into termos_aceite (usuario_id, versao_termos, aceito_em) values (a, 'v0.1-beta', now());
  perform demo.copiar('categorias', $q$'{}'::jsonb$q$);
  n := demo.copiar('pagamentos', $q$jsonb_build_object('descricao', coalesce(x.cat, 'Despesa') || coalesce(' — ' || demo.forn(x.forn), ''), 'forn', demo.forn(x.forn),
      'val', round(x.val * 0.45, 2), 'valor_pago', round(x.valor_pago * 0.45, 2), 'desconto', round(x.desconto * 0.45, 2), 'juros', round(x.juros * 0.45, 2),
      'tiny_key', null, 'fonte', null, 'grupo_id', case when x.grupo_id is null then null else 'g_' || substr(md5(x.grupo_id), 1, 12) end, 'forma_pgto', null, 'loja', demo.loja(x.loja), 'doc', null, 'travas', null, 'oculta', false)$q$, 'not coalesce(x.oculta, false)');
  res := res || jsonb_build_object('pagamentos', n);
  perform demo.copiar('skus', $q$jsonb_build_object('sku', demo.sku(x.sku), 'titulo', demo.tit(x.sku), 'custo', round(x.custo * demo.fc(x.sku), 2), 'imposto', 7, 'pai', demo.sku(x.pai))$q$);
  perform demo.copiar('sku_composicao', $q$jsonb_build_object('sku_comercial', demo.sku(x.sku_comercial), 'titulo_comercial', demo.tit(x.sku_comercial), 'sku_componente', demo.sku(x.sku_componente))$q$);
  perform demo.copiar('liberacoes', $q$jsonb_build_object('val', round(x.val * 0.45, 2), 'ml_user_id', demo.loja(x.ml_user_id))$q$);
  perform demo.copiar('extrato_historico', $q$jsonb_build_object('val_liquido', round(x.val_liquido * 0.45, 2), 'qtd_pedidos', round(x.qtd_pedidos * 0.6), 'ml_user_id', demo.loja(x.ml_user_id))$q$);
  perform demo.copiar('snapshots_ml', $q$jsonb_build_object('val', round(x.val * 0.45, 2), 'qtd', round(x.qtd * 0.6), 'ml_user_id', demo.loja(x.ml_user_id))$q$);
  perform demo.copiar('vendas_ml_dias', $q$jsonb_build_object('vendas', round(x.vendas * 0.6), 'ml_user_id', demo.loja(x.ml_user_id))$q$);
  perform demo.copiar('vendas_cfg', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'flex_custo', round(x.flex_custo * 0.75, 2))$q$);
  perform demo.copiar('emprestimos', $q$jsonb_build_object('nome', 'Empréstimo de capital de giro', 'credor', 'Banco Exemplo', 'numero_contrato', null, 'valor', round(x.valor * 0.45, 2), 'dono', null, 'obs', null, 'arquivo', null, 'loja', demo.loja(x.loja))$q$);
  perform demo.copiar('estoque_componentes', $q$jsonb_build_object('sku', demo.sku(x.sku), 'descricao', demo.tit(x.sku), 'qtd_galpao', round(x.qtd_galpao * 0.6), 'qtd_full', round(x.qtd_full * 0.6),
      'qtd_full_pendente', round(x.qtd_full_pendente * 0.6), 'em_transito', round(x.em_transito * 0.6), 'custo_medio', round(x.custo_medio * demo.fc(x.sku), 2))$q$);
  perform demo.copiar('custo_lotes', $q$jsonb_build_object('sku', demo.sku(x.sku), 'qtd', greatest(1, round(x.qtd * 0.6)), 'custo_unit', round(x.custo_unit * demo.fc(x.sku), 4), 'obs', null)$q$);
  perform demo.copiar('custo_peps_cfg', $q$'{}'::jsonb$q$);
  perform demo.copiar('olist_ordens', $q$jsonb_build_object('fornecedor', demo.forn(x.fornecedor), 'origem', 'local', 'extra', case when x.extra ? 'loja' then jsonb_build_object('loja', demo.loja(x.extra->>'loja')) else null end,
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('sku', demo.sku(i->>'sku'), 'descricao', demo.tit(i->>'sku'), 'qtd', greatest(1, round((i->>'qtd')::numeric * 0.6)), 'valor', round((i->>'valor')::numeric * demo.fc(i->>'sku'), 2))), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(x.itens) = 'array' then x.itens else '[]'::jsonb end) i),
      'total', (select coalesce(sum(greatest(1, round((i->>'qtd')::numeric * 0.6)) * round((i->>'valor')::numeric * demo.fc(i->>'sku'), 2)), 0)
                  from jsonb_array_elements(case when jsonb_typeof(x.itens) = 'array' then x.itens else '[]'::jsonb end) i))$q$);
  perform demo.copiar('compras_recebimentos', $q$jsonb_build_object('sku', demo.sku(x.sku), 'qtd', greatest(1, round(x.qtd * 0.6)), 'obs', null)$q$);

  -- configurações: saldos reduzidos, lojas trocadas, regras de compra no padrão
  insert into configuracoes (usuario_id, cfg, updated_at)
    select a, (c.cfg - 'comprasCfg' - 'saldosLoja' - 'saldoEm' - 'lojaPadrao')
        || jsonb_build_object('saldoMP', round(coalesce((c.cfg->>'saldoMP')::numeric, 0) * 0.45, 2), 'saldoOutros', round(coalesce((c.cfg->>'saldoOutros')::numeric, 0) * 0.45, 2),
             'reservaMinima', round(coalesce((c.cfg->>'reservaMinima')::numeric, 0) * 0.45, 2), 'lojaPadrao', demo.loja(c.cfg->>'lojaPadrao'),
             'saldosLoja', (select coalesce(jsonb_object_agg(demo.loja(k), demo.esc(v, 0.45)), '{}'::jsonb) from jsonb_each(coalesce(c.cfg->'saldosLoja', '{}'::jsonb)) e(k, v)),
             'saldoEm', (select coalesce(jsonb_object_agg(demo.loja(split_part(k, '#', 1)) || case when position('#' in k) > 0 then '#' || split_part(k, '#', 2) else '' end, v), '{}'::jsonb) from jsonb_each(coalesce(c.cfg->'saldoEm', '{}'::jsonb)) e(k, v)),
             'patCfg', demo.esc(coalesce(c.cfg->'patCfg', '{}'::jsonb) - 'markup' - 'desconto' - 'curvaDesde', 0.45) || jsonb_strip_nulls(jsonb_build_object('markup', c.cfg->'patCfg'->'markup', 'desconto', c.cfg->'patCfg'->'desconto', 'curvaDesde', c.cfg->'patCfg'->'curvaDesde'))),
        now()
      from configuracoes c where c.usuario_id = o;

  -- estoque: um depósito de cada tipo e o saldo de cada produto como carga inicial
  create temp table if not exists _dep (o bigint, n bigint) on commit drop; delete from _dep;
  for r in select d.id, d.nome, d.tipo, d.ativo, d.ml_user_id from estoque_depositos d where d.usuario_id = o order by d.id loop
    insert into estoque_depositos (usuario_id, nome, tipo, ativo, ml_user_id)
      values (a, case when r.tipo = 'full' then 'Full ' || initcap(coalesce((select nome from demo.mapa_loja where orig = r.ml_user_id), 'Loja')) else r.nome end, r.tipo, r.ativo, demo.loja(r.ml_user_id)) returning id into n;
    insert into _dep values (r.id, n);
    insert into estoque_mov (usuario_id, deposito_id, sku, qtd, motivo, ref, obs, custo_unit)
      select a, n, demo.sku(max(m.sku)), round(sum(m.qtd) * 0.6), 'carga_inicial', 'demo', 'Estoque de exemplo', null
        from estoque_mov m where m.usuario_id = o and m.deposito_id = r.id group by m.sku_norm having round(sum(m.qtd) * 0.6) > 0;
  end loop;

  -- vendas: 60% dos pedidos, a 75% do preço
  insert into vendas_ml (usuario_id, order_id, pack_id, data_venda, status, comprador_id, comprador_apelido, comprador_nome, item_id, titulo, sku, variacao, qtd, preco_unit, tarifa,
      listing_type, shipping_id, logistic_type, frete_vendedor, frete_comprador, total_pago, thumbnail, atualizado_em, ml_user_id, custo_unit, imposto_pct, sku_fixo, envio_status, enviado_em, uf, frete_flex, envio_n, custo_manual,
      envio_substatus, envio_limite, variation_id, sku_anuncio, cupom_vendedor, pago_mp, liquido_mp, retido_mp, liberacao_mp, liquido_final, est_anuncio_apos, est_galpao_apos, cidade)
    select a, demo.num(v.order_id), demo.num(v.pack_id), v.data_venda, v.status, (abs(hashtextextended(v.comprador_id::text, 5)) % 900000000) + 100000000,
      'COMPRADOR' || ((abs(hashtextextended(v.comprador_id::text, 5)) % 90000) + 10000), 'Cliente ' || ((abs(hashtextextended(v.comprador_id::text, 5)) % 90000) + 10000),
      demo.item(v.item_id), demo.tit(v.sku), demo.sku(v.sku), null, v.qtd, round(v.preco_unit * 0.75, 2), round(v.tarifa * 0.75, 2),
      v.listing_type, demo.num(v.shipping_id), v.logistic_type, round(v.frete_vendedor * 0.75, 2), round(v.frete_comprador * 0.75, 2), round(v.total_pago * 0.75, 2), demo.foto(v.sku), v.atualizado_em, demo.loja(v.ml_user_id),
      round(v.custo_unit * demo.fc(v.sku), 4), 7, false, v.envio_status, v.enviado_em, v.uf, round(v.frete_flex * 0.75, 2), v.envio_n, false,
      v.envio_substatus, v.envio_limite, demo.var(v.variation_id), demo.sku(v.sku_anuncio), round(v.cupom_vendedor * 0.75, 2), round(v.pago_mp * 0.75, 2), round(v.liquido_mp * 0.75, 2), round(v.retido_mp * 0.75, 2),
      v.liberacao_mp, v.liquido_final, round(v.est_anuncio_apos * 0.6), round(v.est_galpao_apos * 0.6), v.cidade
    from vendas_ml v where v.usuario_id = o and (v.order_id % 100) < 60;
  get diagnostics n = row_count; res := res || jsonb_build_object('vendas', n);

  -- foto de exemplo de cada produto (estoque e folha de contagem)
  insert into sku_fotos_manual (usuario_id, sku_norm, url) select a, lower(m.novo), demo.foto_novo(m.novo) from demo.mapa_sku m on conflict do nothing;

  -- conferência do Flex: as faturas guardadas, sem nome nem CEP de comprador
  insert into flex_faturas (usuario_id, numero, transportador, emitida, de, ate, total, arquivo, linhas, resumo, criado_em)
    select a, f.numero, 'TRANSPORTADOR EXEMPLO', f.emitida, f.de, f.ate, f.total, 'fatura_exemplo.pdf',
      (select coalesce(jsonb_agg(l - 'dest' - 'cep' - 'conta' - 'vendas' - 'envio' || jsonb_build_object('envio', demo.num((l->>'envio')::bigint)::text, 'dest', 'Destinatário ' || k, 'cep', '00000-000', 'conta', demo.loja(l->>'conta'),
          'valor', round(coalesce((l->>'valor')::numeric, 0) * 0.75, 2), 'custo', round(coalesce((l->>'custo')::numeric, 0) * 0.75, 2),
          'vendas', (select coalesce(jsonb_agg(jsonb_build_object('pedido', demo.num((w->>'pedido')::bigint)::text, 'sku', demo.sku(w->>'sku'), 'titulo', demo.tit(w->>'sku'), 'qtd', w->'qtd',
                       'valor', round(coalesce((w->>'valor')::numeric, 0) * 0.75, 2), 'custo', round(coalesce((w->>'custo')::numeric, 0) * 0.75, 2))), '[]'::jsonb) from jsonb_array_elements(coalesce(l->'vendas', '[]'::jsonb)) w))), '[]'::jsonb)
         from jsonb_array_elements(f.linhas) with ordinality e(l, k)),
      (f.resumo - 'porLoja') || jsonb_build_object('porLoja', (select coalesce(jsonb_object_agg(demo.loja(k), v), '{}'::jsonb) from jsonb_each(coalesce(f.resumo->'porLoja', '{}'::jsonb)) e(k, v))), f.criado_em
    from flex_faturas f where f.usuario_id = o;

  -- ===== partes que vieram depois de 20/10 (2026-10-25). Cada uma separada: se uma falhar, as outras seguem. =====
  begin
    perform demo.copiar('fornecedores', $q$jsonb_build_object('nome', demo.forn(x.nome), 'razao_social', demo.forn(x.nome), 'fantasia', null, 'apelidos', '[]'::jsonb, 'cnpj', null, 'ie', null, 'contato', null,
      'telefone', null, 'email', null, 'endereco', null, 'cep', null, 'obs', null, 'receita', null, 'receita_em', null, 'grupo', null, 'loja', demo.loja(x.loja))$q$);
  exception when others then res := res || jsonb_build_object('erro_fornecedores', sqlerrm); end;
  begin
    insert into sku_pais (usuario_id, codigo, nome, criado_em) select a, demo.sku(codigo), demo.tit(codigo), criado_em from sku_pais where usuario_id = o on conflict do nothing;
  exception when others then res := res || jsonb_build_object('erro_sku_pais', sqlerrm); end;
  begin
    insert into sku_mapa (usuario_id, item_id, variation_id, sku, ml_user_id, criado_em, sku_anuncio)
      select a, demo.item(item_id), demo.var(variation_id), demo.sku(sku), demo.loja(ml_user_id), criado_em, demo.sku(sku_anuncio) from sku_mapa where usuario_id = o on conflict do nothing;
  exception when others then res := res || jsonb_build_object('erro_sku_mapa', sqlerrm); end;
  begin
    insert into ml_anuncios (usuario_id, ml_user_id, item_id, variation_id, titulo, variacao, sku_anuncio, thumbnail, status, logistic_type, atualizado_em)
      select a, demo.loja(ml_user_id), demo.item(item_id), demo.var(variation_id), demo.tit(sku_anuncio), variacao, demo.sku(sku_anuncio), demo.foto(sku_anuncio), status, logistic_type, atualizado_em
        from ml_anuncios where usuario_id = o on conflict do nothing;
  exception when others then res := res || jsonb_build_object('erro_ml_anuncios', sqlerrm); end;
  begin
    insert into full_sugestoes (usuario_id, ml_user_id, referencia, sku, inventory_id, produto, v30, aptas, caminho, minimo, sugestao, urgencia, prazo, estrela, origem, importado_em)
      select a, demo.loja(ml_user_id), referencia, demo.sku(sku), 'EX' || upper(substr(md5(coalesce(inventory_id, sku)), 1, 7)), demo.tit(sku), round(v30 * 0.6)::int, round(aptas * 0.6)::int,
        round(caminho * 0.6)::int, round(minimo * 0.6)::int, round(sugestao * 0.6)::int, urgencia, prazo, estrela, origem, importado_em from full_sugestoes where usuario_id = o on conflict do nothing;
  exception when others then res := res || jsonb_build_object('erro_full_sugestoes', sqlerrm); end;
  begin
    insert into estoque_envios_full (usuario_id, deposito_id, numero, titulo, ml_user_id, data_prevista, situacao, itens, saiu_em, criado_em, ocupar, conferencia, conferido_em)
      select a, (select d.n from _dep d where d.o = e.deposito_id), demo.numcurto(numero), 'Full ' || demo.numcurto(numero), demo.loja(ml_user_id), data_prevista, situacao, demo.jtroca(itens), saiu_em, criado_em,
        ocupar, demo.jtroca(conferencia), conferido_em from estoque_envios_full e where usuario_id = o on conflict do nothing;
  exception when others then res := res || jsonb_build_object('erro_envios_full', sqlerrm); end;
  begin
    insert into estoque_contagens (usuario_id, deposito_id, origem, obs, itens, aplicada_em, criado_em)
      select a, (select d.n from _dep d where d.o = c.deposito_id), origem, null, demo.jtroca(itens), aplicada_em, criado_em from estoque_contagens c where usuario_id = o;
  exception when others then res := res || jsonb_build_object('erro_contagens', sqlerrm); end;
  begin
    perform demo.copiar('flex_pendencias', $q$jsonb_build_object('envio', demo.numt(x.envio), 'codigo', substr(md5(coalesce(x.codigo, '')), 1, 9), 'transportador', 'TRANSPORTADOR EXEMPLO', 'conta', demo.loja(x.conta),
      'pedido', demo.numt(x.pedido), 'sku', demo.sku(x.sku), 'titulo', demo.tit(x.sku), 'frete', round(x.frete * 0.75, 2), 'valor', round(x.valor * 0.75, 2), 'abatido_valor', round(x.abatido_valor * 0.75, 2),
      'conferido_por', null, 'obs', null)$q$);
  exception when others then res := res || jsonb_build_object('erro_flex_pendencias', sqlerrm); end;
  begin
    perform demo.copiar('ml_fatura_periodos', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'total', round(x.total * 0.75, 2), 'aberto', round(x.aberto * 0.75, 2))$q$);
    perform demo.copiar('ml_fatura_totais', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'valor', round(x.valor * 0.75, 2))$q$);
    perform demo.copiar('ml_fatura_linhas', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'valor', round(x.valor * 0.75, 2))$q$);
  exception when others then res := res || jsonb_build_object('erro_fatura', sqlerrm); end;
  begin
    perform demo.copiar('vendas_ml_cobr', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'order_id', demo.num(x.order_id), 'valor', round(x.valor * 0.75, 2))$q$, '(x.order_id % 100) < 60');
    perform demo.copiar('vendas_ml_afil', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'order_id', demo.num(x.order_id), 'item_id', demo.item(x.item_id), 'valor', round(x.valor * 0.75, 2))$q$, '(x.order_id % 100) < 60');
    perform demo.copiar('vendas_ml_cobr_lida', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'order_id', demo.num(x.order_id))$q$, '(x.order_id % 100) < 60');
  exception when others then res := res || jsonb_build_object('erro_cobrancas', sqlerrm); end;
  begin
    perform demo.copiar('vendas_conferir', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'order_id', demo.num(x.order_id), 'shipping_id', demo.num(x.shipping_id))$q$, '(x.order_id % 100) < 60');
  exception when others then res := res || jsonb_build_object('erro_vendas_conferir', sqlerrm); end;
  begin
    perform demo.copiar('concil_linhas', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'chave', md5(x.chave || 'demo'), 'ref', demo.numt(x.ref), 'numero', demo.numt(x.numero), 'envio', demo.numt(x.envio),
      'item_id', demo.item(x.item_id), 'sku', demo.sku(x.sku), 'nome', null, 'bruto', round(x.bruto * 0.75, 2), 'tarifas', round(x.tarifas * 0.75, 2), 'pos', round(x.pos * 0.75, 2), 'liquido', round(x.liquido * 0.75, 2),
      't_venda', round(x.t_venda * 0.75, 2), 't_mp', round(x.t_mp * 0.75, 2), 't_parcel', round(x.t_parcel * 0.75, 2), 't_envio', round(x.t_envio * 0.75, 2), 't_dev', round(x.t_dev * 0.75, 2), 't_outros', round(x.t_outros * 0.75, 2),
      'env_comp', round(x.env_comp * 0.75, 2), 'parc_comp', round(x.parc_comp * 0.75, 2), 'rebate', round(x.rebate * 0.75, 2))$q$, $f$case when x.ref ~ '^\d+$' then (x.ref::bigint % 100) < 60 else true end$f$);
  exception when others then res := res || jsonb_build_object('erro_conciliacao', sqlerrm); end;
  begin
    perform demo.copiar('promo_campanhas', $q$jsonb_build_object('ml_user_id', demo.loja(x.ml_user_id), 'id', 'EX' || upper(substr(md5(x.id), 1, 8)), 'nome', 'Campanha de exemplo', 'itens', demo.jtroca(x.itens))$q$);
  exception when others then res := res || jsonb_build_object('erro_promocoes', sqlerrm); end;
  begin
    perform demo.copiar('simulacoes', $q$jsonb_build_object('compras', demo.esc(x.compras, 0.45))$q$);
  exception when others then res := res || jsonb_build_object('erro_simulacoes', sqlerrm); end;
  begin
    perform demo.copiar('listas_compra', $q$jsonb_build_object('itens', demo.jtroca(x.itens), 'para', null, 'obs', null)$q$);
  exception when others then res := res || jsonb_build_object('erro_listas_compra', sqlerrm); end;

  -- dados que no sistema real vêm do Mercado Livre na hora
  delete from demo.dados;
  insert into demo.dados values ('contas', (select coalesce(jsonb_agg(jsonb_build_object('ml_user_id', novo, 'apelido', nome, 'updated_at', now(), 'usuario_id', a) order by novo), '[]'::jsonb) from demo.mapa_loja));
  insert into demo.dados select 'inventory', jsonb_build_object('ok', true, 'fonte', 'inventories', 'contas', (select jsonb_agg(jsonb_build_object('conta', novo, 'apelido', nome)) from demo.mapa_loja),
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('sku', demo.sku(i->>'sku'), 'titulo', demo.tit(i->>'sku'), '_conta', demo.loja(i->>'_conta'),
          'aptos_venda', round(coalesce((i->>'aptos_venda')::numeric, 0) * 0.6), 'em_transito', round(coalesce((i->>'em_transito')::numeric, 0) * 0.6), 'nao_aptos', round(coalesce((i->>'nao_aptos')::numeric, 0) * 0.6),
          'em_separacao', 0, 'pendente', 0, 'total_geral', round(coalesce((i->>'aptos_venda')::numeric, 0) * 0.6) + round(coalesce((i->>'em_transito')::numeric, 0) * 0.6) + round(coalesce((i->>'nao_aptos')::numeric, 0) * 0.6))), '[]'::jsonb)
                from jsonb_array_elements(coalesce(s.valor->'itens', '[]'::jsonb)) i))
    from demo_fonte s where s.usuario_id = o and s.chave = 'inventory';
  insert into demo.dados select 'ads', jsonb_build_object('ok', true, 'contas', '[]'::jsonb,
      'anuncios', (select coalesce(jsonb_agg(jsonb_build_object('conta', demo.loja(i->>'conta'), 'item_id', demo.item(i->>'item_id'),
          'titulo', coalesce((select demo.tit(v.sku) from vendas_ml v where v.usuario_id = o and v.item_id = i->>'item_id' and v.sku is not null limit 1), 'Anúncio de exemplo'), 'status', i->'status', 'campanha', 1, 'foto', coalesce((select demo.foto(v.sku) from vendas_ml v where v.usuario_id = o and v.item_id = i->>'item_id' and v.sku is not null limit 1), demo.foto_novo('ANUNCIO')),
          'cliques', round(coalesce((i->>'cliques')::numeric, 0) * 0.6), 'impressoes', round(coalesce((i->>'impressoes')::numeric, 0) * 0.6), 'investimento', round(coalesce((i->>'investimento')::numeric, 0) * 0.45, 2),
          'vendas_ads', round(coalesce((i->>'vendas_ads')::numeric, 0) * 0.45, 2), 'diretas', round(coalesce((i->>'diretas')::numeric, 0) * 0.45, 2), 'indiretas', round(coalesce((i->>'indiretas')::numeric, 0) * 0.45, 2),
          'un_ads', round(coalesce((i->>'un_ads')::numeric, 0) * 0.6), 'un_organicas', round(coalesce((i->>'un_organicas')::numeric, 0) * 0.6), 'organicas', round(coalesce((i->>'organicas')::numeric, 0) * 0.45, 2))), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(s.valor->'anuncios', '[]'::jsonb)) i))
    from demo_fonte s where s.usuario_id = o and s.chave = 'ads';
  return res || jsonb_build_object('quando', now());
end $function$;
