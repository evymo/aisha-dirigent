-- Index: idx_bank_transactions_fio_id

CREATE UNIQUE INDEX idx_bank_transactions_fio_id ON public.bank_transactions USING btree (fio_transaction_id) WHERE (fio_transaction_id IS NOT NULL);
