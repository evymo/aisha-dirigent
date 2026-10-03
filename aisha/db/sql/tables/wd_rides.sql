-- ============================================================================
-- Source of Truth: wd_rides
-- Popis: Kniha jízd z Webdispečinku (_getCarLogBook4). Upsert podle
--        wd_ride_id — kniha jízd se ve Webdispečinku zpětně opravuje,
--        opakovaný import stejného okna aktualizuje existující jízdy.
--        end_time IS NULL = rozpracovaná / nedokončená jízda.
--        Spravováno: svc-webdispecink přes wd_upsert_rides_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_rides (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_ride_id        bigint         NOT NULL,
  wd_car_id         integer        NOT NULL,
  wd_driver_id      integer,
  driver_name       text,
  start_time        timestamptz,
  end_time          timestamptz,
  start_place       text,
  end_place         text,
  purpose           text,
  ride_type         integer,
  distance_km       numeric(10,2),
  odometer_start_km numeric(12,2),
  odometer_end_km   numeric(12,2),
  driving_seconds   integer,
  standing_seconds  integer,
  max_speed_kmh     numeric(6,2),
  avg_speed_kmh     numeric(6,2),
  crew              text,
  note              text,
  raw_data          jsonb,
  last_import_at    timestamptz,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_rides_wd_ride_id_key UNIQUE (wd_ride_id)
);

COMMENT ON TABLE public.wd_rides IS 'Kniha jízd z Webdispečinku (Id_jizda = wd_ride_id); zpětné opravy řeší opakovaný upsert stejného okna';
COMMENT ON COLUMN public.wd_rides.ride_type IS 'Druh z API — služební/soukromá dle číselníku Webdispečinku';
COMMENT ON COLUMN public.wd_rides.end_time IS 'NULL = rozpracovaná jízda (Dt_to prázdné v API)';

ALTER TABLE public.wd_rides ENABLE ROW LEVEL SECURITY;
