-- Index: idx_user_sessions_user_id_session_id_unique
-- Table: user_sessions

CREATE UNIQUE INDEX idx_user_sessions_user_id_session_id_unique ON public.user_sessions USING btree (user_id, session_id);
