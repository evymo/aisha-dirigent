-- Index: uq_knock_device_credentials_ucet
-- Jeden účet zařízení patří právě jednomu průkazu tabletu (a naopak nese průkaz
-- nejvýš jeden účet). Podle téhle vazby handle_new_user i pátá cesta viditelnosti
-- poznávají účet zařízení — dvojí vazba by z jednoho průkazu udělala dva tablety.
CREATE UNIQUE INDEX IF NOT EXISTS uq_knock_device_credentials_ucet
  ON public.knock_device_credentials (ucet_id)
  WHERE ucet_id IS NOT NULL;
