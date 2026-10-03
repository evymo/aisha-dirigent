-- Index: idx_moderation_decisions_type

CREATE INDEX idx_moderation_decisions_type ON public.moderation_decisions USING btree (decision_type);
