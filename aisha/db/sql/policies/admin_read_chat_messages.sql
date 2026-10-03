-- Policy: admin_read_chat_messages

CREATE POLICY "admin_read_chat_messages"
  ON public.public_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'admin'
    )
  );
