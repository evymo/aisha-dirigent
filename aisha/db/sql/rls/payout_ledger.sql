-- RLS: payout_ledger

DROP POLICY IF EXISTS "Users can view own ledger" ON payout_ledger;
CREATE POLICY "Users can view own ledger"
  ON payout_ledger FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage ledger" ON payout_ledger;
CREATE POLICY "Admins can manage ledger"
  ON payout_ledger FOR ALL
  USING ((SELECT is_admin_or_staff()));

