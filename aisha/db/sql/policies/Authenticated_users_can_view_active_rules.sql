-- Policy: Authenticated users can view active rules

CREATE POLICY "Authenticated users can view active rules" ON public.order_approval_rules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.role() = 'authenticated'::text) AND (is_active = true)));
