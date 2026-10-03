-- Policy: Admins can view all check-ins

DROP POLICY IF EXISTS "Admins can view all check-ins" ON public.health_check_ins;
CREATE POLICY "Admins can view all check-ins" ON public.health_check_ins
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
