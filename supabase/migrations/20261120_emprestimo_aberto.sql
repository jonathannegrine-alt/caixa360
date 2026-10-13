-- Empréstimo sem data para devolver (saldo em aberto com juros mensais): novo valor de emprestimos.sistema
alter table public.emprestimos drop constraint if exists emprestimos_sistema_check;
alter table public.emprestimos add constraint emprestimos_sistema_check check (sistema = any (array['price', 'sac', 'outro', 'aberto']));
select 1 ok;
