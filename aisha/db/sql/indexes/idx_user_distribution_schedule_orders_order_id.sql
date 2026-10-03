-- Index: idx_user_distribution_schedule_orders_order_id
-- Table: user_distribution_schedule_orders

CREATE INDEX IF NOT EXISTS idx_user_distribution_schedule_orders_order_id ON public.user_distribution_schedule_orders(order_id);
