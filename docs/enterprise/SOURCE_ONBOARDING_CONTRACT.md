# Source Onboarding Contract

> **Platí pro:** všechny nové datové zdroje integrované do AISHA platformy.  
> **Enforce point:** `enterprise-source-hosting.gate.test.ts`  
> **Závislosti:** Single SoT princip, RPC-only architektura, Audit-first standard.

---

## 1. Povinná klasifikace zdroje

Před aktivací MUSÍ každý zdroj obdržet klasifikaci ve všech 4 dimenzích:

| Dimenze | Hodnoty | Popis |
|---------|---------|-------|
| **source_type** | `internal` \| `partner` \| `external` \| `user_provided` | Původ a vlastnictví dat |
| **data_sensitivity** | `public` \| `internal` \| `restricted` \| `confidential` | Klasifikace citlivosti |
| **retention_class** | `ephemeral` \| `short_term` \| `long_term` \| `permanent` | Retenční kategorie |
| **legal_basis** | `consent` \| `contract` \| `legitimate_interest` \| `legal_obligation` | GDPR právní základ |

Klasifikace se ukládá do `agent_knowledge_sources.config` jako JSONB metadata, nikdy jako volný text.

---

## 2. Datová citlivost a přístupová pravidla

| Sensitivity Class | Přístup | Audit | Šifrování | Maximální retence |
|-------------------|---------|-------|-----------|-------------------|
| `public` | anon + authenticated | log_only | přenášeno TLS | neomezeno |
| `internal` | authenticated | info | přenášeno TLS | 2 roky |
| `restricted` | authenticated + explicitní role | warning | TLS + at-rest | 1 rok |
| `confidential` | service_role nebo consent-gated | critical + full audit | TLS + at-rest + SECURITY DEFINER | 6 měsíců |

---

## 3. Ownership a odpovědnost

Každý zdroj musí mít definovaného vlastníka:

```jsonb
{
  "owner_user_id": "<uuid>",
  "owner_team": "<team_slug>",
  "technical_contact": "<email>",
  "legal_contact": "<email_or_null>"
}
```

Vlastník odpovídá za:
- platnost klasifikace (revize minimálně 1× ročně),
- správnost consent modelu,
- oznámení změn při re-klasifikaci.

---

## 4. Consent model

Pro `user_provided` a `partner` zdroje musí existovat explicitní souhlas:

| Scénář | Požadavek |
|--------|-----------|
| Upload uživatele | Explicitní UI consent před ingestion, zaznamenaný do `audit_journal` |
| Partner data feed | Písemná DPIA nebo DPA (Data Processing Agreement) |
| Third-party API | Smluvní základ + záznam v `agent_knowledge_sources.config.legal_basis` |
| Interní systémová data | Legitimate interest + dokumentace v onboarding záznamu |

Consent záznamy se ukládají přes `audit_journal` s `action = 'SOURCE_CONSENT_GRANTED'` a `metadata.source_id`.

---

## 5. Retenční politika

| Retention Class | Max. délka | Archivace | Automatické mazání |
|-----------------|------------|-----------|-------------------|
| `ephemeral` | 24h | ne | ano (scheduled job) |
| `short_term` | 90 dnů | ne | ano |
| `long_term` | 2 roky | ano (before delete) | ano |
| `permanent` | bez omezení | — | pouze manuálně + audit |

Mazání VŽDY přes `DELETE CASCADE` nebo explicitní deactivation → není přípustné mazat data mimo RPC vrstvu.

---

## 6. Multi-tenant a namespace izolace

Každý zdroj musí být izolován:

```
namespace = "<tenant_slug>/<source_slug>"
```

Pravidla izolace:
- **ACL**: retrieval scope je omezen na namespace; cross-namespace query vyžaduje explicitní `ACL_OVERRIDE` approval.
- **Quota**: každý namespace má `max_items`, `max_size_mb`, `max_queries_per_day` — konfigurováno v `agent_knowledge_sources.config.quota`.
- **Rate limiting**: API rate limit na `api_rate_limits` tabulce per namespace.
- **RLS**: každý zdroj musí mít RLS policy, která omezuje přístup na namespace vlastníka nebo expicitně sdílené role.

---

## 7. Bring-Your-Own-Data (BYOD) governance flow

Postup pro onboarding nového externího zdroje:

```
krok 1: UPLOAD/CONNECT
  - Uživatel/partner dodá soubor nebo konfiguraci připojení
  - Validace formátu + sensitivity scan (PII detection)

krok 2: VALIDATION
  - Automatická klasifikace: source_type, data_sensitivity, legal_basis návrh
  - Compliance check: GDPR, data minimization, retenční kategorie
  - Výsledek: PASS / FAIL_WITH_ISSUES / BLOCKED

krok 3: INDEXING POLICY
  - Určení chunk strategie, embedding modelu, freshness SLA
  - Konfigurace v agent_knowledge_sources.config

krok 4: APPROVAL (dle rizika)
  - public/internal + low risk → auto-approve
  - restricted/confidential nebo high risk → Dirigent approval required
  - legal_basis = consent → consent grant audit before proceed

krok 5: ACTIVATION
  - source_type classified → is_active = true
  - První sync přes WF_KB_RAGNAROK_SYNC.json
  - INSERT INTO audit_journal(action = 'SOURCE_ACTIVATED', metadata.source_id)
```

BYOD flow NESMÍ obcházet approval step pro restricted/confidential zdroje.

---

## 8. Datové produkty přes RPC contracts

Nové aplikace nad onboardovanými zdroji MUSÍ používat RPC contract pattern:

```sql
-- SPRÁVNĚ: data product přes RPC
CALL/SELECT * FROM get_source_data_product(p_namespace, p_query_context)

-- ZAKÁZÁNO: přímé dotazy přes dashboard ad-hoc logiku
SELECT * FROM knowledge_items WHERE source_id = '...'
-- Toto je violation RPC-only principu!
```

RPC funkce pro source přístup MUSÍ:
- mít `SECURITY DEFINER` + `SET search_path TO 'public'`
- ověřit namespace ACL před vrácením dat
- logovat přístup do `audit_journal` pro `confidential`/`restricted` zdroje

---

## 9. Checklist: aktivace nového zdroje

Před `is_active = true` musí být splněno:

- [ ] Klasifikace: source_type, data_sensitivity, retention_class, legal_basis
- [ ] Ownership: owner_user_id, owner_team, technical_contact
- [ ] Consent: záznamy v audit_journal nebo DPA dokumentace
- [ ] Namespace: isolated namespace definován, quota nakonfigurována
- [ ] RLS: RLS policy existuje a testována
- [ ] Approval: pro restricted/confidential proběhl Dirigent approval
- [ ] First sync: WF_KB_RAGNAROK_SYNC.json proběhl bez chyby
- [ ] Audit start: SOURCE_ACTIVATED záznam v audit_journal

---

## 10. Změna klasifikace

Re-klasifikace existujícího zdroje (snížení citlivosti nebo změna právního základu) vyžaduje:

1. Nový approval průchod (HIGH risk minimum)
2. Záznamy v audit_journal: `SOURCE_RECLASSIFIED`
3. Re-review retention policy (může zkrátit max. dobu)
4. Notifikace vlastníka + legal_contact
