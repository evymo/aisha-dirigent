-- RLS: maintenance_contracts

DROP POLICY IF EXISTS "Members can view own contracts" ON maintenance_contracts;
CREATE POLICY "Members can view own contracts"
  ON maintenance_contracts FOR SELECT
  USING (member_id = auth.uid());

DROP POLICY IF EXISTS "Specialists can view assigned contracts" ON maintenance_contracts;
CREATE POLICY "Specialists can view assigned contracts"
  ON maintenance_contracts FOR SELECT
  USING (specialist_id IN (
    SELECT id FROM partner_profiles WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage all contracts" ON maintenance_contracts;
CREATE POLICY "Admins can manage all contracts"
  ON maintenance_contracts FOR ALL
  USING ((SELECT is_admin_or_staff()));

