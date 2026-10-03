-- Policy: personality_signals_service_all

CREATE POLICY "personality_signals_service_all" ON public.personality_signals
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text));
