-- Policies: ledger_participation
-- A member may view + set their OWN participation row; admin/staff may view all.
-- Writes flow through update_my_ledger_participation (SECURITY INVOKER, self-scoped).

DROP POLICY IF EXISTS "Users can view own ledger participation" ON public.ledger_participation;
CREATE POLICY "Users can view own ledger participation" ON public.ledger_participation
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR (SELECT is_admin_or_staff((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Users can insert own ledger participation" ON public.ledger_participation;
CREATE POLICY "Users can insert own ledger participation" ON public.ledger_participation
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own ledger participation" ON public.ledger_participation;
CREATE POLICY "Users can update own ledger participation" ON public.ledger_participation
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
