-- RLS Policies for blockchain_audit_records
-- Source of truth: supabase/sql/policies/

-- Admins can view blockchain audit records
DROP POLICY IF EXISTS "Admins can view blockchain audit records" ON public.blockchain_audit_records;
CREATE POLICY "Admins can view blockchain audit records" ON public.blockchain_audit_records
  FOR SELECT USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
