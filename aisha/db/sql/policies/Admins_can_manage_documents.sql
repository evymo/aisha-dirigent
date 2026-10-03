-- Policy: Admins can manage documents

DROP POLICY IF EXISTS "Admins can manage documents" ON public.archive_documents;
CREATE POLICY "Admins can manage documents" ON public.archive_documents
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
