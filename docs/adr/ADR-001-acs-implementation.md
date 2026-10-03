# ADR-001: Agent Communication Standard — implementační rozhodnutí

> **Status:** Accepted (implementace F0–F5 v PR `feat/acs-core-implementation`)
> **Datum:** 2026-07-08
> **Kontext:** [AGENT_COMMUNICATION_STANDARD.md](../AGENT_COMMUNICATION_STANDARD.md), audit [ACS_AUDIT_FINDINGS.md](../ACS_AUDIT_FINDINGS.md)

## Rozhodnutí

**Schema technologie:** JSON Schema draft 2020-12 jako kontraktní SoT (soubory v `packages/acs-contracts/schemas/`, diffovatelné, seedovatelné do `acs_message_schemas`), ajv (strict) jako runtime validátor — ajv už je v dependency stromu (fastify). Zod zůstává autorský nástroj uvnitř reflection enginu (IP-11 `acsNodeGate`), kde už je idiomatický; nezavádíme konverzní pipeline, dokud ji něco nepotřebuje (YAGNI + jejich „prefer duplication over premature abstraction").

**Identifikátory:** ULID — vlastní 60řádková implementace v SDK (monotonní v rámci ms, crypto random), žádná závislost. Prefixy `int_` / `eff_` pro intenty a efekty.

**Podpisy:** Ed25519 přes `node:crypto` (built-in, žádná závislost). Klíče výhradně z env (`ACS_SIGNING_KEY` PKCS#8 base64, `ACS_TRUSTED_KEYS` JSON sender→SPKI) — No Secrets in Code. Podpis kryje sha256 kanonického JSON (vlastní deterministická serializace, klíče řazené).

**Vrstvení enforcementu (DB nemá jsonschema extension — záměrná dělba):**
DB vynucuje nefalšovatelné minimum: skeleton envelope, členství v registru, existenci intent kotvy, dedup (UNIQUE), append-only, immutabilitu intentů, ACL, DLQ. SDK vynucuje plné kontrakty (ajv) a podpisy. Nekupujeme PG extension kvůli něčemu, co patří na aplikační hranici.

**Mode ladder:** `off → shadow → warn → enforce`, globálně `ACS_MODE` + per-typ `ACS_MODE_OVERRIDES` (JSON). Chybná konfigurace padá **do off** s hlasitým logem — překlep nesmí omylem vynucovat ani vypnout explicitně vynucené (overrides se validují). Default `off` = nulová regrese (CLAUDE.md No Regressions).

**Transport:** `pg_notify` nese pouze `{acs_message_id}` (8 kB limit + pass-by-reference i na transportu); obsah se čte z `acs_message_log`. Přechodně SDK přijímá i inline envelope (migrační okno).

## Zamítnuté alternativy

Protobuf/Avro (binární výhody nevyváží ztrátu jsonb introspekce v PG a čitelnosti diffů), externí message broker (PG LISTEN/NOTIFY + Redis už je backbone — nezavádíme druhý), pg_jsonschema extension (vrstvení výše), ulid/uuid npm balíčky (30 řádek kódu vs. supply-chain plocha).

## Důsledky

Viz [ACS_ROLLOUT_RUNBOOK.md](../acs/ACS_ROLLOUT_RUNBOOK.md) — rollout po typech zpráv, metriky, zbývající wiring (chat.ts ingress F4, verifier F6).
