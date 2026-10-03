-- Policy: Authenticated can read model benchmarks

CREATE POLICY "Authenticated can read model benchmarks" ON public.ai_model_benchmarks
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
