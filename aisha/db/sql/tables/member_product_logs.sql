-- Table: member_product_logs
-- Tracking when products were taken
-- RLS: ENABLED
-- Created: 2026-01-17

CREATE TABLE IF NOT EXISTS public.member_product_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.member_product_plans(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.member_products(id) ON DELETE SET NULL,
  catalog_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  logged_at timestamptz DEFAULT now(),
  dose_taken numeric,
  was_reminded boolean DEFAULT false,
  snooze_count int DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.member_product_logs ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.member_product_logs IS 'Log of when products were actually taken';
COMMENT ON COLUMN public.member_product_logs.user_id IS 'User who took the product';
COMMENT ON COLUMN public.member_product_logs.plan_id IS 'Reference to the product plan';
COMMENT ON COLUMN public.member_product_logs.logged_at IS 'When the product was taken';
COMMENT ON COLUMN public.member_product_logs.dose_taken IS 'Actual dose taken (may differ from plan)';
COMMENT ON COLUMN public.member_product_logs.was_reminded IS 'Whether user was reminded before taking';
COMMENT ON COLUMN public.member_product_logs.snooze_count IS 'How many times reminder was snoozed';
COMMENT ON COLUMN public.member_product_logs.notes IS 'Optional notes about this dose';
