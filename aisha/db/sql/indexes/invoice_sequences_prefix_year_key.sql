-- Index: invoice_sequences_prefix_year_key

CREATE UNIQUE INDEX invoice_sequences_prefix_year_key ON public.invoice_sequences USING btree (prefix, year);
