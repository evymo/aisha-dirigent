-- Table: member_product_plans
-- Personal product schedules
-- RLS: ENABLED
-- Created: 2026-01-17

CREATE TABLE IF NOT EXISTS public.member_product_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.member_products(id) ON DELETE SET NULL,
  protocol_id uuid REFERENCES public.distribution_protocols(id) ON DELETE SET NULL,
  catalog_product_id uuid REFERENCES public.product_catalog(id),
  name text NOT NULL,
  dose_amount numeric NOT NULL,
  dose_unit text NOT NULL DEFAULT 'mg',
  doses_per_day int NOT NULL DEFAULT 1,
  dose_timing text[] DEFAULT ARRAY['morning'],
  take_with_food boolean DEFAULT false,
  custom_distribution_instructions text,  -- User's own dosing instructions (e.g. "2 sprays morning, 1 evening")
  notes text,  -- General notes/comments about the plan
  package_quantity int DEFAULT 1,
  remaining_doses numeric,
  starts_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  is_active boolean DEFAULT true,
  show_on_dashboard boolean DEFAULT true,
  dashboard_position jsonb DEFAULT '{"row": 0, "col": 0}'::jsonb,
  last_taken_at timestamptz,
  next_reminder_at timestamptz,
  reminder_enabled boolean DEFAULT true,
  reminder_mode text DEFAULT 'push', -- 'push', 'email', 'both', 'none'
  reminder_minutes_before int DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.member_product_plans ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.member_product_plans IS 'Personal product schedules with tracking';
COMMENT ON COLUMN public.member_product_plans.user_id IS 'Owner of this plan';
COMMENT ON COLUMN public.member_product_plans.product_id IS 'Reference to member_products (optional)';
COMMENT ON COLUMN public.member_product_plans.protocol_id IS 'Reference to distribution_protocols if from study';
COMMENT ON COLUMN public.member_product_plans.product_id IS 'Reference to products if tracking a product';
COMMENT ON COLUMN public.member_product_plans.name IS 'Display name for the plan';
COMMENT ON COLUMN public.member_product_plans.dose_amount IS 'Amount per dose';
COMMENT ON COLUMN public.member_product_plans.dose_unit IS 'Unit (mg, ml, drops, sprays, etc.)';
COMMENT ON COLUMN public.member_product_plans.doses_per_day IS 'How many doses per day';
COMMENT ON COLUMN public.member_product_plans.dose_timing IS 'When to take (morning, noon, evening, night)';
COMMENT ON COLUMN public.member_product_plans.custom_distribution_instructions IS 'User custom dosing instructions (e.g. 2 sprays morning, 1 evening)';
COMMENT ON COLUMN public.member_product_plans.notes IS 'General notes or comments about this plan';
COMMENT ON COLUMN public.member_product_plans.remaining_doses IS 'Remaining doses in current package';
COMMENT ON COLUMN public.member_product_plans.status IS 'Plan status: active, paused, completed, cancelled';
COMMENT ON COLUMN public.member_product_plans.reminder_enabled IS 'Whether to send reminders';
COMMENT ON COLUMN public.member_product_plans.reminder_mode IS 'How to send reminders: push, email, both, none';
