-- ==============================================================================
-- Expert Rules Seed: Default platform rules for local development
-- ==============================================================================
-- Purpose: Populate expert_rules table with default rules so gen:ide produces
--          valid IDE instruction files (copilot-instructions.md, AGENTS.md, etc.)
--
-- Prerequisites:
-- - 00_prod_users.sql must be executed first (partner_profiles dependency)
-- - 20_aisha_backbone.sql must be executed first (guild_expertise_areas dependency)
--
-- Source: Consolidated from the absorbed migration (now in the baseline)
--         and the absorbed migration (now in the baseline)
-- ==============================================================================

DO $$
DECLARE
  v_partner_id uuid;
  v_area_fullstack uuid;
  v_area_frontend uuid;
  v_area_api uuid;
  v_area_testing uuid;
  v_area_security uuid;
  v_area_devops uuid;
  v_area_pm uuid;
  v_rule_ids uuid[];
  v_ruleset_id uuid;
  v_story_id uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_existing_count int;
BEGIN
  -- Check: skip if rules already bootstrapped
  SELECT count(*) INTO v_existing_count
  FROM expert_rules WHERE status = 'published' AND slug LIKE 'aisha-%';

  IF v_existing_count >= 15 THEN
    RAISE NOTICE 'Expert rules already bootstrapped (% published aisha-* rules). Skipping.', v_existing_count;
    RETURN;
  END IF;

  -- Resolve author partner
  SELECT id INTO v_partner_id FROM partner_profiles LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE NOTICE 'No partner_profiles found. Skipping expert_rules bootstrap.';
    RETURN;
  END IF;

  -- Resolve expertise areas (NULL-safe)
  SELECT id INTO v_area_fullstack FROM guild_expertise_areas WHERE slug = 'fullstack' AND is_active = true;
  SELECT id INTO v_area_frontend FROM guild_expertise_areas WHERE slug = 'frontend-development' AND is_active = true;
  SELECT id INTO v_area_api FROM guild_expertise_areas WHERE slug = 'api-integrations' AND is_active = true;
  SELECT id INTO v_area_testing FROM guild_expertise_areas WHERE slug = 'testing-qa' AND is_active = true;
  SELECT id INTO v_area_security FROM guild_expertise_areas WHERE slug = 'security' AND is_active = true;
  SELECT id INTO v_area_devops FROM guild_expertise_areas WHERE slug = 'devops-infrastructure' AND is_active = true;
  SELECT id INTO v_area_pm FROM guild_expertise_areas WHERE slug = 'project-management' AND is_active = true;

  -- ═══════════════════════════════════════════════════════════════════════
  -- Phase 1: Knowledge-extraction documents (18 rules)
  -- ═══════════════════════════════════════════════════════════════════════

  -- 1. Development Laws
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-development-laws',
    'AISHA Development Laws',
    'Core development laws for AISHA platform. RPC-only data access, no sensitive data in logs, mandatory i18n, proper TypeScript usage.',
    'See knowledge-extraction/DEVELOPMENT_LAWS.md for full content.',
    'coding_standard'::expert_rule_category,
    v_area_fullstack, v_partner_id, 'public',
    E'MANDATORY rules for all AISHA code:\n1. Hook-Only Data Access — API calls ONLY from custom hooks, never from components\n2. No `any` types — use proper TypeScript types or `unknown` + type guard\n3. Zod Validation — all external data MUST pass Zod schema\n4. i18n for all UI text — use t("key"), no hardcoded strings, no fallbacks\n5. No console.log — use safeError() from @/lib/security/safeLogger\n6. No emoji in UI — use lucide-react icons\n7. Function params alphabetically ordered\n8. No @ts-ignore — use @ts-expect-error with explanation\n9. Gate tests must pass — npm run test:gates\n10. RPC-Only — no direct .from() queries, everything via the PostgreSQL RPC gateway',
    ARRAY['typescript','react','postgresql','rpc','security','i18n','development-laws','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 2. Architecture Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-architecture-patterns',
    'AISHA Architecture Patterns',
    'Project structuring, layers, responsibilities for React + PostgreSQL RPC gateway application.',
    'See knowledge-extraction/ARCHITECTURE_PATTERNS.md for full content.',
    'architecture_pattern'::expert_rule_category,
    v_area_frontend, v_partner_id, 'public',
    E'Project structure:\n- src/components/ — UI components (PascalCase)\n- src/hooks/ — Custom hooks (camelCase, use prefix) + barrel export index.ts\n- src/lib/schemas/ — Zod schemas\n- src/lib/security/ — safeLogger, userFacingErrors\n- src/pages/ — Route-level components\n- src/i18n/segments/ — Source translations\n- src/tests/ — hooks/, gates/, components/ tests\n\nLayer flow: Pages → Components → Hooks → API Client (PostgreSQL RPC gateway) → PostgreSQL\nEach layer has single responsibility. Components never call API directly.',
    ARRAY['react','architecture','project-structure','hooks','components','postgresql','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 3. API Communication
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-api-communication',
    'AISHA API Communication Patterns',
    'PostgreSQL RPC-only communication through hooks with Zod validation.',
    'See knowledge-extraction/API_COMMUNICATION.md for full content.',
    'api_design'::expert_rule_category,
    v_area_api, v_partner_id, 'public',
    E'API Communication Rules:\n- Frontend NEVER calls API directly — always through custom hooks\n- All data access via PostgreSQL RPC functions exposed through the gateway\n- No .from("table").select() — use RPC functions\n- No .select("*") — always list explicit columns\n- Zod validation on every API response: schema.parse(data)\n- TanStack Query for caching: useQuery for GET, useMutation for POST/PUT/DELETE\n- Error handling: safeError() for logging, never expose raw errors to user',
    ARRAY['postgresql','rpc','tanstack-query','zod','react-hooks','api','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 4. Hooks Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-hooks-patterns',
    'AISHA Hook Design Patterns',
    'Design patterns for React hooks: anatomy, Zod validation, TanStack Query, mutations.',
    'See knowledge-extraction/HOOKS_PATTERNS.md for full content.',
    'integration_pattern'::expert_rule_category,
    v_area_frontend, v_partner_id, 'public',
    E'Hook Design Patterns:\n- Every hook: src/hooks/useFeatureName.ts + barrel export in hooks/index.ts\n- GET hook: useQuery with queryKey, queryFn (RPC gateway call), Zod parse, staleTime\n- Mutation hook: useMutation + queryClient.invalidateQueries on success\n- Always check existing hooks in src/hooks/ before creating new ones\n- Test file: src/tests/hooks/useFeatureName.test.ts (check it does not already exist!)\n- Mock must match implementation: if hook uses rpc(), mock rpc(), not from().select()\n- Use vi.mocked(rpc) consistently, not custom spy wrappers',
    ARRAY['react','hooks','typescript','zod','tanstack-query','testing','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 5. Testing Philosophy
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-testing-philosophy',
    'AISHA Testing Philosophy',
    '4 test levels: Unit → Integration → Gate → E2E. Mock patterns, vitest configuration.',
    'See knowledge-extraction/TESTING_PHILOSOPHY.md for full content.',
    'testing_strategy'::expert_rule_category,
    v_area_testing, v_partner_id, 'public',
    E'Testing Levels:\n1. Unit (Vitest jsdom) — hook tests with mocked RPC gateway\n2. Integration — component rendering with providers\n3. Gate (Vitest node) — architecture, hygiene, security, i18n checks\n4. E2E (Playwright) — real browser, real Keycloak login against local PostgreSQL stack\n\nRules:\n- Run ONLY relevant tests: npm run test:run -- src/tests/hooks/useMyHook.test.ts\n- Never run all tests unless pre-PR or large refactor\n- Mock must match implementation — ALWAYS check hook before writing test\n- Use vi.mocked() consistently\n- parseRpcArraySafe uses safeParse — silently drops invalid items, run tests after Zod schema changes!',
    ARRAY['vitest','testing','react-testing','mocking','gate-tests','hooks','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 6. Code Quality Gates
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-code-quality-gates',
    'AISHA Code Quality Gates',
    'CI gate tests, code hygiene, what must pass: ESLint, TypeScript strict, architecture checks.',
    'See knowledge-extraction/CODE_QUALITY_GATES.md for full content.',
    'coding_standard'::expert_rule_category,
    v_area_testing, v_partner_id, 'public',
    E'Quality Gates (must all pass):\n- npm run test:gates — architecture, hygiene, security, i18n, emoji, a11y gates\n- npx tsc --noEmit — zero TypeScript errors\n- npm run lint — zero ESLint errors\n- npm run i18n:check — translation parity\n- npm run build — production bundle succeeds\n\nPre-commit (Husky, <30s): tsc + lint + i18n:segments:check\nPre-push (Husky, <3min): gates + validate:static + i18n:check + test:run + build',
    ARRAY['ci','quality','eslint','typescript','gate-tests','code-review','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 7. Security Standards
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-security-standards',
    'AISHA Security Standards',
    'Security patterns: sensitive data protection, safe logging, RLS, SECURITY DEFINER.',
    'See knowledge-extraction/SECURITY_STANDARDS.md for full content.',
    'security_practice'::expert_rule_category,
    v_area_security, v_partner_id, 'public',
    E'Security Rules:\n- No sensitive data (emails, names, health data) in logs/errors — use safeError()\n- Every table has RLS enabled + policies for each operation\n- Functions for anon MUST use SECURITY DEFINER + SET search_path TO ''public''\n- REVOKE ALL FROM PUBLIC + explicit GRANT TO anon/authenticated\n- Audit journal for sensitive operations: INSERT INTO audit_journal(user_id, action, metadata)\n- No sensitive data in metadata — only IDs and non-PII\n- Permission checks: hasPermission("view_sensitive_data"), never hardcoded role checks\n- OWASP Top 10 compliance required',
    ARRAY['security','rls','authentication','logging','owasp','postgresql','keycloak','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 8. i18n Standards
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-i18n-standards',
    'AISHA i18n Standards',
    'Internationalization: every user-facing text through translations. Segment structure, DeepL integration.',
    'See knowledge-extraction/i18n_STANDARDS.md for full content.',
    'coding_standard'::expert_rule_category,
    v_area_frontend, v_partner_id, 'public',
    E'i18n Rules:\n- All UI text via t("namespace.key") — no hardcoded strings in JSX\n- No fallbacks: t("key", "Fallback") is FORBIDDEN — masks missing translations\n- EN is canonical key set: edit src/i18n/segments/en/*.json\n- Add CS translation in src/i18n/segments/cs/*.json\n- Run npm run i18n:check before commit\n- Segments: core, auth, member, partner, admin, shop, research\n- Compiled files: src/i18n/locales/{cs,en,de,fr,ru,th}.json (auto-generated)\n- DeepL for missing: DEEPL_AUTH_KEY=... npm run i18n:segments:translate-missing',
    ARRAY['i18n','translations','react-i18next','deepl','localization','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 9. Project Complexity Tracking
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-project-complexity-tracking',
    'AISHA Project Complexity Tracking',
    'Tracking project complexity, task management, backlog organization for AI-assisted development.',
    'See knowledge-extraction/PROJECT_COMPLEXITY_TRACKING.md for full content.',
    'project_management'::expert_rule_category,
    v_area_pm, v_partner_id, 'public',
    E'Project Tracking:\n- Track task complexity for AI-assisted estimation\n- Use todo list tool for multi-step tasks\n- Mark tasks in-progress before starting, completed immediately after\n- Backlog tasks in docs/tasks/ directory\n- Use estimate_effort MCP tool for story estimation',
    ARRAY['project-management','complexity','task-tracking','backlog','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 10. Commit Workflow (STRENGTHENED: absolute --no-verify prohibition)
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-commit-workflow',
    'AISHA Commit Workflow',
    'Git commit conventions, PR workflow, pre-commit hooks, conventional commits. ABSOLUTE prohibition of --no-verify.',
    'See knowledge-extraction/COMMIT_WORKFLOW.md for full content.',
    'devops_pipeline'::expert_rule_category,
    v_area_devops, v_partner_id, 'public',
    E'Commit Conventions:\n- Conventional Commits: feat|fix|test|refactor|chore(scope): description\n- Pre-commit hook (Husky): tsc + lint + i18n segments check (<30s)\n- Pre-push hook: gates + validate + i18n + tests + build (<3min)\n- ALLOW_NEW_FILES=1 env var required when adding new files\n- Split large changes into logical commits\n\n⛔ ABSOLUTNÍ ZÁKAZ: --no-verify\n- NIKDY nepoužívej git push --no-verify ani git commit --no-verify\n- Bez výjimek. Žádné okolnosti toto neospravedlňují.\n- Pokud hook selhává → OPRAV PŘÍČINU selhání, neobcházej hook\n- Toto je KRITICKÉ bezpečnostní pravidlo platformy\n- AISHA Terminal Watcher detekuje --no-verify a okamžitě reportuje violation',
    ARRAY['git','commits','pr-workflow','conventional-commits','ci-cd','no-verify','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 12. RPC-Only Pattern
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-rpc-only-pattern',
    'RPC-Only Data Access Pattern',
    'No direct .from() queries. Everything via aisha.rpc() through the PostgREST gateway. Explicit columns only.',
    E'# RPC-Only Pattern\n\nAll frontend data access via aisha.rpc("function_name", { params }) through the AISHA PostgREST gateway.\nNo .from("table").select() — use RPC functions.\nNo .select("*") — list explicit columns.\nRPC functions with sensitive data use _audited suffix.',
    'architecture_pattern'::expert_rule_category,
    v_area_api, v_partner_id, 'public',
    E'RPC-Only Architecture:\n- Frontend: aisha.rpc("function_name", { p_param: value }) via gateway/PostgREST for ALL data access (`@/integrations/db/client`)\n- Frontend edge functions: aisha.functions.invoke("fn-name", { body }) — never raw fetch unless tracing the gateway URL explicitly\n- Backend services (services/svc-*): rpcService<T>("function_name", params) (service-role) / rpcUser<T>(..., userJwt) (RLS-enforced)\n- The legacy `supabase` JS SDK is banned; the SupabaseClient-shaped shim in services/svc-ai-chat/src/lib/rpcAdapter.ts exists only for compat and internally calls rpcService/rpcUser\n- No .from("table").select() ever\n- No .select("*") for externally returned data — always list explicit columns\n- Sensitive data functions use _audited suffix with audit_journal logging\n- SECURITY DEFINER for anon functions + SET search_path TO ''public''\n- REVOKE ALL FROM PUBLIC + explicit GRANT TO authenticated/anon',
    ARRAY['rpc','postgrest','gateway','architecture','data-access','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 13. SECURITY DEFINER Pattern
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-security-definer-pattern',
    'SECURITY DEFINER Pattern',
    'Functions with GRANT TO anon MUST have SECURITY DEFINER + SET search_path.',
    E'# SECURITY DEFINER Pattern\n\nCRITICAL: Functions with GRANT TO anon MUST have SECURITY DEFINER.\nAlways SET search_path TO ''public''.\nREVOKE ALL FROM PUBLIC before GRANT.',
    'security_practice'::expert_rule_category,
    v_area_security, v_partner_id, 'public',
    E'SECURITY DEFINER Rules:\n- Functions with GRANT TO anon MUST use SECURITY DEFINER\n- SET search_path TO ''public'' is MANDATORY with SECURITY DEFINER\n- REVOKE ALL ON FUNCTION ... FROM PUBLIC before any GRANT\n- GRANT EXECUTE TO anon, authenticated explicitly\n- SECURITY INVOKER for functions that should respect RLS\n- anon role = unauthenticated user, needs SECURITY DEFINER for data access',
    ARRAY['security-definer','anon','rls','postgresql','postgrest','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 14. Audit Journal Pattern
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-audit-journal-pattern',
    'Audit Journal Pattern',
    'Unified audit pattern for sensitive operations. INSERT INTO audit_journal with metadata.',
    E'# Audit Journal Pattern\n\nINSERT INTO audit_journal (user_id, action, metadata)\nVALUES (auth.uid(), ''ACTION_NAME'', jsonb_build_object(...));\n\nNever store sensitive data in metadata — only IDs.',
    'security_practice'::expert_rule_category,
    v_area_security, v_partner_id, 'public',
    E'Audit Logging:\n- Every sensitive operation: PERFORM write_audit_journal(...) (helper that wraps audit_journal INSERT)\n- ALWAYS pass p_user_id explicitly (alphabetical last among named params); the function''s auth.uid() fallback is for emergency only\n- action format: ''ENTITY_OPERATION'' (e.g. HEALTH_READ, CONSENT_GRANT)\n- metadata: jsonb with area, severity, entity_type, entity_id\n- NEVER store PII (emails, names, health data) in metadata — only IDs\n- Severity levels: info, warning, error, critical, notice\n- RAISE EXCEPTION for validation errors: append USING ERRCODE = ''22023'' (invalid_parameter_value) so the FE can map to i18n keys instead of leaking server strings',
    ARRAY['audit','journal','security','logging','compliance','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 15. Migration Workflow
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-migration-workflow',
    'Database Migration Workflow',
    'Production migration workflow: file → register → migrate → types. Never archive migrations.',
    E'# Migration Workflow\n\nAll DB changes via migration files in aisha/db/migrations/.\nNever archive. Never edit migration-registry.json manually.',
    'devops_pipeline'::expert_rule_category,
    v_area_devops, v_partner_id, 'public',
    E'Migration Rules:\n1. Create: aisha/db/migrations/YYYYMMDDHHMMSS_description.sql\n2. Register: npm run db:migration:register\n3. Apply: npm run db:migrate:local\n4. Types: npm run db:types:gen:local\n5. Verify: npx tsc --noEmit\n6. Test: npm run test:run -- relevant-test-file\n7. Build: npm run build\n\nNEVER archive migrations to the absorbed migration (now in the baseline)!\nNEVER manually edit migration-registry.json!\nNo psql meta-commands in migrations (\\connect, \\set, \\i, \\copy)\nNo COPY ... FROM STDIN\nMigrations run against AISHA PostgreSQL with the configured administrative DB role.',
    ARRAY['migration','database','workflow','postgresql','typescript','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 16. Code Hygiene
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-code-hygiene',
    'Code Hygiene Rules',
    'No emoji, no any, no console.log, no ts-ignore, no hardcoded texts. Gate tests must pass.',
    E'# Code Hygiene\n\nAbsolute rules enforced by gate tests.\nViolation = PR rejection.',
    'coding_standard'::expert_rule_category,
    v_area_fullstack, v_partner_id, 'public',
    E'Code Hygiene (gate-enforced):\n- No emoji in UI — use lucide-react icons only\n- No `any` types — use proper types or unknown + type guard\n- No console.log() — use safeError() from @/lib/security/safeLogger\n- No @ts-ignore — use @ts-expect-error with explanatory comment\n- No hardcoded text in JSX — use t("key") from useTranslation()\n- No .select("*") — list explicit columns\n- Dynamic permissions: hasPermission("action"), never if (role === "admin")\n- All exported code must have TSDoc comments\n- Gate tests: npm run test:gates',
    ARRAY['typescript','eslint','hygiene','code-quality','gate-tests','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 17. Testing Rules
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-testing-rules',
    'Testing Rules',
    'Run ONLY relevant tests. Mock must match implementation. Use vi.mocked() consistently.',
    E'# Testing Rules\n\nRun only relevant tests.\nMock must match hook implementation.\nAlways check hook before writing test.',
    'testing_strategy'::expert_rule_category,
    v_area_testing, v_partner_id, 'public',
    E'Testing Rules:\n- Run ONLY relevant tests: npm run test:run -- src/tests/hooks/useMyHook.test.ts\n- NEVER run all tests unless pre-PR or major refactor\n- Mock MUST match implementation: check hook before writing test\n- If hook calls rpc(), mock rpc() — not from().select()\n- Use vi.mocked(aisha.rpc) consistently, not custom spy wrappers\n- Avoid fragile toHaveBeenCalledTimes(1) — React re-renders cause multiple calls\n- Use vi.hoisted() for mocks used before import\n- After Zod schema change: IMMEDIATELY run affected test (parseRpcArraySafe silently drops invalid items)',
    ARRAY['testing','vitest','mocking','react','hooks','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- 18. i18n Rules
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-i18n-rules',
    'i18n Rules',
    'All UI text via t(). No hardcoded fallbacks. EN is canonical key set.',
    E'# i18n Rules\n\nt("namespace.key") for all UI text.\nNo hardcoded fallbacks.\nEN is source of truth.',
    'coding_standard'::expert_rule_category,
    v_area_frontend, v_partner_id, 'public',
    E'i18n Absolute Rules:\n- const { t } = useTranslation(); <span>{t("common.save")}</span>\n- No hardcoded strings in JSX: <button>Save</button> is FORBIDDEN\n- No fallbacks: t("key", "Fallback") MASKS missing translations\n- No i18n.exists() ternary workarounds\n- Add EN key to src/i18n/segments/en/*.json, CS to src/i18n/segments/cs/*.json\n- Run npm run i18n:check before commit\n- Segment files: core, auth, member, partner, admin, shop, research',
    ARRAY['i18n','translations','react','localization','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    status = 'published',
    updated_at = now();

  -- ═══════════════════════════════════════════════════════════════════════
  -- Phase 2: Comprehensive rules (from second archive migration)
  -- ═══════════════════════════════════════════════════════════════════════

  -- 28. Naming & Import Conventions
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-naming-import-conventions',
    'Naming & Import Conventions',
    'Formatting rules, naming conventions (PascalCase, camelCase, SCREAMING_SNAKE), import ordering.',
    'Comprehensive naming conventions, formatting, and import order rules.',
    'coding_standard'::expert_rule_category,
    v_partner_id, 'public', true,
    E'Formatting: 2-space indent, semicolons, double quotes for JSX, single for JS/TS, trailing comma ES5, 100 char soft limit.\n\n'
    || E'Naming Conventions:\n'
    || E'| Typ | Konvence | Příklad |\n'
    || E'|-----|----------|---------|\n'
    || E'| Komponenty | PascalCase | HealthCheckInForm.tsx |\n'
    || E'| Hooks | camelCase + use | useHealthTracking.ts |\n'
    || E'| Utility funkce | camelCase | formatDate.ts |\n'
    || E'| Konstanty | SCREAMING_SNAKE | MAX_PAIN_LEVEL |\n'
    || E'| TS typy/interfaces | PascalCase | HealthCheckIn |\n'
    || E'| SQL funkce | snake_case | get_my_check_ins_audited |\n'
    || E'| DB tabulky | snake_case plurál | health_check_ins |\n'
    || E'| i18n klíče | dot.notation | health.painLevel |\n\n'
    || E'Import Order (vždy dodržovat):\n'
    || E'1. React a React-related (useState, useNavigate)\n'
    || E'2. Externí knihovny (@tanstack/react-query, zod)\n'
    || E'3. Interní absolutní (@/ importy — hooks, components, utils)\n'
    || E'4. Relativní importy (./)\n'
    || E'5. Typy (type-only import, vždy na konci)',
    ARRAY['naming','conventions','formatting','imports','typescript','react','style','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 29. React Query & Data Fetching Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-react-query-patterns',
    'React Query & Data Fetching Patterns',
    'TanStack React Query best practices: queryKey, staleTime, invalidation, enabled pattern, caching.',
    'React Query patterns for efficient data fetching, caching, and state management.',
    'performance_optimization'::expert_rule_category,
    v_partner_id, 'public', true,
    E'React Query Best Practices:\n\n'
    || E'queryKey structure: ["domain", userId, { limit, offset, filters }]\n'
    || E'- Hierarchical keys enable targeted invalidation\n'
    || E'- Always include user/entity ID for cache isolation\n\n'
    || E'staleTime: 5 * 60 * 1000 (5 min default) — reduce unnecessary refetches.\n'
    || E'enabled: !!userId — conditional fetching, prevent queries without required params.\n\n'
    || E'Invalidation:\n'
    || E'- queryClient.invalidateQueries({ queryKey: ["domain", userId] }) — targeted\n'
    || E'- useMutation onSuccess → invalidate related queries\n'
    || E'- Never invalidate ALL queries — always scope to domain + user\n\n'
    || E'Anti-patterns:\n'
    || E'- Do NOT fetch entire tables on client\n'
    || E'- Do NOT use refetchInterval for polling (use subscriptions if needed)\n'
    || E'- Do NOT share queryKey across unrelated data domains',
    ARRAY['react-query','tanstack','caching','performance','data-fetching','invalidation','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 31. CI Hooks & Validation
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-ci-hooks-workflow',
    'CI Hooks & Validation Workflow',
    'Pre-commit (<30s) and pre-push (<3min) Husky hooks. ABSOLUTE prohibition of --no-verify bypass.',
    'Husky CI hooks ensuring code quality at commit and push time.',
    'devops_pipeline'::expert_rule_category,
    v_partner_id, 'public', true,
    E'Pre-commit (Husky, must complete < 30s):\n'
    || E'1. npx tsc --noEmit — TypeScript type check\n'
    || E'2. npm run lint — ESLint\n'
    || E'3. npm run i18n:segments:check — i18n segment validity\n\n'
    || E'Pre-push (Husky, must complete < 3min):\n'
    || E'1. npm run test:gates — Architecture/hygiene gate tests\n'
    || E'2. npm run validate:static — Static validation\n'
    || E'3. npm run i18n:check — Full i18n check\n'
    || E'4. npm run test:run — All tests (4500+)\n'
    || E'5. npm run build — Production build\n\n'
    || E'⛔ ABSOLUTNÍ ZÁKAZ: --no-verify\n'
    || E'NIKDY nepoužívej git push --no-verify ani git commit --no-verify.\n'
    || E'Žádné výjimky. Pokud hook selhává → OPRAV PŘÍČINU.\n'
    || E'AISHA Terminal Watcher aktivně monitoruje a reportuje jakékoliv použití --no-verify.\n\n'
    || E'Commit message format: type(scope): description\n'
    || E'Types: feat, fix, refactor, docs, test, chore, perf, ci\n'
    || E'POVINNÉ před každým push: npm run test:run && npm run build',
    ARRAY['ci','hooks','husky','pre-commit','pre-push','validation','workflow','no-verify','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 33. OWASP Security Compliance
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-owasp-compliance',
    'OWASP Security Compliance',
    'OWASP Top 10 coverage: injection, auth, data exposure, XSS, access control, logging.',
    'Complete OWASP Top 10 compliance checklist with specific protections.',
    'security_practice'::expert_rule_category,
    v_partner_id, 'public', true,
    E'OWASP Top 10 Compliance:\n\n'
    || E'| Riziko | Ochrana |\n'
    || E'|--------|---------|\n'
    || E'| Injection | PostgreSQL RPC parametrizované funkce, Zod validace vstupů |\n'
    || E'| Broken Auth | Keycloak OIDC + MFA, 30min sensitive session timeout |\n'
    || E'| Sensitive Data Exposure | TLS 1.2+, encrypted at rest, no PII in logs |\n'
    || E'| XXE | Zod validace JSON, no XML processing |\n'
    || E'| Broken Access Control | RLS policies + RPC authorization + audit_journal |\n'
    || E'| Security Misconfig | Strict TypeScript, CSP headers, npm audit |\n'
    || E'| XSS | React auto-escape, DOMPurify pro rich text |\n'
    || E'| Insecure Deserialization | Zod schema validation na všech API responses |\n'
    || E'| Vulnerable Components | npm audit, Snyk scanning, dependency updates |\n'
    || E'| Insufficient Logging | audit_journal pro všechny sensitive přístupy |',
    ARRAY['owasp','security','compliance','top-10','injection','xss','auth','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 36. Zod Schema & Validation Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-zod-validation-patterns',
    'Zod Schema & Validation Patterns',
    'Zod for all external data validation. Schema design, parseRpcArraySafe warning, type inference.',
    'Zod validation patterns for API responses, form data, and type-safe parsing.',
    'data_modeling'::expert_rule_category,
    v_partner_id, 'public', true,
    E'Zod Validation Rules:\n\n'
    || E'- Zod schema for EVERY API response: schema.parse(data)\n'
    || E'- Schemas in src/lib/schemas/ — shared across hooks and tests\n'
    || E'- Type inference: type MyType = z.infer<typeof mySchema>\n\n'
    || E'KRITICKÉ: parseRpcArraySafe warning:\n'
    || E'parseRpcArraySafe uses safeParse — TIŠE zahodí nevalidní položky místo chyby!\n'
    || E'→ Po KAŽDÉ změně Zod schématu OKAMŽITĚ spusť příslušný test.\n\n'
    || E'Anti-patterns:\n'
    || E'- Do NOT use as Type assertions without validation\n'
    || E'- Do NOT skip Zod parse on API responses\n'
    || E'- Do NOT use any — use unknown + Zod parse or type guard',
    ARRAY['zod','validation','schema','type-safety','typescript','parsing','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- ═══════════════════════════════════════════════════════════════════════
  -- Phase 3: Collect rule IDs and create story ruleset
  -- ═══════════════════════════════════════════════════════════════════════

  SELECT array_agg(id ORDER BY slug) INTO v_rule_ids
  FROM expert_rules
  WHERE status = 'published' AND slug LIKE 'aisha-%';

  IF v_rule_ids IS NULL OR array_length(v_rule_ids, 1) = 0 THEN
    RAISE NOTICE 'No published rules found after bootstrap. Cannot create ruleset.';
    RETURN;
  END IF;

  RAISE NOTICE 'Bootstrapped % published expert rules.', array_length(v_rule_ids, 1);

  -- Check if story exists
  IF NOT EXISTS (SELECT 1 FROM partner_stories WHERE id = v_story_id) THEN
    RAISE NOTICE 'AISHA story (%) not found. Skipping ruleset binding.', v_story_id;
    RETURN;
  END IF;

  -- Create or update story_rulesets
  INSERT INTO story_rulesets (
    id, story_id, rule_ids, rule_versions,
    context_profile, ruleset_fingerprint, created_by
  )
  SELECT
    'b0000000-0000-0000-0000-000000000001'::uuid,
    v_story_id,
    array_agg(er.id ORDER BY er.slug),
    jsonb_object_agg(er.slug, er.version),
    'repo_plus_rules',
    'rset:v2:bootstrap-' || md5(string_agg(er.slug || ':' || er.version::text, ',' ORDER BY er.slug)),
    'aisha-bootstrap'
  FROM expert_rules er
  WHERE er.status = 'published' AND er.id = ANY(v_rule_ids)
  ON CONFLICT (id) DO UPDATE SET
    rule_ids = EXCLUDED.rule_ids,
    rule_versions = EXCLUDED.rule_versions,
    ruleset_fingerprint = EXCLUDED.ruleset_fingerprint;

  -- Link story_contexts
  INSERT INTO story_contexts (story_id, ruleset_id)
  VALUES (v_story_id, 'b0000000-0000-0000-0000-000000000001'::uuid)
  ON CONFLICT (story_id) DO UPDATE
    SET ruleset_id = 'b0000000-0000-0000-0000-000000000001'::uuid,
        updated_at = now();

  RAISE NOTICE 'Story ruleset bound with % rules for story %.', array_length(v_rule_ids, 1), v_story_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Supplementary rules (run independently, not guarded by threshold)
-- These use ON CONFLICT DO UPDATE so are safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

DO $supp_rules$
DECLARE
  v_partner_id uuid;
  v_area_security uuid;
  v_area_devops uuid;
BEGIN
  SELECT id INTO v_partner_id FROM partner_profiles LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE NOTICE 'No partner_profiles found. Skipping supplementary rules.';
    RETURN;
  END IF;

  SELECT id INTO v_area_security FROM guild_expertise_areas WHERE slug = 'security' AND is_active = true;
  SELECT id INTO v_area_devops FROM guild_expertise_areas WHERE slug = 'devops-infrastructure' AND is_active = true;

  -- Enterprise Source Onboarding (required by documentation-closure gate test)
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-enterprise-source-onboarding',
    'Enterprise Source Onboarding',
    'Enterprise source onboarding povinný — Každý nový datový zdroj MUSÍ projít klasifikací, consent modelem, namespace ACL a approval flow před aktivací.',
    'See docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md for full content.',
    'security_practice'::expert_rule_category,
    v_partner_id, 'public', true,
    E'Enterprise source onboarding povinný — Každý nový datový zdroj MUSÍ projít onboarding procesem:\n\n'
    || E'1. Klasifikace zdroje (source_type, data_sensitivity, retention_class, legal_basis)\n'
    || E'2. Consent model (GDPR právní základ, retenční politiky)\n'
    || E'3. Namespace ACL (přístupová pravidla per sensitivity class)\n'
    || E'4. Approval flow (review + schválení před aktivací)\n\n'
    || E'Referenční dokumentace:\n'
    || E'| Dokument | Popis |\n'
    || E'|----------|-------|\n'
    || E'| [docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md](docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md) | **Source onboarding contract — klasifikace, consent, BYOD governance** |\n'
    || E'| [docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md](docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md) | **Operační onboarding postup pro nové source aplikace** |\n'
    || E'| [docs/enterprise/SOURCE_ADAPTER_PATTERN.md](docs/enterprise/SOURCE_ADAPTER_PATTERN.md) | **Adapter pattern pro source integrace** |\n\n'
    || E'Gate test: enterprise-source-hosting.gate.test.ts ověřuje přítomnost těchto pravidel.',
    ARRAY['enterprise','source-onboarding','security','governance','consent','classification','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 19. Coolify Deployment Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-coolify-deployment-patterns',
    'Coolify Deployment Patterns',
    'Pravidla pro Docker Compose deploymenty přes Coolify — heredoc escaping, migrate containers, diagnostika.',
    'See knowledge-extraction/COOLIFY_DEPLOYMENT_PATTERNS.md for full content.',
    'devops_pipeline'::expert_rule_category,
    v_area_devops, v_partner_id, 'public', true,
    E'## Coolify Docker Compose Deployment Rules\n\n'
    || E'### 1. Shell Heredoc Escaping — KRITICKÉ\n'
    || E'V shell scriptech (db-entrypoint-wrapper.sh apod.) rozlišuj:\n'
    || E'- `<<''DELIM''` (quoted) → shell NEPROVÁDÍ expanzi → `$$` je správně, `\\$\\$` je CHYBA\n'
    || E'- `<<DELIM` (unquoted) → shell PROVÁDÍ expanzi → `\\$\\$` je nutné pro literal `$$`\n\n'
    || E'**Anti-pattern:** `DO \\$\\$` uvnitř `<<''SETUP''` heredocu → psql dostane literal `\\$\\$` → syntax error\n'
    || E'**Correct:** `DO $$` uvnitř `<<''SETUP''` heredocu → psql dostane `$$` → funguje\n\n'
    || E'Gate test: infrastructure-security.gate.test.ts ověřuje správné dollar-quoting.\n\n'
    || E'### 2. Migrate Container Diagnostika\n'
    || E'Coolify API `/applications/{uuid}/logs` vrací POUZE logy běžících kontejnerů.\n'
    || E'Pro exited kontejnery (migrate) použij:\n'
    || E'- Diagnostický entrypoint co loguje do DB tabulky `_debug_migrate_log`\n'
    || E'- `exit 0` force mode aby web container nastartoval\n'
    || E'- Po diagnostice VŽDY revert na produkční entrypoint\n\n'
    || E'### 3. Docker Compose depends_on\n'
    || E'`service_completed_successfully` condition = migrate MUSÍ exit 0.\n'
    || E'Pokud migrate failne → web nikdy nenastartuje → 503.\n\n'
    || E'### 4. DB Container Rebuild\n'
    || E'DB entrypoint wrapper je COPY do image → vyžaduje rebuild.\n'
    || E'Coolify rebuild triggeruje POUZE pokud se Dockerfile nebo COPY sources změní.\n'
    || E'Volume-based data přežije rebuild — ale entrypoint script se aktualizuje jen s novým image.',
    ARRAY['coolify','docker','deployment','heredoc','migrate','diagnostics','devops','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 20. Shared DB Ownership Governance
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-shared-db-ownership-governance',
    'Shared DB Ownership Governance',
    'Pravidla pro sdílenou DB evymo-db: ownership transfer, schema izolace, Prisma migrate requirements.',
    'See knowledge-extraction/SHARED_DB_OWNERSHIP.md for full content.',
    'security_practice'::expert_rule_category,
    v_area_security, v_partner_id, 'public', true,
    E'## Shared Database Ownership Governance\n\n'
    || E'### Architektura\n'
    || E'AISHA používá jeden `evymo-db` PostgreSQL container sdílený mezi stacky:\n'
    || E'- AISHA stack (PostgreSQL RPC gateway): `aisha_admin` user, `public` schema\n'
    || E'- Langfuse stack: `langfuse_app` user, `langfuse` schema\n'
    || E'- NocoDB: `nocodb_app` user, `public` schema\n'
    || E'Propojeno přes Docker network `evymo-network`.\n\n'
    || E'### Prisma Ownership Requirement — KRITICKÉ\n'
    || E'Prisma migrate vyžaduje OWNERSHIP na tabulkách pro:\n'
    || E'- CREATE INDEX, ALTER TABLE, DROP INDEX\n'
    || E'- Pouhé GRANT ALL NESTAČÍ — Prisma kontroluje pg_tables.tableowner\n\n'
    || E'### Ownership Transfer Pattern\n'
    || E'V `db-entrypoint-wrapper.sh` DO block iteruje pg_tables/pg_sequences/pg_type\n'
    || E'a ALTERuje OWNER TO pro daný schema.\n'
    || E'MUSÍ běžet při KAŽDÉM bootu DB (ne jen first boot).\n\n'
    || E'### Anti-patterns\n'
    || E'- ❌ GRANT ALL bez OWNER transfer → Prisma stále failne\n'
    || E'- ❌ `\\$\\$` v quoted heredocu → DO block se nikdy nespustí (silent fail)\n'
    || E'- ❌ Spouštět Prisma jako superuser → security boundary porušení\n'
    || E'- ❌ Sdílet jeden DB user pro více služeb → audit trail nemožný\n\n'
    || E'### Correct Pattern\n'
    || E'```sql\n'
    || E'CREATE SCHEMA IF NOT EXISTS langfuse;\n'
    || E'ALTER SCHEMA langfuse OWNER TO langfuse_app;\n'
    || E'-- + DO $$ loop pro existing tables ownership transfer\n'
    || E'-- + ALTER DEFAULT PRIVILEGES pro future objects\n'
    || E'```\n\n'
    || E'Gate test: infrastructure-security.gate.test.ts ověřuje ownership transfer.',
    ARRAY['database','ownership','prisma','langfuse','shared-db','security','governance','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 21. Coolify Operations & API Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-coolify-operations',
    'Coolify Operations & API Patterns',
    'Provozní pravidla pro Coolify: API vzory, domain management, stack lifecycle, running:unhealthy diagnostika.',
    'See knowledge-extraction/COOLIFY_OPERATIONS.md for full content.',
    'devops_pipeline'::expert_rule_category,
    v_area_devops, v_partner_id, 'public', true,
    E'## Coolify Operations Rules\n\n'
    || E'### Stack Status Interpretation\n'
    || E'- `running:unhealthy` je KOSMETICKÝ stav — Coolify Sentinel reportuje unhealthy pokud JAKÝKOLI kontejner je exited/unhealthy\n'
    || E'- One-shot kontejnery (functions-init, migrate, task-runners) po dokončení exit 0 → Coolify vidí jako "crash"\n'
    || E'- VŽDY ověř funkčnost přes HTTP endpointy, ne Coolify status\n'
    || E'- Init kontejnery MUSÍ mít `healthcheck: disable: true`\n\n'
    || E'### Coolify API Patterns\n'
    || E'- `POST /api/v1/applications/{uuid}/restart` → FULL redeploy (build + remove + recreate ALL containers)\n'
    || E'- Restart ≠ graceful restart — zastaví VŠECHNY kontejnery, smaže je, znovu vytvoří\n'
    || E'- `/rebuild`, `/start`, `/status`, `/containers` → 404 pro docker-compose apps\n\n'
    || E'### Domain Management — KRITICKÉ\n'
    || E'- `docker_compose_domains` update vyžaduje array s `"name"` field (ne `"service"`)\n'
    || E'- Formát: `[{"name": "service-name", "domain": "https://domain.id3a.cz"}]`\n'
    || E'- Po PATCH domén je nutný restart stacku\n'
    || E'- Coolify auto-generuje domény: `{svc}-{uuid}.id3a.cz` — NEFUNKČNÍ pro vlastní domény\n\n'
    || E'### Anti-patterns\n'
    || E'- ❌ Restart Core stacku bez důvodu = ~3min výpadek VŠECH služeb\n'
    || E'- ❌ Spoléhat na Coolify `running:unhealthy` jako indikátor nefunkčnosti\n'
    || E'- ❌ Měnit docker_compose_domains přes Coolify UI (ztratí se při redeployi)\n'
    || E'- ❌ Používat `studio.id3a.cz` — správná doména je `db.aisha.guru`\n\n'
    || E'Gate test: coolify-compose-compliance.gate.test.ts ověřuje compose pravidla.',
    ARRAY['coolify','operations','api','deployment','domains','healthcheck','troubleshooting','devops','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  -- 22. SSO & OIDC Integration Patterns
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    expertise_area_id, author_partner_id, visibility, is_default,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'aisha-sso-oidc-patterns',
    'SSO & OIDC Integration Patterns',
    'Keycloak OIDC integrace: direct OIDC app clients, OAuth2 Proxy pattern, Langfuse/Appsmith SSO.',
    'See knowledge-extraction/SSO_OIDC_PATTERNS.md for full content.',
    'security_practice'::expert_rule_category,
    v_area_security, v_partner_id, 'public', true,
    E'## SSO / OIDC Integration Rules\n\n'
    || E'### Architektura: Keycloak = centrální OIDC provider\n'
    || E'- Web/mobile app: Keycloak OIDC clients with authorization code + PKCE where supported\n'
    || E'- OAuth2 Proxy (Studio, n8n): keycloak-oidc provider, PKCE podle podpory konkrétní služby\n'
    || E'- Langfuse, Appsmith: nativní OIDC, ANO PKCE\n\n'
    || E'### PKCE — KRITICKÉ ROZHODNUTÍ\n'
    || E'PKCE zapínej pro public/native klienty a vypínej pouze u confidential service klientů, které ho reálně nepodporují.\n'
    || E'V Keycloak musí nastavení klienta odpovídat konkrétnímu toku a typu klienta.\n'
    || E'Služby s nativní OIDC podporou (Langfuse, Appsmith) MOHOU použít PKCE.\n\n'
    || E'### Email Mapper — KRITICKÉ\n'
    || E'Keycloak MUSÍ mít `oidc-usermodel-property-mapper` (NE `attribute-mapper`) pro email claim.\n'
    || E'Špatný mapper → aplikace nedostane email claim → broken auth flow.\n\n'
    || E'### OAuth2 Proxy vzor\n'
    || E'- Image: quay.io/oauth2-proxy/oauth2-proxy:v7.8.2\n'
    || E'- Cookie secret: 32 bytes base64, MUSÍ být stabilní (ne rotovat)\n'
    || E'- SKIP_AUTH_ROUTES pro webhooky: `^/webhook/.*,^/webhook-test/.*,^/healthz`\n'
    || E'- ALLOWED_GROUPS filtruje přístup dle KC skupin\n\n'
    || E'### Realm JSON import behavior (KC 26.x)\n'
    || E'- `--import-realm` importuje POUZE při prvním startu (prázdná keycloak-db)\n'
    || E'- Po restartu s existující DB se realm JSON IGNORUJE\n'
    || E'- Produkční změny → KC Admin API nebo Admin UI\n\n'
    || E'### Anti-patterns\n'
    || E'- ❌ Legacy auth bridge jako mezivrstva místo přímého Keycloak OIDC\n'
    || E'- ❌ attribute-mapper místo property-mapper pro email\n'
    || E'- ❌ Sdílení client secret mezi klienty\n'
    || E'- ❌ Editace realm JSON pro produkční změny\n'
    || E'- ❌ COOKIE_SECURE=false v produkci',
    ARRAY['sso','oidc','keycloak','oauth2-proxy','authentication','security','aisha'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    is_default = true,
    visibility = 'public',
    updated_at = now();

  RAISE NOTICE 'Supplementary expert rules applied (22 rules total).';
END $supp_rules$;
