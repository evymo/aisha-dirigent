-- Policy: Admins can manage label archive

DROP POLICY IF EXISTS "Admins can manage label archive" ON public.product_label_archive;
CREATE POLICY "Admins can manage label archive" ON public.product_label_archive
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
