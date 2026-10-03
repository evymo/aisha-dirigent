-- Seed: agent_phase_catalog — agent work-phase taxonomy (two axes)
--
-- axis='activity': universal session state, validated by
--   fn_upsert_agent_live_session for agent_live_sessions.current_phase.
-- axis='pipeline': source-specific processing stage (VS Code extension
--   workPhase vocabulary), stored unvalidated in phase_detail.
--
-- AISHA extends this taxonomy by seeding rows (self-tooling loop) — no
-- schema change needed. UI reads labels via get_agent_phase_catalog().

INSERT INTO public.agent_phase_catalog (axis, slug, labels, sort_order)
VALUES
  ('activity', 'idle',      jsonb_build_object('cs', 'nečinný',    'en', 'idle'),      0),
  ('activity', 'planning',  jsonb_build_object('cs', 'plánuje',    'en', 'planning'),  1),
  ('activity', 'tool_use',  jsonb_build_object('cs', 'pracuje',    'en', 'tool use'),  2),
  ('activity', 'reviewing', jsonb_build_object('cs', 'kontroluje', 'en', 'reviewing'), 3),
  ('activity', 'stopped',   jsonb_build_object('cs', 'ukončeno',   'en', 'stopped'),   4),
  ('pipeline', 'routing',   jsonb_build_object('cs', 'směrování',  'en', 'routing'),   0),
  ('pipeline', 'edge',      jsonb_build_object('cs', 'edge',       'en', 'edge'),      1),
  ('pipeline', 'backend',   jsonb_build_object('cs', 'backend',    'en', 'backend'),   2),
  ('pipeline', 'eval',      jsonb_build_object('cs', 'evaluace',   'en', 'eval'),      3),
  ('pipeline', 'streaming', jsonb_build_object('cs', 'streamuje',  'en', 'streaming'), 4)
ON CONFLICT (axis, slug) DO UPDATE SET
  labels = EXCLUDED.labels,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();
