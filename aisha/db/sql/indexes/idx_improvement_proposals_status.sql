-- Index: idx_improvement_proposals_status

CREATE INDEX idx_improvement_proposals_status ON public.improvement_proposals USING btree (status) WHERE (status = ANY (ARRAY['draft'::text, 'pending_review'::text]));
