-- Lojas separadas: cada conta a pagar, empréstimo e galpão pode pertencer a uma loja (conta do Mercado Livre).
-- loja = ml_user_id; vazio = loja padrão do usuário (configuracoes.cfg.lojaPadrao).

alter table public.pagamentos
  add column if not exists loja text,
  add column if not exists forma_pgto text,
  add column if not exists doc text,
  add column if not exists emissao date;

alter table public.emprestimos
  add column if not exists loja text,
  add column if not exists arquivo text;          -- caminho do PDF do contrato no Storage (bucket "contratos")

alter table public.estoque_depositos
  add column if not exists lojas jsonb;           -- galpão: quais lojas usam (lista de ml_user_id); null = todas

-- categorias do Olist: grupo do plano de contas (usado no DRE)
alter table public.categorias
  add column if not exists grupo text;

-- PDFs dos contratos de empréstimo: cada usuário só enxerga a própria pasta (<usuario_id>/...)
insert into storage.buckets (id, name, public) values ('contratos', 'contratos', false) on conflict (id) do nothing;
drop policy if exists "contratos do usuario" on storage.objects;
create policy "contratos do usuario" on storage.objects for all to authenticated
  using (bucket_id = 'contratos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'contratos' and (storage.foldername(name))[1] = auth.uid()::text);
