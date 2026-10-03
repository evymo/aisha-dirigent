-- ==============================================================================
-- Extension spine doctrine — governed expert_rules (core layer)
-- ==============================================================================
-- How extension is thought about. Not "which folder does my code go in", but:
-- WHICH EXISTING SPINE DOES THIS RIDE, and does my shape reach the far end of it?
--
-- WHY THESE RULES EXIST (measured 2026-07-26, two collisions in one day):
--
-- (A) A plugin was authored with `"kind": "backend_provider"`. Measured the same
--     day against the SoT:
--       schemas/plugin-manifest.schema.json declares 6 kinds
--         web_tracking · auth_provider · backend_provider
--         automation_node · full_stack · agent
--       aisha/db/sql/functions/ contains 1 materializer
--         materialize_agent_runtime.sql
--     5 of 6 declared kinds have no loader. The manifest validates, the plugin
--     submits, the catalog row appears — and nothing ever materializes into
--     ai_provider_registry, so aisha_resolve_clow_backend can never route to it.
--     It fails by being INERT: no error, no log line, a green-looking artifact
--     that is not connected to anything. (Independently mapped 2026-07-03 in the
--     extension-unification review, main @ 221a2ff5; unchanged 23 days later.)
--
-- (B) Three carriers were built for one domain (vehicle log book: vehicles,
--     drivers, rides, odometer, distance):
--       services/svc-webdispecink   SOAP _getCarLogBook4
--       services/svc-tcars          tc_rides / tc_vehicles / tc_drivers / tc_groups
--       plugins/eurowag-telematics  REST trips / vehicles / drivers
--     Two of them within 24 hours, by the same author, without noticing they were
--     one thing. Each vendor looked like an integration; none of them was.
--
-- Both collisions are ONE mistake: building a new carrier instead of naming the
-- existing spine. The spine already exists in both cases and is proven by a
-- working reference — manifest -> materializer -> registry row -> resolver
-- (agents), and (source, observation, identity signals) -> twin
-- (production_sensor_readings.source already enumerates homeassistant | manual |
-- plc | lims | iot_gateway | scada).
--
-- SOURCE ONBOARDING CONTRACT classification (docs/enterprise/
-- SOURCE_ONBOARDING_CONTRACT.md — mandatory 4-dim classification):
--   source_type       = internal            (own measured engineering behaviour)
--   data_sensitivity  = public              (engineering practice, no tenant data)
--   retention_class   = long_term           (architectural doctrine)
--   legal_basis       = legitimate_interest (operational governance)
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE. Skips gracefully when the partner
-- bootstrap has not run yet (author_partner_id is NOT NULL by schema).
--
-- ENFORCEMENT STATUS (updated 2026-07-26 evening — owner decided: "doplnit"):
--   rule 1 ENFORCED: src/tests/gates/plugin-kind-has-materializer.gate.test.ts
--     (schema enum ≡ DB enum ≡ dispatcher branches ≡ materialize_* files ≡
--      spec columns; call sites must use the dispatcher) + the dispatcher's
--      ELSE RAISE as its runtime twin. Materializers exist for ALL kinds now.
--   rule 2/3 still ai_instructions-only; owed:
--     src/tests/gates/no-per-vendor-carrier.gate.test.ts (needs the tcars
--     retirement decision first — the gate would flag the existing tc_* family)
-- ==============================================================================

DO $seed$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT id INTO v_partner_id FROM partner_profiles ORDER BY created_at LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE NOTICE 'No partner_profiles found — skipping extension spine doctrine seed (re-run after partner bootstrap).';
    RETURN;
  END IF;

  -- 1. A declared capability that never materializes is inert, not "pending".
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'declared-extension-must-reach-the-resolver',
    'A declared extension must reach the resolver',
    'A manifest kind with no materializer produces a catalog row and nothing else — it validates, submits and looks green while being unreachable. Before authoring any extension, verify the kind has a materializer that yields a resolver-visible registry row.',
    E'# A declared extension must reach the resolver\n\nThe stack can be extended eight ways. Only some of them carry a declared capability all the way into the runtime resolver. **Declaring is not wiring.**\n\n## The one correct path (the reference)\n\n```\nmanifest capabilities  ->  materialize_*(...)  ->  registry row  ->  resolver\n   plugin-manifest          in the approval txn     agent_catalog /     derive_clow_needs\n   .schema.json                                     ai_provider_registry -> fn_admit_clow\n                                                    ai_runtime_registry  -> aisha_resolve_clow_backend\n```\n\nNothing about this is agent-specific. It is the contract every surface should share, and it is already locked by the gates `admission-composes-registries` and `runtime-availability-no-allowlist`: a verdict must derive from registries + policy, never from an allow-list.\n\n## The measured gap (2026-07-26)\n\n| declared kind | materializer | reaches resolver |\n|---|---|---|\n| `agent` | `materialize_agent_runtime` | yes |\n| `backend_provider` | — | **no** |\n| `automation_node` | — | **no** |\n| `auth_provider` | — | **no** |\n| `web_tracking` | — | **no** |\n| `full_stack` | — | **no** |\n\nSix kinds in `schemas/plugin-manifest.schema.json`, one materializer in `aisha/db/sql/functions/`.\n\n## Why this is a trap and not a TODO\n\nA dead kind does not reject you. The manifest passes schema validation, `submit_plugin` accepts it, the state machine advances, a `plugin_catalog` row exists. Every signal you normally read says success. The absence is at the far end, where nothing calls you — and nothing logs that nothing called you.\n\nThis is the same failure shape as a Traefik label that never matches: **a green artifact wired to nothing** (see `coolify-no-hostname-in-traefik-label`).\n\n## What to do instead\n\nBefore authoring an extension of kind `K`:\n\n```bash\nls aisha/db/sql/functions/ | grep materialize   # is K wired at all?\n```\n\n- **Materializer exists** — author the manifest, and assert the registry row appears after approval.\n- **No materializer** — you have two honest options: add `materialize_K` following `materialize_agent_runtime` as the template (called from the same approval gate, in the same transaction), or do not use the plugin surface for this. Do NOT author a manifest against a dead kind and treat the missing wiring as someone else''s later problem.',
    'architecture_pattern'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Before authoring any plugin/extension manifest, verify the declared kind has a materializer: `ls aisha/db/sql/functions/ | grep materialize`. Measured 2026-07-26: schemas/plugin-manifest.schema.json declares 6 kinds (web_tracking, auth_provider, backend_provider, automation_node, full_stack, agent) and only materialize_agent_runtime exists — so 5 of 6 kinds are INERT. A dead kind does not error: the manifest validates, submit_plugin accepts, a plugin_catalog row appears, and the capability never reaches aisha_resolve_clow_backend. Do not read "it submitted successfully" as "it is wired". If the kind has no materializer, either add materialize_<kind> modelled on materialize_agent_runtime (same approval gate, same transaction, registry row carries the declared caps) or do not use the plugin surface. Never introduce a new manifest format or a parallel loader — the plugin manifest is the single extension contract and already covers all 6 kinds.',
    ARRAY['architecture','extension','plugin','registry','resolver','capability','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', false, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    summary = EXCLUDED.summary,
    status = 'published',
    updated_at = now();

  -- 2. External observations ride one shape; the vendor is a value, not a schema.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'external-observation-rides-one-shape',
    'External observation rides one shape',
    'Everything arriving from outside is information about an entity. Transport, parsing and identity signals vary per vendor; the storage shape does not. A new vendor is a value in a source column, never a new table family or service.',
    E'# External observation rides one shape\n\nEverything that arrives from outside is **information about an entity**. Ingest attaches it, and the twin reality grows autonomously as a consequence — not because someone declared new tables.\n\n```\n(source, observation, identity signals)  ->  identity resolution  ->  attach to twin\n```\n\n## Only three things vary per vendor\n\n1. **transport** — REST, SOAP, XLS, a person with a phone, an IoT gateway\n2. **parsing** — what each field means\n3. **identity signals** — plate, company id, VIN, sha256, sensor code\n\n**The storage shape is not one of them.** A vendor is a value in a `source` column. `production_sensor_readings.source` already proves the pattern: `homeassistant | manual | plc | lims | iot_gateway | scada` — a human-entered reading and a SCADA tag are the same row shape, because a measurement is a SIGNAL and the human is merely its TRANSPORT.\n\n## The measured violation (2026-07-26)\n\nThree carriers for one domain — vehicles, drivers, rides, odometer, distance:\n\n| carrier | transport | status |\n|---|---|---|\n| `services/svc-webdispecink` | SOAP `_getCarLogBook4` | dead endpoint |\n| `services/svc-tcars` | mirrored `tc_*` tables | upstreamed |\n| `plugins/eurowag-telematics` | REST trips/vehicles/drivers | built same day |\n\nTwo of them within 24 hours by the same author. Each vendor presented itself as "an integration", so each got its own carrier — and the duplication was invisible because it arrived in pieces from different directions.\n\n## Where the pieces actually belong\n\n- **raw lane** — the observation as received, specialised by the NATURE of the signal (typed numeric telemetry queries differently than an OCR''d document with a review state), never by WHO sent it\n- **identity** — `twin_external_refs`, not a mirrored foreign integer id. A vendor''s primary key is just one more identity signal, and a weak one\n- **derivative** — `twin_events` via the `(source, event_type, source_ref)` seam: a trip becomes an event with duration, place and relations\n\n## The tell\n\nIf you are about to create a table group, an enum, or a service whose NAME encodes a vendor, stop. Ask which existing lane carries this class of signal, and what makes this vendor''s row genuinely a different SHAPE rather than a different VALUE. Usually nothing does.',
    'integration_pattern'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Everything arriving from outside is information about an entity, stored in one shape: (source, observation, identity signals) -> identity resolution -> attach to twin. Per vendor only three things vary — transport (REST/SOAP/XLS/human/IoT), parsing (field meaning), identity signals (plate, company id, VIN, sha256, sensor code). The storage shape NEVER varies: a new vendor is a value in a source column, not a new table family and not a new service. Precedent: production_sensor_readings.source already enumerates homeassistant|manual|plc|lims|iot_gateway|scada. Measured violation 2026-07-26: svc-webdispecink (SOAP) + svc-tcars (tc_* tables) + plugins/eurowag-telematics (REST) are three carriers for ONE domain (vehicle log book), two built within 24 hours. Before creating any table group, enum or service whose name encodes a vendor, name the existing lane that carries this class of signal and state what makes this a different SHAPE rather than a different VALUE. Identity goes in twin_external_refs — never mirror the vendor primary key as a column and never add an FK-gap allowlist entry to make mirrored ids pass; the vendor key is one weak identity signal among several. Specialise a lane by the NATURE of the signal (typed telemetry vs reviewable document), never by its sender.',
    ARRAY['architecture','ingest','twins','integration','identity','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', false, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    summary = EXCLUDED.summary,
    status = 'published',
    updated_at = now();

  -- 3. The meta-rule both collisions reduce to.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'name-the-spine-before-building-a-carrier',
    'Name the spine before building a carrier',
    'The first question for any new capability is not how to build it but which existing spine it rides and whether the shape reaches the far end. New services and table families are the anti-pattern; the default answer is a row, a value, or a registration.',
    E'# Name the spine before building a carrier\n\nThe platform is extended by **declaring into something that already resolves**, not by adding carriers. Before writing a service, a table family, or a manifest, answer three questions in order:\n\n1. **Which existing spine does this ride?** Name it concretely — `plugin manifest -> materializer -> registry -> resolver`, or `(source, observation, identity signals) -> twin`, or `surface_blocks.source_params -> get_block_data`.\n2. **Does my shape reach the far end?** Not "does it validate" — does something on the other side actually consume it? Find the consumer and name it.\n3. **What makes this genuinely a new SHAPE and not a new VALUE?** If the honest answer is "the vendor is different" or "the protocol is different", it is a value.\n\nIf you cannot name the spine, you have not finished analysing — you have started building.\n\n## Why this keeps being violated\n\nBoth 2026-07-26 collisions were committed by an author who had been told all day not to build bespoke. Neither felt like bespoke at the time:\n\n- The extension **arrived as a vendor integration**, and integrations feel like they deserve their own module.\n- The duplication **arrived in pieces**, days apart, from different directions — so no single moment looked like "I am building the third one of these".\n\nThe defence is not vigilance, it is the question. Name the spine, in writing, before the first file.\n\n## The green-artifact failure mode\n\nThe expensive version of this mistake is not a rejected build — it is an accepted one. A manifest against a dead kind, a Traefik label that never matches, a config value nobody reads: all validate, all submit, all look done. **A thing wired to nothing reports success.** So "it built" and "it deployed" are not evidence; the evidence is the consumer doing something observable.\n\nRelated: `declared-extension-must-reach-the-resolver`, `external-observation-rides-one-shape`, `coolify-no-hostname-in-traefik-label`.',
    'architecture_pattern'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Before writing a new service, table family, enum, or manifest, name in writing (a) which existing spine it rides, (b) which consumer on the far end will actually read it, (c) what makes it a new SHAPE rather than a new VALUE. If the differentiator is "different vendor" or "different protocol", it is a VALUE — a row or an enum entry — not a carrier. Known spines: plugin manifest -> materialize_* -> registry row -> aisha_resolve_clow_backend; (source, observation, identity signals) -> identity resolution -> twin; surface_blocks.source_params -> get_block_data. If you cannot name the spine you have not finished analysing. CRITICAL: a thing wired to nothing reports SUCCESS — manifests validate, builds pass, deploys go green while the far end never calls. Never accept "it built" or "it submitted" as evidence of wiring; the evidence is the consumer doing something observable. This rule exists because two violations were committed in one day by an author actively trying to avoid bespoke work: an integration presented itself as deserving its own module, and a triplication accumulated in pieces days apart so no single commit looked like the third copy.',
    ARRAY['architecture','doctrine','extension','reuse','analysis','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', false, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    summary = EXCLUDED.summary,
    status = 'published',
    updated_at = now();

END $seed$;
