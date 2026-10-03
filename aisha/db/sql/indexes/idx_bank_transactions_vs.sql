-- Index: idx_bank_transactions_vs

CREATE INDEX idx_bank_transactions_vs ON public.bank_transactions USING btree (variable_symbol) WHERE (variable_symbol IS NOT NULL);
