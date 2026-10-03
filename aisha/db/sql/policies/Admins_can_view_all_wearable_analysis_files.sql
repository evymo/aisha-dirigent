-- Policy: Admins can view all wearable analysis files

DROP POLICY IF EXISTS "Admins can view all wearable analysis files" ON public.wearable_analysis_files;
CREATE POLICY "Admins can view all wearable analysis files" ON public.wearable_analysis_files
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
