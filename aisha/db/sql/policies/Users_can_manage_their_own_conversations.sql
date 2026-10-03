-- Policy: Users can manage their own conversations

CREATE POLICY "Users can manage their own conversations" ON public.chat_conversations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id));
