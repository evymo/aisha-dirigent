-- Policy: Users can create their own documents

CREATE POLICY "Users can create their own documents" ON public.member_health_documents
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
