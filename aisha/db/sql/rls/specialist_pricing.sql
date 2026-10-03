-- RLS: specialist_pricing

CREATE POLICY "Specialists can manage own pricing"
  ON specialist_pricing FOR ALL
  USING (partner_id IN (
    SELECT id FROM partner_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Anyone can read active pricing"
  ON specialist_pricing FOR SELECT
  USING (is_active = true);

