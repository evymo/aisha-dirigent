-- Policy: Authenticated can read variants

CREATE POLICY "Authenticated can read variants" ON public.production_variants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
