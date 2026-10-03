ALTER TABLE production_protocol_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage protocol steps" ON production_protocol_steps;
CREATE POLICY "Admins can manage protocol steps" ON production_protocol_steps
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
