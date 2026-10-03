-- RLS: expert_rules

ALTER TABLE public.expert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_public_rules ON public.expert_rules
  FOR SELECT
  TO anon
  USING (status = 'published' AND visibility = 'public');

CREATE POLICY auth_read_public_and_members_rules ON public.expert_rules
  FOR SELECT
  TO authenticated
  USING (status = 'published' AND visibility IN ('public', 'members'));

CREATE POLICY service_role_full_access_rules ON public.expert_rules
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
