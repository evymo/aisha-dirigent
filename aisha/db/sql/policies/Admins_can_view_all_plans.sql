-- Policy: Admins can view all plans

DROP POLICY IF EXISTS "Admins can view all plans" ON public.member_distribution_plans;
CREATE POLICY "Admins can view all plans" ON public.member_distribution_plans
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
