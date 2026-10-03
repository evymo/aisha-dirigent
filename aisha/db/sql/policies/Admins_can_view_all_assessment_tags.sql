-- Policy: Admins can view all assessment tags

DROP POLICY IF EXISTS "Admins can view all assessment tags" ON public.operational_assessment_tags;
CREATE POLICY "Admins can view all assessment tags" ON public.operational_assessment_tags
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
