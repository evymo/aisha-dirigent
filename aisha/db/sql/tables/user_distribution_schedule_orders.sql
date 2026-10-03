-- Table: user_distribution_schedule_orders
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_distribution_schedule_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  order_id uuid,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT user_distribution_schedule_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT user_distribution_schedule_orders_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES user_distribution_schedule(id) ON DELETE CASCADE
);

ALTER TABLE user_distribution_schedule_orders ENABLE ROW LEVEL SECURITY;
