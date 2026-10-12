-- Conciliação do Mercado Livre: linhas dos dois relatórios que o ML libera para baixar
-- ("por vendas" = origem 'v', "por liberação" = origem 'l'). Cada linha da planilha vira uma linha aqui, já com as
-- tarifas separadas por tipo (o navegador lê a planilha e separa: src/conciliacao.js).
-- chave = resumo da linha calculado no navegador: importar o mesmo arquivo (ou períodos que se sobrepõem) não duplica.
create table if not exists public.concil_linhas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  chave text not null,
  origem text not null,            -- 'v' relatório por vendas, 'l' relatório por liberação
  data date not null,              -- data da operação (v) ou da liberação (l)
  numero text,                     -- número da liberação (l)
  tipo text not null,              -- Venda, Envio, Armazenamento Full, Liberação, Estorno de liberação...
  ref text,                        -- número da operação: a venda, ou o envio nas linhas de envio
  envio text,
  status text,
  item_id text, sku text,
  bruto numeric not null default 0,
  tarifas numeric not null default 0,
  pos numeric not null default 0,  -- tarifas pós-pagas (cobradas na fatura, não descontadas da venda)
  liquido numeric not null default 0,
  t_venda numeric not null default 0, t_mp numeric not null default 0, t_parcel numeric not null default 0,
  t_envio numeric not null default 0, t_dev numeric not null default 0, t_outros numeric not null default 0,
  env_comp numeric not null default 0,   -- frete pago pelo comprador (só na linha que tem valor bruto)
  parc_comp numeric not null default 0,  -- acréscimo de parcelamento pago pelo comprador (idem)
  rebate numeric not null default 0,
  nome text,                       -- nome da tarifa nas cobranças que não são de venda
  periodo text,                    -- período de faturamento (AAAA-MM)
  primary key (usuario_id, ml_user_id, chave)
);
create index if not exists concil_linhas_ref on public.concil_linhas (usuario_id, ml_user_id, ref);
create index if not exists concil_linhas_data on public.concil_linhas (usuario_id, ml_user_id, origem, data);
alter table public.concil_linhas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'concil_linhas' and policyname = 'concil_linhas_dono') then
    create policy concil_linhas_dono on public.concil_linhas for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
  end if;
end $$;
grant select, insert, delete on public.concil_linhas to authenticated;
grant all on public.concil_linhas to service_role;
drop trigger if exists demo_so_leitura on public.concil_linhas;
create trigger demo_so_leitura before insert or update or delete on public.concil_linhas for each row execute function demo.bloqueia();

-- o que já foi importado: por conta e relatório, de quando até quando
create or replace function public.concil_cobertura() returns table (ml_user_id text, origem text, de date, ate date, linhas bigint)
language sql stable security definer set search_path to 'public' as $$
  select ml_user_id, origem, min(data), max(data), count(*) from public.concil_linhas where usuario_id = auth.uid() group by 1, 2
$$;
grant execute on function public.concil_cobertura() to authenticated;

-- apaga o que foi importado de uma conta num período (para reimportar)
create or replace function public.concil_apagar(p_conta text, p_origem text, p_de date, p_ate date) returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare n bigint;
begin
  delete from public.concil_linhas where usuario_id = auth.uid() and ml_user_id = p_conta and origem = p_origem and data between p_de and p_ate;
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.concil_apagar(text, text, date, date) to authenticated;
