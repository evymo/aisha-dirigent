-- Policy: Admins can view all health data

DROP POLICY IF EXISTS "Admins can view all health data" ON public.health_data;
CREATE POLICY "Admins can view all health data" ON public.health_data
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
