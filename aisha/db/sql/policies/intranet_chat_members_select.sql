CREATE POLICY intranet_chat_members_select ON intranet_chat_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR is_intranet_channel_member(channel_id, auth.uid())
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );
