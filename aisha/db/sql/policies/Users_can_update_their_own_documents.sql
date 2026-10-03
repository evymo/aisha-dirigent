-- Policy: Users can update their own documents

CREATE POLICY "Users can update their own documents" ON public.member_health_documents
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
