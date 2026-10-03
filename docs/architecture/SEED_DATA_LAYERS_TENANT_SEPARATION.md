# Seed Data Layers and Implementation Separation

Status: implemented for the 0.9.0 public baseline.

## Layer Model

The public repository carries the AISHA platform and public demo/reference data.
Concrete deployments add their own implementation/private layers without
polluting the platform.

- `platform`: schema SoT in `aisha/db/sql/`, operational seed in
  `aisha/db/seed/core/`, and neutral content translations in
  `aisha/db/seed/translations/`.
- `demo`: public showcase data in `aisha/db/seed/demo/`.
- `implementation`: one concrete stack implementation in
  `aisha/db/seed/implementations/<name>/`.
- `instance`: private deployment overlay in `aisha/db/seed/instance/`.

Client stacks such as patient, Buddhist, union or other customer installations
are the same class of layer as our public `aisha` implementation. They are not
platform core and do not belong in the public repo.

## Runtime Selection

`scripts/db/compile-seed.mjs` composes the layers:

- `platform` or `empty`: platform only.
- `demo`: platform + public demo.
- `implementation`: platform + `implementations/<AISHA_IMPLEMENTATION>`.
- `instance`: platform + implementation + private overlay.
- `full`: platform + implementation + private overlay + demo.

`AISHA_IMPLEMENTATION` is the canonical selector. `AISHA_STORY` and `STORY`
remain legacy fallbacks because older deployment scripts use them for app/realm
naming. Production/private deploys must set `AISHA_SEED_PROFILE=instance`
explicitly. The default compiler profile is `platform` so committed public seed
artifacts cannot accidentally include implementation or private data.

## Content Translations

DB content translations are generated into the same seed layer as their content:

- `src/i18n/content/{locale}/{namespace}.json`
  -> `aisha/db/seed/translations/{namespace}.sql`
- `src/i18n/content/demo/{locale}/{namespace}.json`
  -> `aisha/db/seed/demo/20_content_translations_{namespace}.sql`
- `src/i18n/content/implementations/{name}/{locale}/{namespace}.json`
  -> `aisha/db/seed/implementations/{name}/20_content_translations_{namespace}.sql`

Static frontend i18n segments/locales must stay platform-neutral. Branded web
copy, routing and templates belong to implementation/demo layers or private
hooks.

## Public Submodules

The public `.gitmodules` contains only public upstream dependencies such as
`packages/insight`. Private implementation seed data and branded templates are
represented by ordinary placeholder directories:

- `aisha/db/seed/instance/`
- `domains/templates/aisha.guru/`

Private deployments may mount their own repositories at these paths locally,
but those mounts are not part of the public baseline.

## Baseline Policy

For 0.9.0 the active migration stream is baseline-only:

- `aisha/db/migrations/00000000000000_baseline.sql`
- no non-baseline migrations in `aisha/db/migrations/`
- archived historical SQL under `the absorbed migration (now in the baseline)`

Future migrations are a later phase and should be created in relation to the
relevant platform or implementation change.

## Knowledge Provisioning Model — blank canvas vs instance knowledge base

The same layering governs *knowledge*, and this is a first-class design decision:
the OSS layer is a **blank canvas plus an operating manual** — a complete engine with
documentation of *how to use it*, but **no domain/expert knowledge**. That knowledge is
**not carried in the default by design**; it is the blank canvas anyone can implement on.
The domain knowledge base — the proprietary, curated value — lives **only in the instance
layer** (`seed/instance/` or a deployment's live DB) and is what we provide as a service.

### Two kinds of "knowledge" (must not be conflated)

1. **Platform-operational knowledge** — *how the engine works*: engineering/guild docs,
   tao (platform values/principles), design patterns, operational playbooks. **Ships in
   OSS** (`seed/core/`). It documents the infrastructure itself — the instruction manual
   for the blank canvas, not content on the canvas.
2. **Domain / expert knowledge** — the curated subject-matter expertise that makes a
   deployment valuable (domain playbooks, partner-specific patterns). **Instance-only**
   (`seed/instance/` / live DB). Never in the OSS default. **This is the service.**

**Classification criterion (where a new `knowledge_item` belongs):** does it describe how
to use/operate *the platform itself*? → `core/` (OSS). Is it subject-matter knowledge of a
specific *domain/deployment*? → `instance/` (private, the service). Is it a demonstration?
→ `demo/` (opt-in showcase). When in doubt → `instance/` (public OSS cannot be taken back).

### What lives where (verified 2026-06-06)

| Seed | Content | Class | In OSS default? |
|---|---|---|---|
| `core/20_aisha_backbone` | platform backbone | operational | yes |
| `core/21_aisha_knowledge` | 27 engineering_doc + 34 playbook + 15 domain_doc — all `story_id=NULL` | operational | yes |
| `core/25_aisha_tao` | 1 tao (platform values) | identity | yes |
| `core/30_occipitum_design_kb` | 2 design patterns | platform design | yes |
| `demo/01_storyloop`, `demo/02_expert_rules` | sample story + rules | showcase | only `demo` profile |
| `seed/instance/` | real domain KB | **expert / service** | no — README only (private submodule) |

**Audit (resolved 2026-06-06):** the 15 `domain_doc` items in `core/21_aisha_knowledge` are all
`source_type='guild_db'` **guild expertise-area definitions** (Frontend, Backend, Devops, Database,
UX, Mobile, AI/ML, Security, Testing/QA, PM, API, Data Eng, Blockchain, Performance, Fullstack).
That is the platform's generic *engineering-discipline taxonomy* (how AISHA organizes engineering
expertise) — platform-operational, applies to every deployment — **not** partner/subject-matter
domain knowledge. Per the §2 criterion they correctly belong in `core/` (OSS). No drift; the
blank-canvas principle holds (the OSS default carries the engine's own taxonomy, no domain content).

### Invariant

1. Domain/expert knowledge is **never** committed to public OSS (`seed/core|demo`) — only to
   `seed/instance/` (`AISHA_SEED_PROFILE=instance`, private submodule) or a live DB.
2. The OSS default stays a fully functional **blank canvas** — engine + operating manual, no
   domain content.
3. Classify every new `knowledge_item` by the criterion *before* choosing a layer.

One application of this model is the self-tooling factory templates (generic prompt = OSS
Tier 0; expert tooling playbooks = instance Tier 1) — see
[../deploy/AISHA_SELF_TOOLING.md §13-14](../deploy/AISHA_SELF_TOOLING.md).
