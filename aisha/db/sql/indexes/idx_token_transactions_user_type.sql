-- Index: idx_token_transactions_user_type
-- Table: token_transactions
--
-- D4 (ledger single source of truth): the balance is derived by folding the
-- ledger per (user_id, token_type) — get_my_wallet_balance, create_token_transaction
-- and purchase_product_voucher all run SUM(amount) WHERE user_id = ? [AND token_type = ?].
-- token_transactions had indexes only on from_user_id / to_user_id, so those folds
-- were sequential scans. Postgres does not auto-index FK-referencing columns; this
-- composite index makes the per-user ledger fold an index range scan.

CREATE INDEX idx_token_transactions_user_type ON public.token_transactions USING btree (user_id, token_type);
