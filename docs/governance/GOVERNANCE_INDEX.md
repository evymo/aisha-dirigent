# Governance Index

Tento dokument je centrálni mapa principle -> enforce point -> owner -> test.

## Principy a enforce points

### 1) Single Source of Truth
- Enforce point: `supabase/sql/` + `supabase/migrations/`
- Runtime boundary: API pristup pouze pres `supabase.rpc()`
- Owner: platform/backend
- Gate tests:
  - `src/tests/gates/rpc-only-data-access.gate.test.ts`
  - `src/tests/gates/layer-boundary.gate.test.ts`

### 2) Retrieval-First
- Enforce point: `compose_context`, `route_task`, `search_knowledge`
- Runtime boundary: inference bez retrieval je violation
- Owner: ai-platform
- Gate tests:
  - `src/tests/gates/retrieval-first.gate.test.ts`

### 3) Risk-Governed Autonomy
- Enforce point: approval gate + autonomy rules
- Runtime boundary: high risk = human-in-the-loop
- Owner: dirigent/orchestration
- Gate tests:
  - `src/tests/gates/approval-explainability.gate.test.ts`
  - `src/tests/gates/agent-role-contract.gate.test.ts`

### 4) Auditability by Default
- Enforce point: `audit_journal`, trace correlation, report artifacts
- Runtime boundary: kriticke zmeny musi produkovat audit evidence
- Owner: security/compliance
- Gate tests:
  - `src/tests/gates/audit-fields-completeness.gate.test.ts`
  - `src/tests/gates/cicd-governance.gate.test.ts`

### 5) Release Operations Safety
- Enforce point: CI governance gate + release evidence artifact
- Runtime boundary: deploy blokovan bez quality/governance signalu
- Owner: devops/sre
- Gate tests:
  - `src/tests/gates/cicd-governance.gate.test.ts`
  - `src/tests/gates/release-operations-sre.gate.test.ts`

### 6) Enterprise Source Hosting Safety
- Enforce point: source onboarding contract + BYOD governance flow + namespace ACL
- Runtime boundary: kazdy datovy zdroj musi projit klasifikaci, consent modelem a approval pred aktivaci
- Owner: platform/backend + security/compliance
- Gate tests:
  - `src/tests/gates/enterprise-source-hosting.gate.test.ts`
  - `src/tests/gates/rpc-only-data-access.gate.test.ts`
- Dokumentace:
  - `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`
  - `docs/enterprise/SOURCE_ADAPTER_PATTERN.md`

### 7) Spend & Risk Scope Governance (`scope_type` axis)
- Enforce point: `fn_check_and_consume_ai_budget_audited` (ai_budget), `fn_authorize_task_spend` (ai_spend_policies), `fn_admit_clow` (ai_risk_policies)
- Runtime boundary: the ENFORCED governance axis is **story/context scope** (plus `global`) — multi-instance = per-context/knowledgebase, so the instance boundary IS the story/context. The `partner` + `agent` scope_type values are a **RESERVED forward-looking seam**: the table CHECKs accept them so policies can be authored ahead of reader wiring, but no enforcer reads them yet and nothing writes them → INTENTIONALLY non-binding (a recorded seam, not a fail-open). Wiring partner/agent enforcement is a separate Aisha-driven dev story; until then the asymmetry is documented in each table SoT via an `@scope-reserved:` marker.
- Owner: dirigent/orchestration + platform/backend
- Gate tests:
  - `src/tests/gates/scope-type-write-read-parity.gate.test.ts` (every writable `scope_type` must be enforced by its reader fn OR declared `@scope-reserved:` in the table SoT — a future silently-unenforced scope is caught at PR time)
  - `src/tests/gates/ai-spend-governance.gate.test.ts`

## Ownership matrix
- platform/backend: SQL SoT, RPC contracts, migrations, enterprise source contracts
- ai-platform: routing, context composition, retrieval quality
- security/compliance: audit trail, access analysis, risk controls, source consent
- devops/sre: CI policy, deploy safety, release evidence, runbooky
- docs/governance: handbooky, operationalni standardy

## Change policy
- Kazda zmena, ktera zasahuje risk, security, DB nebo AI orchestration, musi:
  - projit gate testy,
  - zanechat auditovatelny artifact,
  - mit aktualizovanou dokumentaci v `docs/governance/` nebo `docs/operations/`.
