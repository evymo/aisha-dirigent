-- Policy: service_role_chat_history

CREATE POLICY "service_role_chat_history"
  ON public.public_chat_channel_history FOR ALL
  USING (auth.role() = 'service_role');
