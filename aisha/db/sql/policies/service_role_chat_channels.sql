-- Policy: service_role_chat_channels

CREATE POLICY "service_role_chat_channels"
  ON public.public_chat_channels FOR ALL
  USING (auth.role() = 'service_role');
