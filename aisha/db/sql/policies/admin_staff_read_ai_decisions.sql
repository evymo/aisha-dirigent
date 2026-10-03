-- Policy: admin_staff_read_ai_decisions
-- Admin/staff read all decision-journal rows (ops + audit).

DROP POLICY IF EXISTS "admin_staff_read_ai_decisions" ON public.ai_decisions;
CREATE POLICY "admin_staff_read_ai_decisions" ON public.ai_decisions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
