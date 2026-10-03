-- Index: idx_model_registry_eval_status

CREATE INDEX idx_model_registry_eval_status ON public.ai_model_registry USING btree (eval_status) WHERE (eval_status = ANY (ARRAY['pending'::text, 'evaluating'::text]));
