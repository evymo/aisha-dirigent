-- Policy: Admin/staff can manage improvement proposals

DROP POLICY IF EXISTS "Admin/staff can manage improvement proposals" ON public.improvement_proposals;
CREATE POLICY "Admin/staff can manage improvement proposals" ON public.improvement_proposals
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
