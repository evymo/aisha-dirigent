-- Template: story_bootstrap_template.sql
-- Purpose: Bootstrap a new managed story for an instance in the orchestrator backend.
-- Status: Reference example — copy + adapt for your own implementation overlay.
-- Safety: Idempotent (ON CONFLICT DO UPDATE). No PHI.
--
-- Canonical UUIDs (replace with your own when forking):
--   Story:   c0000000-0000-0000-0000-000000000001
--   Ruleset: b0000000-0000-0000-0000-000000000002
--   Partner: deadbeef-0000-0000-0000-000000000002 (AISHA Bootstrap)
--   User:    deadbeef-0000-0000-0000-000000000001 (AISHA Test User)
--
-- This snippet is kept as a reference example. Real instance story data belongs in
-- your private overlay under `aisha/db/seed/instance/` (excluded from the OSS
-- distribution) and is compiled via the `instance` seed profile.
--
-- To apply locally: node scripts/db/compile-seed.mjs --profile=instance

BEGIN;

-- 1) Story base record
INSERT INTO public.partner_stories (
  id, partner_id, user_id, title, status, priority, origin,
  delivery_status, tech_stack, risk_profile, domain,
  repo_url, repo_provider, default_branch
)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'deadbeef-0000-0000-0000-000000000002',
  'deadbeef-0000-0000-0000-000000000001',
  'Acme Example Story',
  'active', 'high', 'internal',
  'analyzing',
  ARRAY['typescript','react','postgresql','vite','stripe','playwright'],
  'high',
  ARRAY['healthcare','e-commerce','research-platform'],
  'https://github.com/example/acme-app', 'github', 'main'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  tech_stack = EXCLUDED.tech_stack,
  risk_profile = EXCLUDED.risk_profile,
  domain = EXCLUDED.domain,
  updated_at = now();

COMMIT;

-- Next steps (RPC — handled by the instance seed profile, Phase 4):
-- Ruleset: shared rules + tenant-specific rules bound automatically
-- Context: build_config + env_hints populated
--
-- Manual verification:
-- SELECT generate_copilot_instructions('c0000000-0000-0000-0000-000000000001');
-- SELECT compose_context('c0000000-0000-0000-0000-000000000001', 'repo_plus_rules', NULL, 'Story verification', NULL);
