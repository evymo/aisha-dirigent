ALTER TABLE user_distribution_schedule_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own schedule orders" ON user_distribution_schedule_orders;
CREATE POLICY "Users can view own schedule orders" ON user_distribution_schedule_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_distribution_schedule s
      WHERE s.id = schedule_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can manage schedule orders" ON user_distribution_schedule_orders;
CREATE POLICY "Admins can manage schedule orders" ON user_distribution_schedule_orders
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
