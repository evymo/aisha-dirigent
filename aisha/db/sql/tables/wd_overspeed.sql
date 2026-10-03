-- ============================================================================
-- Source of Truth: wd_overspeed
-- Popis: Překročení rychlosti z Webdispečinku (_getCarOverSpeed). Jeden řádek =
--        jeden úsek s maximem rychlosti (MSpeed), časem, polohou a řidičem.
--        Upsert podle (wd_car_id, time_from) — opakovaný import okna aktualizuje.
--        Spravováno: svc-webdispecink přes wd_upsert_overspeed_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_overspeed (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_car_id      integer       NOT NULL,
  wd_driver_id   integer,
  max_speed_kmh  numeric(6,2),
  time_from      timestamptz   NOT NULL,
  time_to        timestamptz,
  lat            numeric(9,6),
  lon            numeric(9,6),
  distance_km    numeric(10,3),
  raw_data       jsonb,
  last_import_at timestamptz,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT wd_overspeed_key UNIQUE (wd_car_id, time_from)
);

COMMENT ON TABLE public.wd_overspeed IS 'Překročení rychlosti z Webdispečinku (_getCarOverSpeed); úsek = max. rychlost + poloha + řidič, upsert přes wd_upsert_overspeed_audited';
COMMENT ON COLUMN public.wd_overspeed.max_speed_kmh IS 'MSpeed — maximální rychlost v úseku (km/h)';


ALTER TABLE public.wd_overspeed ENABLE ROW LEVEL SECURITY;
