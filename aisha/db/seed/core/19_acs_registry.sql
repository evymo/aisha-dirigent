-- ============================================================================
-- ACS registry seed (core, PROD-SAFE) — Agent Communication Standard bootstrap.
-- ============================================================================
-- Folded out of the former 20260708131000_acs_grants_seed.sql migration when the
-- ACS schema was absorbed into aisha/db/sql/ (baseline-only doctrine). Every
-- contract starts in SHADOW (rollout ladder — docs/acs/ACS_ROLLOUT_RUNBOOK.md);
-- the jsonb refs mirror packages/acs-contracts/schemas/*.json (the package is the
-- source of truth, this seed carries refs + mode). ACL rows below are the first
-- shadow adopters — everything else is deny-by-default (acs_check_acl).
-- ============================================================================

INSERT INTO acs_message_schemas (schema_ref, json_schema, semantics, mode) VALUES
  ('acs.task.assign@1.0',     '{"$ref":"package://@aisha/acs-contracts/schemas/acs.task.assign@1.0.json"}',     'Delegace práce; obsah výhradně odkazem (R3).', 'shadow'),
  ('acs.task.result@1.0',     '{"$ref":"package://@aisha/acs-contracts/schemas/acs.task.result@1.0.json"}',     'Výsledek úlohy; status je uzavřený enum (R2).', 'shadow'),
  ('acs.effect.propose@1.0',  '{"$ref":"package://@aisha/acs-contracts/schemas/acs.effect.propose@1.0.json"}',  'Readback fáze 1 (R5).', 'shadow'),
  ('acs.effect.decision@1.0', '{"$ref":"package://@aisha/acs-contracts/schemas/acs.effect.decision@1.0.json"}', 'Readback fáze 2; váže se na params hash (R5).', 'shadow'),
  ('acs.verify.request@1.0',  '{"$ref":"package://@aisha/acs-contracts/schemas/acs.verify.request@1.0.json"}',  'Verifikace proti kanonickému intentu (R7).', 'shadow'),
  ('acs.verify.result@1.0',   '{"$ref":"package://@aisha/acs-contracts/schemas/acs.verify.result@1.0.json"}',   'Verdikt verifieru; insufficient_evidence je první třídy.', 'shadow'),
  ('acs.event.db_change@1.0', '{"$ref":"package://@aisha/acs-contracts/schemas/acs.event.db_change@1.0.json"}', 'Row-change event; pouze reference (8 kB NOTIFY limit).', 'shadow'),
  ('acs.workflow.graph@1.0',  '{"$ref":"package://@aisha/acs-contracts/schemas/acs.workflow.graph@1.0.json"}',  'Kontrakt reflection grafů (IP-11).', 'shadow')
ON CONFLICT (schema_ref) DO NOTHING;

-- Bootstrap ACL rows for the first shadow adopters (deny-by-default elsewhere).
INSERT INTO acs_agent_acl (sender_pattern, schema_ref, recipient_pattern, note) VALUES
  ('svc-ai-chat.',    'acs.task.assign@1.0',     'svc-agent-runner',  'planner→runner delegace'),
  ('svc-agent-runner','acs.task.result@1.0',     'svc-ai-chat.',      'runner→planner výsledky'),
  ('svc-ai-chat.',    'acs.effect.propose@1.0',  'svc-ai-chat.',      'toolExecutor readback (in-process přes DB)'),
  ('svc-ai-chat.',    'acs.effect.decision@1.0', 'svc-ai-chat.',      'toolExecutor readback'),
  ('svc-ai-chat.',    'acs.verify.request@1.0',  'svc-ai-chat.verifier', 'completion hook → verifier'),
  ('svc-ai-chat.verifier', 'acs.verify.result@1.0', 'svc-ai-chat.',   'verifier verdikt'),
  ('event-worker',    'acs.event.db_change@1.0', 'svc-ai-chat.',      'db events fan-out'),
  ('event-worker',    'acs.event.db_change@1.0', 'svc-ide-context',   'db events fan-out')
ON CONFLICT DO NOTHING;
