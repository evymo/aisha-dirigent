-- Policy: wd_driver_stats_read
-- Source of truth pair: aisha/db/sql/tables/wd_driver_stats.sql

-- `heals.sql` se přehrává při KAŽDÉ migraci, i na běžící produkci, takže
-- soubor MUSÍ být idempotentní. Policy nezná `CREATE OR REPLACE`, proto
-- `DROP … IF EXISTS` + `CREATE`. Bez toho padne KAŽDÝ DRUHÝ deploy —
-- naměřeno 2026-09-05: `policy "wd_driver_stats_read" for table … already exists`.
DROP POLICY IF EXISTS wd_driver_stats_read ON public.wd_driver_stats;

CREATE POLICY wd_driver_stats_read ON public.wd_driver_stats
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
