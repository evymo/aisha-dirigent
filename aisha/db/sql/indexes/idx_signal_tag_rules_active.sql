-- Index: idx_signal_tag_rules_active

CREATE INDEX IF NOT EXISTS idx_signal_tag_rules_active ON public.signal_tag_rules USING btree (priority, event_type_pattern) WHERE is_active;
