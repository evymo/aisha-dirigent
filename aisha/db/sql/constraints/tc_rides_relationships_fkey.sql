-- Constraint: tc_rides_relationships_fkey
-- Kniha jízd je vázána na tc_vehicles přes externí vozidloId. Izolovaný sync
-- jízd zakládá minimální placeholder vozidla první (upsert), takže FK drží.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tc_rides_tc_vehicle_id_fkey'
      AND conrelid = 'public.tc_rides'::regclass
  ) THEN
    ALTER TABLE public.tc_rides
      ADD CONSTRAINT tc_rides_tc_vehicle_id_fkey
      FOREIGN KEY (tc_vehicle_id)
      REFERENCES public.tc_vehicles(tc_vehicle_id)
      ON DELETE CASCADE;
  END IF;
END $$;
