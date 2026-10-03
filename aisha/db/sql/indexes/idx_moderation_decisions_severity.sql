-- Index: idx_moderation_decisions_severity

CREATE INDEX idx_moderation_decisions_severity ON public.moderation_decisions USING btree (severity) WHERE (severity = ANY (ARRAY['error'::text, 'critical'::text]));
