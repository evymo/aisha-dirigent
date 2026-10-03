-- Policy: Admin can manage consent items

DROP POLICY IF EXISTS "Admin can manage consent items" ON public.study_consent_items;
CREATE POLICY "Admin can manage consent items" ON public.study_consent_items
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
