-- Policy: participant_read_own_story_budget

CREATE POLICY "participant_read_own_story_budget" ON public.ai_budget
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((scope_type = 'story'::text) AND (EXISTS ( SELECT 1 FROM story_participants sp WHERE ((sp.story_id = ai_budget.scope_id) AND (sp.user_id = auth.uid()))))));
