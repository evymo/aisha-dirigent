-- Table: project_revenue
-- Revenue records for completed projects/bookings.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS project_revenue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL,
  booking_id uuid REFERENCES public.consultation_bookings ON DELETE SET NULL,
  total_amount numeric(10,2) NOT NULL,
  currency text,
  revenue_type revenue_type NOT NULL DEFAULT 'project',
  status revenue_status NOT NULL DEFAULT 'pending',
  calculated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  paid_at timestamptz,
  stripe_transfer_ids text[],
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT project_revenue_story_id_fkey FOREIGN KEY (story_id)
    REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT project_revenue_approved_by_fkey FOREIGN KEY (approved_by)
    REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT project_revenue_amount_positive CHECK (total_amount > 0)
);

ALTER TABLE project_revenue ENABLE ROW LEVEL SECURITY;

