# Krmic -> AISHA system extension integration plan

Status update 2026-07-05: this document remains useful as a system-extension
inventory and package-boundary reference. It is superseded for runtime
architecture by `krmic-bounded-microservice-rag-plan.md`, which recommends
Krmic as a bounded microservice with selective RAG projection instead of deep
AISHA DB merge.

Datum: 2026-07-05
Stav: kompletni analyza + integracni plan vcetne testu
Cilova destinace: `<repo-root>`
Navazuje na: `KRMIC_ACCOUNTING_PROTOCOL_BLUEPRINT.md`

## 1. Rozhodnuti

Krmic accounting capability je systemove rozsireni AISHA, ne feature jedne
aplikace. Do main Aishy patri stabilni mechanika:

- protokol dokumentu,
- pipeline kontrakty,
- rule evaluator,
- predkontacni evaluator,
- RPC/audit/Flowboard/runtime integrace,
- test/gate infrastruktura.

Do main Aishy nepatri tvrde zadratovana CZ legislativa, uctova osnova jedne
firmy, Pohoda-specific predkontace, klientsky chart-of-accounts nebo narodni
speciality jako kod. Tyto veci maji byt parametrizace dodana jako pack nebo
tenant config.

Spravny model:

```text
AISHA platform core
  -> accounting protocol core
    -> jurisdiction packs
      -> accounting standard/protocol packs
        -> tenant/company configuration
          -> document-specific evidence and decision
```

Tento model umozni prenest principy Krmice do main repo, ale neuzamkne Aishu do
jedne zeme nebo jednoho ucetniho software.

## 2. Evidence z aktualni Aishy

Repo uz ma patterns, ktere je potreba pouzit:

- `package.json`
  - workspaces jsou `packages/*` a `services/*`.
  - testy maji vrstvy `test:gates`, `test:db`, `test:services`,
    `test:flowboard:*`, `test:repo:db`.
- `packages/audience-types`
  - priklad cisteho sdileneho domain balicku s ESM, NodeNext, strict TS,
    Vitest contract tests a publikovatelnym `@aisha/*` package tvarem.
- `packages/flowboard-core`
  - priklad engine-agnostic core balicku pouzivaneho webem i sluzbami.
- `services/svc-source-broker`
  - priklad broker/source adapter seam, dispatch podle story, fail-soft
    NullDataSource.
- `services/svc-fio-bank`
  - priklad Fastify service: `applySecurity`, OTel, metrics, RPC-only
    PostgREST helpery, route unit tests.
- `services/svc-plugin-system`
  - plugin runtime je capability-scoped, isolated runner, sandbox broker,
    RPC/KV/LLM/notify/fetch pres guardy.
- `aisha/db/sql`
  - DB source-of-truth je rozdeleny do `enums`, `tables`, `functions`,
    `policies`, `rls`, `indexes`.
- `src/tests/gates/service-table-access.gate.test.ts`
  - services nesmi delat direct `.from("table")`; data access jde pres RPC.
- `src/tests/gates/rpc-only-data-access.gate.test.ts`
  - web/mobile/components/pages nesmi obchazet hooks/RPC pattern.
- `src/tests/db/audit-rpc-coverage.test.ts`
  - audited RPC musi zapisovat audit.
- `src/tests/db/document-av-scan-rpc-runtime.test.ts`
  - runtime DB testy bezi proti throwaway DB a overuji grants, role guardy,
    fail-closed stavove prechody.
- `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`
  - source musi mit sensitivity, legal basis, retention, consent, owner,
    namespace a approval flow.
- `docs/AISHA_FLOWBOARD_DESIGN.md`
  - systemove capability se ma objevit jako Flowboard nodes s runtime
    enforcementem gate, ne jen jako UI dekorace.

## 3. Boundary: co je core a co je parametrizace

### 3.1 Core v main Aishe

Core je invariantni mechanika, ktera plati pro vsechny zeme a klienty.

Patri do main repo:

- `packages/accounting-protocol`
  - typy, Zod schemas, canonical document model,
  - condition evaluator,
  - tax/preaccounting evaluation orchestration,
  - deterministic money rounding helpers,
  - risk scoring helpers,
  - connector mapper interfaces,
  - no DB, no fetch, no OpenAI, no country-specific defaults.
- `services/svc-accounting-intake`
  - upload/capture orchestration,
  - OCR/extract/classify/preaccount/validate route orchestration,
  - calls to governed LLM,
  - RPC-only DB writes,
  - ai_runs/audit_journal/Langfuse correlation,
  - no hardcoded CZ rules.
- `aisha/db/sql/*`
  - protocol tables,
  - processing runs,
  - pack registry,
  - pack installation per story/tenant/company,
  - ruleset versions,
  - audited RPCs.
- `packages/flowboard-core` extension or plugin provider
  - accounting node descriptors and port compatibility.
- test/gate files
  - enforce separation and RPC/audit/security invariants.

### 3.2 Parametrizace mimo core

Parametrizace je vse, co muze byt rozdilne podle zeme, roku, firmy, ucetniho
standardu nebo exportniho software.

Nepatri jako hardcoded core:

- VAT rates,
- legal references,
- income tax deductibility rules,
- reverse-charge/import/export variants,
- chart of accounts,
- account numbers,
- accounting templates,
- client-specific supplier mappings,
- export-specific Pohoda fields,
- thresholds for automatic posting,
- language-specific prompts,
- local file/MDB access details.

Tyto veci maji byt:

- versioned data pack,
- tenant/company configuration,
- connector plugin,
- or instance seed.

## 4. Navrzena vrstvena architektura

### Layer 0: AISHA platform substrate

Existujici:

- auth,
- story spine,
- source onboarding,
- audit_journal,
- ai_runs,
- integration_events,
- plugin sandbox,
- Flowboard,
- DB manager gates,
- service security.

Accounting se sem napoji, ale nebude tyto vrstvy duplikovat.

### Layer 1: accounting protocol core

Balicek: `packages/accounting-protocol`

Obsah:

- canonical document schema,
- canonical party schema,
- item schema,
- money/tax amount helpers,
- rule condition tree,
- rule effect model,
- evaluator engine,
- risk score model,
- posting proposal model,
- pack manifest schema.

Zakaz:

- zadne `CZ` defaults v core evaluatorech,
- zadne Supabase/PostgREST volani,
- zadny network access,
- zadne AI SDK volani,
- zadne klient-specific ucty.

### Layer 2: accounting pack registry

Packs jsou data-driven rozsireni, ktera core engine interpretuje.

Typy packu:

- `jurisdiction_pack`
  - napr. `cz-tax-2026`, `sk-tax-2026`, `de-vat-2026`.
- `accounting_standard_pack`
  - napr. `cz-double-entry`, `ifrs-sme`, `tax-evidence-cz`.
- `connector_pack`
  - napr. `pohoda-xml`, `isdoc`, `fio-bank`, `gmail-invoice`.
- `prompt_pack`
  - localized extraction/classification prompts, stale-safe and versioned.
- `validation_pack`
  - country/accounting-standard validation rules.

Pack manifest shape:

```json
{
  "id": "cz-tax-2026",
  "kind": "jurisdiction_pack",
  "jurisdiction": "CZ",
  "version": "2026.1.0",
  "valid_from": "2026-01-01",
  "valid_to": null,
  "requires": ["aisha.accounting-protocol>=0.1.0"],
  "legal_references": [
    { "code": "CZ:586/1992:24", "label": "Income tax deductibility base" },
    { "code": "CZ:235/2004:72", "label": "VAT deduction base" }
  ],
  "artifacts": {
    "rules": "rules.json",
    "vat_rates": "vat-rates.json",
    "templates": "templates.json",
    "fixtures": "fixtures/"
  }
}
```

### Layer 3: tenant/company configuration

Configuration is per story/company/tenant.

Examples:

- company is VAT payer,
- default jurisdiction,
- chart of accounts,
- cost centers,
- supplier aliases,
- preferred accounting software,
- auto-posting threshold,
- required approval roles,
- private/non-business ratio defaults,
- vehicle/fuel allocation rules,
- asset capitalization threshold.

This should be stored in DB and edited via admin UI/RPC, not committed into
main repo.

### Layer 4: runtime decisions

Every document run produces immutable or revisioned evidence:

- input file hash,
- OCR/extract result,
- model and prompt hash,
- pack versions,
- matched rule codes,
- posting template code,
- confidence,
- warnings,
- approval decision,
- final export payload hash.

This is the audit surface. Re-running with a new pack version creates a new
revision, not silent mutation.

## 5. Repository layout proposal

```text
packages/
  accounting-protocol/
    src/
      schemas/
      money/
      rules/
      tax/
      posting/
      packs/
      connectors/
      __tests__/

services/
  svc-accounting-intake/
    src/
      server.ts
      config.ts
      auth.ts
      postgrest.ts
      routes/
      llm/
      pipeline/
      __tests__/

aisha/db/sql/
  enums/accounting_*.sql
  tables/accounting_*.sql
  functions/accounting_*.sql
  policies/accounting_*.sql
  rls/accounting_*.sql
  indexes/accounting_*.sql

docs/integrations/
  KRMIC_ACCOUNTING_PROTOCOL_BLUEPRINT.md
  KRMIC_ACCOUNTING_SYSTEM_EXTENSION_PLAN.md

src/tests/gates/
  accounting-extension-boundary.gate.test.ts
  accounting-pack-contract.gate.test.ts

src/tests/db/
  accounting-document-rpc-runtime.test.ts
  accounting-pack-installation-rpc-runtime.test.ts
  accounting-preaccounting-rpc-runtime.test.ts
```

## 6. DB model

### 6.1 Core protocol tables

- `accounting_documents`
  - story-bound document header.
- `accounting_document_files`
  - storage object pointer, sha256, mime, AV/preflight state.
- `accounting_document_items`
  - normalized line items.
- `accounting_processing_runs`
  - stage-level run state for capture/preflight/OCR/extract/classify/etc.
- `accounting_extractions`
  - OCR text hash, extracted JSON, model, prompt hash, confidence.
- `accounting_classifications`
  - category, applied rules, AI output, warnings.
- `accounting_tax_assessments`
  - tax/VAT deductibility split, rule evidence.
- `accounting_vat_records`
  - VAT filing/control-statement materialization.
- `accounting_posting_suggestions`
  - proposed journal lines and approval state.
- `accounting_exports`
  - export target, payload hash, external status.

### 6.2 Pack/parameter tables

- `accounting_pack_catalog`
  - pack id, kind, jurisdiction, version, status, manifest hash.
- `accounting_pack_versions`
  - artifact URL/hash or embedded JSONB, reviewed_by, published_at.
- `accounting_pack_installations`
  - story/company/tenant binding, enabled version, effective dates.
- `accounting_rule_sets`
  - logical group of rules per pack and standard.
- `accounting_rules`
  - condition tree and effects, versioned.
- `accounting_vat_rate_catalog`
  - jurisdiction, rate code, percentage, valid_from/to.
- `accounting_posting_templates`
  - predicates -> debit/credit/VAT/dimensions.
- `accounting_chart_accounts`
  - tenant/company chart of accounts, source mapping.
- `accounting_counterparty_mappings`
  - supplier/customer aliases and preferred templates.

### 6.3 RPC patterns

Client/user RPC:

- `create_accounting_document_from_upload_audited`
- `list_my_accounting_documents_audited`
- `get_accounting_document_audited`
- `approve_accounting_posting_suggestion_audited`
- `reject_accounting_posting_suggestion_audited`

Service RPC:

- `record_accounting_integration_event_service`
- `record_accounting_file_preflight_service`
- `upsert_accounting_processing_run_service`
- `upsert_accounting_ocr_result_service`
- `upsert_accounting_extraction_service`
- `upsert_accounting_classification_service`
- `upsert_accounting_tax_assessment_service`
- `upsert_accounting_posting_suggestions_service`
- `persist_accounting_export_service`

Admin/pack RPC:

- `submit_accounting_pack_admin`
- `publish_accounting_pack_version_admin`
- `install_accounting_pack_for_story_admin`
- `upsert_accounting_rule_admin`
- `upsert_accounting_posting_template_admin`
- `replay_accounting_document_pipeline_admin`

Rules:

- user RPC: `SECURITY DEFINER`, auth/story guard, audit.
- service RPC: service role only, no user trust.
- admin RPC: `is_admin_or_staff()` guard.
- all audited RPC names should include `_audited` where user-visible.

## 7. Service architecture

### 7.1 `svc-accounting-intake`

Responsibilities:

- receive upload/intake events,
- call existing file preflight/AV pattern,
- register idempotent integration event,
- run OCR/extract/classify/validate pipeline,
- invoke `@aisha/accounting-protocol`,
- persist only through RPC,
- emit `ai_runs`, audit, metrics and trace IDs.

Do not:

- store raw document text in logs,
- access DB tables directly,
- embed CZ rules in code,
- hardcode supplier/account mappings,
- bypass source onboarding for user files.

### 7.2 Existing service reuse

- `svc-fio-bank`
  - should provide bank transaction input and matching candidate data.
  - Long-term: move reusable parser/contracts into `accounting-protocol` or
    `accounting-connector-fio`.
- `storage-auth`
  - reuse signed upload/preflight concepts.
- `svc-plugin-system`
  - use for optional connector/export plugins and third-party pack delivery.
- `svc-source-broker`
  - use source onboarding semantics for external accounting sources.
- `svc-ai-chat` / Flowboard runtime
  - use accounting nodes for automation composition, not as the accounting
    domain engine itself.

## 8. Flowboard integration

Accounting capability should appear as Flowboard descriptors:

- `trigger.accounting_mobile_capture`
- `trigger.accounting_email_inbound`
- `trigger.accounting_connector_event`
- `action.accounting_ocr`
- `action.accounting_extract`
- `action.accounting_classify`
- `action.accounting_tax_evaluate`
- `action.accounting_preaccount`
- `gate.accounting_compliance`
- `action.accounting_export`

Rules:

- accounting document port should reuse existing `document` port first.
- if too generic, add `accounting_document` only after evidence that generic
  document port causes unsafe connections.
- `gate.accounting_compliance` must be sandbox-only for sensitive/high-risk
  flows.
- export nodes are egress and require gate when data is restricted/confidential.

## 9. Pack governance

### 9.1 Pack lifecycle

```text
draft -> validated -> reviewed -> canary -> active -> deprecated -> archived
```

Required checks before active:

- manifest schema valid,
- no duplicate rule codes in active scope,
- no overlapping VAT rate periods for same rate code,
- all legal refs present and normalized,
- all templates reference existing chart-account roles, not tenant accounts,
- fixtures pass,
- reviewer recorded,
- audit_journal entry written.

### 9.2 Rule versioning

Rules must be immutable after publication.

Changing a rule creates:

- new rule version,
- new pack version,
- new ruleset fingerprint,
- optional replay/backfill job.

Document decisions store:

- pack id,
- pack version,
- ruleset fingerprint,
- matched rule codes,
- evaluator version.

### 9.3 Tenant overrides

Tenant override can tune:

- thresholds,
- supplier mappings,
- account numbers,
- approval requirements,
- private-use coefficients.

Tenant override cannot silently rewrite published legal rule semantics. If a
tenant needs a different legal interpretation, it becomes a local custom rule
with explicit `source = tenant_override`, reviewer and audit entry.

## 10. Test strategy

### 10.1 Package unit tests

Location: `packages/accounting-protocol/src/__tests__`

Tests:

- money rounding:
  - decimal strings with spaces/commas,
  - VAT from gross,
  - negative/credit-note values,
  - currency precision.
- condition evaluator:
  - dot path,
  - regex invalid pattern fail-safe,
  - numeric comparisons,
  - AND/OR trees,
  - null checks.
- tax evaluator:
  - no matching rule -> AI fallback marked as lower confidence,
  - first matching priority wins,
  - inactive rules ignored,
  - VAT pct forced 0 for zero/non-VAT rate,
  - income/VAT split sums exactly to net/VAT amounts.
- posting evaluator:
  - template match by document kind/category/supplier,
  - chart account role -> tenant account resolution,
  - unknown account -> review_needed,
  - VAT lines separated from base lines.
- pack schema:
  - manifest required fields,
  - semver/version format,
  - valid_from/to,
  - legal reference format,
  - no executable code in data pack.

Command:

```bash
npm --prefix packages/accounting-protocol test
npm --prefix packages/accounting-protocol run type-check
```

### 10.2 Golden fixtures

Location:

```text
packages/accounting-protocol/src/__fixtures__/
  cz/
    invoice-services-standard-vat.json
    invoice-material-reduced-vat.json
    receipt-cash.json
    representation-nondeductible.json
    penalty-nondeductible.json
    fuel-mixed-use.json
    eu-reverse-charge.json
    import-customs.json
    credit-note.json
    asset-purchase-review.json
```

Each fixture asserts:

- normalized document shape,
- tax assessment,
- warning flags,
- risk level,
- posting suggestion,
- required review state,
- exact pack/rule codes.

### 10.3 Pack contract tests

Location: `src/tests/gates/accounting-pack-contract.gate.test.ts`

Static checks:

- every pack has manifest,
- every active pack has fixtures,
- no active pack without legal refs,
- no duplicate active rule codes,
- no overlapping effective periods,
- no tenant account numbers in generic pack templates,
- every pack has reviewer metadata before active.

### 10.4 DB source-of-truth tests

Static:

```bash
npm run func:validate
npm run db-mgr:lint
npm run db-mgr:source
npm run db-mgr:access -- --static
npm run db-mgr:flow -- --static
npm run test:gates -- src/tests/gates/accounting-extension-boundary.gate.test.ts
```

Checks:

- all `accounting_*` tables have RLS,
- service/user/admin RPC grants are correct,
- user-visible `_audited` functions write audit,
- no direct `.from()` in services,
- no `.select("*")`,
- no SECURITY DEFINER without `SET search_path`,
- no service role escalation from client RPC,
- pack tables cannot be modified by normal users.

Runtime DB tests:

```bash
npm run test:db -- src/tests/db/accounting-*.test.ts
```

Tests:

- upload RPC creates document for authenticated user only,
- another user cannot read it,
- service role can write processing result,
- authenticated user cannot call service RPC,
- admin can install pack, normal user cannot,
- approving suggestion writes audit and state transition,
- replay creates new revision, does not mutate prior evidence,
- idempotency key prevents duplicate document from same source event.

### 10.5 Service tests

Location: `services/svc-accounting-intake/src/__tests__`

Tests:

- auth:
  - missing token rejected,
  - wrong role rejected for admin endpoints,
  - service token required for worker endpoints.
- RPC-only:
  - mocked `rpcService` called with expected function names,
  - no direct DB client imports.
- upload/intake:
  - MIME allowlist,
  - max size,
  - sha256/idempotency,
  - preflight fail-closed.
- pipeline:
  - OCR skipped/blocked according to config,
  - extraction parse failure -> review_needed,
  - low confidence -> review_needed,
  - pack missing -> blocked with actionable error,
  - no raw OCR text in logs.
- LLM/cost:
  - cost guardrail blocks,
  - prompt hash stored,
  - ai_run started/finished/failed.
- connector:
  - Pohoda/Fio normalized records accepted,
  - invalid connector payload rejected by Zod.

Command:

```bash
npm --prefix services/svc-accounting-intake test
npm --prefix services/svc-accounting-intake run type-check
```

### 10.6 Flowboard tests

Add package/core tests:

- descriptors parse with `flowNodeDescriptorSchema`,
- ports connect only document -> document/main where intended,
- egress export without compliance gate fails for restricted/confidential,
- sandbox engine selected for high-risk accounting flow,
- n8n compile rejected for compliance-gated tax flow until runtime gate exists.

Command:

```bash
npm run test:flowboard:fullenv
```

### 10.7 E2E/smoke tests

MVP smoke:

1. user uploads invoice fixture,
2. preflight clean,
3. OCR mocked,
4. extract mocked,
5. CZ pack applies,
6. posting suggestion produced,
7. high confidence service invoice auto-suggests but not auto-posts,
8. user approves,
9. export payload generated,
10. audit_journal and ai_runs are correlated.

Command shape:

```bash
npm run test:e2e:local -- e2e/accounting-intake.spec.ts
```

## 11. Rollout plan

### Phase A: design lock

Deliverables:

- this doc in `docs/integrations`,
- final naming decision,
- table/RPC naming convention,
- pack manifest schema decision.

Exit criteria:

- architecture accepted,
- no open boundary ambiguity between core vs pack vs tenant config.

### Phase B: pure protocol package

Deliverables:

- `packages/accounting-protocol`,
- ported Krmic tax-engine pure modules,
- Zod schemas,
- pack manifest schema,
- golden fixtures,
- unit tests.

Exit criteria:

- package type-check clean,
- unit tests pass,
- no DB/network imports,
- no hardcoded jurisdiction defaults in core.

### Phase C: DB SoT foundation

Deliverables:

- enums/tables/RLS/indexes,
- audited RPCs,
- pack registry and installation tables,
- processing run tables.

Exit criteria:

- `func:validate` clean,
- `db-mgr:*` clean,
- runtime DB tests pass in throwaway DB.

### Phase D: service skeleton

Deliverables:

- `services/svc-accounting-intake`,
- Fastify/Otel/security/metrics,
- RPC helpers,
- routes for intake and pipeline stages,
- mocked OCR/extract/classify execution.

Exit criteria:

- service unit tests pass,
- service table-access gate passes,
- no raw content logs.

### Phase E: CZ MVP pack

Deliverables:

- first `cz-tax-2026` jurisdiction pack,
- first `cz-double-entry` accounting protocol pack,
- templates for received invoices/receipts,
- fixtures.

Exit criteria:

- pack gate passes,
- golden fixtures pass,
- legal refs normalized.

### Phase F: Flowboard + mobile

Deliverables:

- accounting node descriptors,
- mobile capture route integration,
- progress UI over processing runs,
- compliance gate runtime behavior.

Exit criteria:

- flowboard tests pass,
- mobile smoke passes,
- high-risk flow cannot bypass review gate.

### Phase G: connectors/export

Deliverables:

- Fio matching path,
- Pohoda mapper port,
- export payload generation,
- ISDOC/CSV/JSON export foundation.

Exit criteria:

- connector unit tests,
- export golden payload tests,
- idempotent integration events.

## 12. Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| CZ rules accidentally hardcoded into core | Blocks multi-country support | gate: no jurisdiction defaults in `accounting-protocol` core except test fixtures |
| AI treated as legal authority | Wrong accounting/tax decisions | rule/template provenance required; AI only proposes/scored fallback |
| Direct DB access in service | Bypasses RLS/audit | existing service-table-access gate + new accounting gate |
| Pack changes mutate historical decisions | Audit failure | immutable pack versions and stored ruleset fingerprint |
| Tenant override silently changes legal semantics | Compliance risk | overrides are separate custom rules with reviewer/audit |
| Raw OCR/PII logged | Data leak | no raw content log tests and structured metadata only |
| Export posts without approval | Financial risk | approval gate before `posted/exported` state |
| Multi-engine Flowboard bypasses gate in n8n | Governance risk | high-risk/restricted accounting flows sandbox-only |
| Pohoda MDB cloud dependency | Deployment failure | local/agent-side adapter emits normalized payloads |

## 13. Concrete implementation order

1. Create `packages/accounting-protocol`.
2. Port pure Krmic modules:
   - `tax-engine/types`,
   - `conditions`,
   - `evaluator`,
   - `vat-populator`.
3. Add protocol schemas:
   - document,
   - party,
   - item,
   - rule,
   - pack manifest,
   - posting suggestion.
4. Add unit/golden tests.
5. Add DB SoT skeleton and RPC contracts.
6. Add DB gate tests.
7. Add `svc-accounting-intake` skeleton.
8. Wire first mocked pipeline.
9. Add CZ MVP pack as data pack.
10. Add Flowboard descriptors and compliance gate tests.
11. Add mobile capture integration.
12. Add connector/export pack work.

## 14. First PR scope recommendation

Keep first PR small enough to be safe:

- Add `packages/accounting-protocol` only.
- Include pack manifest schema but no DB.
- Port pure evaluator and tests.
- Add fixtures for 5 cases:
  - service invoice,
  - representation,
  - penalty,
  - mixed-use fuel,
  - credit note.
- Add doc links to this plan.

Do not include service/DB/Flowboard in the first PR unless package tests are
green. This avoids mixing protocol correctness with platform plumbing.
