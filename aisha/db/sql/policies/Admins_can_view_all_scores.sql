-- Policy: Admins can view all scores

DROP POLICY IF EXISTS "Admins can view all scores" ON public.member_compliance_scores;
CREATE POLICY "Admins can view all scores" ON public.member_compliance_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
