-- ============================================================================
-- Source of Truth: wd_drivers
-- Popis: Řidiči importovaní z Webdispečink API (_getDriversList2).
--        Spravováno: svc-webdispecink přes wd_upsert_drivers_audited.
--        erp_employee_ref je ruční mapování na interní osobní číslo / ERP
--        zaměstnance (zadání 3.2) — import ho nikdy nepřepisuje.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_drivers (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_driver_id        integer      NOT NULL,
  first_name          text,
  last_name           text,
  personal_number     text,
  group_id            integer,
  group_name          text,
  card_identifier     text,
  phone               text,
  active              boolean      NOT NULL DEFAULT true,
  assigned_vehicle    text,
  erp_employee_ref    text,
  raw_data            jsonb,
  last_import_at      timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wd_drivers_wd_driver_id_key UNIQUE (wd_driver_id)
);

COMMENT ON TABLE public.wd_drivers IS 'Řidiči z Webdispečinku (SOAP _getDriversList2), upsert přes wd_upsert_drivers_audited';
COMMENT ON COLUMN public.wd_drivers.wd_driver_id IS 'iddriver z Webdispečink API — externí identita řidiče';
COMMENT ON COLUMN public.wd_drivers.card_identifier IS 'Dallas/RFID/karta identifikace řidiče (pole dallas z API)';
COMMENT ON COLUMN public.wd_drivers.erp_employee_ref IS 'Ruční mapování na ERP zaměstnance — import nepřepisuje';

ALTER TABLE public.wd_drivers ENABLE ROW LEVEL SECURITY;
