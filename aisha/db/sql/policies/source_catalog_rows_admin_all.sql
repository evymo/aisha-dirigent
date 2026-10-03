-- Idempotentní: baseline (studený start) politiku založí, heals (běžící DB) ji
-- přehrává znovu — CREATE POLICY bez DROP by na druhém průchodu spadl.
-- ⛔ Autorizace v PODDOTAZU: `(SELECT is_admin_or_staff())` se vyhodnotí JEDNOU
-- (InitPlan), holé volání na KAŽDÝ ŘÁDEK (naměřeno u source_period_stats:
-- 27 ms vs 10 405 ms na 43 157 řádcích). Katalog členů roste s komunitou.
DROP POLICY IF EXISTS "source_catalog_rows_admin_all" ON public.source_catalog_rows;
CREATE POLICY "source_catalog_rows_admin_all" ON public.source_catalog_rows
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
