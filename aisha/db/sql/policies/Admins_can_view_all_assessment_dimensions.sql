-- Policy: Admins can view all assessment dimensions

DROP POLICY IF EXISTS "Admins can view all assessment dimensions" ON public.operational_assessment_dimensions;
CREATE POLICY "Admins can view all assessment dimensions" ON public.operational_assessment_dimensions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
