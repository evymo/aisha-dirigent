-- Index: idx_compliance_scores_period
-- Table: member_compliance_scores

CREATE INDEX idx_compliance_scores_period ON public.member_compliance_scores USING btree (period_start, period_end);
