-- Policy: Authenticated can read suppliers

CREATE POLICY "Authenticated can read suppliers" ON public.production_suppliers
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
