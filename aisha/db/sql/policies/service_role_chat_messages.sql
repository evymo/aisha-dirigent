-- Policy: service_role_chat_messages

CREATE POLICY "service_role_chat_messages"
  ON public.public_chat_messages FOR ALL
  USING (auth.role() = 'service_role');
