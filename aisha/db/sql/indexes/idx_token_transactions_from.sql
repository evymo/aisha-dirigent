-- Index: idx_token_transactions_from
-- Table: token_transactions

CREATE INDEX idx_token_transactions_from ON public.token_transactions USING btree (from_user_id);
