-- Idempotentní: baseline (studený start) politiku založí, heals (běžící DB) ji
-- přehrává znovu — CREATE POLICY bez DROP by na druhém průchodu spadl
-- (naměřeno 2026-09-08 na jednorázové DB: "policy … already exists").
-- ⛔ Autorizace v PODDOTAZU: `(SELECT is_admin_or_staff())` se vyhodnotí JEDNOU
-- (InitPlan), holé volání na KAŽDÝ ŘÁDEK. Naměřeno na 43 157 řádcích: 27 ms
-- vs 10 405 ms; u identity bez nároku 42 ms vs 41 252 ms. STABLE nestačí.
-- Tahle tabulka roste s každým měsícem a zdrojem — hlídá brána rls-predikat-a-indexy.
DROP POLICY IF EXISTS "source_period_stats_admin_all" ON public.source_period_stats;
CREATE POLICY "source_period_stats_admin_all" ON public.source_period_stats
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
