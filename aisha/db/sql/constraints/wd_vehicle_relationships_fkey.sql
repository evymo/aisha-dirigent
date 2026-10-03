-- Constraint: wd_vehicle_relationships_fkey
-- Webdispecink telemetry/logbook rows are tied to wd_vehicles by external car ID.
-- Isolated positions/rides syncs create minimal vehicle placeholders first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_current_wd_car_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_current'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_current
      ADD CONSTRAINT wd_vehicle_positions_current_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_history_wd_car_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_history'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_history
      ADD CONSTRAINT wd_vehicle_positions_history_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_rides_wd_car_id_fkey'
      AND conrelid = 'public.wd_rides'::regclass
  ) THEN
    ALTER TABLE public.wd_rides
      ADD CONSTRAINT wd_rides_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;
END $$;
