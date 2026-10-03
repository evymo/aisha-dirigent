-- Index: tracked_actions_user_occurred_idx

CREATE INDEX IF NOT EXISTS tracked_actions_user_occurred_idx ON public.tracked_actions USING btree (user_id, occurred_at DESC);
