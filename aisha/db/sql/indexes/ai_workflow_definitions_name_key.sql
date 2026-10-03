-- Index: ai_workflow_definitions_name_key

CREATE UNIQUE INDEX ai_workflow_definitions_name_key ON public.ai_workflow_definitions USING btree (name);
