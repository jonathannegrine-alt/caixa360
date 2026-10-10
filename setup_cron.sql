SELECT cron.schedule(
  'ml-snapshot-diario',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qasrccmtrllotukyeiax.supabase.co/functions/v1/ml-snapshot',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhc3JjY210cmxsb3R1a3llaWF4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjY4NjUxOSwiZXhwIjoyMDYyMjYyNTE5fQ.7b80YqtUv9ItVv7yBOhCFdECIgXfEY6HhqEK3RiVkW0"}'::jsonb,
    body := '{"cron":true}'::jsonb
  ) AS request_id;
  $$
);

-- Vendas ML: hoje/ontem + preenchimento do historico (365 dias), a cada 15 minutos.
-- Criado em 2026-10-10 copiando o comando (com o segredo) do job ml-snapshot-diario:
--   select cron.schedule('ml-vendas-sync', '*/15 * * * *', replace(command, 'ml-snapshot', 'ml-vendas'))
--   from cron.job where jobname = 'ml-snapshot-diario';
