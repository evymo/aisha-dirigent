-- Index: idx_improvement_proposals_agent_created

CREATE INDEX idx_improvement_proposals_agent_created ON public.improvement_proposals USING btree (agent_slug, created_at);
