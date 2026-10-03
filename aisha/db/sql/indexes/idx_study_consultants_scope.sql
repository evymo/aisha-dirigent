-- Index: idx_study_consultants_scope
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_study_consultants_scope ON public.study_consultants USING btree (scope_type, study_id);
