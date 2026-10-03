-- Policy: Users can delete their own documents

CREATE POLICY "Users can delete their own documents" ON public.member_health_documents
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
