-- ============================================================================
-- Source of Truth: wd_vehicle_positions_history
-- Popis: Historie poloh vozidel z Webdispečinku — append-only, dedup přes
--        UNIQUE (wd_car_id, position_time), protože polling vrací stejnou
--        poslední polohu, dokud vozidlo stojí. Vysokoobjemová tabulka:
--        bigint identity PK (ne uuid), retence/partitioning řeší noční
--        údržba podle retenční politiky zdroje (source onboarding §5).
--        Spravováno: svc-webdispecink přes wd_upsert_positions_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_vehicle_positions_history (
  id             bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wd_car_id      integer        NOT NULL,
  wd_driver_id   integer,
  driver_card    text,
  position_time  timestamptz    NOT NULL,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  speed_kmh      numeric(6,2),
  moving         boolean,
  location_text  text,
  odometer_km    numeric(12,2),
  fuel_level     numeric(8,2),
  used_fuel      numeric(10,2),
  raw_data       jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_vehicle_positions_history_car_time_key UNIQUE (wd_car_id, position_time)
);

COMMENT ON TABLE public.wd_vehicle_positions_history IS 'Historie poloh z Webdispečinku pro zpětné vyhodnocení tras; surová data v raw_data';

ALTER TABLE public.wd_vehicle_positions_history ENABLE ROW LEVEL SECURITY;
