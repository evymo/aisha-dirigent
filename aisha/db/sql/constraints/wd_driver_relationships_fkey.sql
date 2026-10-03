-- Constraint: wd_driver_relationships_fkey
-- Webdispecink driver references are enforced only after import-time lookup:
-- unknown driver IDs stay NULL, preserving isolated rides/positions syncs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_current_wd_driver_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_current'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_current
      ADD CONSTRAINT wd_vehicle_positions_current_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_history_wd_driver_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_history'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_history
      ADD CONSTRAINT wd_vehicle_positions_history_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_rides_wd_driver_id_fkey'
      AND conrelid = 'public.wd_rides'::regclass
  ) THEN
    ALTER TABLE public.wd_rides
      ADD CONSTRAINT wd_rides_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;
END $$;
