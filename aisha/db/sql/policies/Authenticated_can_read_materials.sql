-- Policy: Authenticated can read materials

CREATE POLICY "Authenticated can read materials" ON public.production_materials
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
