-- Constraint: wd_fleet_relationships_fkey
-- FK z fleet vrstev (výkony, překročení rychlosti, statistiky řidičů) na
-- rodičovské registry Webdispečinku — na jejich ALTERNATIVNÍ klíč
-- (`wd_drivers.wd_driver_id`, `wd_vehicles.wd_car_id`), tj. na externí
-- identitu z API, ne na náš uuid. Stejný vzor jako `wd_rides` a
-- `wd_vehicle_positions_*` (viz wd_driver_relationships_fkey.sql).
--
-- ⛔ NAMĚŘENO 2026-09-05 bránou `fk-relationship-gaps` (cold-start job):
--   4 NEW unenforced relationship(s) (a *_id column gained no FK)
-- Rohatka: 31 mezer, 27 povolených — tyhle čtyři byly nové a bez důvodu.
--
-- ⭐ PROČ VLASTNÍ SOUBOR, a ne rozšíření stávajících dvou: ty v `heals.sql`
-- NEJSOU (žijí jen v baseline). Kdybych je tam zapojil, sáhly by na živé DB
-- i na `wd_vehicle_positions_*` — tabulky, které v heals taky nejsou, a
-- `::regclass` by na nich spadl. Tenhle soubor se dotýká JEN tabulek, které
-- heal #42/#43 sám zakládá, a zapojuje se hned za ně.
--
-- ON DELETE podle NULLability sloupce, ne podle chuti:
--   NOT NULL  → CASCADE   (SET NULL by porušil NOT NULL; řádek bez rodiče
--                          nemá smysl — výkon bez řidiče, překročení bez vozu)
--   nullable  → SET NULL  (řidič u překročení je doplňková informace, vůz
--                          je nositel; zmizí-li řidič, záznam zůstane)

DO $$
BEGIN
  -- wd_worktime.wd_driver_id (NOT NULL) → wd_drivers
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wd_worktime_wd_driver_id_fkey'
      AND conrelid = 'public.wd_worktime'::regclass
  ) THEN
    ALTER TABLE public.wd_worktime
      ADD CONSTRAINT wd_worktime_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE CASCADE;
  END IF;

  -- wd_driver_stats.wd_driver_id (NOT NULL) → wd_drivers
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wd_driver_stats_wd_driver_id_fkey'
      AND conrelid = 'public.wd_driver_stats'::regclass
  ) THEN
    ALTER TABLE public.wd_driver_stats
      ADD CONSTRAINT wd_driver_stats_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE CASCADE;
  END IF;

  -- wd_overspeed.wd_car_id (NOT NULL) → wd_vehicles
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wd_overspeed_wd_car_id_fkey'
      AND conrelid = 'public.wd_overspeed'::regclass
  ) THEN
    ALTER TABLE public.wd_overspeed
      ADD CONSTRAINT wd_overspeed_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;

  -- wd_overspeed.wd_driver_id (nullable) → wd_drivers
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wd_overspeed_wd_driver_id_fkey'
      AND conrelid = 'public.wd_overspeed'::regclass
  ) THEN
    ALTER TABLE public.wd_overspeed
      ADD CONSTRAINT wd_overspeed_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;
END $$;
