-- Index: idx_ai_feedback_org_id
CREATE INDEX IF NOT EXISTS idx_ai_feedback_org_id ON public.ai_feedback(org_id) WHERE org_id IS NOT NULL;
