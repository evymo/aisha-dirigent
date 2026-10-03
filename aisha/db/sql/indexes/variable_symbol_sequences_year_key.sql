-- Index: variable_symbol_sequences_year_key

CREATE UNIQUE INDEX variable_symbol_sequences_year_key ON public.variable_symbol_sequences USING btree (year);
