-- Policy: Public can view public documents

CREATE POLICY "Public can view public documents" ON public.archive_documents
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_public = true));
