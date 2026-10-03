-- Index: idx_orders_invoice_number

CREATE UNIQUE INDEX idx_orders_invoice_number ON public.orders USING btree (invoice_number) WHERE (invoice_number IS NOT NULL);
