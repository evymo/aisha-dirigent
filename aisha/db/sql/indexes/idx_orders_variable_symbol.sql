-- Index: idx_orders_variable_symbol

CREATE UNIQUE INDEX idx_orders_variable_symbol ON public.orders USING btree (variable_symbol) WHERE (variable_symbol IS NOT NULL);
