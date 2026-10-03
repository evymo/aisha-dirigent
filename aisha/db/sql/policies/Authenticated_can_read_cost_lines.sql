-- Policy: Authenticated can read cost lines

CREATE POLICY "Authenticated can read cost lines" ON public.production_cost_lines
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
