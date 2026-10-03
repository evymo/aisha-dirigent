-- Policy: Authenticated can read quality params

CREATE POLICY "Authenticated can read quality params" ON public.production_quality_params
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
