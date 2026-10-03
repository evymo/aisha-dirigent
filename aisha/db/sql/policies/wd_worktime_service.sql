-- Policy: wd_worktime_service
-- Source of truth pair: aisha/db/sql/tables/wd_worktime.sql

-- `heals.sql` se přehrává při KAŽDÉ migraci, i na běžící produkci, takže
-- soubor MUSÍ být idempotentní. Policy nezná `CREATE OR REPLACE`, proto
-- `DROP … IF EXISTS` + `CREATE`. Bez toho padne KAŽDÝ DRUHÝ deploy —
-- naměřeno 2026-09-05: `policy "wd_worktime_service" for table … already exists`.
DROP POLICY IF EXISTS wd_worktime_service ON public.wd_worktime;

CREATE POLICY wd_worktime_service ON public.wd_worktime
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
