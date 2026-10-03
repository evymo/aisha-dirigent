-- Index: idx_token_transactions_to_user_created
-- Table: token_transactions

CREATE INDEX idx_token_transactions_to_user_created ON public.token_transactions USING btree (to_user_id, created_at DESC);
