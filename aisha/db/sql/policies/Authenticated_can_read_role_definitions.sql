-- Policy: Authenticated can read role definitions

CREATE POLICY "Authenticated can read role definitions" ON public.role_definitions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
