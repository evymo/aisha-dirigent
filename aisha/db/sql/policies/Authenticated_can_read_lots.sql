-- Policy: Authenticated can read lots

CREATE POLICY "Authenticated can read lots" ON public.production_lots
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
