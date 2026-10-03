-- Policy: Authenticated can read batch materials

CREATE POLICY "Authenticated can read batch materials" ON public.production_batch_materials
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
