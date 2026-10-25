-- Nome do comprador: o /orders do ML não traz mais o nome; ele vem do envio (ml-envios, receiver_name).
-- O ml-vendas regrava a venda com comprador_nome nulo; este gatilho mantém o nome já gravado.
create or replace function public.vendas_ml_manter_nome() returns trigger language plpgsql as $$
begin
  if coalesce(new.comprador_nome, '') = '' and coalesce(old.comprador_nome, '') <> '' then new.comprador_nome := old.comprador_nome; end if;
  return new;
end $$;
drop trigger if exists vendas_ml_manter_nome on public.vendas_ml;
create trigger vendas_ml_manter_nome before update on public.vendas_ml for each row execute function public.vendas_ml_manter_nome();
