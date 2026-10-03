-- Policy: Authenticated can read CAPA

CREATE POLICY "Authenticated can read CAPA" ON public.production_capa
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
