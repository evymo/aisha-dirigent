-- Policy: personality_signals_user_select

CREATE POLICY "personality_signals_user_select" ON public.personality_signals
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
