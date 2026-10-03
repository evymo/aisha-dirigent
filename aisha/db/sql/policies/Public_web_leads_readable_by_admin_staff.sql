-- Policy: Public web leads readable by admin staff
-- Operator triage UI reads inbound leads; nobody else can SELECT directly.

DROP POLICY IF EXISTS "Public web leads readable by admin staff" ON public.lead_submissions;
CREATE POLICY "Public web leads readable by admin staff" ON public.lead_submissions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
