-- Index: ai_session_memory_conversation_id_key_key

CREATE UNIQUE INDEX ai_session_memory_conversation_id_key_key ON public.ai_session_memory USING btree (conversation_id, key);
