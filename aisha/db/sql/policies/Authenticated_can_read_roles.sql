-- Policy: Authenticated can read roles

CREATE POLICY "Authenticated can read roles" ON public.roles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
