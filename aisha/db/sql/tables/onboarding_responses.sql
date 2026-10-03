-- Table: onboarding_responses
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS onboarding_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  step_name text,
  responses jsonb,
  completed_at timestamptz DEFAULT now(),
  overall_feeling int4,
  energy_perception int4,
  physical_confidence int4,
  mental_wellbeing int4,
  sleep_satisfaction int4,
  primary_concern text,
  secondary_concerns text[],
  main_goal text,
  timeframe_expectation text,
  age_range text,
  has_chronic_condition bool,
  condition_brief text,
  mentor_preference text,
  communication_style text,
  assigned_partner_id uuid,
  phone_call_scheduled_at timestamptz,
  phone_call_completed_at timestamptz,
  onboarding_completed bool DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT onboarding_responses_user_id_step_name_key UNIQUE (user_id, step_name),
  CONSTRAINT onboarding_responses_assigned_partner_id_fkey FOREIGN KEY (assigned_partner_id) REFERENCES partner_profiles(id),
  CONSTRAINT onboarding_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;
