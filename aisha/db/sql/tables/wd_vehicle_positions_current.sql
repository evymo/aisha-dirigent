-- ============================================================================
-- Source of Truth: wd_vehicle_positions_current
-- Popis: Poslední známá poloha vozidla z Webdispečinku (_getAllCarsPosition).
--        Jeden řádek na vozidlo, přepisuje se jen novější polohou.
--        Spravováno: svc-webdispecink přes wd_upsert_positions_audited.
--        wd_driver_id se dopočítává z ac_dallas ↔ wd_drivers.card_identifier.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_vehicle_positions_current (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
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
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_vehicle_positions_current_wd_car_id_key UNIQUE (wd_car_id)
);

COMMENT ON TABLE public.wd_vehicle_positions_current IS 'Poslední známá poloha vozidla z Webdispečinku — dispečerský přehled čte odsud, ne z historie';
COMMENT ON COLUMN public.wd_vehicle_positions_current.position_time IS 'positiontime z API; TZ sémantiku (GMT vs. lokální) potvrdit proti živému API — import je opakovatelný';
COMMENT ON COLUMN public.wd_vehicle_positions_current.driver_card IS 'ac_dallas z API — identifikace řidiče kartou/čipem v době polohy';

ALTER TABLE public.wd_vehicle_positions_current ENABLE ROW LEVEL SECURITY;
