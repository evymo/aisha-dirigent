CREATE POLICY intranet_chat_members_manage ON intranet_chat_members
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );
