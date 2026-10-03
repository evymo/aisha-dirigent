-- Policy: Anyone can read active symptom catalog

CREATE POLICY "Anyone can read active symptom catalog" ON public.symptom_catalog
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
