-- Index: idx_public_chat_sessions_visitor
-- Table: public_chat_sessions

CREATE INDEX IF NOT EXISTS idx_public_chat_sessions_visitor
  ON public.public_chat_sessions(visitor_id);
