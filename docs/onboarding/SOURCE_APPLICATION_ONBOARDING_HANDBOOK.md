# Source Application Onboarding Handbook

Tento handbook popisuje jak onboardovat novou aplikaci nad externim nebo internim datovym zdrojem bez poruseni principu Single Source of Truth, Retrieval-First a Auditability by Default.

## 1. Scope handbooku

Platnost:
- nove source aplikace napojene na knowledge nebo operational data,
- partner/external/user_provided datove zdroje,
- workflow ingest -> index -> retrieval -> data product.

Mimo scope:
- ciste UI redesigny bez noveho datoveho zdroje,
- interni refaktoring bez zmeny source governance.

## 2. Required references

Pred onboardovanim MUSI tym projit:
- docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md
- docs/enterprise/SOURCE_ADAPTER_PATTERN.md
- docs/governance/GOVERNANCE_INDEX.md
- docs/knowledge/KNOWLEDGE_LOOP_SLA.md

## 3. Role model

- Requestor (product/partner): doda business context, legal basis a ownership.
- Platform/backend: implementuje RPC contracts, ACL, namespace izolaci.
- Security/compliance: schvaluje consent model a sensitivity klasifikaci.
- Dirigent/operations: schvaluje risk level, escalation policy, aktivaci.

Zadny krok nesmi byt uzavren bez urceneho ownera.

## 4. Onboarding flow (operacni postup)

1. Discovery
- Definuj source_type, data_sensitivity, retention_class, legal_basis.
- Definuj namespace schema: tenant_slug/source_slug.
- Definuj quota: max_items, max_size_mb, max_queries_per_day.

2. Contract setup
- Vypln source onboarding kontrakt.
- Potvrd ownership (owner_user_id, owner_team, technical_contact).
- Potvrd consent model nebo pravni titul.

3. Adapter setup
- Implementuj nebo nakonfiguruj source adapter podle SOURCE_ADAPTER_PATTERN.
- Zapni validation pipeline: schema, PII scan, sensitivity enforcement.
- Pridavej provenance metadata na kazdy chunk.

4. Governance checks
- Pro restricted/confidential zdroje vyzaduj approval pred aktivaci.
- Otestuj namespace izolaci a ACL boundaries.
- Potvrd audit events pro onboarding kroky.

5. Activation
- Aktivuj zdroj az po PASS validation + PASS approval + PASS first sync.
- Zapis SOURCE_ACTIVATED do audit_journal.
- Spust first sync pres KB workflow.

6. Post-activation
- Sleduj retrieval utility metriky podle KNOWLEDGE_LOOP_SLA.
- Sleduj quota a rate-limit alerty.
- Plan reindex policy pri schema driftu.

## 5. Mandatory technical guardrails

- Data pristup pouze pres RPC contracts.
- Zadny direct table access pro source data products.
- Zadne cross-tenant retrieval bez explicitni ACL override approval.
- Zadne sensitive data v logach.
- RLS a namespace boundary musi byt testovatelne.

## 6. Release readiness checklist

Pred release source aplikace:
- [ ] Source klasifikace kompletni (4 dimenze)
- [ ] Ownership a legal basis potvrzeny
- [ ] Consent flow zaznamenan v audit_journal
- [ ] Adapter pipeline validuje schema + PII + sensitivity
- [ ] Namespace ACL a quota enforceovany
- [ ] Data product pres RPC contract existuje
- [ ] Relevantni gate testy pass
- [ ] Build pass

## 7. Incident handling for source applications

Typicke incidenty:
- ACL leak risk
- PII detected in chunk
- quota exceeded loop
- failed first sync

Reakce:
1. suspend source (is_active = false),
2. audit event SOURCE_SUSPENDED,
3. incident report do operations,
4. fix + revalidation,
5. controlled reactivation s approval.

## 8. Evidence package for source onboarding

Minimalni release evidence:
- gate test report,
- approval evidence (pokud required),
- first sync result,
- audit snapshot (SOURCE_VALIDATED, SOURCE_APPROVED, SOURCE_ACTIVATED),
- commit SHA + datum aktivace.
