-- 41_aisha_knowledge_from_experience.sql
-- ═══════════════════════════════════════════════════════════════════════
-- GENEROVÁNO — neupravovat ručně. Zdroj: aisha/knowledge/<slug>.md
-- Generátor: scripts/db/gen-knowledge-seed.mjs (platforma) · přegenerovat: npm run db:seed:knowledge
-- ═══════════════════════════════════════════════════════════════════════
-- Obecné znalosti ze zkušenosti, platné pro každý fork: story_id NULL = výchozí příběh,
-- visibility public (repo je veřejné, ELv2). Seed core → každá instance při každém nasazení.
-- Zápis: ON CONFLICT (id) DO UPDATE — řádek se přepíše a verze zvedne jen tehdy,
-- když se obsah liší; opakované použití nic nemění. Vektory se neseedují (dopočítá je
-- platforma po zápisu), karanténa se nepřepisuje.
-- Zařazeno: 24 · nezařazeno (stav mimo adopted/retired): 4
--   ci-green-from-job-conclusions (proposed)
--   definer-search-path-ends-with-pg-temp (proposed)
--   monitoring-alert-delivery-and-proxy-trust (proposed)
--   secrets-out-of-build-args-and-commands (proposed)

-- Stráž. Relace API vyhrazený zdroj nezapíše (trigger trg_protect_reserved_knowledge,
-- odmítnutí v import_story_bundle a upsert_story_knowledge_item_audited) a slug ve vyhrazeném
-- prostoru vrstvy neobsadí (idx_knowledge_items_reserved_slug_unique). Co stráž chytá, proto
-- vzniká JEN ručním zásahem pod superuživatelem nebo v datové cestě: řádek s id této položky
-- pod jiným source_type než platform_knowledge, nebo slug této vrstvy pod jiným id. Seed ho
-- nepřepíše a odmítne nahlas se jménem položky.
DO $straz$
DECLARE
  v_cizi text;
BEGIN
  SELECT string_agg(format('%s (id %s, source_type %s, story %s)', ki.source_slug, ki.id, ki.source_type,
                           coalesce(ki.story_id::text, '-')), ', ' ORDER BY ki.source_slug)
    INTO v_cizi
    FROM public.knowledge_items ki
    JOIN (VALUES
    ('adapter-identity-and-gate-sample-size', '67e5b64b-66bc-ad49-4e9d-55f91fade539'::uuid),
    ('agent-handover-evidence', 'edb02ba8-9f69-3f6c-69e0-b2e216b5333d'::uuid),
    ('db-gate-protects-own-measurement', '60b24fa2-9bc5-c99c-e20b-cb5666adec4c'::uuid),
    ('deciding-between-colleagues', '9dbd1ecc-99ce-8dc1-3bae-19fe06e6feac'::uuid),
    ('embedding-backend-migration', '7847d641-ec07-05d0-108a-34a6994b2404'::uuid),
    ('evidence-vs-claim-model-numbers', '582e566b-e692-1cbf-cb3a-98276f82d6bf'::uuid),
    ('gpu-shared-lane-vllm-measured', '1d862703-5f10-09e0-ccba-73088a80e5db'::uuid),
    ('measurement-proves-it-measured', '2344fff8-6276-69ee-5b36-5552f95ff9cb'::uuid),
    ('model-access-architecture', '82500165-e5ba-361f-98b0-0c8b5f612dc8'::uuid),
    ('model-promotion-approval', 'ccb5e3fa-9962-eed1-0511-3878420b15d8'::uuid),
    ('ops-ci-run-states-and-forgejo-api', 'ae9a9084-d342-2dbc-9080-9d6bdfc30faa'::uuid),
    ('ops-ci-runner-restart-and-shared-cache', '1f7409f2-ea88-ad34-b2c5-943cb7ed7493'::uuid),
    ('ops-coolify-cleanup-removes-init-images', 'df8adfd7-7500-3190-45bc-aafa172e57fd'::uuid),
    ('ops-coolify-deploy-facts', 'ef074771-6ef4-3b9a-74b3-12759eee520e'::uuid),
    ('ops-deploy-speed-build-cache-and-transfer', 'c9602a0b-26fc-0d1c-a4f8-e92ba5acb955'::uuid),
    ('ops-flow-control-shared-machine-queue', '222d9f30-8c59-4fff-a7c5-38962cf9adf0'::uuid),
    ('ops-full-disk-is-data-not-garbage', '386001ca-8a8a-7760-a5ef-db3633ad4c9c'::uuid),
    ('ops-monitoring-alerts-need-delivery', 'ddaf548c-f4b2-a377-e4f5-190c5cd8f8db'::uuid),
    ('ops-patched-platform-upgrades', 'ba457195-ad57-acf7-196e-1b6a86abaee1'::uuid),
    ('ops-pull-through-cache-and-build-cache', 'de4f0b3f-96e5-8a8c-d678-3c061d95d479'::uuid),
    ('ops-secrets-in-env-history-and-urls', 'bfc314c4-eb72-339f-b7d0-8a82a60a2bdd'::uuid),
    ('ops-tmpfs-and-forgotten-background-jobs', 'adaad2c0-e7b4-289d-e005-22d216c1b7ae'::uuid),
    ('shared-gpu-job-runner-rules', '83d69583-2bac-6e96-d85b-dd43bdbb0146'::uuid),
    ('verify-identity-at-every-write', 'ca2e75b0-f59f-5d97-9e4e-f25f0a0bb4ad'::uuid)
    ) AS z(slug, id)
      ON (ki.id = z.id AND ki.source_type <> 'platform_knowledge')
      OR (ki.source_type = 'platform_knowledge' AND ki.source_slug = z.slug AND ki.locale = 'global' AND ki.id <> z.id);
  IF v_cizi IS NOT NULL THEN
    RAISE EXCEPTION '41_aisha_knowledge_from_experience.sql: vyhrazený prostor znalostí nese cizí řádek: % — vzniká jen ručním zásahem; seed ho nepřepíše', v_cizi;
  END IF;
END
$straz$;

-- adapter-identity-and-gate-sample-size  (zdroj: aisha/knowledge/adapter-identity-and-gate-sample-size.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '67e5b64b-66bc-ad49-4e9d-55f91fade539',
  'playbook',
  'platform_knowledge',
  'adapter-identity-and-gate-sample-size',
  'Adapter identity and how many examples a quality gate needs',
  'An adapter is identified by the bytes of its two files; its quality gate needs a disjoint, recorded holdout that is large enough, a paired comparison and a bare-base anchor.',
  '# Adapter identity and how many examples a quality gate needs

## Rules
1. **Identity = `peft:<sha256 of manifest>`.** [read] The manifest is exactly two lines in fixed order, `<sha256><two spaces><file name>`, for `adapter_config.json` and `adapter_model.safetensors`. It is a byte identity: never re-serialise the files. A hash of tensors alone is not an identity (strength, target modules and base revision live in the config).
2. **The serving layer computes identity from the files it loaded,** not from the declared value, and returns it with the answer. [read] Until it does, "the adapter ran" is unproven.
3. **Bare base as an anchor.** [read] Measure the base without the adapter on the same examples; it must come out worse. A request sent to the base name instead of the adapter name runs without the adapter and nothing fails.
4. **Holdout recorded before training.** [read] Fixed split with a seed; store sha256 of both parts, counts and class distribution next to the adapter. If the split was never recorded, earlier numbers are an upper estimate only.
5. **Size decides, not repetitions.** [measured: arithmetic] Three repetitions measure run noise. Sample uncertainty is about ±1/√n: ±35 points at n=8, ±14 at n=50, ±10 at n=100.
6. **Paired comparison.** [measured: arithmetic] Same examples for base and adapter; count discordant pairs; one-sided sign test. Fewer than 5 discordant pairs cannot reach p ≤ 0.05.
7. **Precision claims need counts.** [measured: arithmetic] Zero errors in n extractions gives an upper error bound of 3/n: "precision ≥ 0.97" needs at least 100 error-free extractions.
8. **Freeze the threshold and the minimum size before measuring;** below the minimum the gate says unmeasured. Only clean ground truth belongs in the gate. [read]

## Why
A tenant''s adapter gate had been measured on 7–8 examples with an unrecorded split, and the worse of two adapters was the one deployed.

---
**Verification:** read only (not run here) — rules 5-7 are arithmetic and can be checked from the formulas given; rules 1-4 and 8 are definitions agreed between a tenant and the operator of a shared model layer, recorded in a private review repository
**Evidence:** procedure: rule 5 = binomial standard error ~ 1/sqrt(n); rule 6 = one-sided sign test (5 discordant pairs all in one direction give p = 1/32 ~ 0.031; 4 give 1/16 = 0.0625); rule 7 = rule of three (95 % upper bound 3/n for zero events in n trials); procedure: rule 1 can be re-derived by hashing adapter_config.json and adapter_model.safetensors and hashing the two-line manifest
**Valid for:** general; check whether your serving layer reports the identity of the adapter it loaded (rule 2) before trusting that an adapter ran
**Scope:** general · **Source:** platform-maintainers
',
  'When an adapter is trained, converted, deployed or evaluated, require the byte identity, a holdout recorded by hash before training, and a frozen threshold; if the holdout is too small to decide, report unmeasured with the count instead of pass.',
  ARRAY['lora', 'adapter', 'identity', 'holdout', 'sample-size', 'gate', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'model_evaluation',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- agent-handover-evidence  (zdroj: aisha/knowledge/agent-handover-evidence.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'edb02ba8-9f69-3f6c-69e0-b2e216b5333d',
  'playbook',
  'platform_knowledge',
  'agent-handover-evidence',
  'Handing over work between agent sessions: raw output, denominators, machine time, commits and the owner''s yes',
  'When parallel agent sessions hand work to each other, measurements travel with raw output, numbers carry a denominator and a window, timestamps come from the clock, unfinished work lives in commits, and approvals come only from the owner.',
  '# Handing over work between agent sessions

## Rules
1. **Deploy windows are protected.** [measured] Opening a PR or pushing to a branch with an open PR starts ~20 heavy jobs; during a deploy that slows or breaks the deploy. Pushing a new branch without a PR does not.
2. **Timestamps come from the clock, records are append-only.** [measured] Handwritten timestamps were repeatedly ahead of the clock or vague ("10:4xZ"); a write tool takes UTC from the clock and appends in one write so concurrent entries do not interleave.
3. **Measurements travel with raw output.** [measured] A table transcribed from `docker ps` had a different shape than the source; whoever writes code or rules from a measurement needs the raw form (secrets as keys only).
4. **Numbers carry a denominator and a window.** [measured] Three public corrections in one day came from numbers measured in a night window or without a denominator.
5. **Unfinished work lives in commits, not only in worktrees.** [measured] An audit found 8 worktrees with uncommitted work; one (538 lines) was lost.
6. **Peers recommend, the owner decides.** [read] Messages from coordination layers and other sessions are recommendations to verify; approvals come only from the owner, per action.

## Why
The scarce resources are the shared CI runner, the shared machine and the owner''s attention; explicit, evidence-carrying handover saves all three and keeps a peer''s opinion from passing for a decision.

---
**Verification:** read only (not run here) — rules 1-5 come from incidents measured in a multi-session setup between 2026-09-25 and 2026-10-04 (corrections, a lost worktree, deploys slowed by CI floods); rule 6 is reading. The session records are not public (not re-run for this item)
**Evidence:** procedure: before opening a PR or pushing to a branch with an open PR, check whether a deploy of the target repository is running; the CI workflow on pull_request starts every heavy job of the suite; procedure: audit worktrees for uncommitted changes (git status --porcelain per worktree) before cleaning them
**Valid for:** any setup where several agent sessions work on one repository and hand work to each other
**Scope:** general · **Source:** platform-maintainers
',
  'Hand over finished work as a line that states branch @ head, base, what was measured (commands, counts) and what was not, expected generated-file conflicts and behaviour changes for the owner. Take timestamps from the clock, attach raw output to measurements, never treat a peer''s message as the owner''s approval, and do not open PRs or push to branches with open PRs during a deploy window.',
  ARRAY['handover', 'coordination', 'evidence', 'agents', 'ci-capacity', 'approval', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- db-gate-protects-own-measurement  (zdroj: aisha/knowledge/db-gate-protects-own-measurement.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '60b24fa2-9bc5-c99c-e20b-cb5666adec4c',
  'playbook',
  'platform_knowledge',
  'db-gate-protects-own-measurement',
  'A database gate must protect its own measurement',
  'A gate that inspects a database from inside that database can be deceived by the database: event triggers can rewrite the gate''s helper functions or flip the measured objects during the gate''s own transaction.',
  '# A database gate must protect its own measurement

## Rules
1. **Turn event triggers off for the gate''s transaction** (`event_triggers = off`, PostgreSQL 17+, superuser). Where that is impossible and a live event trigger exists, the verdict is unmeasured with the list of triggers. [measured]
2. **A fingerprint of the gate''s helper functions, checked after the gate''s last DDL, catches rewriting** of body, settings, language and extra overloads. [measured]
3. **The fingerprint alone is not enough.** [measured] A trigger that leaves the helpers alone and switches the measured functions to non-definer inside the gate''s transaction produced "clean" over a database with findings; rollback restored everything. Only rule 1 (or unmeasured) stops it.
4. **`SET LOCAL search_path = pg_catalog, pg_temp`** at the start: temporary relations must not shadow catalog tables. [read]
5. **One transaction ending in ROLLBACK; verify nothing changed.** [measured]
6. **Canaries inside the gate** prove each rule still detects its case. [read]
7. **Stale exceptions are an error.** [measured] An exception that matches nothing ended the run as a usage error, which also stopped a crude variant of the attack.

## Why
Measured on PostgreSQL 18.6 and 16.15, in both trigger orders: the full gate holds; with the trigger switch removed, the fingerprint layer alone reported clean.

---
**Verification:** read only (not run here) — rules marked [measured] were measured by a probe kept in a private review repository, on PostgreSQL 18.6 and 16.15 in both trigger orders (not re-run for this item); rules 4 and 6 are reading
**Evidence:** file: scripts/db/check-definer-rpc-security.mjs — example of a gate that reads the catalog of the database it checks; procedure: re-measure rule 3 by creating an event trigger that, during the gate''s transaction, switches a measured function from SECURITY DEFINER to INVOKER; the gate must report unmeasured (rule 1), not clean
**Valid for:** general
**Scope:** general · **Source:** platform-maintainers
',
  'When building or reviewing a check that runs SQL inside the inspected database (especially after replaying untrusted migrations), apply these rules and state plainly that it does not defend against an adversary with superuser rights.',
  ARRAY['postgres', 'security-definer', 'event-trigger', 'gate', 'catalog', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'database_security',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- deciding-between-colleagues  (zdroj: aisha/knowledge/deciding-between-colleagues.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '9dbd1ecc-99ce-8dc1-3bae-19fe06e6feac',
  'playbook',
  'platform_knowledge',
  'deciding-between-colleagues',
  'When two recommendations disagree: name what each protects, look for a variant that keeps both',
  'A disagreement between two advisers usually means two valid concerns. Name them, look for a variant that keeps both (never trading a security or isolation invariant), let each side state its conditions, then decide with the owner.',
  '# When two recommendations disagree

## Rules
1. **[read] Name what each side protects** (for example: operations wants a stateless node without public entry; the owner of a shared layer wants isolation by shape).
2. **[read] Look for a variant that keeps both;** ask both sides whether it does. If one concern is a security or isolation invariant, it is not traded: the variant must keep it fully, otherwise that side wins.
3. **[read] Collect each side''s conditions** and make them part of the decision.
4. **[read] Decide with the owner,** and record the decision so that it can be reopened if someone sees a risk nobody named.
5. **[read] Admit your own lean when it was wrong** and say what corrected it.

## Why
Two advisers recommended opposite modes for the same design; both were right about different risks. A third variant kept both concerns, and both accepted it with conditions. The first lean of the one deciding had missed a decisive identity issue.

---
**Verification:** read only (not run here) — one observed case on 2026-10-05 (a model-mesh design: an operations view and an isolation view recommended opposite modes; a third variant kept both and both sides accepted it with conditions), recorded in a private review repository; a pattern, not yet repeated
**Evidence:** one recorded case (private review repository, 2026-10-05): opposite recommendations, a third variant, conditions from both sides, decision with the owner; review note on the case: a variant that weakens a security invariant is not a compromise but a loss of the invariant
**Valid for:** general
**Scope:** general · **Source:** platform-maintainers
',
  'When two sessions or advisers recommend opposite options, write down what each one protects, propose a variant that keeps both, ask both for conditions, and only then decide with the owner; never trade away a security or isolation invariant, and do not pick the side of the last message.',
  ARRAY['decisions', 'conflict', 'architecture', 'collaboration', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'collaboration',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- embedding-backend-migration  (zdroj: aisha/knowledge/embedding-backend-migration.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '7847d641-ec07-05d0-108a-34a6994b2404',
  'playbook',
  'platform_knowledge',
  'embedding-backend-migration',
  'Moving embeddings to another backend',
  'The same model name on another backend is not the same vector space. Recompute the whole corpus under a new identity, then switch queries; a compatibility check is not a switch gate.',
  '# Moving embeddings to another backend

## Rules
1. **Recompute, then switch.** [read] Recompute all vectors once on the new backend under a new identity, verify by counting vectors per identity in the database, then switch queries. Cost = number of items × measured vectors per second.
2. **Identity is more than the weights hash.** [read] It includes the weights format and the text recipe (query vs passage prefix, chunking recipe). Vectors with different recipes are different spaces.
3. **Two thresholds, two questions.** [read] Self-consistency (same weights file, e.g. 0.999) and compatibility of different weights (e.g. 0.99) must not be merged into one number.
4. **A compatibility check must prove it compares two backends.** [measured] With the same endpoint on both sides the check reported "same space". Refuse identical endpoints and record both backends'' model identity.
5. **The sample must exercise the risk.** [measured] A built-in sample whose longest text was about 300 characters cannot see truncation differences. Use the tenant''s own corpus, including its longest chunks.
6. **A named key that is missing is an error.** [measured] The check silently sent the request without a key and passed; an open lane would look fine.
7. **Twenty generic sentences say nothing about top-k in a 100k corpus.** [read]
8. **"100 % under one identity" is a database count, not "the job finished".** [read]

## Why
Mixing spaces breaks retrieval silently: results are returned, only worse. On one tenant about half of the vectors carried the declared identity before the move.

---
**Verification:** read only (not run here) — rules 4-6 were measured by a probe with a fake fetch, kept in a private review repository (not re-run for this item); rules 1-3, 7 and 8 are agreements and reading
**Evidence:** file: aisha/db/sql/tables/knowledge_embeddings.sql — every vector carries its model identity (model, model_version, model_registry_id), which is what rule 8 counts; procedure: re-measure rule 4 by pointing both sides of a compatibility check at the same endpoint; a correct check refuses to run instead of reporting the same space; procedure: re-measure rule 6 by naming an API key variable that is not set; a correct check fails instead of sending the request without a key
**Valid for:** general
**Scope:** general · **Source:** platform-maintainers
',
  'When a tenant''s embedding model, weights format or serving backend changes, recommend recomputing all vectors under a new identity before switching queries, and refuse to treat a small-sample similarity check as proof that spaces can be mixed.',
  ARRAY['embeddings', 'vector-space', 'migration', 'identity', 'rag', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'rag',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- evidence-vs-claim-model-numbers  (zdroj: aisha/knowledge/evidence-vs-claim-model-numbers.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '582e566b-e692-1cbf-cb3a-98276f82d6bf',
  'playbook',
  'platform_knowledge',
  'evidence-vs-claim-model-numbers',
  'Numbers about models are claims until a logged run backs them',
  'Before choosing a base model, separate measured numbers (run with label and log) from distilled claims, and measure what the choice of a shared base actually needs.',
  '# Numbers about models are claims until a logged run backs them

## Rules
1. **[read] Mark every number:** measured (run with label, date and log), claimed (no run evidence), estimate, or plan.
2. **[read] A distilled summary without labels and logs is not evidence for a decision,** however precise it looks.
3. **[read] Measure what the decision needs:** for a shared lane, memory and throughput of all lanes at the same time (not summed separately), concurrency with training, and quality on the tenant''s own data.
4. **[read] Keep one living "what is measured" document** and update it with each run; list contradictions between documents instead of picking one silently.

## Why
General rules for measurements are in `measurement-proves-it-measured`; this item adds what is specific to models. In one survey before the first probe on a GPU node, all training and multi-adapter numbers turned out to be an unlogged distillate, and no serving or embedder-quality number had been measured. Choosing on them would have been choosing on impressions.

---
**Verification:** read only (not run here) — derived from a survey of design documents and measurement records on 2026-10-05 in which three key claims were checked by hand and found unlogged; the survey is kept in a private review repository. General measurement rules live in measurement-proves-it-measured; this item covers only what is specific to choosing models
**Evidence:** one recorded survey (private review repository, 2026-10-05): training and multi-adapter numbers in circulation had no run label or log behind them; procedure: for every number in a model comparison, find the run label, date and log; a number without them is a claim
**Valid for:** general method; the concrete state changes with each measurement
**Scope:** general · **Source:** platform-maintainers
',
  'When asked to choose or compare models, list for each number whether it comes from a logged run (label, date, log) or is a distilled claim; treat claims as hypotheses and plan the measurement that would confirm them.',
  ARRAY['models', 'measurement', 'evidence', 'gpu', 'serving', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'engineering_practice',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- gpu-shared-lane-vllm-measured  (zdroj: aisha/knowledge/gpu-shared-lane-vllm-measured.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '1d862703-5f10-09e0-ccba-73088a80e5db',
  'engineering_doc',
  'platform_knowledge',
  'gpu-shared-lane-vllm-measured',
  'Shared vLLM lane on a GPU node: what leaks between tenants and what ''ready'' means (measured)',
  'Measured with a pinned vLLM image: prefix cache leaks between clients unless every tenant gets its own cache_salt; /v1/models lists every tenant''s adapter; /health 200 is not readiness (first request can exceed 60 s); --gpu-memory-utilization is a share of the whole card. Container GPU access works via CDI and --gpus; check that the image''s architecture list covers the card.',
  '# Shared vLLM lane on a GPU node (measured)

## Rules
1. **Prefix cache is shared across ALL callers unless salted per tenant.** [measured]
   - Two clients sent the same 1176-token prefix to the same base model. The second client got **1168 cached tokens**, i.e. a hit on the first client''s prompt.
   - With a different `cache_salt` per tenant the hit was **0**. The same salt again hit 1168 (anchor).
   - The enforcement point in front of the lane must set `cache_salt` from the tenant identity established at the entry (network and tenant key), never from the request, and reject any salt sent by the client. Otherwise the cache must be off for that lane.
   - Gate:
     - two tenants with the same prefix → `cached_tokens` of the second = 0;
     - anchor: the same tenant twice → > 0;
     - mutant: salt off or taken from the client → hit.
   - The leak is a timing side channel (time to first token shows that someone already sent this prefix), not content.
2. **An adapter does not share prefix cache with the base, but that is not tenant isolation.** [measured] The same prefix on a LoRA adapter after the base gave 0 cached tokens, and the adapter twice gave 1168. The adapter identity is part of the cache key. Two tenants on the same base or the same adapter still share, so rule 1 applies regardless.
3. **`/v1/models` lists every loaded adapter to any caller.** [measured]
   - One server with two adapters returned `base, lora-a, lora-b` to an unauthenticated local call.
   - On a shared lane this reveals other tenants'' adapter names.
   - The enforcement point must answer the model list per tenant (shared bases + own adapters only) and return 404 for a foreign adapter.
4. **`/health` 200 is not "ready".** [measured]
   - Without CUDA graphs (`--enforce-eager`), the server reported healthy after 140 s, but the first request did not return within a 60 s client timeout.
   - With CUDA graphs (default), it was healthy after 271 s (engine init 224 s: compile 23 s, graph capture about 2.4 min), and the first request then took 358 ms.
   - Readiness = `/health` 200 **and** a completed warm-up request.
   - A lane restart lasts minutes. Callers must report "lane starting" loudly as unavailability, not hang until their own timeout, and must never fall back to another model or to CPU.
5. **`--gpu-memory-utilization` is a share of the WHOLE card, not of free memory.** [measured]
   - At 0.25 the engine process held about a quarter of the card''s total memory, matching vLLM''s own target.
   - Two lanes with the default 0.9 cannot share one card.
   - Budget the node in absolute GiB and derive each lane''s fraction from it, rounded down. The sum of the fractions plus a reserve must be ≤ 1.0, otherwise stop before deploying.
   - On a card without MIG partitioning (`nvidia-smi` reports MIG N/A) this budget is the only separation between lanes: enforce it per lane and treat an overrun as a stop, not a warning.
6. **Container GPU access and architecture.** [measured]
   - With NVIDIA Container Toolkit and a CDI spec on the host, both `--device nvidia.com/gpu=all` (CDI) and `--gpus all` exposed the GPU. A registered `nvidia` runtime in the Docker daemon is not required for that.
   - The pinned image listed the card''s architecture in its arch list and ran fp16 matmul and multi-LoRA serving on it.
   - Check the arch list of any replacement image before deploying. A missing architecture does not always fail loudly (llama.cpp falls back to CPU).

## Why
A shared lane serves several forks at once. Isolation that is not enforced by the enforcement point does not exist: the server itself caches, lists and serves whatever any caller asks for. Rules 1–3 are the concrete places where one tenant could see or infer another tenant''s activity. Rules 4–5 are where a naive deployment fails without anyone noticing: health that lies about readiness, and memory fractions that silently overcommit the card. Every rule here was measured with an anchor in the same run, so a ''no hit'' result is evidence, not the absence of a measurement.

---
**Verification:** read only (not run here) — two probe runs on 2026-10-05 against a pinned vLLM 0.30.0 image on a single 96 GB-class card; no tenant data: a public 0.5B base model and two random LoRA adapters built inside the container; every ''no hit'' result had a same-run anchor that hit. The probe scripts and outputs are kept in a private repository (not re-run for this item); each rule below names its re-runnable gate
**Evidence:** procedure: rule 1 gate — two tenants send the same long prefix; cached_tokens of the second = 0; anchor: the same tenant twice > 0; mutant: salt off or taken from the client -> hit; procedure: rule 3 gate — GET /v1/models through the enforcement point as tenant A must not list tenant B''s adapter; a request for B''s adapter returns 404; procedure: rule 4 gate — after /health 200, send one warm-up request with a client timeout; ready only when it completes; procedure: rule 5 — read the engine process memory in nvidia-smi at a given --gpu-memory-utilization and compare with the card total
**Valid for:** vLLM 0.30.0 image pinned by digest; re-measure on any vLLM upgrade or a different card
**Scope:** general · **Source:** platform-maintainers
',
  'Use when designing, reviewing or operating a vLLM lane that serves more than one tenant (fork) on a shared GPU, and when writing its gates. Treat each rule as a contract requirement with its own test and anchor. Do not trust /health alone for readiness, never let a client choose its own cache_salt, never expose /v1/models unfiltered, and size VRAM as shares of the whole card. Re-run the probes before relying on these rules after an image upgrade.',
  ARRAY['gpu', 'vllm', 'lora', 'multi-tenant', 'prefix-cache', 'readiness', 'vram', 'isolation', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- measurement-proves-it-measured  (zdroj: aisha/knowledge/measurement-proves-it-measured.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '2344fff8-6276-69ee-5b36-5552f95ff9cb',
  'playbook',
  'platform_knowledge',
  'measurement-proves-it-measured',
  'Measurement that proves it measured',
  'A gate or probe may report clean only if the same run proves it could have reported a finding. Unmeasured is a separate verdict, never clean.',
  '# Measurement that proves it measured

## Rules
1. **Anchor in the same run.** [measured] Before the real cases, run one case that must produce a finding and one that must pass. If the anchor fails, the verdict is "unmeasured", not "clean".
2. **Unmeasured is not clean.** [measured] Three verdicts: clean, finding, unmeasured. A tool error, an empty input or an unreachable endpoint is unmeasured.
3. **A negative check needs a positive anchor.** [measured] "The line is not in the output" also passes on an error page. Require exit code 0 and a known line in the same output.
4. **Both orders.** [measured] A concern that depends on order (trigger order, registration, concurrency) is refuted only by a probe in both orders.
5. **Never read a gate''s result through a pipe.** [measured] `gate | tail` returns the exit code of `tail`. Write the code to a file and read the verdict line.
6. **Two independent searches for "all places".** [measured] One pattern found 19 call sites, the owner''s pattern found 25. Neither list alone was complete.
7. **Verify the probe before trusting it.** [measured] A first probe signalled a subshell instead of the script and measured nothing; a second flipped more objects than a real attacker would and hit an unrelated defence. Both were caught only because the anchor failed loudly.
8. **Say what was read and what was run.** [measured] Every finding carries "verified by experiment" or "read only", and what was not looked at.

## Why
Each rule comes from a case where a green result was wrong: a compatibility check that passed with the same endpoint on both sides, a guard that reported clean over a database with findings, a probe that measured its own mistake.

---
**Verification:** read only (not run here) — every rule comes from a probe whose anchor caught a wrong green result; the probes are kept in a private review repository (not re-run for this item). Examples of rules 1-3 and 5 in code: see evidence
**Evidence:** file: scripts/lib/beh-nic-nezmeril.mjs — example: a run that measured nothing is reported as unmeasured, not as a finding and not as green; file: scripts/test/run-vitest.mjs — example: exit code 75 = UNMEASURED (no evidence left after the run), distinct from 0 and 1; file: scripts/ci/ci-verdikt.mjs — example: a CI verdict with a separate ''unknown'' outcome; green is read from job results, not from a status the job can write itself
**Valid for:** general method; no expiry
**Scope:** general · **Source:** platform-maintainers
',
  'When writing, reviewing or interpreting any gate, probe, test or review conclusion, check these rules; if one is not met, report the result as unmeasured and name the missing rule.',
  ARRAY['gate', 'probe', 'measurement', 'verification', 'false-clean', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'engineering_practice',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- model-access-architecture  (zdroj: aisha/knowledge/model-access-architecture.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '82500165-e5ba-361f-98b0-0c8b5f612dc8',
  'engineering_doc',
  'platform_knowledge',
  'model-access-architecture',
  'How a fork reaches models: never directly, only through its own Aisha and its own model mesh',
  'Models are an internal organ of Aisha. Each fork reaches a shared model lane only from its own Aisha, through a separate per-fork model mesh whose control plane runs at the fork; the GPU node is only a stateless peer.',
  '# How a fork reaches models

## Rules
1. **[read] Models are never exposed directly.** No public endpoint, no endpoint shared between forks. To the outside world the "model" is Aisha herself; external clients (gateway services and others) reach Aisha only through the fork''s edge.
2. **[read] Routing to models belongs only to the fork''s Aisha:** which model, which lens, what is allowed, which budget.
3. **[read] Bases are shared, lens and knowledge are per fork.** Base models (chat, embedding, rerank) are loaded once on the shared lane; every fork has its own adapter (lens), trained only on its data, and its own knowledge base stored in its own database. The shared embedder computes on the fork''s request; vectors are stored at the fork.
4. **[read] One access mode: a separate model mesh per fork.** Its control plane runs at the fork (a second instance of the same mesh stack, generated from the same declaration, backed up the same way, using the fork''s identity provider), published through the fork''s edge with UDP as an explicit exception. The GPU node joins it as a stateless peer with outbound connections only; it never joins the fork''s main mesh. No silent fallback to another mode; the fork''s doctor reports loudly when the GPU peer is missing.
5. **[read] The node enforces locally what a fork''s control plane could push:** per-fork mesh client in its own network namespace (no SSH server, no routes, no DNS takeover, no host LAN), per-fork entry into the lane, only the fork''s dispatch and the GPU peer in the model mesh (dispatch to model only; the GPU peer initiates nothing), a local kill switch independent of the fork, one-time registration keys, adapters only as checksummed files addressed by the entry''s identity, and the host firewall exactly as the node''s declaration states it (never changed on your own).
6. **[read] The model mesh has its own identity setup:** its own OIDC client and audience for administrators, and peers join only with a one-time registration key (single sign-on and device flow for peers disabled). The fork''s two control planes are never confused, and the GPU peer is never in the main mesh.
7. **[read] One bridge per fork** (a model gateway sidecar) is the only point where the main and model meshes touch; the doctor must measure it.
8. **[read] Accepted residual risk:** a compromised control plane of one fork can add peers to its own model mesh, but they reach only that fork''s entry within its quota, never another fork.

## Why
Isolation by shape instead of by access lists, a stateless shared GPU node without public entry, and identity checks staying with each fork. Two views disagreed (operations: no state and no public entry on the node; the layer''s owner: the node must never sit in a fork''s main mesh); this variant satisfies both.

---
**Verification:** read only (not run here) — design decided by the platform owner on 2026-10-05 with conditions from the operator of the shared layer and from operations; recorded in a private review repository; check the implementation and its doctor before relying on any rule
**Evidence:** owner decisions of 2026-10-05 (routing, per-fork lens and knowledge base, per-fork model mesh, the accepted variant) and the mesh contract with its conditions, recorded in a private review repository; procedure: once implemented, the fork''s doctor must report a missing GPU peer loudly and must find no model endpoint reachable from outside the fork''s edge
**Valid for:** design from 2026-10-05; until the owner changes the model-access design
**Scope:** general · **Source:** platform-maintainers
',
  'When designing, reviewing or operating anything that calls a model, check that the call comes from the fork''s own Aisha through its own model mesh; refuse any design that exposes a model endpoint publicly, to another fork, or to a client other than the fork''s Aisha.',
  ARRAY['models', 'gpu', 'mesh', 'isolation', 'routing', 'lens', 'knowledge-base', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'architecture',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- model-promotion-approval  (zdroj: aisha/knowledge/model-promotion-approval.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'ccb5e3fa-9962-eed1-0511-3878420b15d8',
  'playbook',
  'platform_knowledge',
  'model-promotion-approval',
  'Promoting a model or adapter: Aisha approves, on measured evidence from the tenant''s own data',
  'A new base, embedder or adapter goes live for a fork only after Aisha approves it on a measurement run inside that fork''s lane, compared with the current model, optionally validated by a user in administration, and recorded.',
  '# Promoting a model or adapter

## Rules
1. **[read] Aisha approves every promotion,** optionally after a user validates it in administration.
2. **[read] The evidence is a machine test inside the tenant''s lane** on the tenant''s own frozen evaluation set (checksum), one JSON line per run: recall@k and nDCG@10 for retrieval, latency, memory per vector, cost of recomputing the corpus.
3. **[read] Compare with the current model on the same set and the same run conditions;** decide the tie rule (for example "if indistinguishable, cost decides") before the run.
4. **[read] The vector space is chosen by measurement,** not fixed in advance. Recompute all vectors under the new identity as a background batch that never blocks the tenant''s interactive queries; switch queries only when 100 % of the space carries the new identity (count by identity in the database, not "the job finished"). Details: see knowledge item `embedding-backend-migration`; adapter identity and evaluation sample size: see `adapter-identity-and-gate-sample-size`.
5. **[read] Record the approval** (who, which run, which identity of weights) so that it can be rolled back.

## Why
Each fork gets its own deployment and Aisha approves promotions; without a fixed recipe, approvals would rest on impressions or on unlogged numbers.

---
**Verification:** read only (not run here) — platform owner''s decision of 2026-10-05 (promotion approved by Aisha, vector space chosen by measurement) and a measurement format, recorded in a private review repository
**Evidence:** owner decision of 2026-10-05 and the measurement format, recorded in a private review repository; procedure: one JSON line per run with the evaluation set checksum, recall@k, nDCG@10, latency, memory per vector and recompute cost; the same set and conditions for the current and the candidate model
**Valid for:** from 2026-10-05; until the owner changes the promotion rule
**Scope:** general · **Source:** platform-maintainers
',
  'Before promoting any model, embedder or adapter for a fork, require a machine test on that fork''s own evaluation set inside its lane, a comparison with the current model, and an explicit approval record; never promote on numbers without a run log.',
  ARRAY['models', 'promotion', 'approval', 'measurement', 'embeddings', 'adapters', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'model_operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-ci-run-states-and-forgejo-api  (zdroj: aisha/knowledge/ops-ci-run-states-and-forgejo-api.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'ae9a9084-d342-2dbc-9080-9d6bdfc30faa',
  'engineering_doc',
  'platform_knowledge',
  'ops-ci-run-states-and-forgejo-api',
  'Reading CI state correctly: unmeasured runs, cancellation and the Forgejo API',
  'A test run has three outcomes (pass, fail, unmeasured); always() jobs do not survive cancellation; the Forgejo API can cancel and dispatch but cannot rerun; run listings are heavy and tasks are not the queue.',
  '# Reading CI state correctly

## Rules
1. **Three outcomes of a test run.** [measured] `0` measured and green, `1` measured and failed, `75` UNMEASURED (no evidence left: watchdog, sleeping machine, OOM). 75 means rerun (with fewer workers under load); a finding seen in both attempts is "persistent" and rerunning will not help.
2. **`if: always()` does not survive cancellation.** [measured] The server marks every unfinished job cancelled, including waiting ones, before the condition is evaluated; applies to `cancel-in-progress` and manual cancel. A verdict status left `pending` after a cancelled deploy is fail-closed by design.
3. **API capabilities.** [measured] Cancel `POST /repos/{o}/{r}/actions/runs/{run_id}/cancel`; dispatch `POST …/actions/workflows/{file}/dispatches`; jobs `GET …/runs/{run_id}/jobs` returns an ARRAY; no rerun endpoint. `run_id` is the field `id`, not the number shown in the UI (`index_in_repo`).
4. **`task_id = 0`** [measured] means a runner never got the job (it waited on `needs`).
5. **Do not use `/actions/tasks`.** [measured] It times out (504 after 30 s) and loads the forge. Run listings carry the full `event_payload` (30 runs ≈ 30 MB): page with small limits or filter by `head_sha`.
6. **`stopped` is not the cancel time** [measured] (15 min earlier than `context canceled` in the job log). A secret''s `created_at` is its creation, not its last change.
7. **PR CI runs from the branch head, not from the merge with main.** [read] A fix already in main does not help a branch that does not contain it.

## Why
Each misreading cost a night: a run that cannot be retried via API stood until morning, and "nothing runs" was concluded from tasks while seven runs waited in the queue.

---
**Verification:** read only (not run here) — API behaviour was measured on 2026-10-03 against a Forgejo 16.x instance (its swagger and the history of five cancelled runs; not re-run for this item); examples of rules 1, 3 and 5 in code: see evidence
**Evidence:** file: scripts/ci/ci-verdikt.mjs — example: finds the run by head_sha instead of listing tasks and reads its jobs through the run id; file: scripts/test/run-vitest.mjs — example: exit 75 = EX_TEMPFAIL = unmeasured; file: docs/testing/BRANY_DRAHY_A_VYBER.md; procedure: Forgejo /swagger.v1.json lists POST /repos/{owner}/{repo}/actions/runs/{run}/cancel and POST …/actions/workflows/{workflow}/dispatches, and no rerun endpoint
**Valid for:** Forgejo 16.x Actions; re-check the API list after a Forgejo upgrade
**Scope:** general · **Source:** platform-maintainers
',
  'On exit code 75 rerun instead of fixing gates; on ''finding is persistent'' fix the code. Do not cancel or dispatch runs without the owner''s yes; they are writes.',
  ARRAY['ci', 'forgejo', 'actions-api', 'verdict', 'cancellation', 'flaky', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-ci-runner-restart-and-shared-cache  (zdroj: aisha/knowledge/ops-ci-runner-restart-and-shared-cache.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '1f7409f2-ea88-ad34-b2c5-943cb7ed7493',
  'playbook',
  'platform_knowledge',
  'ops-ci-runner-restart-and-shared-cache',
  'CI runner service: restart only when idle, and shared cache must ask every lane',
  'Restarting a Coolify service that hosts Forgejo runners recreates every container and kills running jobs; jobs run inside DinD and are invisible on the host; anything touching a cache shared by two lanes must check both.',
  '# CI runner service: restart only when idle, and shared cache must ask every lane

## Rules
1. **Saving and restarting are two steps.** [measured] `PATCH /api/v1/services/<uuid>` with `docker_compose_raw` (base64) only stores the compose. `POST …/restart` (POST; GET says the endpoint changed) does `up -d --force-recreate` of ALL containers: runner, DinD and janitor. Running jobs die. `/start` on a running service does nothing.
2. **Compare stored compose semantically.** [measured] Coolify drops trailing whitespace and comments outside strings, so a text diff lies; compare parsed YAML.
3. **Jobs live inside DinD.** [measured] `docker ps` on the host never shows them; use `docker exec <dind> docker ps` for every lane. "Idle" = no `FORGEJO-ACTIONS-TASK-*` in any DinD, twice, 20 s apart. Quiet usually came within ~15 min; after restart all healthy in ~45 s.
4. **A guard that asks only its own lane is no guard.** [measured] Each lane''s janitor deleted the shared npm cache when "nobody works", asking only its own DinD. One janitor deleted it 18 times in two days under running jobs of the other lane (`npm error EEXIST`, `ENOENT … _cacache/tmp`, jobs hitting their time limit). Fixed: ask all neighbouring DinD; a neighbour that does not answer counts as working. After the fix: 3 refusals, 0 deletions in 24 h.
5. **A lane that carries deploy jobs makes every restart a deploy decision.** [read] A restart cuts a running deploy wave in the middle.
6. **A runner''s queue is not visible as tasks.** [measured] A task exists only after a runner takes the job. "No tasks" is not "quiet": measure `…/actions/runs?status=running&status=waiting&status=blocked` per repository.

## Why
Two outages of CI looked like flaky tests: one was a restart during jobs, the other a cache deleted under running jobs by a guard that could not see the other lane.

---
**Verification:** read only (not run here) — restart behaviour was measured on 2026-09-27 and 2026-10-03, the janitor defect from runner logs (18 deletions in two days) and its fix by a test that failed 6 of 10 runs before the fix; runner definitions and logs live in a private infrastructure repository (not re-run for this item)
**Evidence:** procedure: Coolify API — PATCH /api/v1/services/{uuid} stores docker_compose_raw only; POST /api/v1/services/{uuid}/restart recreates every container of the service; procedure: idle check = no container named FORGEJO-ACTIONS-TASK-* in ANY DinD of the service (docker exec <dind> docker ps), twice, 20 s apart; procedure: re-measure rule 4 by running a job in one lane while the other lane''s janitor decides; the shared cache must stay
**Valid for:** a runner service with several lanes, each with its own DinD, sharing one cache volume; Coolify 4.x API, verify on your version
**Scope:** general · **Source:** platform-maintainers
',
  'Before restarting or redeploying a CI runner service, wait until no FORGEJO-ACTIONS-TASK container exists in every DinD of the service twice in a row 20 s apart, and announce the window. When CI fails with npm EEXIST or ENOENT under _cacache, suspect the runner, rerun, and check cache janitors.',
  ARRAY['ci', 'forgejo-runner', 'dind', 'restart', 'cache', 'janitor', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-coolify-cleanup-removes-init-images  (zdroj: aisha/knowledge/ops-coolify-cleanup-removes-init-images.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'df8adfd7-7500-3190-45bc-aafa172e57fd',
  'engineering_doc',
  'platform_knowledge',
  'ops-coolify-cleanup-removes-init-images',
  'Coolify cleanup, init images and the deploy that cannot pull',
  'Stock Coolify cleanup removes every image not used by a container, including upstream images of finished init containers; a later deploy then pulls them after removing old containers, and a registry error takes the stack down.',
  '# Coolify cleanup, init images and the deploy that cannot pull

## Rules
1. **Step 2 of image cleanup deletes everything unused.** [read] `docker image prune -f` (dangling) is followed by `docker images` minus application images (`<uuid>_…`) and the current helper/realtime, then `docker rmi` on the rest. `rmi` succeeds for every image no container uses.
2. **Finished init containers used to vanish first.** [measured] Stock Coolify wrote its prune exceptions as several `label!=` filters on one `docker container prune`; Docker ANDs them, so they protected nothing. Finished init containers of applications were removed (one deploy''s fresh container too; a workflow service was down 5 h). With the exceptions expressed correctly a finished init container keeps its image. Check how your version writes these filters.
3. **Order inside a deploy matters.** [measured] Coolify removes old containers before pulling. An init image deleted by cleanup is pulled at that moment; a 401 from the registry left no containers and the API returned 502.
4. **Own builds of third-party init images avoid the registry dependency.** [measured] The fix was building the object-store client image from source instead of pulling it from a third-party registry.
5. **`docker_images_to_keep` concerns only old tags.** [measured] Current = tags of all containers with label `coolify.applicationId`. Keep=1 does not delete the image of the running version''s init container.
6. **Retention keeps one image per application, not a stack version.** [measured] After cleanup only one image of a multi-service stack remained. Local rollback of a stack is therefore not a full set; rollback = rebuild from git.

## Why
The outage looked like an infrastructure failure, but the cause was an interaction of three ordinary steps: cleanup, removal order, registry auth.

---
**Verification:** read only (not run here) — rule 1 read from the Coolify 4.x source; rules 2-6 measured on 2026-09-28 (outage reconstructed from deploy logs) and 2026-10-03 (24 finished init containers after the prune filter was corrected); the deploy logs are not public (not re-run for this item)
**Evidence:** procedure: Coolify 4.x app/Actions/Server/CleanupDocker.php, buildImagePruneCommand — step 1 docker image prune -f, step 2 docker rmi of every image outside the application set; procedure: docker container prune with several label!= filters keeps a container only if it matches ALL of them (filters are ANDed) — check with docker container prune --dry-run style listing before trusting the exceptions; file: docker/minio/Dockerfile — example of building a third-party object-store image from a pinned source instead of pulling it from a registry
**Valid for:** Coolify 4.x; verify CleanupDocker on your version
**Scope:** general · **Source:** platform-maintainers
',
  'Before trusting that a deploy works offline because ''the image is local'', check whether cleanup could have removed it. When diagnosing a deploy that failed after ''Removing old containers'', look for a pull error of an init image first.',
  ARRAY['coolify', 'cleanup', 'images', 'deploy', 'init-container', 'outage', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-coolify-deploy-facts  (zdroj: aisha/knowledge/ops-coolify-deploy-facts.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'ef074771-6ef4-3b9a-74b3-12759eee520e',
  'engineering_doc',
  'platform_knowledge',
  'ops-coolify-deploy-facts',
  'Coolify deployments: timing, start order of an instance, where it builds',
  'Deployment duration comes from log timestamps, not from the queue table; an instance starts PKI first; the build location is the helper container named by the deployment uuid, not a DB column.',
  '# Coolify deployments: timing, start order, where it builds

## Rules
1. **`updated_at` is not the end of a deploy.** [measured] It changes long after (bulk status rewrites, cleanup). A 13-minute "overlap" derived from it did not exist; log timestamps showed sequential deploys. A patch built on that reading was useless and harmful and had to be reverted.
2. **Real run = first and last `timestamp` in the JSON `logs` field** (UTC ISO). Queue times are orientation only.
3. **An instance starts PKI first.** [measured] Every stack has `pki-init`, which waits for the instance''s `pki-bridge` to issue the realm CA and gives up after 600 s with exit 1 (`service "pki-init" didn''t complete successfully`). Order: `<instance>-pki` -> wait for `pki-bridge`, `pki-auth`, `pki-server`, `pki-db` healthy -> the rest.
4. **PKI stacks are per instance.** [read] A `pki-bridge` on another server belongs to another instance; instances never share PKI.
5. **The DB status column lags.** [measured] `applications.status` is updated periodically; reality is `docker ps -a` on the target server.
6. **Where it builds = the helper container named by `deployment_uuid`.** [measured] Load on the build node during a deploy came from the CI runner (a push triggers both CI and the deploy), while the Coolify helper ran on the target host. Check whether `build_server_id` in the DB is filled on your version before relying on it: in the measured version `addLogEntry()` → `refresh()` discarded it (833 of 833 rows were NULL).
7. **Cancelling a deploy can leave a helper behind** [measured] with its `build-time.env` on the build node, because cancellation removes the helper on `build_server_id ?? server_id`.
8. **Never run several deploys of one application in parallel; prefer one stack at a time on tight nodes.** [read: recommendation derived from an out-of-disk outage during a parallel deploy]

## Why
Each rule replaced a wrong conclusion that looked like an infrastructure fault.

---
**Verification:** read only (not run here) — timing error found 2026-09-13 against log timestamps; start-order failure reproduced 2026-09-02; build location measured during a live deploy; the measurements were made on a production Coolify and are not public (not re-run for this item)
**Evidence:** file: docker-compose.coolify-pki.yml — the per-instance PKI stack every other stack waits for; file: docker-compose.coolify.yml — a stack with its own pki-init service (every AISHA stack carries one); procedure: compare application_deployment_queues.updated_at with the first and last logs[].timestamp of the same deployment
**Valid for:** Coolify 4.x with AISHA stacks (pki-init in every stack); verify on your version
**Scope:** general · **Source:** platform-maintainers
',
  'Before concluding anything about overlap, order or duration of deployments, read first and last timestamp from the deployment logs. Before a mass restart of an instance, start <instance>-pki alone and wait for healthy. Trust docker ps -a on the target server over the status column in the Coolify DB.',
  ARRAY['coolify', 'deploy', 'pki', 'start-order', 'build-server', 'measurement', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-deploy-speed-build-cache-and-transfer  (zdroj: aisha/knowledge/ops-deploy-speed-build-cache-and-transfer.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'c9602a0b-26fc-0d1c-a4f8-e92ba5acb955',
  'engineering_doc',
  'platform_knowledge',
  'ops-deploy-speed-build-cache-and-transfer',
  'Why a stack deploy is slow: the build cache is defeated by injected ARGs, images travel whole',
  'Build and image transfer dominate deploy time; RUN steps rarely hit the build cache when a build variable injected as an ARG declaration into every stage changes on every deploy (the commit id); a build server that ships images with docker save/load copies unchanged layers again. Measure before and after any change.',
  '# Why a stack deploy is slow

## Where the time goes [measured]
- Across 24 h of deploys on one fleet, build took about half of the deploy time and image transfer about a third; waiting, preparing and starting together the rest.
- One 13-image stack deployed without forced rebuild spent ~10 min building and ~3 min transferring, then ~2 min removing old containers. A deploy with forced rebuild (`--no-cache`) took the same time — the cache was not helping either way.

## Why the cache does not help [measured]
1. **RUN steps almost never hit the cache:** 7 % fleet-wide, 0 of 96 on the stack above. FROM, WORKDIR and COPY do hit it (the lockfile COPY was cached, the `npm ci` right after it was rebuilt).
2. **Injected ARGs are in the cache key of RUN.** A control plane can add build variables as ARG declarations to every build stage. When any of them differs between deploys, every RUN after the declaration is rebuilt. COPY is not keyed by ARGs, which is exactly the observed pattern.
   - **The value that changes is the commit id.** Of the build-time variables only `GIT_SHA` is rewritten at every deploy (its `updated_at` equals the deploy time); the deploy pipeline sets it. One new commit therefore invalidates every RUN of every stage of every service.
   - **The control plane has its own switch** `inject_build_args_to_dockerfile` ("preserves Docker build cache"). Turning it off is safe when every Dockerfile declares the build variables it reads. Keep it that way with a gate before switching injection off.
3. **A from-source build with a fixed version is rebuilt every time** (object-store server 5-7 min, client ~3 min) because its stage gets the same ARGs.
4. **Whole images travel.** A build server that ships images with `docker save` -> `docker load` copies unchanged layers (a ~0.5 GB `node_modules` per service) again on every deploy.
5. **Dockerfiles that copy the whole source before `npm ci`** invalidate the install layer on any source change, even with a working cache.

## Levers, in order of expected gain [read: proposals, gain unmeasured]
1. Keep every Dockerfile declaring the build variables it reads (a gate compares reads with declarations per stage), then switch off ARG injection per compose application, delivered from the instance declaration, not by hand — this restores RUN caching.
2. Prebuild from-source third-party images once per version, push to the registry and pin by digest.
3. Copy only package manifests before `npm ci`, then the source (helps only after lever 1).
4. Transfer through a registry (push/pull moves only changed layers) instead of save/load.
5. Build once in CI and deploy by image reference.

## How to evaluate yourself [read]
Metrics per window: phase shares and medians, RUN cache ratio, the five most expensive rebuilt steps. Keep your own dated baseline. A lever counts as done only when the same window shows the change.

---
**Verification:** read only (not run here) — the phase split and cache ratio were measured from Coolify deploy logs over 24 h (116 builds) and on two deploys of one 13-image stack on 2026-10-04 with a deployment meter kept in a private infrastructure repository (not re-run for this item); the levers are proposals whose gain is not measured
**Evidence:** file: Dockerfile.web — example of a Dockerfile that declares the build variable it reads (ARG GIT_SHA) before using it, the condition for switching ARG injection off; procedure: in a deploy log count RUN steps reported as CACHED vs rebuilt; procedure: the Coolify application setting inject_build_args_to_dockerfile controls the injection; compare RUN cache hits on two deploys of one commit with it on and off
**Valid for:** Coolify 4.x compose builds, verify on your version; re-measure after any lever lands
**Scope:** general · **Source:** platform-maintainers
',
  'When asked why deploys are slow or when evaluating your own delivery speed, measure the deploy phases and the RUN cache ratio over a window and compare with the instance''s own baseline before proposing changes; after a change, report the same metrics on the same window length. Do not claim a speed-up from one deploy.',
  ARRAY['deploy', 'build-cache', 'buildkit', 'coolify', 'image-transfer', 'self-evaluation', 'performance', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-flow-control-shared-machine-queue  (zdroj: aisha/knowledge/ops-flow-control-shared-machine-queue.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '222d9f30-8c59-4fff-a7c5-38962cf9adf0',
  'playbook',
  'platform_knowledge',
  'ops-flow-control-shared-machine-queue',
  'Flow control on one shared machine: a semaphore with lanes, dependencies and detached jobs',
  'Many agent sessions on one machine share heavy work (type checks, test suites, installs, pushes with pre-push) through one FIFO semaphore with mandatory lanes; short jobs take the express lane, chains use explicit dependencies, long jobs run detached.',
  '# Flow control on one shared machine

## Rules
1. **One semaphore for everyone, two slots, FIFO.** [measured] Without it four type checks, test runs, lint and a VM at once pushed load to 52-64 and swap to 15 GB. Two semaphores coordinate nothing: there must be exactly one.
2. **The lane is mandatory.** [measured] heavy (CPU), short (<= 300 s, express, no git commit/merge/push inside, enforced by a git shim), long (push with the full pre-push suite), remote (waiting on a server). Before lanes existed, 661 of 800 heavy-lane jobs ran under 300 s and waited 71 h in total.
3. **The scheduler rejects misfiled jobs.** [measured] A command that ran >= 3 times with p90 < 240 s is refused in the heavy lane while the express lane is free; declare a known long run explicitly.
4. **Dependencies are explicit.** [measured] A declared predecessor (by pid or label) replaces `while kill -0` loops; a label like "after round 16" written in prose enforced nothing and a push overtook the one it should follow. A failed dependency stops the chain.
5. **Long jobs run detached.** [measured] A push started as a background job of the agent tool was killed by the tool''s 2 h limit mid-suite. Detach (setsid) with a log file, verify the result in the log and, for pushes, with `git ls-remote`.
6. **The toolchain comes from the repository.** [measured] Jobs take Node from `.nvmrc` of the directory they are started from; started above the repo they ran under a wrong major version. Start jobs from the worktree.
7. **A heartbeat, not a pid, proves a holder lives.** [read] A slot is taken away only when its holder''s heartbeat stops for > 120 s while the machine''s clock kept ticking; a sleeping laptop does not kill all holders.
8. **Every threshold needs a way out.** [measured] A job waiting for `load < 14` waited 90 min; load never fell below 40 with ten sessions queued. An unreachable threshold punishes those who obey it.
9. **The queue cannot hand a place to a named session.** [read] "I will free a slot for you" cannot be delivered; changing that is a policy decision of the owner.

## A tool that submits work to the queue
10. **No lane = refused = not run.** [measured] A job without a lane is refused; a refused job has NOT run - report it as UNMEASURED, never as passed or failed.
11. **Follow the queue''s advice in order.** [measured] heavy -> (refused as "known short") express -> (killed by the express cap) heavy with the explicit "I know it is long" flag, in a fresh working directory. Handle each refusal code explicitly.
12. **The bypass flag is not a default.** [measured] Hard-coding "I know it is long" defeats the lanes: short jobs would wait behind long suites again.

## Why
The machine is shared by a dozen sessions; without flow control they starve each other and every push re-measured the same code several times.

---
**Verification:** read only (not run here) — measured on one machine shared by about ten agent sessions: before lanes (window ending 2026-10-03 morning) 661 of 800 heavy-lane jobs ran under 300 s and waited 71 h in total; a later 24 h window to 2026-10-04 morning had 714 jobs, 36 h of run time and 79 h of waiting; lane rules were measured against the semaphore script with mutants. The script and its journal are not public (not re-run for this item)
**Evidence:** procedure: before load-based fixes, record load and swap with and without the semaphore (without it: load 52-64 and swap 12.9-15.4 GB on one day); procedure: from the queue journal, count jobs per lane that finished under the express cap; a high share in the heavy lane means misfiled jobs; procedure: verify a submitting tool through the real queue plus mutants (no lane, express cap exceeded, refused job reported as passed)
**Valid for:** any machine where many agent sessions share CPU-heavy work; general principle
**Scope:** general · **Source:** platform-maintainers
',
  'Wrap every heavy local command (tsc, test suites, eslint over a repo, npm ci, builds, commit and push hooks) in the shared semaphore with an explicit lane; put short checks in the express lane, chain with explicit dependencies instead of polling loops, and run anything longer than the tool limit detached with a log. Enqueue early and do other work while waiting.',
  ARRAY['flow-control', 'queue', 'semaphore', 'heavy-jobs', 'scheduling', 'agents', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-full-disk-is-data-not-garbage  (zdroj: aisha/knowledge/ops-full-disk-is-data-not-garbage.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '386001ca-8a8a-7760-a5ef-db3633ad4c9c',
  'playbook',
  'platform_knowledge',
  'ops-full-disk-is-data-not-garbage',
  'A full Coolify server: find what grew, not what looks reclaimable',
  'On Coolify nodes ''reclaimable'' in docker system df is not garbage; space is taken by data volumes, retained images and one-shot init images. Measure growth first, then decide retention with the owner.',
  '# A full Coolify server: find what grew, not what looks reclaimable

## Rules
1. **"Reclaimable" means "no container uses it", not "safe to delete".** [measured] On a deployment node ~35 GB of reclaimable images were the current images of one-shot services (`pki-init`, `migrate`, `n8n-workflow-init`, `plugin-publish-init`). Their containers finished and were cleaned up; the next deploy needs them, and locally built ones cannot be pulled back.
2. **Orphans are usually absent.** [measured] Every image uuid prefix on three nodes matched a live Coolify resource. Hunting for garbage is a dead end; space is data and retention.
3. **Measure growth first.** [measured] `docker exec <c> find <path> -type f -mtime -N -exec du -k {} +` per volume, then the logs of whatever writes there. A 20 GB jump on a registry node came from one large image pulled through the pull-through cache, not from CI (CI logs grew ~30 MB/day).
4. **Coolify cleanup works in a saw-tooth.** [measured] Above the threshold (80 %) the forced cleanup runs hourly and frees space each time; the last two or three log lines ("93 % -> 93 %") are a sample, not the whole. Count over the full window.
5. **The real levers are owner decisions.** [read] `docker_images_to_keep` per application, deleting retired (stopped) applications, retention of the npm registry, moving a static database. None is a cleanup step an agent should take alone.
6. **Deploying a whole instance at once does not fit the reserve.** [measured] A cold start that redeployed every stack of one instance in parallel filled a 120 GB node (ENOSPC, cascade of failed layers). Deploy stacks one by one on tight nodes.
7. **Without root, journal size lies.** [measured] `journalctl --disk-usage` shows only the user journal (24 MB) while `/var/log/journal` held 4.1 GB. Measure with `du -sh /var/log/journal`; a cap (`SystemMaxUse=1G`) keeps it bounded.

## Why
Twice an agent almost reported findings that were not true (ineffective cleanup, orphaned journal) and once an "obsolete" image deletion broke a deploy. The answer to "the disk is full" is capacity and retention, decided by the owner.

---
**Verification:** read only (not run here) — rules 1-4 and 7 were measured read-only on four Coolify nodes between 2026-09-23 and 2026-10-03, rule 6 comes from two outages, rule 5 is reading; the node surveys are not public (not re-run for this item)
**Evidence:** procedure: docker system df -v, then per volume docker exec <container> find <path> -type f -mtime -N -exec du -k {} + ; Coolify DB table docker_cleanup_executions for the cleanup history over a whole window; procedure: compare journalctl --disk-usage (user journal only without root) with du -sh /var/log/journal; file: docker-compose.coolify.yml — one-shot services (pki-init, migrate) whose current images look reclaimable after their containers finish
**Valid for:** Coolify 4.x; verify on your version
**Scope:** general · **Source:** platform-maintainers
',
  'When asked why a server is full or whether it can be cleaned, answer with this structure: what grew (per volume, per day), who pulled or wrote it, what retention keeps on purpose, and which owner decision would free space. Never propose deleting images or volumes only because Docker calls them reclaimable.',
  ARRAY['disk', 'docker', 'coolify', 'retention', 'cleanup', 'capacity', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-monitoring-alerts-need-delivery  (zdroj: aisha/knowledge/ops-monitoring-alerts-need-delivery.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'ddaf548c-f4b2-a377-e4f5-190c5cd8f8db',
  'playbook',
  'platform_knowledge',
  'ops-monitoring-alerts-need-delivery',
  'Monitoring that scales: portable rules, one evaluator per machine, logs without the docker socket',
  'Alert rules that load unchanged anywhere with thresholds as data, exactly one evaluator per machine, host logs collected without the docker socket, no permanently unhealthy containers, and machine monitoring kept apart from application monitoring.',
  '# Monitoring that scales

## Rules
1. **Rules portable, thresholds as data.** [read] Alert rules read nothing from the stack and can be loaded unchanged into a central Prometheus; thresholds are recording rules placed before the alerts; every alert has a promtool test (below and above threshold, pending and firing, neighbours that must not fire).
2. **One evaluator per machine.** [read] When two instances deploy the same observability compose on one machine, host alerts would arrive twice. Make host monitoring an optional capability behind a switch (default off), enabled for exactly one instance per machine; an invalid value disables it loudly (fail-closed).
3. **Host logs without the docker socket.** [read] The socket is root over the host and `:ro` does not limit the API. A collector can read `/var/log/journal` (with `/etc/machine-id`) and container json logs read-only, run with `cap_drop: ALL`, read-only root and no ports. Caveat: mounting `/var/lib/docker/containers` also exposes `config.v2.json` (container env = secrets) - a decision for the owner.
4. **A permanently unhealthy container is noise that hides real ones.** [measured] A survey found containers unhealthy for weeks while their service worked: a cache healthcheck `valkey-cli ping` without the password (`NOAUTH`, failing streak > 180 000 over two months) and mesh ingress health endpoints. Fix the check (authenticate via an env variable such as `REDISCLI_AUTH`) or the service; an alert on `unhealthy` is useless while known-false ones exist.
5. **Machine monitoring and application monitoring are different scopes.** [read] Machines go to one central stack; application metrics stay in each instance.

---
**Verification:** read only (not run here) — rule 4 was measured in a fleet survey (2026-10-04); rules 1-2 were verified with promtool (4 of 4 rule mutations caught); rules 3 and 5 are reading (not re-run for this item)
**Evidence:** procedure: promtool test rules with cases below and above each threshold, pending and firing, and neighbours that must not fire; procedure: list containers with docker ps --filter health=unhealthy and read each healthcheck''s last output before trusting an unhealthy alert
**Valid for:** general for Prometheus/Grafana/Loki
**Scope:** general · **Source:** platform-maintainers
',
  'When adding monitoring, keep alert rules portable with thresholds as recording rules and a promtool test per alert, evaluate each machine exactly once, collect host logs without the docker socket, and fix permanently unhealthy containers before alerting on health.',
  ARRAY['monitoring', 'prometheus', 'alerting', 'loki', 'grafana', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-patched-platform-upgrades  (zdroj: aisha/knowledge/ops-patched-platform-upgrades.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'ba457195-ad57-acf7-196e-1b6a86abaee1',
  'playbook',
  'platform_knowledge',
  'ops-patched-platform-upgrades',
  'A locally patched control plane: no auto-update, patch lives in config, verify by running',
  'When the deployment platform carries a local patch, automatic updates must be off, the patch must live in the config applied at container creation (not in the running container), and every claim about it is verified by a real deploy.',
  '# A locally patched control plane

## Rules
1. **Auto-update off.** [measured] A midnight update to a new patch release broke one hunk of the patch; 100 % of deploys of ~200 applications failed until the patch was rewritten. The update also killed workers of two running deploys, which stayed `in_progress` forever (no reaper).
2. **Upgrade order:** [measured] rebase the patch on a clean tree from the new image (`git apply --reject`, finish rejected hunks, `php -l` all files, apply to a clean tree) -> install through the compose override file -> recreate only the service (`up -d --no-deps --force-recreate <service>`, always `--dry-run` first; without `--no-deps` compose recreates DB, redis and realtime) -> the log must say "applied to N file(s)" without warning.
3. **Before recreate, zero deploys in progress,** [measured] otherwise they are orphaned.
4. **The patch lives in config, not in the container.** [measured] Files are copied at container creation; `docker restart` does not deliver a new patch and an edit inside the running container vanishes at the next recreate. Detect drift: `stat -c %y` of a patched file vs. container `State.StartedAt`; capture drift as a patch before recreating.
5. **One authority.** [read] The patch has one source of truth (the main branch of the repository that holds it); a new version is a commit there, then install in a window. Read the log of the patch directory before writing a new version: other operators write it too.
6. **Parts of one fix stay in one file.** [read] If two dependent parts of a patch live separately, an upgrade can drop one and leave a worse state than unpatched (variables suddenly ''required but missing'').
7. **Static reading and foreign reports are not evidence here.** [measured] The conclusion "build server does not work with compose" was reversed several times by reading code and a public discussion; only a deploy that passed the first gate decided it.
8. **Self-approval is blocked.** [read] The operator who writes a patch PR does not merge it; root install steps are prepared as commands for the owner.

---
**Verification:** read only (not run here) — rules 1-4 and 7 come from incidents on a control plane carrying a source patch (an automatic update that failed every deploy, a runtime edit nearly lost, wrong conclusions reversed only by a real deploy); the records are not public (not re-run for this item)
**Evidence:** procedure: Coolify instance_settings.is_auto_update_enabled must read false on a patched control plane; procedure: drift check = stat -c %y <patched file> inside the container vs docker inspect -f ''{{.State.StartedAt}}'' <container>; a file newer than the start was edited in place; procedure: docker compose up -d --no-deps --force-recreate <service> --dry-run before the real recreate; the patch install log must say ''applied to N file(s)'' without warning
**Valid for:** general for any control plane carrying a local patch; examples from Coolify 4.x with a compose-mounted source patch
**Scope:** general · **Source:** platform-maintainers
',
  'Never enable automatic updates of a patched control plane. Before any upgrade: rebase the patch on the new version, install through the compose config, recreate only the service, verify the apply log. Check whether files were edited inside the running container (mtime vs StartedAt) before recreating it.',
  ARRAY['coolify', 'patch', 'upgrade', 'auto-update', 'configuration-drift', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-pull-through-cache-and-build-cache  (zdroj: aisha/knowledge/ops-pull-through-cache-and-build-cache.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'de4f0b3f-96e5-8a8c-d678-3c061d95d479',
  'engineering_doc',
  'platform_knowledge',
  'ops-pull-through-cache-and-build-cache',
  'Image caches that grow on their own: registry pull-through cache and BuildKit cache',
  'A pull-through registry cache keeps every large image for its TTL and cannot delete; registry garbage-collect would remove foreign blobs. BuildKit cache from interrupted builds stays ''InUse'' until dockerd restarts.',
  '# Image caches that grow on their own

## Pull-through registry cache
1. **Every large image costs its size for a week.** [measured] One ~20 GB model-server image pulled through the cache by a GPU node moved the shared node from 87 % to 98 % in days. TTL is 7 days (`scheduler-state.json`, key `ExpiryData`).
2. **Proxy mode cannot DELETE.** [measured] The API returns 405.
3. **Never `registry garbage-collect` on a proxy cache.** [measured] The dry run listed 207 blobs, 133 of them layers of other images whose manifests GC does not mark; some can no longer be pulled.
4. **Targeted removal that worked:** [measured] list digests from `repositories/<repo>/_layers` and `_manifests/revisions`, subtract everything referenced by other repositories (`comm -23`), remove the repository directory and only the remaining blobs, then verify `/v2/` = 200 and a manifest of another image. Stale scheduler entries only log an error at expiry.
5. **Who pulled what** is in the cache log (`http.request.remoteaddr`); map the address to a server through the Coolify DB.
6. **Very large images should bypass a shared cache by an explicit, reasoned exception** written into the pin itself and reviewed, never silently. [read]

## BuildKit cache on the build node
1. **"InUse" does not mean "a build runs on it".** [measured] 60.9 GB of 68.8 GB InUse had not been used for weeks; running builds held 0.2 GB. The leaked references came from days with many interrupted builds (18 interrupted -> 22 GB).
2. **Only a dockerd restart releases them.** [measured] After the restart the whole cache became reclaimable. With `live-restore=false` the restart stops every container; services with `unless-stopped` come back, a CI runner restarts several times until its DinD is healthy (depends_on applies only to `compose up`). Done in ~40 s; needs a window and the owner.
3. **Age filters are wrong for images.** [measured] `--filter until=` measures the author''s build date, not local use.

---
**Verification:** read only (not run here) — registry: a targeted deletion was done on 2026-10-03 with the owner''s approval (disk 98 % -> 89 %); BuildKit: the hypothesis was confirmed by a dockerd restart on 2026-09-27 (reclaimable 42 MB -> 59.95 GB); measured on private nodes (not re-run for this item)
**Evidence:** procedure: registry proxy cache — scheduler-state.json key ExpiryData holds the TTL; the cache log field http.request.remoteaddr says who pulled; DELETE on a proxy registry returns 405; procedure: registry garbage-collect --dry-run on a proxy cache lists blobs referenced by other repositories'' layers (207 listed, 133 of them still referenced); procedure: docker buildx du --verbose shows InUse records and their last use; compare with the builds actually running; file: src/tests/gates/registry-proxy-centralni-domov.gate.test.ts — example of a gate that keeps image pins on the cache path, so any exception has to be written explicitly
**Valid for:** distribution registry in proxy mode; Docker with containerd snapshotter and live-restore=false
**Scope:** general · **Source:** platform-maintainers
',
  'Do not route very large images (model servers, GPU images) through a shared pull-through cache unless its disk is sized for them. Never run registry garbage-collect on a proxy cache. Treat large ''InUse'' BuildKit cache with no running build as leaked references, fixable only by a dockerd restart in a window.',
  ARRAY['registry', 'pull-through-cache', 'buildkit', 'build-cache', 'disk', 'gpu-images', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-secrets-in-env-history-and-urls  (zdroj: aisha/knowledge/ops-secrets-in-env-history-and-urls.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'bfc314c4-eb72-339f-b7d0-8a82a60a2bdd',
  'playbook',
  'platform_knowledge',
  'ops-secrets-in-env-history-and-urls',
  'Where secrets leak during operations: env values, URLs and base64',
  'Secrets hide in values that do not look secret (git URLs with tokens, base64 blobs, CI_ prefixed variables); print keys only and values only by an allowlist.',
  '# Where secrets leak during operations

## Rules
1. **Env of a container: keys only.** [measured] `docker inspect … Config.Env | cut -d= -f1`. A "quick look" with `grep -E ''^CI_''` printed a registry token; a warning in memory did not prevent it, the mechanical rule does.
2. **Values only by allowlist of named keys.** [measured] `grep -E ''^(CI_MIN_FREE_PCT|CI_PRUNE_INTERVAL)=''`. Never by prefix or by a pattern such as `OPERATOR|PORT`.
3. **URLs carry tokens.** [measured] `…_GIT_URL=https://oauth2:<token>@host/…`, repository URLs stored in databases, `git remote -v`. Clean with `sed -E ''s#//[^@/]*@#//#''`, in SQL `regexp_replace(x,''//[^@/]*@'',''//'')`, in jq `sub("//[^@/]*@";"//")`.
4. **Base64 is not harmless.** [measured] A `*_B64` value contained an HMAC key and an OTP seed.
5. **Read credential files with a parser, never `source` them.** [measured] `set -a; . file; set +a` executes values: a backup with the bare value `a|touch <file>` created the file when a doctor script sourced it, and part of another value went to the log as "command not found". Use the platform''s env parser (`scripts/lib/env-file-keys.sh` -> `load_env_file_keys`, `scripts/lib/env-soubor.sh` -> `parse_env_soubor`, or `readConfigKey` in Node). Tokens live in one local env file (chmod 600); never minted ad hoc, never echoed.

## Why
Secret values must not reach transcripts; transcripts are long-lived and shared between sessions.

---
**Verification:** read only (not run here) — each pattern was observed at least once in operation (2026-09-14, 2026-09-27, 2026-10-04); the records are not public (not re-run for this item)
**Evidence:** file: scripts/lib/env-file-keys.sh — load_env_file_keys reads an env file without executing it; file: scripts/lib/env-soubor.sh — parse_env_soubor, an env parser that does not execute values
**Valid for:** general; examples from Coolify 4.x compose deployments
**Scope:** general · **Source:** platform-maintainers
',
  'When inspecting containers, env, Coolify API /envs or SQL rows with URLs, print keys only (cut -d= -f1) and values only for an explicit allowlist of named keys; read env files with a parser, never with `source`; strip credentials from URLs with sed -E ''s#//[^@/]*@#//#''. Never filter by prefix or regex to decide what is safe to print. Do not rotate leaked secrets without the owner.',
  ARRAY['secrets', 'env', 'logging', 'hygiene', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- ops-tmpfs-and-forgotten-background-jobs  (zdroj: aisha/knowledge/ops-tmpfs-and-forgotten-background-jobs.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'adaad2c0-e7b4-289d-e005-22d216c1b7ae',
  'playbook',
  'platform_knowledge',
  'ops-tmpfs-and-forgotten-background-jobs',
  '/tmp is RAM on servers: forgotten background jobs take the host down',
  'A background command started over ssh without a time limit and writing to /tmp (tmpfs) grew for weeks and exhausted RAM and swap of a host running three instances; containers without init accumulated zombies.',
  '# /tmp is RAM on servers: forgotten background jobs take the host down

## Rules
1. **Every background command over ssh needs an end.** [measured] `ssh host ''nohup docker events --since 1s … > /tmp/…log &''` without `--until` never ends and survives the disconnect. It wrote ~0.5 GB/day (mostly exec events of healthchecks) for 33 days.
2. **/tmp on servers is tmpfs = RAM.** [measured] The host ran 49 days without reboot, so nothing cleaned the file. RAM 46/47 GB, swap full, OOM killer 38 times since boot.
3. **Alert on memory classes, thresholds as data.** [read] Shmem > 2 GiB, MemAvailable < 10 %, tmpfs /tmp < 50 % free, swap > 80 % (each 5 min), any increase of `node_vmstat_oom_kill`. Thresholds are recording rules so they can change without editing alerts.
4. **Containers without init collect zombies.** [measured] ~39 000 zombie `bash` processes under one parent; zombies pile up under PID 1 of containers with `HostConfig.Init=nil`. Set `init: true` for long-running services that fork (healthcheck shells, workers).
5. **OOM kills are visible without kernel log access.** [measured] `node_vmstat_oom_kill` in Prometheus confirmed the kill window; an agent account does not read the kernel log and should not get that group.

## Why
A diagnostic command left running by one session took down the shared host weeks later. The process had no owner and the RAM disk had no watcher.

---
**Verification:** read only (not run here) — growth and OOM kills were read from Prometheus (node_memory_Shmem_bytes, node_vmstat_oom_kill) and from the host during an outage on 2026-10-03; the host data is not public (not re-run for this item)
**Evidence:** procedure: df -h /tmp shows tmpfs; node_memory_Shmem_bytes and node_vmstat_oom_kill in Prometheus show the growth and the kill window without kernel log access; procedure: docker inspect -f ''{{.HostConfig.Init}}'' <container> = <nil> means no init process, so zombies pile up under PID 1
**Valid for:** any Linux host where /tmp is tmpfs; general
**Scope:** general · **Source:** platform-maintainers
',
  'Never start a background process on a server without a time limit (timeout, --until) and never write to /tmp there. When a host is short of memory, check df -h /tmp and Shmem before anything else.',
  ARRAY['tmpfs', 'memory', 'oom', 'ssh', 'background-job', 'zombie', 'monitoring', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'operations',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- shared-gpu-job-runner-rules  (zdroj: aisha/knowledge/shared-gpu-job-runner-rules.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  '83d69583-2bac-6e96-d85b-dd43bdbb0146',
  'playbook',
  'platform_knowledge',
  'shared-gpu-job-runner-rules',
  'One shared GPU, many jobs: queue, cleanup and evidence',
  'Rules for a job wrapper on a single shared GPU: the lock, the cleanup and the per-label log must not be able to destroy another job or another job''s evidence.',
  '# One shared GPU, many jobs: queue, cleanup and evidence

## Rules
1. **Cleanup must know whose containers it removes.** [measured] "Remove everything with the layer label because I hold the lock" is safe only if every job uses the same lock path. A job started with another lock path (an overridden variable, a container without the lock directory mounted) removed a running job''s container. Put the lock identity into the label and treat a foreign one as an error.
2. **One label, one run, one log.** [measured] Re-using a label while the first run is still active put the first run''s verdict into the second run''s log. Refuse a label that is queued or running; name logs with a timestamp.
3. **Three repetitions need three labels.** [measured] Otherwise each repetition overwrites the evidence of the previous one.
4. **Clean up on interruption too.** [measured] After TERM/INT the verdict line was written but the job''s container stayed on the GPU.
5. **Enforce the label, do not just offer it.** [measured] A container started without the label survived the job and the job still reported success.
6. **A lock does not mean the card is free.** [read] Serving lanes and processes outside containers do not hold the lock. Measure the card (used memory below a threshold, no foreign process) before every run.
7. **Queue files must not be writable by everyone.** [measured] A ticket carrying the pid of any long-lived process blocked the queue.
8. **Secrets only through the environment.** [read] The full command line goes to the log.

## Why
The wrapper was written after two trainings ran out of memory because a server from a previous step stayed on the card. The same class of failure remained reachable through the edges above.

---
**Verification:** read only (not run here) — rules 1-5 and 7 were measured by a probe over a copy of a job wrapper with a simulated docker, kept in a private review repository (not re-run for this item); rules 6 and 8 are reading
**Evidence:** procedure: re-measure rule 1 by starting two jobs with different lock paths; the second job''s cleanup must not remove the first job''s container; procedure: re-measure rule 4 by sending TERM to a running job; no container with the job''s label may remain on the GPU afterwards; procedure: re-measure rule 5 by starting a container without the label inside a job; the job must fail, not report success
**Valid for:** general rules for any job wrapper on a GPU shared by several jobs or tenants
**Scope:** general · **Source:** platform-maintainers
',
  'When proposing, running or reviewing GPU jobs (training, benchmarks, serving measurements) on a shared node, apply these rules; do not accept a measured number whose label was reused or whose run did not verify an empty card.',
  ARRAY['gpu', 'queue', 'lock', 'cleanup', 'evidence', 'tenant-isolation', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'model_evaluation',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);

-- verify-identity-at-every-write  (zdroj: aisha/knowledge/verify-identity-at-every-write.md)
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  'ca2e75b0-f59f-5d97-9e4e-f25f0a0bb4ad',
  'playbook',
  'platform_knowledge',
  'verify-identity-at-every-write',
  'Check who holds your name at every write, not only at start',
  'Where restarting agent sessions claim shared names, a name can be taken over between your check and your write; a declared author is not an authenticated one.',
  '# Check who holds your name at every write

## Rules
1. **[read: observed incident] A name can change hands within seconds.** A check at start does not cover a write a minute later.
2. **[read] Verify the holder before each write** under a shared name (the lock contains your session id); better, let the tool verify it.
3. **[read] If you wrote under a name that was no longer yours, correct it openly** (who really wrote what, when); never rewrite the record.

## Why
Two sessions carried one name for about a minute: the new holder had taken it over, and the previous holder still logged a decision, a handover and a commit under it. The content was valid, the signature was not.

---
**Verification:** read only (not run here) — observed incident, not an experiment: on 2026-10-04 a takeover of a shared session name was logged and the previous holder wrote three more records under the same name within the next minute; recorded in a private log
**Evidence:** one observed incident (private log, 2026-10-04): takeover record, then three records by the previous holder under the taken name, then an open correction; procedure: compare the session id in the name''s lock with your own immediately before each write; a mismatch means the name is no longer yours
**Valid for:** any multi-session setup where names are claimed by declaration
**Scope:** general · **Source:** platform-maintainers
',
  'Before writing a record, commit or message under a shared name, check that the name''s lock still holds your session id; if it does not, write under your own new identity and correct the record openly instead of rewriting it.',
  ARRAY['identity', 'sessions', 'succession', 'logging', 'knowledge-from-experience', 'verified:read', 'scope:general', 'source_type:internal', 'data_sensitivity:public', 'retention_class:long_term', 'legal_basis:legitimate_interest']::text[],
  'governance',
  'active',
  'public',
  1,
  false,
  'platform-maintainers',
  now()
) ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  source_type = EXCLUDED.source_type,
  source_slug = EXCLUDED.source_slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  visibility = EXCLUDED.visibility,
  is_verified = EXCLUDED.is_verified,
  author_display_name = EXCLUDED.author_display_name,
  story_id = EXCLUDED.story_id,
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (public.knowledge_items.item_type, public.knowledge_items.source_type, public.knowledge_items.source_slug, public.knowledge_items.title, public.knowledge_items.summary, public.knowledge_items.body_markdown, public.knowledge_items.ai_instructions, public.knowledge_items.ai_context_tags, public.knowledge_items.category, public.knowledge_items.status, public.knowledge_items.visibility, public.knowledge_items.is_verified, public.knowledge_items.author_display_name, public.knowledge_items.story_id)
  IS DISTINCT FROM
      (EXCLUDED.item_type, EXCLUDED.source_type, EXCLUDED.source_slug, EXCLUDED.title, EXCLUDED.summary, EXCLUDED.body_markdown, EXCLUDED.ai_instructions, EXCLUDED.ai_context_tags, EXCLUDED.category, EXCLUDED.status, EXCLUDED.visibility, EXCLUDED.is_verified, EXCLUDED.author_display_name, EXCLUDED.story_id);
