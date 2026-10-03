-- Index: idx_ai_workflow_definitions_context_active

CREATE INDEX idx_ai_workflow_definitions_context_active ON public.ai_workflow_definitions USING btree (context, is_active) WHERE (is_active = true);
