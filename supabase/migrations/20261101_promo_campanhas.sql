-- Campanhas do vendedor (promoções próprias no Mercado Livre): cópia do que foi lido/gravado, para listar as
-- encerradas e para copiar uma campanha de um mês para o outro (o ML só devolve as que estão ativas).
create table if not exists public.promo_campanhas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  id text not null,
  nome text, sub_tipo text, situacao text, inicio timestamptz, fim timestamptz, pct_fixa numeric,
  itens jsonb not null default '[]'::jsonb,
  atualizado timestamptz not null default now(),
  primary key (usuario_id, ml_user_id, id)
);
alter table public.promo_campanhas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'promo_campanhas' and policyname = 'promo_campanhas_dono') then
    create policy promo_campanhas_dono on public.promo_campanhas for select using (usuario_id = auth.uid());
  end if;
end $$;
grant select on public.promo_campanhas to authenticated;
grant all on public.promo_campanhas to service_role;
drop trigger if exists demo_so_leitura on public.promo_campanhas;
create trigger demo_so_leitura before insert or update or delete on public.promo_campanhas for each row execute function demo.bloqueia();

-- tira uma campanha da lista do sistema (não mexe no Mercado Livre)
create or replace function public.promo_campanha_ocultar(p_conta text, p_id text) returns void language sql security definer set search_path to 'public' as $$
  update public.promo_campanhas set situacao = 'deleted' where usuario_id = auth.uid() and ml_user_id = p_conta and id = p_id
$$;
grant execute on function public.promo_campanha_ocultar(text, text) to authenticated;
