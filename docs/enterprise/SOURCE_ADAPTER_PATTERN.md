# Source Adapter Pattern

> **Platí pro:** implementátory nových datových source adapterů pro AISHA Ragnarok pipeline.  
> **Enforce point:** `enterprise-source-hosting.gate.test.ts`  
> **Závislosti:** SOURCE_ONBOARDING_CONTRACT.md, RPC-only architektura, Ragnarok ingest API.

---

## 1. Ingest Adapter Interface

Každý source adapter musí implementovat standardní ingest rozhraní:

```typescript
interface SourceAdapter {
  /** Identifikátor adaptéru — namespace/slug */
  readonly sourceId: string;
  /** Data sensitivity class z onboarding contract */
  readonly sensitivityClass: "public" | "internal" | "restricted" | "confidential";

  /** 
   * Načte data ze zdroje a vrátí normalizované chunky.
   * NESMÍ volat žádné DB tabulky přímo — pouze přes supabase.rpc().
   */
  fetch(params: IngestParams): Promise<RawChunk[]>;

  /**
   * Validuje chunk před indexací.
   * Musí detekovat PII a zablokovat confidential data bez consent.
   */
  validate(chunk: RawChunk): ValidationResult;

  /**
   * Normalizuje data do standardního formátu pro Ragnarok.
   */
  normalize(chunk: RawChunk): NormalizedChunk;
}
```

Adaptér NESMÍ:
- přistupovat přímo k DB tabulkám (`.from()` je zakázáno)
- logovat raw content chunků (PII risk)
- ignorovat ValidationResult.BLOCKED nebo ValidationResult.PII_DETECTED

---

## 2. Normalization Pipeline

Každý chunk procházející pipeline musí projít těmito kroky v pořadí:

```
[RAW_DATA]
    │
    ▼
[1. SCHEMA_VALIDATION]          — Zod schema check, required fields
    │
    ▼
[2. PII_SCAN]                  — detekce osobních údajů (regex + pattern matching)
    │
    ▼
[3. SENSITIVITY_ENFORCEMENT]   — ověření, zda citlivost chunku odpovídá klasifikaci zdroje
    │
    ▼
[4. METADATA_TAGGING]          — přidání provenance, namespace, timestamp, source_id
    │
    ▼
[5. CHUNKING]                  — split podle chunk-splitting pravidel (chunk-splitting.gate.test.ts)
    │
    ▼
[6. EMBEDDING_PREP]            — text cleaning, language detection
    │
    ▼
[NORMALIZED_CHUNK → Ragnarok]
```

Každý krok musí být zaznamenán v pipeline metadata pro debugování.

---

## 3. Metadata tagging

Každý normalizovaný chunk MUSÍ mít tyto provenance metadata:

```jsonb
{
  "source_id": "<uuid>",
  "namespace": "<tenant_slug>/<source_slug>",
  "source_type": "internal|partner|external|user_provided",
  "data_sensitivity": "public|internal|restricted|confidential",
  "ingested_at": "<ISO8601>",
  "schema_version": "1.0",
  "language": "cs|en|...",
  "provenance": {
    "origin_url": "<url_or_null>",
    "origin_file": "<filename_or_null>",
    "chunk_index": 0,
    "total_chunks": 10
  },
  "retention_expires_at": "<ISO8601_or_null>"
}
```

Metadata jsou uložena v Ragnarok jako document metadata — nikdy jako součást vektorového embeddings.

---

## 4. Provenance Tracking

Provenance tracking zajišťuje zpětnou dohledatelnost každého chunk → zdroj:

| Úroveň | Co sledujeme | Kde uloženo |
|--------|-------------|-------------|
| Source → Chunk | source_id, chunk_index | Ragnarok metadata |
| Chunk → AI Response | trace_id z Langfuse | ai_trace_events |
| Ingest event | who/when/what/result | audit_journal |
| Re-index | trigger reason, delta | audit_journal + ai_runs |

**Pravidlo:** Pokud chunk ovlivnil AI odpověď, trace_id musí být dohledatelný přes `ai_trace_events.langfuse_trace_id`. Bez provenance = compliance violation.

---

## 5. Multi-tenant Namespace Izolace

Ragnarok retrieval MUSÍ respektovat namespace scope:

```typescript
// SPRÁVNĚ: retrieval s namespace scope
const result = await supabase.rpc("search_ragnarok", {
  p_query: userQuery,
  p_namespace: "tenant_a/docs",          // izolace na namespace
  p_max_results: 10
});

// ZAKÁZÁNO: retrieval bez namespace scope → cross-tenant data leak!
const result = await supabase.rpc("search_ragnarok", {
  p_query: userQuery
  // chybí p_namespace → vrátí data ze všech namespaces!
});
```

Namespace scope je enforceován na Ragnarok API vrstvě. Kdykoli je namespace vynechán a zdroj je `restricted`/`confidential`, volání MUSÍ selhat s 403.

---

## 6. Quota a Rate Limiting

Každý namespace má kvótu definovanou v `agent_knowledge_sources.config.quota`:

```jsonb
{
  "quota": {
    "max_items": 10000,
    "max_size_mb": 500,
    "max_queries_per_day": 50000,
    "max_ingest_per_hour": 1000
  }
}
```

Překročení kvóty:
- `max_queries_per_day` → HTTP 429, záznám do `api_rate_limits`
- `max_items` / `max_size_mb` → odmítnutí ingestu s error `QUOTA_EXCEEDED`
- `max_ingest_per_hour` → circuit breaker, zpráva vlastníkovi

---

## 7. Data Products přes RPC Contracts

Nové aplikace sbírají data z onboardovaných sources VÝHRADNĚ přes RPC data products:

### Vzor: Read Data Product
```sql
CREATE OR REPLACE FUNCTION public.get_source_data_product(
  p_namespace text,
  p_query_context jsonb DEFAULT '{}'
)
RETURNS TABLE (
  chunk_id    text,
  content     text,
  score       float8,
  metadata    jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 1. Ověř namespace ACL
  IF NOT EXISTS (
    SELECT 1 FROM agent_knowledge_sources
    WHERE config->>'namespace' = p_namespace
      AND is_active = true
      AND (
        -- public/internal: authenticated může číst
        config->>'data_sensitivity' IN ('public', 'internal')
        -- restricted/confidential: ověř roli nebo consent
        OR has_role(auth.uid(), 'admin')
      )
  ) THEN
    RAISE EXCEPTION 'Access denied to namespace: %', p_namespace;
  END IF;

  -- 2. Volej Ragnarok přes edge function (přes HTTP nebo db_link)
  -- (implementace závisí na deployment topologii)

  -- 3. Audit pro restricted+ sensitivity
  INSERT INTO audit_journal(user_id, action, metadata)
  SELECT auth.uid(), 'SOURCE_DATA_ACCESSED',
    jsonb_build_object('namespace', p_namespace, 'sensitivity', config->>'data_sensitivity')
  FROM agent_knowledge_sources
  WHERE config->>'namespace' = p_namespace
    AND config->>'data_sensitivity' IN ('restricted', 'confidential');
END;
$$;

REVOKE ALL ON FUNCTION public.get_source_data_product(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_source_data_product(text, jsonb) TO authenticated;
```

### Zakázané vzory
```typescript
// ZAKÁZÁNO: přímý dotaz přes ORM/from() na knowledge_items
const { data } = await supabase
  .from("knowledge_items")
  .select("*")
  .eq("source_id", sourceId);  // ← violation RPC-only + namespace izolace!

// ZAKÁZÁNO: GET request přímo na Ragnarok API bez namespace scope
fetch("http://ragnarok:9696/search", { body: { query: "..." } }); // ← missing namespace!
```

---

## 8. Source Lifecycle States

```
DRAFT → VALIDATING → PENDING_APPROVAL → APPROVED → ACTIVE → SUSPENDED → ARCHIVED
```

| Přechod | Trigger | Podmínka | Audit |
|---------|---------|----------|-------|
| DRAFT → VALIDATING | Uživatel spustí onboarding flow | — | SOURCE_VALIDATION_STARTED |
| VALIDATING → PENDING_APPROVAL | Validation PASS | Sensitivity classified | SOURCE_VALIDATED |
| VALIDATING → DRAFT | Validation FAIL | Issues to resolve | SOURCE_VALIDATION_FAILED |
| PENDING_APPROVAL → APPROVED | Dirigent approval (pro restricted+) nebo auto-approve | dle sensitivity | SOURCE_APPROVED |
| APPROVED → ACTIVE | First sync úspěšný | — | SOURCE_ACTIVATED |
| ACTIVE → SUSPENDED | Quota breach / compliance issue | — | SOURCE_SUSPENDED |
| SUSPENDED → ACTIVE | Issue resolved + re-approval | — | SOURCE_REACTIVATED |
| ANY → ARCHIVED | Explicit deactivation + retention expiry | Owner action | SOURCE_ARCHIVED |

---

## 9. Chybové stavy a recovery

| Chyba | Reakce | Kdo notifikován |
|-------|--------|----------------|
| PII_DETECTED during ingest | Chunk odmítnut, ingest zastaven | Dirigent + owner |
| QUOTA_EXCEEDED | Ingest odmítnut, fallback retry queue | owner |
| SCHEMA_VALIDATION_FAIL | Chunk odmítnut, skipped | log only |
| SENSITIVITY_MISMATCH | Ingest zastaven, manual review | Dirigent |
| NAMESPACE_ACL_VIOLATION | Request 403, audit log critical | Dirigent + security |
| FIRST_SYNC_FAILED | is_active = false, owner notified | owner + Dirigent |

---

## 10. Testování nového adaptéru

Před release nového adaptéru musí projít:

```bash
# 1. Unit test adaptéru (normalization, validation, metadata tagging)
npm run test:run -- src/tests/hooks/useSourceAdapter.test.ts

# 2. Gate test enterprise patterns
npm run test:gates

# 3. Integration test: ingest → Ragnarok → retrieval round-trip
npm run test:run -- src/tests/integration/source-ingest-roundtrip.test.ts

# 4. Build
npm run build
```

Adapter NESMÍ být aktivován v produkci bez všech 4 kroků úspěšně dokončených.
