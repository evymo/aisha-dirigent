-- Policy: Users can view their own documents

CREATE POLICY "Users can view their own documents" ON public.member_health_documents
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
