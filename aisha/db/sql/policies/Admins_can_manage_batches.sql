-- Policy: Admins can manage batches
-- Predikát v InitPlanu (2026-07-30) — duplicitní deklarace téže policy jako
-- policies/production_batches.sql (historicky dva soubory); obě drží týž tvar,
-- aby výsledek nezávisel na pořadí \ir.

DROP POLICY IF EXISTS "Admins can manage batches" ON public.production_batches;
CREATE POLICY "Admins can manage batches" ON public.production_batches
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
