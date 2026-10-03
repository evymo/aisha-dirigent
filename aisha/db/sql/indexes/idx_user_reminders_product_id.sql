-- Index: idx_user_reminders_product_id
-- Table: user_reminders

CREATE INDEX IF NOT EXISTS idx_user_reminders_product_id ON public.user_reminders(product_id);
