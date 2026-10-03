ALTER TABLE production_logs ENABLE ROW LEVEL SECURITY;

-- Logs are usuall append-only via functions, but admin manage for now
DROP POLICY IF EXISTS "Admins can manage logs" ON production_logs;
CREATE POLICY "Admins can manage logs" ON production_logs
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
