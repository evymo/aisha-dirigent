-- Index: idx_compliance_scores_token
-- Table: member_compliance_scores

CREATE INDEX idx_compliance_scores_token ON public.member_compliance_scores USING btree (member_token);
