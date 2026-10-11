-- Foto de produto enviada pelo usuário (vale mais que a foto do anúncio). Arquivos no bucket público "produtos".
create table if not exists public.sku_fotos_manual (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  sku_norm text not null,
  url text not null,
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, sku_norm)
);
alter table public.sku_fotos_manual enable row level security;
drop policy if exists sku_fotos_manual_dono on public.sku_fotos_manual;
create policy sku_fotos_manual_dono on public.sku_fotos_manual for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
grant select, insert, update, delete on public.sku_fotos_manual to authenticated;
grant all on public.sku_fotos_manual to service_role;

insert into storage.buckets (id, name, public) values ('produtos', 'produtos', true) on conflict (id) do update set public = true;
drop policy if exists produtos_ler on storage.objects;
create policy produtos_ler on storage.objects for select using (bucket_id = 'produtos');
drop policy if exists produtos_gravar on storage.objects;
create policy produtos_gravar on storage.objects for insert to authenticated with check (bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists produtos_trocar on storage.objects;
create policy produtos_trocar on storage.objects for update to authenticated using (bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists produtos_apagar on storage.objects;
create policy produtos_apagar on storage.objects for delete to authenticated using (bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.sku_fotos(p_skus text[])
returns table(sku text, foto text) language sql stable as $$
  with alvo as (select distinct lower(btrim(x)) as s from unnest(p_skus) x),
  vendas as (select lower(btrim(v.sku)) as s, v.thumbnail, v.data_venda from public.vendas_ml v
              where v.usuario_id = auth.uid() and v.thumbnail is not null and v.data_venda > now() - interval '180 days'),
  cand as (
    select a.s, m.url as thumbnail, now() as data_venda, -1 as pr from alvo a join public.sku_fotos_manual m on m.usuario_id = auth.uid() and m.sku_norm = a.s
    union all
    select a.s, v.thumbnail, v.data_venda, 0 from alvo a join vendas v on v.s = a.s
    union all
    select a.s, v.thumbnail, v.data_venda, 1 from alvo a
      join public.sku_composicao c on c.usuario_id = auth.uid() and lower(btrim(c.sku_componente)) = a.s
      join vendas v on v.s = lower(btrim(c.sku_comercial))
  )
  select distinct on (s) s, thumbnail from cand order by s, pr, data_venda desc;
$$;
