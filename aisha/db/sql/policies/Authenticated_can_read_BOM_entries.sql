-- Policy: Authenticated can read BOM entries

CREATE POLICY "Authenticated can read BOM entries" ON public.production_bom_entries
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
