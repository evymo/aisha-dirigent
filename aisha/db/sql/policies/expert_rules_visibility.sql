-- Policies for expert_rules table
-- Anon can only read published public rules
-- Authenticated can read published public + members rules
-- Service role has full access

CREATE POLICY anon_read_public_rules ON expert_rules
  FOR SELECT TO anon
  USING (visibility = 'public' AND status = 'published');

CREATE POLICY auth_read_public_and_members_rules ON expert_rules
  FOR SELECT TO authenticated
  USING (visibility IN ('public', 'members') AND status = 'published');

CREATE POLICY service_role_full_access_rules ON expert_rules
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
