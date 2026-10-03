-- Policy: creator_read_own_tokens

CREATE POLICY "creator_read_own_tokens" ON public.mcp_auth_tokens
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((created_by = auth.uid()));
