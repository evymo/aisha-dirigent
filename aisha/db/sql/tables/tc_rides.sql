-- ============================================================================
-- Source of Truth: tc_rides
-- Popis: Kniha jízd / práce strojů z T-cars (knihaJizdVozidlo). Upsert podle
--        tc_ride_id — kniha jízd se zpětně opravuje, opakovaný import stejného
--        okna aktualizuje existující jízdy. end_time IS NULL = rozpracovaná.
--        Spravováno: svc-tcars přes tc_upsert_rides_audited.
--        BEZ GPS poloh — start_place/end_place jsou text (jizdaOdkud/jizdaKam).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tc_rides (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_ride_id         bigint         NOT NULL,
  tc_vehicle_id      integer        NOT NULL,
  tc_driver_id       integer,
  driver_name        text,
  responsible_name   text,
  start_time         timestamptz,
  end_time           timestamptz,
  start_place        text,
  end_place          text,
  country            text,
  odometer_start_km  numeric(12,2),
  odometer_end_km    numeric(12,2),
  distance_km        numeric(10,2),
  city_ratio         numeric(4,3),
  fuel_end           numeric(10,2),
  fuel_end_alt       numeric(10,2),
  private            boolean,
  purpose            text,
  cost_center_id     integer,
  cost_center_name   text,
  raw_data           jsonb,
  last_import_at     timestamptz,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT tc_rides_tc_ride_id_key UNIQUE (tc_ride_id)
);

COMMENT ON TABLE public.tc_rides IS 'Kniha jízd z T-cars (jizdaId = tc_ride_id); zpětné opravy řeší opakovaný upsert stejného okna';
COMMENT ON COLUMN public.tc_rides.city_ratio IS 'jizdaPomerMestoMimomesto — poměr jízdy ve/mimo město (0.0-1.0)';
COMMENT ON COLUMN public.tc_rides.private IS 'jizdaSoukroma — soukromá jízda';
COMMENT ON COLUMN public.tc_rides.end_time IS 'NULL = rozpracovaná jízda (jizdaDo prázdné v API)';

ALTER TABLE public.tc_rides ENABLE ROW LEVEL SECURITY;
