-- Policy: Admins can view all assessments

DROP POLICY IF EXISTS "Admins can view all assessments" ON public.operational_assessments;
CREATE POLICY "Admins can view all assessments" ON public.operational_assessments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
