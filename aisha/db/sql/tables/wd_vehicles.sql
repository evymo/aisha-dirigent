-- ============================================================================
-- Source of Truth: wd_vehicles
-- Popis: Vozidla importovaná z Webdispečink API (_getCarsList2).
--        Spravováno: svc-webdispecink přes wd_upsert_vehicles_audited.
--        Neaktivní vozidla se nemažou — jen active=false (zadání 3.1).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_vehicles (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_car_id          integer      NOT NULL,
  car_group_id       integer,
  identifier         text,
  description        text,
  vehicle_type       integer,
  default_driver     text,
  active             boolean      NOT NULL DEFAULT true,
  online             boolean,
  odometer_km        numeric(12,2),
  installation_date  timestamptz,
  disable_date       timestamptz,
  raw_data           jsonb,
  last_import_at     timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wd_vehicles_wd_car_id_key UNIQUE (wd_car_id)
);

COMMENT ON TABLE public.wd_vehicles IS 'Vozidla z Webdispečinku (SOAP _getCarsList2), upsert přes wd_upsert_vehicles_audited';
COMMENT ON COLUMN public.wd_vehicles.wd_car_id IS 'carid z Webdispečink API — externí identita vozidla';
COMMENT ON COLUMN public.wd_vehicles.identifier IS 'identifikator z API — SPZ nebo název vozidla';
COMMENT ON COLUMN public.wd_vehicles.raw_data IS 'Kompletní surová položka z API (vč. servisních polí, IMEI, jednotky)';

ALTER TABLE public.wd_vehicles ENABLE ROW LEVEL SECURITY;
