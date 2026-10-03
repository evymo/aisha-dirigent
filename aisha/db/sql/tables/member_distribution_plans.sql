-- Table: member_distribution_plans
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS member_distribution_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_token uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  study_registration_id uuid,
  subscription_id uuid,
  protocol_id uuid,
  starts_at date NOT NULL DEFAULT CURRENT_DATE,
  ends_at date,
  dose_amount numeric,
  dose_unit text,
  doses_per_day int4,
  dose_timing text,
  effective_from date,
  effective_until date,
  is_active bool DEFAULT true,
  custom_dose_amount numeric,
  custom_doses_per_day int4,
  custom_instructions text,
  status text DEFAULT 'active'::text,
  paused_at timestamptz,
  pause_reason text,
  compliance_target numeric DEFAULT 0.90,
  is_vip bool DEFAULT false,
  compensation_percentage int4 DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT member_distribution_plans_member_token_key UNIQUE (member_token),
  CONSTRAINT member_distribution_plans_protocol_id_fkey FOREIGN KEY (protocol_id) REFERENCES study_distribution_protocols(id) ON DELETE SET NULL,
  CONSTRAINT member_distribution_plans_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id) ON DELETE SET NULL,
  CONSTRAINT member_distribution_plans_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES member_subscriptions(id) ON DELETE SET NULL,
  CONSTRAINT member_distribution_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE member_distribution_plans ENABLE ROW LEVEL SECURITY;
