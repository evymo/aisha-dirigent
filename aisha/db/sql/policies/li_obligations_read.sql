-- ============================================================================
-- Policy: li_obligations_read — čtecí nárok na závazky (admin/staff)
--
-- Nahrazuje DVĚ identické permisivní SELECT policies, které se OR-ovaly a obě
-- volaly `(SELECT is_admin_or_staff())` PER ŘÁDEK:
--   li_obligations_admin_select  USING (SELECT is_admin_or_staff())
--   li_obligations_read_admin    USING (SELECT is_admin_or_staff())   ← drift: v SoT nebyla
--
-- Změřeno na produkci (509 řádků): 123,5 ms → 3,7 ms (33×) pouhým obalením do
-- poddotazu — ten se vyhodnotí jako InitPlan JEDNOU za dotaz místo 509× (resp.
-- 1 018× kvůli duplikátu). Poroste to lineárně s objemem závazků.
--
-- Nárok je NEZMĚNĚN (dokázáno porovnáním množin):
--   admin     před 509 / md5 0ca2e482ff44125d71997cb627d6ab1d
--             po   509 / md5 0ca2e482ff44125d71997cb627d6ab1d
--   bez rolí  před 0 · po 0
-- ============================================================================

DROP POLICY IF EXISTS li_obligations_admin_select ON public.li_obligations;
-- drift: existovala v živé DB, ne v SoT — bez dropu zůstane per-row člen v OR
DROP POLICY IF EXISTS li_obligations_read_admin   ON public.li_obligations;
DROP POLICY IF EXISTS li_obligations_read         ON public.li_obligations;

CREATE POLICY li_obligations_read ON public.li_obligations
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
