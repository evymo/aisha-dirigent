-- Index: idx_message_escalations_user_id
-- Table: message_escalations

CREATE INDEX idx_message_escalations_user_id ON public.message_escalations USING btree (user_id);
