-- RLS: knowledge_attribution

DROP POLICY IF EXISTS "Admins can manage attributions" ON knowledge_attribution;
CREATE POLICY "Admins can manage attributions"
  ON knowledge_attribution FOR ALL
  USING ((SELECT is_admin_or_staff()));

DROP POLICY IF EXISTS "Story participants can view" ON knowledge_attribution;
CREATE POLICY "Story participants can view"
  ON knowledge_attribution FOR SELECT
  USING (story_id IN (
    SELECT id FROM partner_stories
    WHERE partner_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid())
       OR user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Rule authors can view own attributions" ON knowledge_attribution;
CREATE POLICY "Rule authors can view own attributions"
  ON knowledge_attribution FOR SELECT
  USING (author_id = auth.uid());

