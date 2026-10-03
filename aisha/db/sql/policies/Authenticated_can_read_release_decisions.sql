-- Policy: Authenticated can read release decisions

CREATE POLICY "Authenticated can read release decisions" ON public.production_release_decisions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
