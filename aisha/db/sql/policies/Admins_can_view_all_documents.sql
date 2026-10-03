-- Policy: Admins can view all documents

DROP POLICY IF EXISTS "Admins can view all documents" ON public.member_health_documents;
CREATE POLICY "Admins can view all documents" ON public.member_health_documents
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
