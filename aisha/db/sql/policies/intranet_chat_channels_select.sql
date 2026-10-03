CREATE POLICY intranet_chat_channels_select ON intranet_chat_channels
  FOR SELECT TO authenticated
  USING (
    is_intranet_channel_member(id, auth.uid())
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );
