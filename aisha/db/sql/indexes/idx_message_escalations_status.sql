-- Index: idx_message_escalations_status
-- Table: message_escalations

CREATE INDEX idx_message_escalations_status ON public.message_escalations USING btree (status);
