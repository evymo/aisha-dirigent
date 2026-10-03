-- Policy: Admin can manage all studies

DROP POLICY IF EXISTS "Admin can manage all studies" ON public.studies;
CREATE POLICY "Admin can manage all studies" ON public.studies
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
