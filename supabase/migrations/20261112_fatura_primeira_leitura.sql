-- Fatura do ML: lido_ok marca a fatura que já foi lida inteira pelo menos uma vez. Enquanto alguma ainda não foi,
-- os meses estão incompletos e o DRE continua usando o que está em Contas a pagar (a releitura diária da fatura
-- aberta não desliga nada: as linhas antigas continuam gravadas).
alter table public.ml_fatura_periodos add column if not exists lido_ok boolean not null default false;
update public.ml_fatura_periodos set lido_ok = false;
drop function if exists public.ml_fatura_situacao();
create or replace function public.ml_fatura_situacao()
returns table (ml_user_id text, faturas bigint, pendentes bigint, faltam bigint, lido_ate date, lido_em timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select p.ml_user_id, count(*), count(*) filter (where not p.completo), count(*) filter (where not p.lido_ok),
         (select max(l.dia) from public.ml_fatura_linhas l where l.usuario_id = auth.uid() and l.ml_user_id = p.ml_user_id), max(p.lido_em)
  from public.ml_fatura_periodos p where p.usuario_id = auth.uid() group by 1
$$;
revoke all on function public.ml_fatura_situacao() from public, anon;
grant execute on function public.ml_fatura_situacao() to authenticated;
