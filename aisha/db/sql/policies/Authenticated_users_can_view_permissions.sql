-- Policy: Authenticated users can view permissions

CREATE POLICY "Authenticated users can view permissions" ON public.role_permissions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
