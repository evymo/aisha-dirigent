# Web artifact pipeline — operator how-to

The Aisha stack hosts **one public web** at `/{slug}` (canonical: `/index`).
Its content is a GrapesJS canvas stored in `web_pages.canvas_data`. The
**web artifact pipeline** is how operators put a new canvas in front of
that row — from a static folder, a remote URL, or via an Aisha-led redesign.

This is **not a new capability** — it's Aisha's existing block registry,
story system, page builder, audit trail, and LLM gateway, **wired up
for the specific use case of designing a web on top of your stack**.

## Two usage directions, one mechanism

| Direction | Operator situation | Default seed | Iteration |
|---|---|---|---|
| **A — My stack hosts my web** | You run a stack for yourself or your org | `domains/default/` minimal hello-stack (no Aisha brand) | Upload your zip, scrape your URL, or have Aisha redesign |
| **B — My stack hosts a client/project web** | Story-driven work for a research group, agency, accountancy, etc. | Empty until first ingest | Same — every iteration lives in `web_artifact_jobs` under that story |

Stories are first-class. Each story can run its own iteration timeline in
parallel; only one artifact is **applied** to the live `web_pages.index`
row at a time (concurrency-guarded — see below).

## Lifecycle

```
pending → processing → ready_for_review → approved → applied (terminal)
                                      ↘ rejected   (terminal)
            ↘ failed (terminal)
```

Every transition writes `audit_journal` with tags
`['stack', 'story', 'web_artifact', <kind>]` so the audit dashboard can
trace any apply back to its source.

## Operator actions

### 1. Upload a static folder

```
/admin/stories → open story → Upload static folder → choose .zip
```

The zip is uploaded into the private `web-artifact-sources` bucket
(50 MB cap, MIME-locked, admin/staff INSERT, story-participant SELECT).
`svc-web-artifact` then parses:

- jsdom + DOMPurify sanitization (`<script>`, `on*` handlers, `javascript:` URLs stripped)
- token extraction (`:root { --xxx }`, font stacks, spacing)
- runtime block detection — heuristics map static patterns to the **12 existing
  runtime web blocks** (`hero-slides`, `news-list`, `contact-form`,
  `archive-preview`, `knowledge-preview`, `faq-accordion`, `product-catalog`,
  `news-browser`, `knowledge-browser`, `archive-browser`, `studies-browser`,
  `guild-directory`)
- patterns without a matching block are flagged `preserve_as_static` +
  produce a follow-up story suggestion. **No new block types are minted
  inside this milestone** — they become Aisha-driven dev stories.

Result lands as `web_artifact_jobs.status = ready_for_review`.

### 2. Scrape an existing URL

```
/admin/stories → open story → Scrape a URL → paste URL → Start scrape
```

`svc-web-artifact` fetches the URL with SSRF guard (DNS lookup + IP reject
for RFC1918, link-local, metadata-service ranges), bounded at 10 MB.
Pulls the HTML + same-origin stylesheets, then runs the same parsing
pipeline as upload. Returns `csr_unrenderable` if the site requires JS
rendering — that's a follow-up scope (Playwright-based scraper).

### 3. Ask Aisha to redesign

```
/admin/stories → open story → Ask Aisha to redesign → brief + slot profile
```

Pick a slot profile:

| Profile | When to use | Cost |
|---|---|---|
| `budget` | quick variation, exploring | cheapest |
| `balanced` | normal iteration | default |
| `maxQuality` | final polish, brand-critical | highest |

The n8n `WF_OCCIPITUM_REDESIGN` workflow runs a 3-pass slot chain
(Spark → Ember → Verify) keyed on the prior canvas. The **Verify slot
enforces hard invariants** before the new canvas can land:

- every `data-runtime-block` placeholder from seed must be present in
  output (functional layer of the stack is **never silently dropped**)
- every `data-i18n-key` from seed must be present in output
- every original content block text must be preserved verbatim

If any invariant fails, the redesign retries with explicit feedback (up to
2 attempts) and then the job goes to `failed` with a descriptive
`error_message`. This is non-negotiable — Aisha may restyle, not strip.

### 4. Apply + publish

When a job is `ready_for_review`, paste the `web_pages.id` of your target
page (typically the `slug='index'` row) and **Apply**. The RPC
`apply_web_artifact_to_page`:

1. Validates the operator is admin/staff or a participant of the job's story.
2. **Concurrency guard:** if another version landed on this page since
   the job was generated, raises `stale_artifact_apply_another_version_landed`
   — UI prompts you to regenerate.
3. Takes a pre-apply version snapshot via `create_web_page_version` so
   you have a one-click rollback path (`restore_web_page_version` RPC).
4. Overwrites `web_pages.canvas_data` / `canvas_html` / `canvas_css`.
5. Marks the job `applied`, records `applied_version_id` for the snapshot.

**Publish** flips `web_pages.status = 'published'`. Until then, the new
canvas is admin-visible only.

## Default seed

On first stack boot, `svc-web-artifact` runs `/seed-default` 3 seconds
after listening. It reads `domains/default/{index.html, tokens.css,
styles.css}` and pipes them through the same parsing pipeline, ending
in `web_pages.slug='index'` with `story_id IS NULL`. **Idempotent** —
subsequent boots return 304. Disable with `AISHA_SEED_ON_BOOT=0`.

The default content is **branding-neutral on purpose** — operators
represent themselves, not us. The Aisha showcase template lives in
`domains/templates/aisha.guru/` and is **not** the default.

## Tables touched

- `web_pages` (column added: `story_id uuid REFERENCES partner_stories`)
- `web_page_versions` (existing — used for pre-apply snapshots)
- `web_artifact_jobs` (new)
- `audit_journal` (existing — every transition)
- Storage: `web-artifact-sources` bucket (new, private, 50 MB cap)

## RPCs

| RPC | Caller | Purpose |
|---|---|---|
| `start_web_artifact_ingest` | hooks + n8n | create pending job, idempotent on key |
| `mark_web_artifact_processing` | service_role only | pending → processing |
| `complete_web_artifact_ingest` | service_role only | processing → ready_for_review with parsed canvas |
| `request_web_artifact_redesign` | operator | spawn redesign job from prior result |
| `fail_web_artifact_ingest` | service_role only | non-terminal → failed |
| `apply_web_artifact_to_page` | operator | concurrency-guarded apply + snapshot |
| `publish_web_artifact` | operator | flip web_pages.status='published' |
| `get_web_artifact_jobs_for_story` | hooks | UI timeline read |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Upload returns 413 | Zip > 50 MB | Trim assets; consider splitting |
| Parse returns `csr_unrenderable` | Source site is JS-rendered (React/Vue/Angular SPA shell) | Static export the site first, or wait for Playwright follow-up |
| Apply returns `stale_artifact_apply_another_version_landed` | Someone else (or another story) applied to this page since your job was generated | Regenerate (Aisha redesign or re-upload) — read latest version, iterate from there |
| Job stuck in `processing` | Microservice crashed mid-parse | Check `aisha-svc-web-artifact` logs, then `fail_web_artifact_ingest` with stale RPC, retry |
| Redesign job → `failed` with `runtime_block_invariant_violated` | LLM dropped a functional placeholder | Re-run; the gate is hard on purpose |
| `seed-default` not running | `AISHA_SEED_ON_BOOT=0` set, or `domains/default/index.html` missing on volume | Check env + bind mount in `docker-compose.coolify.yml` |
