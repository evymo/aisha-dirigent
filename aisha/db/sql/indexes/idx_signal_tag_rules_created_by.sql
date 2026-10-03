-- Index: idx_signal_tag_rules_created_by

CREATE INDEX IF NOT EXISTS idx_signal_tag_rules_created_by ON public.signal_tag_rules USING btree (created_by);
