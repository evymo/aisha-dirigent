-- Policy: Users can manage permissions for their documents

CREATE POLICY "Users can manage permissions for their documents" ON public.document_sharing_permissions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (is_health_document_owner(document_id))
  WITH CHECK (is_health_document_owner(document_id));
