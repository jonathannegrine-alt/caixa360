-- Conferência de frete pela tabela oficial do Mercado Livre (reputação verde / MercadoLíder / sem reputação).
-- Fonte: https://www.mercadolivre.com.br/ajuda/40538. A tabela muda de tempos em tempos: cada versão entra com a
-- data em que passou a valer ("desde"). A versão anterior a 24/08/2026 foi deduzida das cobranças da época
-- (os valores coincidem com a tabela de atacado atual, /ajuda/56258).
--   faixa de preço: 0 = até 18,99 | 1 = 19 a 48,99 | 2 = 49 a 78,99 | 3 = 79 a 99,99 | 4 = 100 a 119,99 | 5 = 120 a 149,99 | 6 = 150 a 199,99 | 7 = 200 ou mais

create table if not exists public.frete_tabela (
  desde date not null,
  linha int not null,
  peso_ate_g numeric not null,
  rotulo text not null,
  faixa int not null,
  valor numeric not null,
  primary key (desde, linha, faixa)
);
alter table public.frete_tabela enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'frete_tabela' and policyname = 'frete_tabela_ler') then
    create policy frete_tabela_ler on public.frete_tabela for select using (true);
  end if;
end $$;
grant select on public.frete_tabela to authenticated, anon;
create index if not exists frete_tabela_valor on public.frete_tabela (desde, valor);
grant all on public.frete_tabela to service_role;

delete from public.frete_tabela where desde in ('2000-01-01', '2026-08-24');
insert into public.frete_tabela (desde, linha, peso_ate_g, rotulo, faixa, valor) values
  ('2000-01-01',0,300,'Até 0,3 kg',0,5.65),('2000-01-01',0,300,'Até 0,3 kg',1,6.55),('2000-01-01',0,300,'Até 0,3 kg',2,7.75),('2000-01-01',0,300,'Até 0,3 kg',3,12.35),('2000-01-01',0,300,'Até 0,3 kg',4,14.35),('2000-01-01',0,300,'Até 0,3 kg',5,16.45),('2000-01-01',0,300,'Até 0,3 kg',6,18.45),('2000-01-01',0,300,'Até 0,3 kg',7,20.95),
  ('2000-01-01',1,500,'0,3 a 0,5 kg',0,5.95),('2000-01-01',1,500,'0,3 a 0,5 kg',1,6.65),('2000-01-01',1,500,'0,3 a 0,5 kg',2,7.85),('2000-01-01',1,500,'0,3 a 0,5 kg',3,13.25),('2000-01-01',1,500,'0,3 a 0,5 kg',4,15.45),('2000-01-01',1,500,'0,3 a 0,5 kg',5,17.65),('2000-01-01',1,500,'0,3 a 0,5 kg',6,19.85),('2000-01-01',1,500,'0,3 a 0,5 kg',7,22.55),
  ('2000-01-01',2,1000,'0,5 a 1 kg',0,6.05),('2000-01-01',2,1000,'0,5 a 1 kg',1,6.75),('2000-01-01',2,1000,'0,5 a 1 kg',2,7.95),('2000-01-01',2,1000,'0,5 a 1 kg',3,13.85),('2000-01-01',2,1000,'0,5 a 1 kg',4,16.15),('2000-01-01',2,1000,'0,5 a 1 kg',5,18.45),('2000-01-01',2,1000,'0,5 a 1 kg',6,20.75),('2000-01-01',2,1000,'0,5 a 1 kg',7,23.65),
  ('2000-01-01',3,1500,'1 a 1,5 kg',0,6.15),('2000-01-01',3,1500,'1 a 1,5 kg',1,6.85),('2000-01-01',3,1500,'1 a 1,5 kg',2,8.05),('2000-01-01',3,1500,'1 a 1,5 kg',3,14.15),('2000-01-01',3,1500,'1 a 1,5 kg',4,16.45),('2000-01-01',3,1500,'1 a 1,5 kg',5,18.85),('2000-01-01',3,1500,'1 a 1,5 kg',6,21.15),('2000-01-01',3,1500,'1 a 1,5 kg',7,24.65),
  ('2000-01-01',4,2000,'1,5 a 2 kg',0,6.25),('2000-01-01',4,2000,'1,5 a 2 kg',1,6.95),('2000-01-01',4,2000,'1,5 a 2 kg',2,8.15),('2000-01-01',4,2000,'1,5 a 2 kg',3,14.45),('2000-01-01',4,2000,'1,5 a 2 kg',4,16.85),('2000-01-01',4,2000,'1,5 a 2 kg',5,19.25),('2000-01-01',4,2000,'1,5 a 2 kg',6,21.65),('2000-01-01',4,2000,'1,5 a 2 kg',7,24.65),
  ('2000-01-01',5,3000,'2 a 3 kg',0,6.35),('2000-01-01',5,3000,'2 a 3 kg',1,7.95),('2000-01-01',5,3000,'2 a 3 kg',2,8.55),('2000-01-01',5,3000,'2 a 3 kg',3,15.75),('2000-01-01',5,3000,'2 a 3 kg',4,18.35),('2000-01-01',5,3000,'2 a 3 kg',5,21.05),('2000-01-01',5,3000,'2 a 3 kg',6,23.65),('2000-01-01',5,3000,'2 a 3 kg',7,26.25),
  ('2000-01-01',6,4000,'3 a 4 kg',0,6.45),('2000-01-01',6,4000,'3 a 4 kg',1,8.15),('2000-01-01',6,4000,'3 a 4 kg',2,8.95),('2000-01-01',6,4000,'3 a 4 kg',3,17.05),('2000-01-01',6,4000,'3 a 4 kg',4,19.85),('2000-01-01',6,4000,'3 a 4 kg',5,22.65),('2000-01-01',6,4000,'3 a 4 kg',6,25.55),('2000-01-01',6,4000,'3 a 4 kg',7,28.35),
  ('2000-01-01',7,5000,'4 a 5 kg',0,6.55),('2000-01-01',7,5000,'4 a 5 kg',1,8.35),('2000-01-01',7,5000,'4 a 5 kg',2,9.75),('2000-01-01',7,5000,'4 a 5 kg',3,18.45),('2000-01-01',7,5000,'4 a 5 kg',4,21.55),('2000-01-01',7,5000,'4 a 5 kg',5,24.65),('2000-01-01',7,5000,'4 a 5 kg',6,27.75),('2000-01-01',7,5000,'4 a 5 kg',7,30.75),
  ('2000-01-01',8,6000,'5 a 6 kg',0,6.65),('2000-01-01',8,6000,'5 a 6 kg',1,8.55),('2000-01-01',8,6000,'5 a 6 kg',2,9.95),('2000-01-01',8,6000,'5 a 6 kg',3,25.45),('2000-01-01',8,6000,'5 a 6 kg',4,28.55),('2000-01-01',8,6000,'5 a 6 kg',5,32.65),('2000-01-01',8,6000,'5 a 6 kg',6,35.75),('2000-01-01',8,6000,'5 a 6 kg',7,39.75),
  ('2000-01-01',9,7000,'6 a 7 kg',0,6.75),('2000-01-01',9,7000,'6 a 7 kg',1,8.75),('2000-01-01',9,7000,'6 a 7 kg',2,10.15),('2000-01-01',9,7000,'6 a 7 kg',3,27.05),('2000-01-01',9,7000,'6 a 7 kg',4,31.05),('2000-01-01',9,7000,'6 a 7 kg',5,36.05),('2000-01-01',9,7000,'6 a 7 kg',6,40.05),('2000-01-01',9,7000,'6 a 7 kg',7,44.05),
  ('2000-01-01',10,8000,'7 a 8 kg',0,6.85),('2000-01-01',10,8000,'7 a 8 kg',1,8.95),('2000-01-01',10,8000,'7 a 8 kg',2,10.35),('2000-01-01',10,8000,'7 a 8 kg',3,28.85),('2000-01-01',10,8000,'7 a 8 kg',4,33.65),('2000-01-01',10,8000,'7 a 8 kg',5,38.45),('2000-01-01',10,8000,'7 a 8 kg',6,43.25),('2000-01-01',10,8000,'7 a 8 kg',7,48.05),
  ('2000-01-01',11,9000,'8 a 9 kg',0,6.95),('2000-01-01',11,9000,'8 a 9 kg',1,9.15),('2000-01-01',11,9000,'8 a 9 kg',2,10.55),('2000-01-01',11,9000,'8 a 9 kg',3,29.65),('2000-01-01',11,9000,'8 a 9 kg',4,34.55),('2000-01-01',11,9000,'8 a 9 kg',5,39.55),('2000-01-01',11,9000,'8 a 9 kg',6,44.45),('2000-01-01',11,9000,'8 a 9 kg',7,49.35),
  ('2000-01-01',12,11000,'9 a 11 kg',0,7.05),('2000-01-01',12,11000,'9 a 11 kg',1,9.55),('2000-01-01',12,11000,'9 a 11 kg',2,10.95),('2000-01-01',12,11000,'9 a 11 kg',3,41.25),('2000-01-01',12,11000,'9 a 11 kg',4,48.05),('2000-01-01',12,11000,'9 a 11 kg',5,54.95),('2000-01-01',12,11000,'9 a 11 kg',6,61.75),('2000-01-01',12,11000,'9 a 11 kg',7,68.65),
  ('2000-01-01',13,13000,'11 a 13 kg',0,7.15),('2000-01-01',13,13000,'11 a 13 kg',1,9.95),('2000-01-01',13,13000,'11 a 13 kg',2,11.35),('2000-01-01',13,13000,'11 a 13 kg',3,42.15),('2000-01-01',13,13000,'11 a 13 kg',4,49.25),('2000-01-01',13,13000,'11 a 13 kg',5,56.25),('2000-01-01',13,13000,'11 a 13 kg',6,63.25),('2000-01-01',13,13000,'11 a 13 kg',7,70.25),
  ('2000-01-01',14,15000,'13 a 15 kg',0,7.25),('2000-01-01',14,15000,'13 a 15 kg',1,10.15),('2000-01-01',14,15000,'13 a 15 kg',2,11.55),('2000-01-01',14,15000,'13 a 15 kg',3,45.05),('2000-01-01',14,15000,'13 a 15 kg',4,52.45),('2000-01-01',14,15000,'13 a 15 kg',5,59.95),('2000-01-01',14,15000,'13 a 15 kg',6,67.45),('2000-01-01',14,15000,'13 a 15 kg',7,74.95),
  ('2000-01-01',15,17000,'15 a 17 kg',0,7.35),('2000-01-01',15,17000,'15 a 17 kg',1,10.35),('2000-01-01',15,17000,'15 a 17 kg',2,11.75),('2000-01-01',15,17000,'15 a 17 kg',3,48.55),('2000-01-01',15,17000,'15 a 17 kg',4,56.05),('2000-01-01',15,17000,'15 a 17 kg',5,63.55),('2000-01-01',15,17000,'15 a 17 kg',6,70.75),('2000-01-01',15,17000,'15 a 17 kg',7,78.65),
  ('2000-01-01',16,20000,'17 a 20 kg',0,7.45),('2000-01-01',16,20000,'17 a 20 kg',1,10.55),('2000-01-01',16,20000,'17 a 20 kg',2,11.95),('2000-01-01',16,20000,'17 a 20 kg',3,54.75),('2000-01-01',16,20000,'17 a 20 kg',4,63.85),('2000-01-01',16,20000,'17 a 20 kg',5,72.95),('2000-01-01',16,20000,'17 a 20 kg',6,82.05),('2000-01-01',16,20000,'17 a 20 kg',7,91.15),
  ('2000-01-01',17,25000,'20 a 25 kg',0,7.65),('2000-01-01',17,25000,'20 a 25 kg',1,10.95),('2000-01-01',17,25000,'20 a 25 kg',2,12.15),('2000-01-01',17,25000,'20 a 25 kg',3,64.05),('2000-01-01',17,25000,'20 a 25 kg',4,75.05),('2000-01-01',17,25000,'20 a 25 kg',5,84.75),('2000-01-01',17,25000,'20 a 25 kg',6,95.35),('2000-01-01',17,25000,'20 a 25 kg',7,105.95),
  ('2000-01-01',18,30000,'25 a 30 kg',0,7.75),('2000-01-01',18,30000,'25 a 30 kg',1,11.15),('2000-01-01',18,30000,'25 a 30 kg',2,12.35),('2000-01-01',18,30000,'25 a 30 kg',3,65.95),('2000-01-01',18,30000,'25 a 30 kg',4,75.45),('2000-01-01',18,30000,'25 a 30 kg',5,85.55),('2000-01-01',18,30000,'25 a 30 kg',6,96.25),('2000-01-01',18,30000,'25 a 30 kg',7,106.95),
  ('2000-01-01',19,40000,'30 a 40 kg',0,7.85),('2000-01-01',19,40000,'30 a 40 kg',1,11.35),('2000-01-01',19,40000,'30 a 40 kg',2,12.55),('2000-01-01',19,40000,'30 a 40 kg',3,67.75),('2000-01-01',19,40000,'30 a 40 kg',4,78.95),('2000-01-01',19,40000,'30 a 40 kg',5,88.95),('2000-01-01',19,40000,'30 a 40 kg',6,99.15),('2000-01-01',19,40000,'30 a 40 kg',7,107.05),
  ('2000-01-01',20,50000,'40 a 50 kg',0,7.95),('2000-01-01',20,50000,'40 a 50 kg',1,11.55),('2000-01-01',20,50000,'40 a 50 kg',2,12.75),('2000-01-01',20,50000,'40 a 50 kg',3,70.25),('2000-01-01',20,50000,'40 a 50 kg',4,81.05),('2000-01-01',20,50000,'40 a 50 kg',5,92.05),('2000-01-01',20,50000,'40 a 50 kg',6,102.55),('2000-01-01',20,50000,'40 a 50 kg',7,110.75),
  ('2000-01-01',21,60000,'50 a 60 kg',0,8.05),('2000-01-01',21,60000,'50 a 60 kg',1,11.75),('2000-01-01',21,60000,'50 a 60 kg',2,12.95),('2000-01-01',21,60000,'50 a 60 kg',3,74.95),('2000-01-01',21,60000,'50 a 60 kg',4,86.45),('2000-01-01',21,60000,'50 a 60 kg',5,98.15),('2000-01-01',21,60000,'50 a 60 kg',6,109.35),('2000-01-01',21,60000,'50 a 60 kg',7,118.15),
  ('2000-01-01',22,70000,'60 a 70 kg',0,8.15),('2000-01-01',22,70000,'60 a 70 kg',1,11.95),('2000-01-01',22,70000,'60 a 70 kg',2,13.15),('2000-01-01',22,70000,'60 a 70 kg',3,80.25),('2000-01-01',22,70000,'60 a 70 kg',4,92.95),('2000-01-01',22,70000,'60 a 70 kg',5,105.05),('2000-01-01',22,70000,'60 a 70 kg',6,117.15),('2000-01-01',22,70000,'60 a 70 kg',7,126.55),
  ('2000-01-01',23,80000,'70 a 80 kg',0,8.25),('2000-01-01',23,80000,'70 a 80 kg',1,12.15),('2000-01-01',23,80000,'70 a 80 kg',2,13.35),('2000-01-01',23,80000,'70 a 80 kg',3,83.95),('2000-01-01',23,80000,'70 a 80 kg',4,97.05),('2000-01-01',23,80000,'70 a 80 kg',5,109.85),('2000-01-01',23,80000,'70 a 80 kg',6,122.45),('2000-01-01',23,80000,'70 a 80 kg',7,132.25),
  ('2000-01-01',24,90000,'80 a 90 kg',0,8.35),('2000-01-01',24,90000,'80 a 90 kg',1,12.35),('2000-01-01',24,90000,'80 a 90 kg',2,13.55),('2000-01-01',24,90000,'80 a 90 kg',3,93.25),('2000-01-01',24,90000,'80 a 90 kg',4,107.45),('2000-01-01',24,90000,'80 a 90 kg',5,122.05),('2000-01-01',24,90000,'80 a 90 kg',6,136.05),('2000-01-01',24,90000,'80 a 90 kg',7,146.95),
  ('2000-01-01',25,100000,'90 a 100 kg',0,8.45),('2000-01-01',25,100000,'90 a 100 kg',1,12.55),('2000-01-01',25,100000,'90 a 100 kg',2,13.75),('2000-01-01',25,100000,'90 a 100 kg',3,106.55),('2000-01-01',25,100000,'90 a 100 kg',4,123.95),('2000-01-01',25,100000,'90 a 100 kg',5,139.55),('2000-01-01',25,100000,'90 a 100 kg',6,155.55),('2000-01-01',25,100000,'90 a 100 kg',7,167.95),
  ('2000-01-01',26,125000,'100 a 125 kg',0,8.55),('2000-01-01',26,125000,'100 a 125 kg',1,12.75),('2000-01-01',26,125000,'100 a 125 kg',2,13.95),('2000-01-01',26,125000,'100 a 125 kg',3,119.25),('2000-01-01',26,125000,'100 a 125 kg',4,138.05),('2000-01-01',26,125000,'100 a 125 kg',5,156.05),('2000-01-01',26,125000,'100 a 125 kg',6,173.95),('2000-01-01',26,125000,'100 a 125 kg',7,187.95),
  ('2000-01-01',27,150000,'125 a 150 kg',0,8.65),('2000-01-01',27,150000,'125 a 150 kg',1,12.75),('2000-01-01',27,150000,'125 a 150 kg',2,14.15),('2000-01-01',27,150000,'125 a 150 kg',3,126.55),('2000-01-01',27,150000,'125 a 150 kg',4,146.15),('2000-01-01',27,150000,'125 a 150 kg',5,165.65),('2000-01-01',27,150000,'125 a 150 kg',6,184.65),('2000-01-01',27,150000,'125 a 150 kg',7,199.45),
  ('2000-01-01',28,99999999,'Mais de 150 kg',0,8.75),('2000-01-01',28,99999999,'Mais de 150 kg',1,12.95),('2000-01-01',28,99999999,'Mais de 150 kg',2,14.35),('2000-01-01',28,99999999,'Mais de 150 kg',3,166.15),('2000-01-01',28,99999999,'Mais de 150 kg',4,192.45),('2000-01-01',28,99999999,'Mais de 150 kg',5,217.55),('2000-01-01',28,99999999,'Mais de 150 kg',6,242.55),('2000-01-01',28,99999999,'Mais de 150 kg',7,261.95),
  ('2026-08-24',0,300,'Até 0,3 kg',0,5.65),('2026-08-24',0,300,'Até 0,3 kg',1,6.85),('2026-08-24',0,300,'Até 0,3 kg',2,8.15),('2026-08-24',0,300,'Até 0,3 kg',3,12.95),('2026-08-24',0,300,'Até 0,3 kg',4,14.95),('2026-08-24',0,300,'Até 0,3 kg',5,16.95),('2026-08-24',0,300,'Até 0,3 kg',6,19.05),('2026-08-24',0,300,'Até 0,3 kg',7,21.65),
  ('2026-08-24',1,500,'0,3 a 0,5 kg',0,5.95),('2026-08-24',1,500,'0,3 a 0,5 kg',1,6.95),('2026-08-24',1,500,'0,3 a 0,5 kg',2,8.25),('2026-08-24',1,500,'0,3 a 0,5 kg',3,13.85),('2026-08-24',1,500,'0,3 a 0,5 kg',4,16.15),('2026-08-24',1,500,'0,3 a 0,5 kg',5,18.15),('2026-08-24',1,500,'0,3 a 0,5 kg',6,20.45),('2026-08-24',1,500,'0,3 a 0,5 kg',7,23.25),
  ('2026-08-24',2,1000,'0,5 a 1 kg',0,6.05),('2026-08-24',2,1000,'0,5 a 1 kg',1,7.15),('2026-08-24',2,1000,'0,5 a 1 kg',2,8.45),('2026-08-24',2,1000,'0,5 a 1 kg',3,14.45),('2026-08-24',2,1000,'0,5 a 1 kg',4,16.85),('2026-08-24',2,1000,'0,5 a 1 kg',5,19.05),('2026-08-24',2,1000,'0,5 a 1 kg',6,21.35),('2026-08-24',2,1000,'0,5 a 1 kg',7,24.45),
  ('2026-08-24',3,1500,'1 a 1,5 kg',0,6.15),('2026-08-24',3,1500,'1 a 1,5 kg',1,7.35),('2026-08-24',3,1500,'1 a 1,5 kg',2,8.65),('2026-08-24',3,1500,'1 a 1,5 kg',3,14.75),('2026-08-24',3,1500,'1 a 1,5 kg',4,17.15),('2026-08-24',3,1500,'1 a 1,5 kg',5,19.45),('2026-08-24',3,1500,'1 a 1,5 kg',6,21.75),('2026-08-24',3,1500,'1 a 1,5 kg',7,25.45),
  ('2026-08-24',4,2000,'1,5 a 2 kg',0,6.25),('2026-08-24',4,2000,'1,5 a 2 kg',1,7.45),('2026-08-24',4,2000,'1,5 a 2 kg',2,8.75),('2026-08-24',4,2000,'1,5 a 2 kg',3,15.05),('2026-08-24',4,2000,'1,5 a 2 kg',4,17.65),('2026-08-24',4,2000,'1,5 a 2 kg',5,19.85),('2026-08-24',4,2000,'1,5 a 2 kg',6,22.25),('2026-08-24',4,2000,'1,5 a 2 kg',7,25.55),
  ('2026-08-24',5,3000,'2 a 3 kg',0,6.35),('2026-08-24',5,3000,'2 a 3 kg',1,8.65),('2026-08-24',5,3000,'2 a 3 kg',2,9.15),('2026-08-24',5,3000,'2 a 3 kg',3,16.45),('2026-08-24',5,3000,'2 a 3 kg',4,19.15),('2026-08-24',5,3000,'2 a 3 kg',5,21.65),('2026-08-24',5,3000,'2 a 3 kg',6,24.35),('2026-08-24',5,3000,'2 a 3 kg',7,27.05),
  ('2026-08-24',6,4000,'3 a 4 kg',0,6.45),('2026-08-24',6,4000,'3 a 4 kg',1,8.75),('2026-08-24',6,4000,'3 a 4 kg',2,9.75),('2026-08-24',6,4000,'3 a 4 kg',3,17.85),('2026-08-24',6,4000,'3 a 4 kg',4,20.75),('2026-08-24',6,4000,'3 a 4 kg',5,23.35),('2026-08-24',6,4000,'3 a 4 kg',6,26.35),('2026-08-24',6,4000,'3 a 4 kg',7,29.25),
  ('2026-08-24',7,5000,'4 a 5 kg',0,6.55),('2026-08-24',7,5000,'4 a 5 kg',1,8.85),('2026-08-24',7,5000,'4 a 5 kg',2,10.25),('2026-08-24',7,5000,'4 a 5 kg',3,19.75),('2026-08-24',7,5000,'4 a 5 kg',4,22.85),('2026-08-24',7,5000,'4 a 5 kg',5,26.05),('2026-08-24',7,5000,'4 a 5 kg',6,29.25),('2026-08-24',7,5000,'4 a 5 kg',7,32.45),
  ('2026-08-24',8,6000,'5 a 6 kg',0,6.65),('2026-08-24',8,6000,'5 a 6 kg',1,8.95),('2026-08-24',8,6000,'5 a 6 kg',2,10.35),('2026-08-24',8,6000,'5 a 6 kg',3,25.95),('2026-08-24',8,6000,'5 a 6 kg',4,29.15),('2026-08-24',8,6000,'5 a 6 kg',5,33.35),('2026-08-24',8,6000,'5 a 6 kg',6,36.45),('2026-08-24',8,6000,'5 a 6 kg',7,40.85),
  ('2026-08-24',9,7000,'6 a 7 kg',0,6.75),('2026-08-24',9,7000,'6 a 7 kg',1,9.05),('2026-08-24',9,7000,'6 a 7 kg',2,10.45),('2026-08-24',9,7000,'6 a 7 kg',3,27.55),('2026-08-24',9,7000,'6 a 7 kg',4,31.65),('2026-08-24',9,7000,'6 a 7 kg',5,36.75),('2026-08-24',9,7000,'6 a 7 kg',6,40.85),('2026-08-24',9,7000,'6 a 7 kg',7,45.25),
  ('2026-08-24',10,8000,'7 a 8 kg',0,6.85),('2026-08-24',10,8000,'7 a 8 kg',1,9.25),('2026-08-24',10,8000,'7 a 8 kg',2,10.55),('2026-08-24',10,8000,'7 a 8 kg',3,29.45),('2026-08-24',10,8000,'7 a 8 kg',4,34.35),('2026-08-24',10,8000,'7 a 8 kg',5,39.25),('2026-08-24',10,8000,'7 a 8 kg',6,44.15),('2026-08-24',10,8000,'7 a 8 kg',7,49.35),
  ('2026-08-24',11,9000,'8 a 9 kg',0,6.95),('2026-08-24',11,9000,'8 a 9 kg',1,9.35),('2026-08-24',11,9000,'8 a 9 kg',2,10.65),('2026-08-24',11,9000,'8 a 9 kg',3,30.25),('2026-08-24',11,9000,'8 a 9 kg',4,35.25),('2026-08-24',11,9000,'8 a 9 kg',5,40.35),('2026-08-24',11,9000,'8 a 9 kg',6,45.35),('2026-08-24',11,9000,'8 a 9 kg',7,50.75),
  ('2026-08-24',12,10000,'9 a 10 kg',0,7.05),('2026-08-24',12,10000,'9 a 10 kg',1,9.45),('2026-08-24',12,10000,'9 a 10 kg',2,10.85),('2026-08-24',12,10000,'9 a 10 kg',3,38.25),('2026-08-24',12,10000,'9 a 10 kg',4,45.05),('2026-08-24',12,10000,'9 a 10 kg',5,51.95),('2026-08-24',12,10000,'9 a 10 kg',6,58.75),('2026-08-24',12,10000,'9 a 10 kg',7,65.85),
  ('2026-08-24',13,11000,'10 a 11 kg',0,7.05),('2026-08-24',13,11000,'10 a 11 kg',1,9.65),('2026-08-24',13,11000,'10 a 11 kg',2,11.05),('2026-08-24',13,11000,'10 a 11 kg',3,41.65),('2026-08-24',13,11000,'10 a 11 kg',4,48.55),('2026-08-24',13,11000,'10 a 11 kg',5,55.45),('2026-08-24',13,11000,'10 a 11 kg',6,62.35),('2026-08-24',13,11000,'10 a 11 kg',7,69.35),
  ('2026-08-24',14,13000,'11 a 13 kg',0,7.15),('2026-08-24',14,13000,'11 a 13 kg',1,10.05),('2026-08-24',14,13000,'11 a 13 kg',2,11.45),('2026-08-24',14,13000,'11 a 13 kg',3,42.55),('2026-08-24',14,13000,'11 a 13 kg',4,49.75),('2026-08-24',14,13000,'11 a 13 kg',5,56.85),('2026-08-24',14,13000,'11 a 13 kg',6,63.85),('2026-08-24',14,13000,'11 a 13 kg',7,70.95),
  ('2026-08-24',15,15000,'13 a 15 kg',0,7.25),('2026-08-24',15,15000,'13 a 15 kg',1,10.25),('2026-08-24',15,15000,'13 a 15 kg',2,11.65),('2026-08-24',15,15000,'13 a 15 kg',3,45.55),('2026-08-24',15,15000,'13 a 15 kg',4,52.95),('2026-08-24',15,15000,'13 a 15 kg',5,60.55),('2026-08-24',15,15000,'13 a 15 kg',6,68.15),('2026-08-24',15,15000,'13 a 15 kg',7,75.65),
  ('2026-08-24',16,17000,'15 a 17 kg',0,7.35),('2026-08-24',16,17000,'15 a 17 kg',1,10.45),('2026-08-24',16,17000,'15 a 17 kg',2,11.85),('2026-08-24',16,17000,'15 a 17 kg',3,48.95),('2026-08-24',16,17000,'15 a 17 kg',4,56.55),('2026-08-24',16,17000,'15 a 17 kg',5,64.05),('2026-08-24',16,17000,'15 a 17 kg',6,71.35),('2026-08-24',16,17000,'15 a 17 kg',7,79.35),
  ('2026-08-24',17,20000,'17 a 20 kg',0,7.45),('2026-08-24',17,20000,'17 a 20 kg',1,10.65),('2026-08-24',17,20000,'17 a 20 kg',2,12.05),('2026-08-24',17,20000,'17 a 20 kg',3,55.15),('2026-08-24',17,20000,'17 a 20 kg',4,64.35),('2026-08-24',17,20000,'17 a 20 kg',5,73.55),('2026-08-24',17,20000,'17 a 20 kg',6,82.75),('2026-08-24',17,20000,'17 a 20 kg',7,91.95),
  ('2026-08-24',18,25000,'20 a 25 kg',0,7.65),('2026-08-24',18,25000,'20 a 25 kg',1,11.05),('2026-08-24',18,25000,'20 a 25 kg',2,12.25),('2026-08-24',18,25000,'20 a 25 kg',3,64.55),('2026-08-24',18,25000,'20 a 25 kg',4,75.75),('2026-08-24',18,25000,'20 a 25 kg',5,85.45),('2026-08-24',18,25000,'20 a 25 kg',6,96.25),('2026-08-24',18,25000,'20 a 25 kg',7,106.85),
  ('2026-08-24',19,30000,'25 a 30 kg',0,7.75),('2026-08-24',19,30000,'25 a 30 kg',1,11.25),('2026-08-24',19,30000,'25 a 30 kg',2,12.45),('2026-08-24',19,30000,'25 a 30 kg',3,66.45),('2026-08-24',19,30000,'25 a 30 kg',4,76.05),('2026-08-24',19,30000,'25 a 30 kg',5,86.25),('2026-08-24',19,30000,'25 a 30 kg',6,97.15),('2026-08-24',19,30000,'25 a 30 kg',7,107.85),
  ('2026-08-24',20,40000,'30 a 40 kg',0,7.85),('2026-08-24',20,40000,'30 a 40 kg',1,11.45),('2026-08-24',20,40000,'30 a 40 kg',2,12.65),('2026-08-24',20,40000,'30 a 40 kg',3,68.35),('2026-08-24',20,40000,'30 a 40 kg',4,79.65),('2026-08-24',20,40000,'30 a 40 kg',5,89.75),('2026-08-24',20,40000,'30 a 40 kg',6,100.05),('2026-08-24',20,40000,'30 a 40 kg',7,107.95),
  ('2026-08-24',21,50000,'40 a 50 kg',0,7.95),('2026-08-24',21,50000,'40 a 50 kg',1,11.65),('2026-08-24',21,50000,'40 a 50 kg',2,12.85),('2026-08-24',21,50000,'40 a 50 kg',3,70.95),('2026-08-24',21,50000,'40 a 50 kg',4,81.85),('2026-08-24',21,50000,'40 a 50 kg',5,92.85),('2026-08-24',21,50000,'40 a 50 kg',6,103.45),('2026-08-24',21,50000,'40 a 50 kg',7,111.65),
  ('2026-08-24',22,60000,'50 a 60 kg',0,8.05),('2026-08-24',22,60000,'50 a 60 kg',1,11.85),('2026-08-24',22,60000,'50 a 60 kg',2,13.05),('2026-08-24',22,60000,'50 a 60 kg',3,75.55),('2026-08-24',22,60000,'50 a 60 kg',4,87.25),('2026-08-24',22,60000,'50 a 60 kg',5,99.05),('2026-08-24',22,60000,'50 a 60 kg',6,110.25),('2026-08-24',22,60000,'50 a 60 kg',7,119.05),
  ('2026-08-24',23,70000,'60 a 70 kg',0,8.15),('2026-08-24',23,70000,'60 a 70 kg',1,12.05),('2026-08-24',23,70000,'60 a 70 kg',2,13.25),('2026-08-24',23,70000,'60 a 70 kg',3,80.95),('2026-08-24',23,70000,'60 a 70 kg',4,93.75),('2026-08-24',23,70000,'60 a 70 kg',5,105.95),('2026-08-24',23,70000,'60 a 70 kg',6,118.05),('2026-08-24',23,70000,'60 a 70 kg',7,127.45),
  ('2026-08-24',24,80000,'70 a 80 kg',0,8.25),('2026-08-24',24,80000,'70 a 80 kg',1,12.25),('2026-08-24',24,80000,'70 a 80 kg',2,13.45),('2026-08-24',24,80000,'70 a 80 kg',3,84.65),('2026-08-24',24,80000,'70 a 80 kg',4,97.95),('2026-08-24',24,80000,'70 a 80 kg',5,110.75),('2026-08-24',24,80000,'70 a 80 kg',6,123.35),('2026-08-24',24,80000,'70 a 80 kg',7,133.15),
  ('2026-08-24',25,90000,'80 a 90 kg',0,8.35),('2026-08-24',25,90000,'80 a 90 kg',1,12.45),('2026-08-24',25,90000,'80 a 90 kg',2,13.65),('2026-08-24',25,90000,'80 a 90 kg',3,94.05),('2026-08-24',25,90000,'80 a 90 kg',4,108.35),('2026-08-24',25,90000,'80 a 90 kg',5,122.95),('2026-08-24',25,90000,'80 a 90 kg',6,136.95),('2026-08-24',25,90000,'80 a 90 kg',7,147.85),
  ('2026-08-24',26,100000,'90 a 100 kg',0,8.45),('2026-08-24',26,100000,'90 a 100 kg',1,12.65),('2026-08-24',26,100000,'90 a 100 kg',2,13.85),('2026-08-24',26,100000,'90 a 100 kg',3,107.45),('2026-08-24',26,100000,'90 a 100 kg',4,124.85),('2026-08-24',26,100000,'90 a 100 kg',5,140.45),('2026-08-24',26,100000,'90 a 100 kg',6,156.45),('2026-08-24',26,100000,'90 a 100 kg',7,168.85),
  ('2026-08-24',27,125000,'100 a 125 kg',0,8.55),('2026-08-24',27,125000,'100 a 125 kg',1,12.85),('2026-08-24',27,125000,'100 a 125 kg',2,14.05),('2026-08-24',27,125000,'100 a 125 kg',3,120.15),('2026-08-24',27,125000,'100 a 125 kg',4,138.95),('2026-08-24',27,125000,'100 a 125 kg',5,156.95),('2026-08-24',27,125000,'100 a 125 kg',6,174.85),('2026-08-24',27,125000,'100 a 125 kg',7,188.85),
  ('2026-08-24',28,150000,'125 a 150 kg',0,8.65),('2026-08-24',28,150000,'125 a 150 kg',1,12.85),('2026-08-24',28,150000,'125 a 150 kg',2,14.25),('2026-08-24',28,150000,'125 a 150 kg',3,127.45),('2026-08-24',28,150000,'125 a 150 kg',4,147.05),('2026-08-24',28,150000,'125 a 150 kg',5,166.55),('2026-08-24',28,150000,'125 a 150 kg',6,185.55),('2026-08-24',28,150000,'125 a 150 kg',7,200.35),
  ('2026-08-24',29,99999999,'Mais de 150 kg',0,8.75),('2026-08-24',29,99999999,'Mais de 150 kg',1,12.85),('2026-08-24',29,99999999,'Mais de 150 kg',2,14.45),('2026-08-24',29,99999999,'Mais de 150 kg',3,167.05),('2026-08-24',29,99999999,'Mais de 150 kg',4,193.35),('2026-08-24',29,99999999,'Mais de 150 kg',5,218.45),('2026-08-24',29,99999999,'Mais de 150 kg',6,243.45),('2026-08-24',29,99999999,'Mais de 150 kg',7,262.85);

create or replace function public.frete_faixa(p numeric) returns int language sql immutable as $$
  select case when p < 19 then 0 when p < 49 then 1 when p < 79 then 2 when p < 100 then 3 when p < 120 then 4 when p < 150 then 5 when p < 200 then 6 else 7 end
$$;

-- Dados de cada anúncio lidos no Mercado Livre (função ml-promos, ação "base"): peso tarifável (o peso que o ML usa
-- para cobrar o frete), tarifa de venda, SKU e preço. Servem à conferência de frete e à margem nas promoções.
create table if not exists public.ml_itens_base (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ml_user_id text not null,
  item_id text not null,
  titulo text, thumbnail text, sku text, preco numeric, categoria text, tipo_anuncio text,
  tarifa_pct numeric, peso_g numeric, frete_lista numeric, logistica text,
  lido_em timestamptz not null default now(),
  primary key (usuario_id, ml_user_id, item_id)
);
alter table public.ml_itens_base enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ml_itens_base' and policyname = 'ml_itens_base_dono') then
    create policy ml_itens_base_dono on public.ml_itens_base for select using (usuario_id = auth.uid());
  end if;
end $$;
grant select on public.ml_itens_base to authenticated;
grant all on public.ml_itens_base to service_role;

-- Medida do produto registrada pelo ML nos envios (por unidade): Full e agência/coleta separados.
alter table public.ml_itens_base
  add column if not exists full_a numeric, add column if not exists full_l numeric, add column if not exists full_c numeric, add column if not exists full_g numeric, add column if not exists full_envio text,
  add column if not exists ag_a numeric, add column if not exists ag_l numeric, add column if not exists ag_c numeric, add column if not exists ag_g numeric, add column if not exists ag_envio text, add column if not exists ag_origem text,
  add column if not exists env_lido timestamptz;

-- Peso e medidas conferidos pelo próprio usuário na expedição (opcional). Quem não preenche fica com o peso tarifável do ML.
create table if not exists public.frete_medidas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  altura numeric, largura numeric, comprimento numeric, peso_g numeric,
  atualizado timestamptz not null default now(),
  primary key (usuario_id, item_id)
);
alter table public.frete_medidas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'frete_medidas' and policyname = 'frete_medidas_dono') then
    create policy frete_medidas_dono on public.frete_medidas for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
  end if;
end $$;
grant select, insert, update, delete on public.frete_medidas to authenticated;
grant all on public.frete_medidas to service_role;

do $$ declare t text; begin
  for t in select unnest(array['ml_itens_base', 'frete_medidas']) loop
    execute format('drop trigger if exists demo_so_leitura on public.%I', t);
    execute format('create trigger demo_so_leitura before insert or update or delete on public.%I for each row execute function demo.bloqueia()', t);
  end loop;
end $$;

-- Anúncios com venda no período cujo peso tarifável ainda não foi lido (ou foi lido há mais de 7 dias).
create or replace function public.frete_itens_sem_base(p_de date, p_ate date, p_conta text default null)
returns table (ml_user_id text, item_id text) language sql stable as $$
  select v.ml_user_id, v.item_id
  from public.vendas_ml v
  left join public.ml_itens_base b on b.usuario_id = v.usuario_id and b.ml_user_id = v.ml_user_id and b.item_id = v.item_id
  where v.usuario_id = auth.uid() and v.status = 'paid' and v.item_id is not null and coalesce(v.logistic_type, '') <> 'self_service'
    and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
    and (b.item_id is null or b.lido_em < now() - interval '7 days' or b.env_lido is null or b.env_lido < now() - interval '7 days')
  group by 1, 2 order by count(*) desc limit 400
$$;
grant execute on function public.frete_itens_sem_base(date, date, text) to authenticated;

-- Conferência: cada venda (envio com um item só, sem Flex) contra a tabela.
--   frete devido = tabela[linha de peso do anúncio][faixa do PREÇO DE VENDA] x quantidade
--   linha de peso = a em que o anúncio foi cobrado naquele dia/semana. O ML cobra pela embalagem de envio declarada no
--   anúncio (validado com 9 produtos em 12/10/2026) e ela pode ser alterada a qualquer momento; o padrão do dia acompanha.
--   Classe 'medida': cobrança certa por essa regra, mas numa faixa de peso ACIMA da medida exata do Full (PACKAGE_*).
-- Classes: certo | preco (cobrado numa faixa de preço acima) | peso (linha de peso acima) | multiplo (2x, 3x ou 4x o devido)
--          | total (várias unidades cobradas pelo total do pedido) | outro | peso_menos | preco_menos | sem_base
drop function if exists public.frete_conferencia_tab(date, date, text);
create or replace function public.frete_conferencia_tab(p_de date, p_ate date, p_conta text default null, p_envio text default null)
returns jsonb language sql stable as $$
  with ver as (select distinct desde from public.frete_tabela),
  base as materialized (
    select v.order_id, v.item_id, v.sku, v.qtd, v.preco_unit, v.frete_vendedor as f, v.logistic_type, v.data_venda, v.ml_user_id,
           (v.data_venda at time zone 'America/Sao_Paulo')::date as dia, count(*) over (partition by v.shipping_id) as n_env
    from public.vendas_ml v
    where v.usuario_id = auth.uid() and v.status = 'paid' and v.shipping_id is not null and v.item_id is not null
      and coalesce(v.frete_vendedor, 0) > 0 and coalesce(v.logistic_type, '') <> 'self_service' and v.qtd > 0
      and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and (coalesce(p_conta, '') = '' or v.ml_user_id = p_conta)
      and (coalesce(p_envio, '') = '' or (p_envio = 'full' and v.logistic_type = 'fulfillment') or (p_envio = 'ag' and coalesce(v.logistic_type, '') <> 'fulfillment'))
  ),
  s as materialized (
    select b.*, (select max(desde) from ver where desde <= b.dia) as versao, public.frete_faixa(b.preco_unit) as bv, round(b.f / b.qtd, 2) as u
    from base b where b.n_env = 1
  ),
  c0 as materialized (
    select s.*, (select jsonb_agg(jsonb_build_array(t.linha, t.faixa)) from public.frete_tabela t where t.desde = s.versao and t.valor between s.u - 0.021 and s.u + 0.021) as cel
    from s
  ),
  -- faixa de peso em vigor: o ML remede os produtos de tempos em tempos e o peso muda de um dia para o outro. Por isso a
  -- faixa devida é a em que o anúncio mais foi cobrado NAQUELE DIA (3 vendas ou mais), senão naquela semana, senão no período.
  habc as materialized (select c0.ml_user_id, c0.item_id, c0.versao, c0.dia, (x->>0)::int as linha, count(*) as n from c0, jsonb_array_elements(coalesce(c0.cel, '[]'::jsonb)) x where (x->>1)::int = c0.bv group by 1, 2, 3, 4, 5),
  habd as materialized (select distinct on (ml_user_id, item_id, versao, dia) ml_user_id, item_id, versao, dia, linha from habc where n >= 3 order by ml_user_id, item_id, versao, dia, n desc, linha),
  habw as materialized (select distinct on (ml_user_id, item_id, versao, sem) ml_user_id, item_id, versao, sem, linha from (select ml_user_id, item_id, versao, date_trunc('week', dia)::date as sem, linha, sum(n) as n from habc group by 1, 2, 3, 4, 5) y order by ml_user_id, item_id, versao, sem, n desc, linha),
  hab as materialized (select distinct on (ml_user_id, item_id, versao) ml_user_id, item_id, versao, linha from (select ml_user_id, item_id, versao, linha, sum(n) as n from habc group by 1, 2, 3, 4) y order by ml_user_id, item_id, versao, n desc, linha),
  pes as materialized (
    select p.ml_user_id, p.item_id, nullif(p.peso_g, 0) as peso_g,
           p.full_a, p.full_l, p.full_c, p.full_g, p.ag_a, p.ag_l, p.ag_c, p.ag_g,
           nullif(greatest(coalesce(p.full_a * p.full_l * p.full_c / 6.0, 0), coalesce(p.full_g, 0)), 0) as full_conta,
           nullif(greatest(coalesce(p.ag_a * p.ag_l * p.ag_c / 6.0, 0), coalesce(p.ag_g, 0)), 0) as ag_conta,
           p.ml_a, p.ml_l, p.ml_c, p.ml_g, nullif(greatest(coalesce(p.ml_a * p.ml_l * p.ml_c / 6.0, 0), coalesce(p.ml_g, 0)), 0) as ml_conta
    from public.ml_itens_base p where p.usuario_id = auth.uid()
  ),
  c as materialized (
    select s.*, p.peso_g, h.linha as hab,
           -- medida exata do Full (a mesma da Gestão de estoque Full), só para vendas do Full
           case when s.logistic_type = 'fulfillment' then p.ml_a end as ma, case when s.logistic_type = 'fulfillment' then p.ml_l end as ml,
           case when s.logistic_type = 'fulfillment' then p.ml_c end as mc, case when s.logistic_type = 'fulfillment' then p.ml_g end as mg,
           case when s.logistic_type = 'fulfillment' then p.ml_conta end as mconta,
           (select min(t.linha) from public.frete_tabela t where t.desde = s.versao and t.faixa = 0 and p.peso_g <= t.peso_ate_g) as lp,
           case when s.logistic_type = 'fulfillment' then (select min(t.linha) from public.frete_tabela t where t.desde = s.versao and t.faixa = 0 and p.ml_conta <= t.peso_ate_g) end as lm,
           coalesce(hd.linha, hw.linha, h.linha, (select min(t.linha) from public.frete_tabela t where t.desde = s.versao and t.faixa = 0 and p.peso_g <= t.peso_ate_g)) as ld
    from c0 s
    left join pes p on p.ml_user_id = s.ml_user_id and p.item_id = s.item_id
    left join habd hd on hd.ml_user_id = s.ml_user_id and hd.item_id = s.item_id and hd.versao = s.versao and hd.dia = s.dia
    left join habw hw on hw.ml_user_id = s.ml_user_id and hw.item_id = s.item_id and hw.versao = s.versao and hw.sem = date_trunc('week', s.dia)::date
    left join hab h on h.ml_user_id = s.ml_user_id and h.item_id = s.item_id and h.versao = s.versao
  ),
  k as materialized (
    select c.*,
           (select t.valor from public.frete_tabela t where t.desde = c.versao and t.linha = c.ld and t.faixa = c.bv) as devido_un,
           (select t.valor from public.frete_tabela t where t.desde = c.versao and t.linha = c.lm and t.faixa = c.bv) as devido_full,
           exists (select 1 from jsonb_array_elements(coalesce(c.cel, '[]'::jsonb)) x where (x->>0)::int = c.ld and (x->>1)::int = c.bv) as certo,
           (select min((x->>1)::int) from jsonb_array_elements(coalesce(c.cel, '[]'::jsonb)) x where (x->>0)::int = c.ld and (x->>1)::int > c.bv) as faixa_acima,
           (select min((x->>0)::int) from jsonb_array_elements(coalesce(c.cel, '[]'::jsonb)) x where (x->>1)::int = c.bv and (x->>0)::int > c.ld) as linha_acima,
           (select max((x->>0)::int) from jsonb_array_elements(coalesce(c.cel, '[]'::jsonb)) x where (x->>1)::int = c.bv and (x->>0)::int < c.ld) as linha_abaixo,
           (select max((x->>1)::int) from jsonb_array_elements(coalesce(c.cel, '[]'::jsonb)) x where (x->>0)::int = c.ld and (x->>1)::int < c.bv) as faixa_abaixo
    from c
  ),
  r as materialized (
    select k.*, case when k.certo and k.lm < k.ld and k.devido_full is not null then round(k.f - k.devido_full * k.qtd, 2) when k.certo or k.devido_un is null then 0 else round(k.f - coalesce(k.devido_un, 0) * k.qtd, 2) end as dif,
      case when k.ld is null or k.devido_un is null then 'sem_base'
           when k.certo and k.lm < k.ld and k.devido_full is not null and k.f - k.devido_full * k.qtd > 0.02 then 'medida'
           when k.certo then 'certo'
           when k.faixa_acima is not null then 'preco'
           when k.linha_acima is not null then 'peso'
           when k.linha_abaixo is not null then 'peso_menos'
           when k.faixa_abaixo is not null then 'preco_menos'
           when abs(k.u - k.devido_un * 2) < 0.03 or abs(k.u - k.devido_un * 3) < 0.03 or abs(k.u - k.devido_un * 4) < 0.03 then 'multiplo'
           when k.qtd > 1 and exists (select 1 from public.frete_tabela t where t.desde = k.versao and abs(t.valor - k.f) < 0.021) then 'total'
           else 'outro' end as classe
    from k
  )
  select jsonb_build_object(
    'conferidas', (select count(*) from r),
    'fora', (select count(*) from base where n_env > 1),
    'anuncios', (select count(distinct item_id) from r),
    'com_peso', (select count(distinct item_id) from r where peso_g is not null),
    'com_medida', (select count(*) from r where lm is not null),
    'resumo', (select coalesce(jsonb_object_agg(classe, jsonb_build_object('n', n, 'mais', mais, 'menos', menos, 'n_mais', n_mais, 'n_menos', n_menos)), '{}'::jsonb) from (
        select classe, count(*) as n, coalesce(sum(dif) filter (where dif > 0.02), 0) as mais, coalesce(-sum(dif) filter (where dif < -0.02), 0) as menos,
               count(*) filter (where dif > 0.02) as n_mais, count(*) filter (where dif < -0.02) as n_menos from r group by 1) x),
    'lista', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_venda desc), '[]'::jsonb) from (
        select order_id, item_id, sku, qtd, preco_unit, f as frete, case when classe = 'medida' then devido_full else devido_un end as devido_un, dif, classe, data_venda, ml_user_id, logistic_type, peso_g,
               case when classe = 'medida' then lm else ld end as ld, lp, lm, ma, ml, mc, mg, mconta, bv, versao, faixa_acima, case when classe = 'medida' then ld else linha_acima end as linha_acima, u
        from r where classe in ('preco', 'peso', 'multiplo', 'total', 'outro', 'medida') and dif > 0.02 order by data_venda desc limit 4000) x),
    'menos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_venda desc), '[]'::jsonb) from (
        select order_id, item_id, sku, qtd, preco_unit, f as frete, devido_un, dif, classe, data_venda, ml_user_id, logistic_type, peso_g, ld, lp, lm, ma, ml, mc, mg, mconta, bv, versao, u
        from r where classe not in ('certo', 'sem_base') and dif < -0.02 order by dif limit 300) x),
    'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select r.item_id, r.ml_user_id, max(r.sku) as sku, max(r.peso_g) as peso_g, count(*) as vendas,
               count(*) filter (where r.classe in ('certo', 'medida')) as certas,
               count(*) filter (where r.classe = 'medida') as n_medida, coalesce(sum(r.dif) filter (where r.classe = 'medida'), 0) as rs_medida,
               count(*) filter (where r.classe = 'peso') as n_peso, coalesce(sum(r.dif) filter (where r.classe = 'peso'), 0) as rs_peso,
               count(*) filter (where r.classe = 'preco') as n_preco, coalesce(sum(r.dif) filter (where r.classe = 'preco'), 0) as rs_preco,
               count(*) filter (where r.classe = 'peso_menos') as n_peso_menos, coalesce(-sum(r.dif) filter (where r.classe = 'peso_menos'), 0) as rs_peso_menos,
               (array_agg(r.ld order by r.data_venda desc))[1] as ld, max(r.lp) as lp, max(r.hab) as hab, bool_or(r.peso_g is null) as sem_peso,
               count(distinct r.ld) as faixas_no_periodo, mode() within group (order by r.bv) as bv
        from r group by 1, 2) x)
  )
$$;
grant execute on function public.frete_conferencia_tab(date, date, text, text) to authenticated;
