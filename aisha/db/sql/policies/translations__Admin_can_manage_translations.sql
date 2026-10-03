-- Policy: Admin can manage translations
--
-- Predikát obalen do poddotazu → InitPlan: jedno vyhodnocení za dotaz místo
-- jednoho na každý ze 6 926 řádků. U SELECT to dnes zachraňuje sesterská policy
-- „Anyone can read translations" (USING true), takže bolí hlavně UPDATE/DELETE —
-- ty ale jdou přes celou tabulku. `has_role` ani `auth.uid()` nezávisí na řádku,
-- takže nárok zůstává týž; mizí jen opakování.

DROP POLICY IF EXISTS "Admin can manage translations" ON public.translations;
CREATE POLICY "Admin can manage translations" ON public.translations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
