-- Index: idx_hub_reprice_story

CREATE INDEX IF NOT EXISTS idx_hub_reprice_story ON public.hub_reprice_proposal (story_id) WHERE story_id IS NOT NULL;
