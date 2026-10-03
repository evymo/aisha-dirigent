-- Policy: Partners can view shared documents

CREATE POLICY "Partners can view shared documents" ON public.member_health_documents
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (has_document_sharing_access(id));
