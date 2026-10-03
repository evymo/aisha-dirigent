-- Index: idx_ai_runs_story

CREATE INDEX idx_ai_runs_story ON public.ai_runs USING btree (story_id);
