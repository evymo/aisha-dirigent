-- Policy: Admins and staff can view audit journal
--
-- Predikát obalen do poddotazu → InitPlan: vyhodnotí se JEDNOU za dotaz, ne pro
-- každý ze 71 051 řádků žurnálu (a poroste). `is_admin_or_staff` nezávisí na
-- řádku, takže jedno vyhodnocení dává tentýž výsledek jako 71 tisíc stejných —
-- nárok se nemění, mizí jen opakování. Sesterská oprava k li_source_registry_read
-- (tam změřeno 10 405 ms → 27 ms na 43 157 řádcích).
--
-- `TO public` je ZÁMĚRNĚ ponecháno: omezení na `authenticated` by nic nepřineslo
-- (anon dnes projde k predikátu, který ho odmítne; po omezení by ho odmítl
-- default-deny — stejný výsledek, stejný signál) a jen by přidalo riziko.
-- Chybějící signál o odmítnutém pokusu se neřeší v policy (ta jen filtruje),
-- ale výš — rozlišením „nemáš nárok" od „prázdno" ve čtecí RPC a v logu gatewaye.

DROP POLICY IF EXISTS "Admins and staff can view audit journal" ON public.audit_journal;
CREATE POLICY "Admins and staff can view audit journal" ON public.audit_journal
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
