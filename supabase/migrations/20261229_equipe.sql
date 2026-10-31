-- EQUIPE: colaboradores de uma conta (ex.: logística vendo só Pedidos).
-- O colaborador tem login próprio; ao entrar, o site lê os dados do DONO só nas telas liberadas em "paginas".
-- Ele só consulta: as políticas abaixo são todas de SELECT. Quem cria o login é a função de borda "equipe"
-- (precisa da chave de serviço); o dono pode mudar nome, telas e ativo, nunca o membro nem o dono.
create table if not exists public.equipe (
  membro_id uuid primary key references auth.users(id) on delete cascade,
  dono_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  nome text,
  paginas text[] not null default '{pedidos}',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (membro_id <> dono_id)
);
create index if not exists equipe_dono_idx on public.equipe (dono_id);
alter table public.equipe enable row level security;
drop policy if exists equipe_ler on public.equipe;
create policy equipe_ler on public.equipe for select to authenticated using (dono_id = auth.uid() or membro_id = auth.uid());
drop policy if exists equipe_dono_alterar on public.equipe;
create policy equipe_dono_alterar on public.equipe for update to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());
revoke all on public.equipe from anon, authenticated;
grant select on public.equipe to authenticated;
grant update (nome, paginas, ativo, atualizado_em) on public.equipe to authenticated;
grant select, insert, update, delete on public.equipe to service_role;

-- dono de quem está logado, se for colaborador ativo com a tela pedida; nulo para todos os outros
create or replace function public.equipe_dono(p_pagina text) returns uuid
language sql stable security definer set search_path = public as $$
  select dono_id from public.equipe where membro_id = auth.uid() and ativo and p_pagina = any(paginas)
$$;
revoke all on function public.equipe_dono(text) from public, anon;
grant execute on function public.equipe_dono(text) to authenticated;

-- tela Pedidos (lista, detalhe e foto): leitura das vendas e marcações do dono
drop policy if exists vendas_ml_equipe on public.vendas_ml;
create policy vendas_ml_equipe on public.vendas_ml for select to authenticated using (usuario_id = (select public.equipe_dono('pedidos')));
drop policy if exists vendas_conferir_equipe on public.vendas_conferir;
create policy vendas_conferir_equipe on public.vendas_conferir for select to authenticated using (usuario_id = (select public.equipe_dono('pedidos')));
drop policy if exists vendas_fotos_equipe on public.vendas_fotos;
create policy vendas_fotos_equipe on public.vendas_fotos for select to authenticated using (usuario_id = (select public.equipe_dono('pedidos')));
drop policy if exists sku_fotos_manual_equipe on public.sku_fotos_manual;
create policy sku_fotos_manual_equipe on public.sku_fotos_manual for select to authenticated using (usuario_id = (select public.equipe_dono('pedidos')));

-- fotos por SKU: o colaborador da tela Pedidos vê as fotos do dono
create or replace function public.sku_fotos(p_skus text[])
 returns table(sku text, foto text)
 language sql
 stable
as $function$
  with eu as (select coalesce(public.equipe_dono('pedidos'), auth.uid()) as uid),
  alvo as (select distinct lower(btrim(x)) as s from unnest(p_skus) x),
  vendas as (select lower(btrim(v.sku)) as s, coalesce(v.thumbnail, ft.thumbnail) as thumbnail, v.data_venda from public.vendas_ml v
              left join public.vendas_fotos ft on ft.usuario_id = v.usuario_id and ft.item_id = v.item_id
              where v.usuario_id = (select uid from eu) and coalesce(v.thumbnail, ft.thumbnail) is not null and v.data_venda > now() - interval '180 days'),
  cand as (
    select a.s, m.url as thumbnail, now() as data_venda, -1 as pr from alvo a join public.sku_fotos_manual m on m.usuario_id = (select uid from eu) and m.sku_norm = a.s
    union all
    select a.s, replace(b.thumbnail, 'http://', 'https://'), b.lido_em, 0 from alvo a join public.ml_itens_base b on b.usuario_id = (select uid from eu) and lower(btrim(b.sku)) = a.s and b.thumbnail is not null
    union all
    select a.s, v.thumbnail, v.data_venda, 1 from alvo a join vendas v on v.s = a.s
    union all
    select a.s, v.thumbnail, v.data_venda, 2 from alvo a
      join public.sku_composicao c on c.usuario_id = (select uid from eu) and lower(btrim(c.sku_componente)) = a.s
      join vendas v on v.s = lower(btrim(c.sku_comercial))
  )
  select distinct on (s) s, thumbnail from cand order by s, pr, data_venda desc;
$function$;
