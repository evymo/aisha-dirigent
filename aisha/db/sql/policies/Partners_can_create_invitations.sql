-- Policy: Partners can create invitations

CREATE POLICY "Partners can create invitations" ON public.invitations
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((created_by = auth.uid()));
