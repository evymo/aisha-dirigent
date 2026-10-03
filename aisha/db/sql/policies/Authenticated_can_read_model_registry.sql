-- Policy: Authenticated can read model registry

CREATE POLICY "Authenticated can read model registry" ON public.ai_model_registry
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
