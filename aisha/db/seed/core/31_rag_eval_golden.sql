-- =============================================================================
-- RAG eval — Golden Q/A seed (Step 0 of retrieval optimization plan 2026)
-- =============================================================================
-- Starter golden set: 24 representative Q/A pairs spanning the 4 context
-- profiles (chat_lightweight, repo_plus_rules, planning_heavy, evidence_strict)
-- × 2 languages (cs, en) × varied difficulty (1–5).
--
-- This seed is the *baseline* — operators are expected to extend it with
-- domain-specific golden questions (per-story Q/A, regulated-content checks,
-- regression questions captured from real chat sessions).
--
-- Pattern: INSERT … ON CONFLICT (slug) DO UPDATE → idempotent re-seed.
--
-- See: docs/proposals/RAG_OPTIMIZATION_2026.md §Step 0 (eval foundation).
-- =============================================================================
--
-- ⛔ PLATFORMNÍ SADA plat-cs-* / plat-en-* (2026-09-13).
--   Naměřeno: labely otázek rp-* / es-* / ph-cs-* odkazují na expert_rules z DEMO seedu
--   (seed/demo/02_expert_rules.sql; do knowledge_items je zrcadlí trigger
--   trg_sync_expert_rule_to_knowledge; na čisté DB s demo seedem se zrcadlí všech 27 a každý
--   label se najde — změřeno runtime testem). Produkční
--   profil demo nikdy neseeduje (brána demo-seed-nesmi-do-produkce), takže na instanci,
--   jejíž overlay tytéž slugy nenese, mají tyto otázky recall 0 pro KAŽDÝ embedding model
--   a jejich skupiny (context_profile × jazyk) končí ve fn_compare_rag_embedding_models „tie".
--   Tyto řádky se NEMĚNÍ — kde obsah je (demo, instance s tímto KB), měří správně.
--   Přibyla sada nad knowledge_items ze seed/core (21, 24, 25, 35), které existují na KAŽDÉ
--   instanci bez podmínky a embeduje je cold-start krok 6b — včetně anglických otázek nad
--   česky psaným obsahem (mezijazyčné vyhledávání). Hlídá brána
--   src/tests/gates/rag-golden-nad-platformnim-obsahem.gate.test.ts.
--
-- LABEL COVERAGE STATUS (Brick0/1 measurement foundation):
--   20/24 rows carry verified expected_chunk_slugs (set-based recall measurable).
--   The remaining 4 are planning_heavy questions scored JUDGE-ONLY by design — an
--   empty expected_chunk_slugs on those is INTENTIONAL, not a gap.
--     - 5 chat_lightweight (cl-cs-greeting-purpose, cl-cs-story-concept,
--       cl-en-platform-overview, cl-en-agents-vs-rules, cl-en-deploy-flow-summary)
--       → labelled to the new platform domain_docs (aisha-platform-overview /
--       aisha-story-concept / aisha-agents-vs-rules / aisha-deploy-flow-overview),
--       authored in 21_aisha_knowledge.sql from README + the deploy-flow skill.
--     - 3 evidence_strict (es-cs-rls-required-tables, es-en-no-bypass-rule,
--       es-en-emoji-forbidden) → labelled to EXISTING expert_rules whose summaries
--       already carry the rule (aisha-security-standards / aisha-development-laws /
--       aisha-commit-workflow / aisha-ci-hooks-workflow / aisha-code-hygiene). The
--       content was always present (in summary, which mcp_search_knowledge text-ranks
--       on) — this was a LABELLING gap, not a content gap. (An earlier note here
--       claimed the rule content was absent; that was a probe error — it searched
--       body_markdown, where the detail is a stub; the rules live in summary +
--       ai_instructions.)
--     - 4 planning_heavy (ph-cs-debug-failing-retrieval, ph-en-onboard-new-tenant,
--       ph-en-build-new-context-profile, ph-en-extend-hippocampus-loop) are
--       multi-step procedures with no single ground-truth chunk. The scorer skips
--       set-based recall when expected_chunk_slugs is empty and scores them via the
--       LLM judge (faithfulness + answer_relevancy). Their empty array is the
--       JUDGE-ONLY marker, by design — do NOT treat it as an unlabelled gap.
-- =============================================================================

INSERT INTO public.rag_eval_golden (
  slug, question, ground_truth_answer, expected_chunk_slugs,
  context_profile_slug, language, difficulty, tags, notes
) VALUES

-- ────────────────────────────────────────────────────────────────────────────
-- chat_lightweight × cs (3 questions, difficulty 1–2)
-- ────────────────────────────────────────────────────────────────────────────
(
  'cl-cs-greeting-purpose',
  'K čemu AISHA slouží?',
  'AISHA je multi-agent AI orchestrátor — pomáhá s návrhem, implementací a provozem softwarových produktů přes systém příběhů (stories), agentů a expertních pravidel. Není to chatbot, ale platforma pro autonomní vývoj.',
  ARRAY['aisha-platform-overview']::text[],
  'chat_lightweight', 'cs', 1,
  ARRAY['brand','orientation','chat']::text[],
  'Smoke test: jednoduchá orientace; selhání = retrieval nedosáhne k brand knowledge_items.'
),
(
  'cl-cs-story-concept',
  'Co je v AISHA "story" / příběh?',
  'Story je multi-tenant izolační jednotka — má vlastní knowledge_items, agenty, expert_rules a deployment kontext. Každý zákaznický projekt obvykle běží jako vlastní story.',
  ARRAY['aisha-story-concept']::text[],
  'chat_lightweight', 'cs', 2,
  ARRAY['platform','story','multitenant']::text[],
  NULL
),
(
  'cl-cs-language-support',
  'Podporuje AISHA češtinu?',
  'Ano. AISHA má i18n s minimálně dvěma segmenty (cs, en); knowledge_items + UI mají oba jazyky. Embeddingy a retrieval respektují language flag v context_profiles.',
  ARRAY['aisha-i18n-rules','aisha-i18n-standards']::text[],
  'chat_lightweight', 'cs', 1,
  ARRAY['i18n','localization']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- chat_lightweight × en (3 questions, difficulty 1–2)
-- ────────────────────────────────────────────────────────────────────────────
(
  'cl-en-platform-overview',
  'What is AISHA in one sentence?',
  'AISHA is a multi-agent AI orchestrator platform that combines stories (multi-tenant isolation units), agents, and expert rules to drive autonomous software development and operations.',
  ARRAY['aisha-platform-overview']::text[],
  'chat_lightweight', 'en', 1,
  ARRAY['brand','orientation','chat']::text[],
  NULL
),
(
  'cl-en-agents-vs-rules',
  'What is the difference between an AISHA agent and an expert rule?',
  'Agents are autonomous actors that execute tasks (write code, run tests, deploy). Expert rules are declarative knowledge and policies that constrain agent behavior — they are retrieved and injected into prompts via compose_context.',
  ARRAY['aisha-agents-vs-rules']::text[],
  'chat_lightweight', 'en', 2,
  ARRAY['platform','agents','rules']::text[],
  NULL
),
(
  'cl-en-deploy-flow-summary',
  'How does AISHA deploy a story to production?',
  'The autonomous deploy flow has 4 phases: drift detection (Phase 1), blue/green orchestration (Phase 2), Sentry-driven rollback monitoring (Phase 3), and Appsmith dashboard regeneration (Phase 4). All phases write to audit_journal and respect the approval gate.',
  ARRAY['aisha-deploy-flow-overview']::text[],
  'chat_lightweight', 'en', 2,
  ARRAY['platform','deploy','autonomy']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- repo_plus_rules × cs (3 questions, difficulty 2–3)
-- ────────────────────────────────────────────────────────────────────────────
(
  'rp-cs-rpc-only-rule',
  'Mohu z frontendu volat supabase.rpc() přímo?',
  'Ne. AISHA má absolutní pravidlo RPC-Only přes wrapper rpcUser<T>() / rpcService<T>() v services/svc-ai-chat/src/lib/rpcAdapter.ts. Přímé volání supabase.rpc() je zakázané a aisha-branding gate to zachytí.',
  ARRAY['aisha-rpc-only-pattern']::text[],
  'repo_plus_rules', 'cs', 2,
  ARRAY['rules','rpc','frontend']::text[],
  NULL
),
(
  'rp-cs-hook-only-rule',
  'Kde mám volat retrieval API z React komponenty?',
  'Vždy v custom hooku v src/hooks/useFeatureName.ts. Komponenta jen konzumuje hook. Toto je AISHA pravidlo Hook-Only Data Access — komponenty nikdy nevolají RPC přímo.',
  ARRAY['aisha-hooks-patterns']::text[],
  'repo_plus_rules', 'cs', 2,
  ARRAY['rules','hooks','frontend']::text[],
  NULL
),
(
  'rp-cs-migration-workflow',
  'Jak vytvořím novou DB migraci v AISHA?',
  'Vytvoř soubor v aisha/db/migrations/YYYYMMDDHHMMSS_description.sql, registruj přes npm run db:migration:register, aplikuj přes npm run db:migrate:local, regeneruj typy přes npm run db:types:gen:local a ověř npx tsc --noEmit. Migrace se nikdy nearchivují.',
  ARRAY['aisha-migration-workflow']::text[],
  'repo_plus_rules', 'cs', 3,
  ARRAY['rules','migrations','workflow']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- repo_plus_rules × en (3 questions, difficulty 2–3)
-- ────────────────────────────────────────────────────────────────────────────
(
  'rp-en-security-definer',
  'What is required for every new RPC that anon role can call?',
  'SECURITY DEFINER plus SET search_path TO public is mandatory. REVOKE ALL ON FUNCTION FROM PUBLIC must precede any GRANT, and explicit GRANT EXECUTE TO anon/authenticated is required. Anonymous-accessible functions also need an auth.uid()/service_role check.',
  ARRAY['aisha-security-definer-pattern']::text[],
  'repo_plus_rules', 'en', 3,
  ARRAY['rules','security','rpc']::text[],
  NULL
),
(
  'rp-en-audit-pattern',
  'How should a sensitive RPC log to audit_journal?',
  'Use the _audited suffix convention and INSERT INTO audit_journal (user_id, action, metadata) with a typed action string (e.g. hippocampus.learning_captured) and structured JSONB metadata. Never store PII in metadata — only IDs and counters.',
  ARRAY['aisha-audit-journal-pattern']::text[],
  'repo_plus_rules', 'en', 3,
  ARRAY['rules','audit','rpc']::text[],
  NULL
),
(
  'rp-en-i18n-no-fallback',
  'Why are fallback strings in t("key", "Fallback") forbidden in AISHA?',
  'Fallback strings mask missing translations. AISHA requires both src/i18n/segments/en/*.json and src/i18n/segments/cs/*.json entries for every key; npm run i18n:check enforces this in CI. The fallback would silently hide a missing CS translation.',
  ARRAY['aisha-i18n-rules','aisha-i18n-standards']::text[],
  'repo_plus_rules', 'en', 2,
  ARRAY['rules','i18n']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- planning_heavy × cs (3 questions, difficulty 3–4)
-- ────────────────────────────────────────────────────────────────────────────
(
  'ph-cs-add-feature-multistep',
  'Jaké kroky podniknu, když chci přidat novou stránku do AISHA admin sekce s tabulkovým přehledem dat z DB?',
  'Postup: 1) napsat migraci s view/RPC který data agreguje (SECURITY DEFINER + REVOKE/GRANT), 2) přidat Zod schema do src/schemas/, 3) napsat useXxx hook v src/hooks/ s useQuery + aisha.rpc + Zod parse, 4) vytvořit stránku v src/pages/admin/ s Card+Table komponentami, 5) přidat i18n klíče do segments/{en,cs}/admin.json, 6) napsat gate test, 7) ověřit npm run i18n:check + npx tsc --noEmit.',
  ARRAY['aisha-migration-workflow','aisha-zod-validation-patterns','aisha-hooks-patterns','aisha-react-query-patterns','aisha-i18n-rules','aisha-testing-rules']::text[],
  'planning_heavy', 'cs', 4,
  ARRAY['planning','admin','workflow']::text[],
  NULL
),
(
  'ph-cs-add-knowledge-source',
  'Jak připojím nový externí datový zdroj do AISHA?',
  'Musí projít Enterprise Source Onboarding procesem podle docs/SOURCE_ONBOARDING_CONTRACT.md a SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md. Bez schváleného onboardingu data nesmí vstoupit do produkce. Governance index je v GOVERNANCE_INDEX.md, SLA pro knowledge loop v KNOWLEDGE_LOOP_SLA.md.',
  ARRAY['aisha-enterprise-source-onboarding']::text[],
  'planning_heavy', 'cs', 3,
  ARRAY['planning','onboarding','governance']::text[],
  NULL
),
(
  'ph-cs-debug-failing-retrieval',
  'Co udělám, když AISHA pro konkrétní dotaz vrací irelevantní knowledge_items?',
  'Postup: 1) ověřit že knowledge_items mají správné item_type a ai_context_tags, 2) zkontrolovat že chunky existují (knowledge_chunks pro daný item), 3) ověřit že knowledge_embeddings je vyplněn pro chunky (embedding NOT NULL), 4) zkontrolovat context_profile slug a jeho layers.kb_retrieval konfiguraci, 5) ověřit story_id filtr (per-story izolace), 6) zkontrolovat audit_journal pro hippocampus.learnings_retrieved a knowledge.retrieval události.',
  '{}'::text[],
  'planning_heavy', 'cs', 4,
  ARRAY['planning','retrieval','debug']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- planning_heavy × en (3 questions, difficulty 3–4)
-- ────────────────────────────────────────────────────────────────────────────
(
  'ph-en-onboard-new-tenant',
  'What are the steps to onboard a new partner story (tenant) into AISHA?',
  'Steps: 1) create the story row in partner_stories with metadata, 2) seed brand brain knowledge_items (item_type=personality_trait/core_value) scoped to story_id, 3) bind agents to the story via agent_story_bindings, 4) configure expert_rules per area, 5) set context_profile preference and per-story knowledge isolation, 6) verify retrieval works via mcp_search_knowledge_v2 with p_story_id, 7) add eval golden Q/A scoped to the story.',
  '{}'::text[],
  'planning_heavy', 'en', 4,
  ARRAY['planning','onboarding','multitenant']::text[],
  NULL
),
(
  'ph-en-build-new-context-profile',
  'How do I create a new context_profile for a specialized retrieval use case?',
  'Insert a row into context_profiles with: slug, display_name, description, layers JSONB (enabled flags per layer: ruleset, project_context, kb_retrieval, agent_memory, learnings), token_budget, priority_order array, is_active. Optionally set ragnarok_hybrid=true on kb_retrieval for hybrid sparse+dense. Then run npm run db:types:gen:local so the slug type updates.',
  '{}'::text[],
  'planning_heavy', 'en', 3,
  ARRAY['planning','context','retrieval']::text[],
  NULL
),
(
  'ph-en-extend-hippocampus-loop',
  'How does a captured learning eventually become an expert_rule in AISHA?',
  'Flow: fn_capture_learning inserts an agent_memories row (memory_type=learning) from a reflection run. Each retrieval increments reuse_count via the hippocampus.learnings_retrieved audit event. fn_maybe_promote_learning checks the threshold (reuse_count >= 5 AND importance >= 6) and inserts an improvement_proposals row of type hippocampus_learning_promotion. After human/agent approval, the proposal becomes an expert_rule.',
  '{}'::text[],
  'planning_heavy', 'en', 4,
  ARRAY['planning','hippocampus','learning']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- evidence_strict × cs (3 questions, difficulty 3–5)
-- ────────────────────────────────────────────────────────────────────────────
(
  'es-cs-rls-required-tables',
  'Které tabulky v AISHA MUSÍ mít zapnuté RLS?',
  'Všechny tabulky s daty multi-tenant nebo PII: partner_stories, knowledge_items (per-story isolation), agent_memories, audit_journal, ai_runs, rag_eval_* (Step 0 plan). Tabulky s pouze referenčními daty (např. context_profiles) RLS mít nemusí. Pravidlo: pokud řádek může patřit jen určitému tenantovi/uživateli, RLS je povinné.',
  ARRAY['aisha-security-standards','aisha-development-laws']::text[],
  'evidence_strict', 'cs', 4,
  ARRAY['security','rls','strict']::text[],
  'Strict profile: odpověď musí být ověřitelná v docs nebo migracích, ne vymyšlená.'
),
(
  'es-cs-pii-storage-rule',
  'Smím uložit e-mail uživatele do audit_journal.metadata?',
  'Ne. Pravidlo AISHA říká: NEVER store PII in metadata — only IDs. Místo e-mailu se zaloguje user_id (uuid). Pokud potřebuješ e-mail pro debug, čteš ho přes JOIN s aisha_auth.users při auditu, ne při zápisu.',
  ARRAY['aisha-audit-journal-pattern','aisha-security-standards']::text[],
  'evidence_strict', 'cs', 3,
  ARRAY['security','audit','pii']::text[],
  NULL
),
(
  'es-cs-baseline-not-editable',
  'Mohu editovat aisha/db/migrations/00000000000000_baseline.sql?',
  'Ne. Baseline.sql je auto-generated z aisha/db/sql/. Edituj source-of-truth (aisha/db/sql/tables/, /functions/) a baseline se regeneruje. Po regeneraci se aplikované migrace archivují do the absorbed migration (now in the baseline) Přímá editace baseline je porušení pravidla Source of Truth.',
  ARRAY['aisha-migration-workflow','heals-upgrade-path-ordering-invariant']::text[],
  'evidence_strict', 'cs', 4,
  ARRAY['rules','sot','migrations']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- evidence_strict × en (3 questions, difficulty 3–5)
-- ────────────────────────────────────────────────────────────────────────────
(
  'es-en-search-path-mandatory',
  'Is SET search_path TO public required for every SECURITY DEFINER function in AISHA?',
  'Yes. SECURITY DEFINER without SET search_path is a security anti-pattern — a malicious user could shadow public.tablename in their own schema and the function would execute against the wrong table. AISHA gates require SET search_path TO public on every SECURITY DEFINER function. The pattern: SECURITY DEFINER then SET search_path TO public on its own line before AS $$.',
  ARRAY['aisha-security-definer-pattern']::text[],
  'evidence_strict', 'en', 4,
  ARRAY['security','rpc','strict']::text[],
  NULL
),
(
  'es-en-no-bypass-rule',
  'Can I commit with --no-verify if the husky pre-commit hook is failing?',
  'No. The AISHA "no workarounds" rule is absolute: NEVER use --no-verify, HUSKY=0, or ALLOW_NEW_FILES=1 to bypass hooks. The gate is the spec. If the hook fails, fix the underlying cause or sequence the PR so dependencies merge first. Bypassing is documented as a violation pattern that leads to regressions.',
  ARRAY['aisha-commit-workflow','aisha-ci-hooks-workflow']::text[],
  'evidence_strict', 'en', 5,
  ARRAY['rules','workflow','strict']::text[],
  NULL
),
(
  'es-en-emoji-forbidden',
  'Are emoji allowed anywhere in AISHA UI code?',
  'No. AISHA absolute rule: no emoji in UI — only lucide-react icons. This applies to JSX, status indicators, error states, and confirmation messages. The rule is enforced by lint configuration and code review. Emoji are permitted in commit messages and audit_journal metadata text but never in user-facing rendered output.',
  ARRAY['aisha-code-hygiene','aisha-development-laws']::text[],
  'evidence_strict', 'en', 3,
  ARRAY['rules','ui','strict']::text[],
  NULL
),

-- ────────────────────────────────────────────────────────────────────────────
-- PLATFORMNÍ SADA (2026-09-13) — jen knowledge_items ze seed/core, cs + en
-- ────────────────────────────────────────────────────────────────────────────
(
  'plat-cs-story-izolace',
  'Co v AISHA odděluje data jednoho zákaznického projektu od jiného?',
  'Story (příběh) — izolační jednotka pro více nájemníků. Každá story vlastní své knowledge_items, agenty, expertní pravidla a kontext nasazení; přístup ke znalostem se hlídá podle story_id (členství, ne viditelnost). Zákaznický projekt obvykle běží jako vlastní story.',
  ARRAY['aisha-story-concept']::text[],
  'chat_lightweight', 'cs', 2,
  ARRAY['platform','story','multitenant']::text[],
  'Platformní obsah (seed/core/21). Česká otázka nad anglicky psanou položkou.'
),
(
  'plat-cs-agent-vs-pravidlo',
  'Čím se v AISHA liší agent od expertního pravidla?',
  'Agent je autonomní aktér, který vykonává úlohy (píše kód, spouští testy, nasazuje). Expertní pravidlo je deklarativní znalost nebo politika, která chování agenta omezuje — vyhledá se a vloží do promptu přes compose_context. Agenti jednají, pravidla vedou.',
  ARRAY['aisha-agents-vs-rules']::text[],
  'chat_lightweight', 'cs', 2,
  ARRAY['platform','agents','rules']::text[],
  'Platformní obsah (seed/core/21).'
),
(
  'plat-cs-nasazeni-faze',
  'Jakými fázemi prochází autonomní nasazení příběhu do produkce?',
  'Čtyřmi: 1) detekce driftu (drift_state), 2) blue/green orchestrace (coolify_app_slots), 3) sledování a rollback řízený Sentry (rollback_history), 4) regenerace dashboardu v Appsmith. Všechny fáze zapisují do audit_journal a respektují schvalovací bránu.',
  ARRAY['aisha-deploy-flow-overview']::text[],
  'chat_lightweight', 'cs', 2,
  ARRAY['platform','deploy','autonomy']::text[],
  'Platformní obsah (seed/core/21).'
),
(
  'plat-cs-nejistota',
  'Co AISHA udělá, když si odpovědí není jistá?',
  'Nehádá. Buď ví jistě, nebo řekne, že neví — kvalita informace je absolutní: fakta, nebo ticho.',
  ARRAY['tao-quality-absolute']::text[],
  'chat_lightweight', 'cs', 1,
  ARRAY['tao','quality']::text[],
  'Platformní obsah (seed/core/25), psaný česky.'
),
(
  'plat-cs-frustrace',
  'Jak má AISHA reagovat na frustrovaného uživatele?',
  'Nejdřív uzná jeho emoce a teprve pak řeší problém. Na frustraci odpovídá víc láskyplně, ne formálněji — blíž, ne dál.',
  ARRAY['aisha-empathy-first','aisha-frustration-response']::text[],
  'chat_lightweight', 'cs', 2,
  ARRAY['personality','empathy']::text[],
  'Platformní obsah (seed/core/24), psaný česky.'
),
(
  'plat-cs-heals-poradi',
  'Kam v heals.sql patří příkaz, který používá nově přidaný sloupec, a proč chybu v pořadí neodhalí test nad čistou databází?',
  'Až ZA ADD COLUMN IF NOT EXISTS, který sloupec zaručuje. heals.sql běží shora dolů na existující databázi, kdežto baseline se aplikuje jen na čistou. Na čisté DB sloupec vytvořil už baseline, takže špatně umístěný příkaz tam projde a selže až na skutečné existující databázi; odhalí to jen verify-upgrade-apply.sh (regress → re-heal → seed).',
  ARRAY['heals-upgrade-path-ordering-invariant']::text[],
  'evidence_strict', 'cs', 4,
  ARRAY['database','heals','upgrade']::text[],
  'Platformní obsah (seed/core/35).'
),
(
  'plat-cs-cli-beh',
  'Jak stack AISHA spouští a řídí vlastní headless CLI agenty?',
  'Jako řízený runtime: resolve → admit ve čtyřech osách → ask/hold → approve → zápis do žurnálu (I1) → spawn → kontrakt výsledku. Nic specifického pro konkrétní nástroj není natvrdo; runtime se vybírá z řádků ai_runtime_registry.',
  ARRAY['aisha-self-governed-cli-run-lifecycle']::text[],
  'planning_heavy', 'cs', 4,
  ARRAY['runtime','cli','governance']::text[],
  'Platformní obsah (seed/core/35).'
),
(
  'plat-en-story-isolation',
  'What isolates one customer project''s data from another in AISHA?',
  'A story — the multi-tenant isolation unit. Each story owns its own knowledge_items, agents, expert_rules and deployment context; every knowledge reader is gated by story_id (membership, not visibility). A client project typically runs as its own story.',
  ARRAY['aisha-story-concept']::text[],
  'chat_lightweight', 'en', 2,
  ARRAY['platform','story','multitenant']::text[],
  'Platform content (seed/core/21).'
),
(
  'plat-en-uncertainty',
  'What does AISHA do when it is not sure about an answer?',
  'It does not guess: either it knows for certain or it says it does not know — information quality is absolute, facts or silence.',
  ARRAY['tao-quality-absolute']::text[],
  'chat_lightweight', 'en', 1,
  ARRAY['tao','quality']::text[],
  'Cross-lingual: English question over Czech-written platform content (seed/core/25).'
),
(
  'plat-en-frustrated-user',
  'How should AISHA respond to a frustrated user?',
  'It first acknowledges the user''s emotions and only then solves the problem; frustration is answered with more warmth, not more formality — closer, not further away.',
  ARRAY['aisha-empathy-first','aisha-frustration-response']::text[],
  'chat_lightweight', 'en', 2,
  ARRAY['personality','empathy']::text[],
  'Cross-lingual: English question over Czech-written platform content (seed/core/24).'
),
(
  'plat-en-heals-ordering',
  'When an existing AISHA database is upgraded via heals.sql, where must a statement that references a new column be placed, and why can a fresh-database test not catch a mistake?',
  'After the ADD COLUMN IF NOT EXISTS that guarantees the column. heals.sql runs top-to-bottom on existing databases, while the baseline is applied only to fresh ones; on a fresh DB the baseline already created the column, so a misplaced statement works there and fails only on a real existing database. Only verify-upgrade-apply.sh (regress -> re-heal -> seed) catches it.',
  ARRAY['heals-upgrade-path-ordering-invariant']::text[],
  'evidence_strict', 'en', 4,
  ARRAY['database','heals','upgrade']::text[],
  'Platform content (seed/core/35).'
),
(
  'plat-en-cli-run-lifecycle',
  'How does the AISHA stack launch and govern its own headless CLI agent instances?',
  'As a governed runtime: resolve -> admit on four axes -> ask/hold -> approve -> journal the dispatch (I1) -> spawn -> result contract. Nothing tool-specific is hardcoded; the runtime is selected from ai_runtime_registry rows.',
  ARRAY['aisha-self-governed-cli-run-lifecycle']::text[],
  'planning_heavy', 'en', 4,
  ARRAY['runtime','cli','governance']::text[],
  'Platform content (seed/core/35).'
)

ON CONFLICT (slug) DO UPDATE
SET question             = EXCLUDED.question,
    ground_truth_answer  = EXCLUDED.ground_truth_answer,
    expected_chunk_slugs = EXCLUDED.expected_chunk_slugs,
    context_profile_slug = EXCLUDED.context_profile_slug,
    language             = EXCLUDED.language,
    difficulty           = EXCLUDED.difficulty,
    tags                 = EXCLUDED.tags,
    notes                = EXCLUDED.notes,
    updated_at           = now();
