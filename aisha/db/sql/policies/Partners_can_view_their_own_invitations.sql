-- Policy: Partners can view their own invitations

CREATE POLICY "Partners can view their own invitations" ON public.invitations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((created_by = auth.uid()));
