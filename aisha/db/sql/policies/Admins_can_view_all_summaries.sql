-- Policy: Admins can view all summaries

DROP POLICY IF EXISTS "Admins can view all summaries" ON public.alcohol_tracking_summary;
CREATE POLICY "Admins can view all summaries" ON public.alcohol_tracking_summary
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
