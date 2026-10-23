-- Empréstimo pago com uma porcentagem de cada venda (Mercado Crédito / Mercado Pago): sistema 'vendas'.
-- O Mercado Pago retém parte de cada venda até completar o total a devolver; o Caixa 360 soma vendas_ml.retido_mp da conta
-- desde o início e divide cada retenção entre capital e juros na proporção valor / total a devolver.
alter table public.emprestimos drop constraint if exists emprestimos_sistema_check;
alter table public.emprestimos add constraint emprestimos_sistema_check check (sistema = any (array['price', 'sac', 'outro', 'aberto', 'vendas']));
alter table public.emprestimos add column if not exists pct_vendas numeric,        -- % retido de cada venda (informado no contrato)
                               add column if not exists total_devolver numeric,    -- valor recebido + juros/tarifa fixa
                               add column if not exists conta_ml text;             -- conta do ML onde a retenção acontece

-- retido pelo Mercado Pago por mês numa conta, a partir de uma data (só vendas do próprio usuário)
create or replace function public.emprestimo_retido(p_conta text, p_de date)
returns table(mes text, retido numeric, vendas bigint, pago numeric)
language sql stable security invoker set search_path = public as $$
  select to_char((v.data_venda at time zone 'America/Sao_Paulo')::date, 'YYYY-MM'), round(sum(v.retido_mp), 2), count(*), round(sum(v.pago_mp), 2)
  from public.vendas_ml v
  where v.usuario_id = auth.uid() and v.ml_user_id = p_conta and v.status = 'paid' and v.retido_mp > 0
    and (v.data_venda at time zone 'America/Sao_Paulo')::date >= p_de
  group by 1 order by 1
$$;
grant execute on function public.emprestimo_retido(text, date) to authenticated;
