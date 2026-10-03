-- Policy: service_role_chat_sessions

CREATE POLICY "service_role_chat_sessions"
  ON public.public_chat_sessions FOR ALL
  USING (auth.role() = 'service_role');
