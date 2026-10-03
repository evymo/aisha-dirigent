-- Table: distribution_schedule_orders
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_schedule_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  order_id uuid NOT NULL,
  status text DEFAULT 'pending'::text,
  error_message text,
  processed_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT distribution_schedule_orders_schedule_id_order_id_key UNIQUE (order_id, schedule_id),
  CONSTRAINT distribution_schedule_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT distribution_schedule_orders_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES distribution_schedule(id) ON DELETE CASCADE
);

ALTER TABLE distribution_schedule_orders ENABLE ROW LEVEL SECURITY;
