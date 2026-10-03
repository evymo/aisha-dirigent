-- Policy: Admins can view all lab results

DROP POLICY IF EXISTS "Admins can view all lab results" ON public.lab_results;
CREATE POLICY "Admins can view all lab results" ON public.lab_results
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
