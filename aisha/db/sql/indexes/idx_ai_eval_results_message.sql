-- Index: idx_ai_eval_results_message

CREATE INDEX idx_ai_eval_results_message ON public.ai_eval_results USING btree (message_id);
