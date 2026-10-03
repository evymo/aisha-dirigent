-- Index: idx_chat_messages_golden

CREATE INDEX idx_chat_messages_golden ON public.chat_messages USING btree (is_golden_example) WHERE (is_golden_example = true);
