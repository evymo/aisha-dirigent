-- Policy: Authenticated users can view active protocols

CREATE POLICY "Authenticated users can view active protocols" ON public.control_protocols
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.role() = 'authenticated'::text) AND (is_active = true)));
