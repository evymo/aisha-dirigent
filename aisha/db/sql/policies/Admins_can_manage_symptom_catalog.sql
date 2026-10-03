-- Policy: Admins can manage symptom catalog

DROP POLICY IF EXISTS "Admins can manage symptom catalog" ON public.symptom_catalog;
CREATE POLICY "Admins can manage symptom catalog" ON public.symptom_catalog
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
