CREATE POLICY intranet_chat_messages_insert ON intranet_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND is_intranet_channel_member(channel_id, auth.uid())
  );
