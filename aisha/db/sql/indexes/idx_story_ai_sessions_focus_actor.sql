-- Index: idx_story_ai_sessions_focus_actor
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_story_ai_sessions_focus_actor ON public.story_ai_sessions USING btree (focus_actor_id) WHERE (focus_actor_id IS NOT NULL);
