-- RLS: rule_quality_feedback

CREATE POLICY "Reviewers can manage own feedback"
  ON rule_quality_feedback FOR ALL
  USING (reviewer_id = auth.uid());

CREATE POLICY "Rule authors can view feedback"
  ON rule_quality_feedback FOR SELECT
  USING (rule_id IN (
    SELECT id FROM expert_rules
    WHERE author_partner_id IN (
      SELECT id FROM partner_profiles WHERE user_id = auth.uid()
    )
  ));

