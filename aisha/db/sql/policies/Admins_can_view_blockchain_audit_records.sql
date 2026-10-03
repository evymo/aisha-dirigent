-- Policy: Admins can view blockchain audit records

DROP POLICY IF EXISTS "Admins can view blockchain audit records" ON public.blockchain_audit_records;
CREATE POLICY "Admins can view blockchain audit records" ON public.blockchain_audit_records
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
