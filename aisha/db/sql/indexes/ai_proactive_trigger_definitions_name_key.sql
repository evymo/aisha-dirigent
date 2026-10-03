-- Index: ai_proactive_trigger_definitions_name_key

CREATE UNIQUE INDEX ai_proactive_trigger_definitions_name_key ON public.ai_proactive_trigger_definitions USING btree (name);
