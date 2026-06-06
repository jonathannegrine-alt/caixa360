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
