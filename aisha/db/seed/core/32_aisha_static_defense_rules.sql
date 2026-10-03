-- ==============================================================================
-- Static defense rules — canonical seed (core layer)
-- ==============================================================================
-- aisha_static_defense_rules is the SoT for static-analysis policy (Semgrep
-- rules) that gets generated INTO .semgrep/aisha-rules.yml via
-- scripts/gen-static-defense.mjs. The TABLE schema is part of the generated
-- baseline (aisha/db/sql/tables/aisha_static_defense_rules.sql), but its ROWS
-- lived only in archive/migrations/20260517052142_aisha_static_defense_rules.sql
-- (absorbed schema-only into the 0.9.0 baseline). That left every fresh install
-- with an EMPTY rule set, and — more importantly for CI — left the generator's
-- `--from-seed` mode reading the row data out of an archived historical
-- migration. The archive is being deleted (baseline-only invariant), so the
-- canonical row data must live here, in the seed corpus, as its source of truth.
--
-- This file is the DB-less source of truth consumed by:
--   1. scripts/gen-static-defense.mjs --from-seed  (renders .semgrep/aisha-rules.yml)
--   2. seed compile/apply (cold-start row seeding)
--
-- Same pattern as 27_plugin_transition_rules.sql: table in baseline, rows here.
--
-- Idempotent: ON CONFLICT (rule_id) DO NOTHING. To add/modify a rule in a live
-- DB use the Appsmith UI or the propose/publish RPCs; this seed is the cold-
-- start baseline, regenerate .semgrep/aisha-rules.yml after editing it.
-- ==============================================================================

INSERT INTO public.aisha_static_defense_rules (
  rule_id, category, owasp_category,
  semgrep_pattern, semgrep_paths, semgrep_message,
  severity, status, proposed_by, rationale
) VALUES
  (
    'aisha-raw-fetch-outside-ssrf-guard',
    'semgrep',
    'A10',
    '[{"pattern": "fetch($URL, ...)"}, {"pattern": "await fetch($URL, ...)"}]'::jsonb,
    '{"include": ["services/"], "exclude": ["services/*/src/__tests__/**", "services/*/src/**/*.test.ts", "packages/security/src/ssrf.ts"]}'::jsonb,
    'OWASP A10 (SSRF): raw fetch() call detected outside @aisha/security/ssrf. Use createSsrfGuard().safeFetch() to enforce host allowlist + scheme restriction.',
    'ERROR',
    'active',
    'seed-2026-05-17',
    'Migrated from hand-written .semgrep/aisha-rules.yml as part of Phase 6 DB-as-SoT generator rollout'
  ),
  (
    'aisha-console-in-service-runtime',
    'semgrep',
    'A09',
    '[{"pattern": "console.log(...)"}, {"pattern": "console.error(...)"}, {"pattern": "console.warn(...)"}, {"pattern": "console.info(...)"}, {"pattern": "console.debug(...)"}]'::jsonb,
    '{"include": ["services/"], "exclude": ["services/*/src/__tests__/**", "services/*/src/**/*.test.ts", "services/*/scripts/**"]}'::jsonb,
    'OWASP A09: console.* call in service runtime. Use createSafeLogger() from @aisha/security so log redaction + audit linking apply.',
    'ERROR',
    'active',
    'seed-2026-05-17',
    'Migrated from hand-written .semgrep/aisha-rules.yml as part of Phase 6 DB-as-SoT generator rollout'
  ),
  (
    'aisha-inline-jose-jwt-verify',
    'semgrep',
    'A07',
    '[{"pattern": "jwtVerify($TOKEN, ...)"}]'::jsonb,
    '{"include": ["services/"], "exclude": ["services/*/src/__tests__/**", "services/*/src/**/*.test.ts", "packages/security/src/jwt.ts"]}'::jsonb,
    'OWASP A07: inline jose.jwtVerify() detected. JWT verification belongs in @aisha/security/jwt where JWKS caching, audience checking, MFA policy and session-age policy are enforced uniformly.',
    'ERROR',
    'active',
    'seed-2026-05-17',
    'Migrated from hand-written .semgrep/aisha-rules.yml as part of Phase 6 DB-as-SoT generator rollout'
  ),
  (
    'aisha-fastify-route-without-zod',
    'semgrep',
    'A03',
    '[{"pattern": "$APP.post($PATH, async ($REQ, $REPLY) => { ... $REQ.body ... })"}, {"pattern": "$APP.put($PATH, async ($REQ, $REPLY) => { ... $REQ.body ... })"}, {"pattern": "$APP.patch($PATH, async ($REQ, $REPLY) => { ... $REQ.body ... })"}]'::jsonb,
    '{"include": ["services/"], "exclude": ["services/*/src/__tests__/**", "services/*/src/**/*.test.ts"]}'::jsonb,
    'OWASP A03: Fastify route reads req.body without validateBody()/Zod. Use validateBody(zodSchema, req.body) from @aisha/security to enforce schema before any downstream use.',
    'ERROR',
    'active',
    'seed-2026-05-17',
    'Migrated from hand-written .semgrep/aisha-rules.yml as part of Phase 6 DB-as-SoT generator rollout'
  ),
  (
    'aisha-hardcoded-secret-fallback',
    'semgrep',
    'A02',
    '[{"pattern": "process.env.$KEY ?? \"changeme\""}, {"pattern": "process.env.$KEY ?? \"password\""}, {"pattern": "process.env.$KEY ?? \"secret\""}, {"pattern": "process.env.$KEY ?? \"default-secret\""}, {"pattern": "process.env.$KEY || \"changeme\""}, {"pattern": "process.env.$KEY || \"password\""}, {"pattern": "process.env.$KEY || \"secret\""}]'::jsonb,
    NULL,
    'OWASP A02: weak secret fallback detected. If the env var is missing, the service should refuse to start (loud-fail) rather than silently using a guessable default.',
    'ERROR',
    'active',
    'seed-2026-05-17',
    'Migrated from hand-written .semgrep/aisha-rules.yml as part of Phase 6 DB-as-SoT generator rollout'
  ),
  (
    'aitg-llm-import-without-guard',
    'semgrep',
    'AITG-APP-01',
    '[{"pattern": "import { ... } from ''openai''"}, {"pattern": "import { ... } from ''@anthropic-ai/sdk''"}, {"pattern": "import { ... } from ''@google/generative-ai''"}, {"pattern": "import { ... } from ''cohere-ai''"}]'::jsonb,
    '{"include": ["services/", "packages/"], "exclude": ["services/*/src/__tests__/**", "services/*/src/**/*.test.ts", "packages/aitg/src/__tests__/**", "packages/security/src/__tests__/**"]}'::jsonb,
    'AITG-APP-01: file imports an LLM provider SDK but does not import withAitgGuard from @aisha/aitg. Every LLM call site MUST wrap calls in withAitgGuard so the runtime classifiers record outcomes to aitg_runs.',
    'ERROR',
    'active',
    'seed-2026-05-17',
    'Migrated from hand-written .semgrep/aisha-rules.yml as part of Phase 6 DB-as-SoT generator rollout'
  )
ON CONFLICT (rule_id) DO NOTHING;
