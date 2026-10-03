-- Policies: governance_proposals + governance_votes (D3 local ballot ledger)
-- Proposals are readable by any authenticated member; management is admin/staff.
-- Ballots: a member reads their OWN ballot (+ admin reads all). Ballot writes go
-- through cast_governance_vote (SECURITY DEFINER), so no direct write policy.

DROP POLICY IF EXISTS "Members can view governance proposals" ON public.governance_proposals;
CREATE POLICY "Members can view governance proposals" ON public.governance_proposals
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage governance proposals" ON public.governance_proposals;
CREATE POLICY "Admin can manage governance proposals" ON public.governance_proposals
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Members can view own governance votes" ON public.governance_votes;
CREATE POLICY "Members can view own governance votes" ON public.governance_votes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR (SELECT is_admin_or_staff((SELECT auth.uid()))));
