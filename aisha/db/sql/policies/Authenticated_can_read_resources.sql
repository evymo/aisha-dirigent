-- Policy: Authenticated can read resources

CREATE POLICY "Authenticated can read resources" ON public.production_resources
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
