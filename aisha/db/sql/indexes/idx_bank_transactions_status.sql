-- Index: idx_bank_transactions_status

CREATE INDEX idx_bank_transactions_status ON public.bank_transactions USING btree (match_status);
