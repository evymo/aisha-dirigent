-- Index: idx_onboarding_responses_assigned_partner_id
-- Table: onboarding_responses

CREATE INDEX IF NOT EXISTS idx_onboarding_responses_assigned_partner_id ON public.onboarding_responses(assigned_partner_id);
