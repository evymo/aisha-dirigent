ALTER TABLE token_production_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage token production events" ON token_production_events;
CREATE POLICY "Admins can manage token production events" ON token_production_events
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
