-- ==============================================================================
-- AISHA system identity — the platform's own actor (user + partner profile)
-- ==============================================================================
-- AISHA authors the stack's own expert rules (instance KB layer binds
-- expert_rules.author_partner_id, which is NOT NULL), owns system-originated
-- activity and is the stable attribution target for autonomous runs. Without
-- it a CLEAN install has zero partner_profiles rows and the KB seed aborts
-- (verified on a throwaway PG17: "no partner available for
-- expert_rules.author_partner_id").
--
-- Deterministic UUIDs (RFC 4122 v4 shape, reserved a15a block — "AISHA"):
--   user    00000000-0000-4000-a000-00000000a15a
--   partner 00000000-0000-4000-b000-00000000a15a
--
-- Hidden from the public guild directory (is_visible=false,
-- is_accepting_clients=false) — this is an attribution identity, not a
-- marketplace specialist. Runs BEFORE 05_our_aisha_default_story.sql so the
-- stack-default story can attach to the system partner, and BEFORE the
-- private instance KB layer (compile-seed order: implementation → instance).
-- Idempotent: ON CONFLICT keeps live values fresh on re-seed.
-- ==============================================================================

INSERT INTO aisha_auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-4000-a000-00000000a15a',
  'aisha@system.internal',
  '{"display_name": "AISHA", "system": true}'::jsonb,
  now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  updated_at = now();

INSERT INTO aisha_auth.identities (
  id, user_id, identity_data, provider, provider_id, email,
  created_at, updated_at, last_sign_in_at
)
VALUES (
  '00000000-0000-4000-a000-00000000a15a',
  '00000000-0000-4000-a000-00000000a15a',
  '{"sub": "00000000-0000-4000-a000-00000000a15a", "system": true}'::jsonb,
  'system',
  '00000000-0000-4000-a000-00000000a15a',
  'aisha@system.internal',
  now(), now(), now()
)
ON CONFLICT (provider, provider_id) DO UPDATE SET
  identity_data = EXCLUDED.identity_data,
  updated_at = now();

INSERT INTO partner_profiles (
  id, user_id, display_name, business_name, description, city, country,
  is_visible, is_accepting_clients, accepts_online_appointments,
  accepts_in_person_appointments, services, languages
)
VALUES (
  '00000000-0000-4000-b000-00000000a15a',
  '00000000-0000-4000-a000-00000000a15a',
  'AISHA',
  'AISHA Platform',
  'System identity of the AISHA orchestrator. Authors stack expert rules and owns autonomous platform activity. Not a marketplace specialist.',
  'system',
  'CZ',
  false,  -- is_visible: never listed in the public guild directory
  false,  -- is_accepting_clients
  false,
  false,
  ARRAY['platform-orchestration'],
  ARRAY['cs', 'en']
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  is_visible   = EXCLUDED.is_visible,
  is_accepting_clients = EXCLUDED.is_accepting_clients,
  updated_at   = now();
