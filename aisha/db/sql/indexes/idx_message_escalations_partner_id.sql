-- Index: idx_message_escalations_partner_id
-- Table: message_escalations

CREATE INDEX idx_message_escalations_partner_id ON public.message_escalations USING btree (partner_id);
