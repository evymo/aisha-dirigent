-- Policy: authenticated_read_context_profiles

CREATE POLICY "authenticated_read_context_profiles" ON public.context_profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
