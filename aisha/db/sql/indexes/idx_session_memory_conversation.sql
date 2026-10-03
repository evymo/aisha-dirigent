-- Index: idx_session_memory_conversation

CREATE INDEX idx_session_memory_conversation ON public.ai_session_memory USING btree (conversation_id);
