# ACS Rollout Runbook — shadow → warn → enforce

> **Souvisí:** [AGENT_COMMUNICATION_STANDARD.md](../AGENT_COMMUNICATION_STANDARD.md), [ADR-001](../adr/ADR-001-acs-implementation.md)
> **Implementace:** `packages/acs-sdk`, `packages/acs-contracts`, `aisha/db/migrations/20260708*`, IP-4 (event-worker), IP-8 (toolExecutor), IP-11 (reflection)

## Co je nasazeno tímto PR

| Vrstva | Stav | Default |
|---|---|---|
| Kontrakty (9 schémat) + SDK (envelope, ULID, Ed25519, ajv, readback, provenance) | ✅ kód + testy 18/18 | — |
| DB: `acs_intents/message_log/message_schemas/dead_letters/pending_effects/agent_acl` + funkce + granty | ✅ migrace (3 soubory) | seed mode `shadow` |
| IP-4 event-worker inbound gate | ✅ zapojeno | `ACS_MODE=off` |
| IP-8 toolExecutor readback | ✅ zapojeno | `ACS_MODE=off` |
| IP-11 reflection node gate (ToT) | ✅ zapojeno | `ACS_MODE=off` |
| IP-1 `acsStructuredChat` | ✅ modul k adopci volajícími | opt-in |
| IP-10 CI gate (`acs-contracts.yml` + `schema-diff.mjs`) | ✅ | běží na PR |

**`ACS_MODE` není nastaven → chování platformy je bit-po-bitu stejné jako před merge (No Regressions).**

## Kroky po merge

1. **Registrace migrací:** `npm run db:migration:register` a aplikace na lokál/staging (`npm run db:migrate:local`).
2. **Klíče:** vygenerovat Ed25519 páry per service (`node -e "const {generateKeyPairSync}=require('crypto');const {privateKey,publicKey}=generateKeyPairSync('ed25519');console.log('ACS_SIGNING_KEY='+privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));console.log('SPKI='+publicKey.export({format:'der',type:'spki'}).toString('base64'))"`), do Coolify env; `ACS_TRUSTED_KEYS` = JSON mapa sender→SPKI. Nikdy do repa.
3. **Shadow (týden 1):** `ACS_MODE=shadow` na event-worker + svc-ai-chat. Sledovat: počet violations v lozích, `acs_dead_letters` (má zůstat prázdná — shadow neDLQuje), poměr validních envelope.
4. **Warn (týden 2):** `ACS_MODE=warn`. Kritérium postupu: violations < 0,5 % provozu daného typu.
5. **Enforce po typech:** `ACS_MODE_OVERRIDES={"acs.event.db_change@1.0":"enforce"}` → postupně další typy. Před enforce daného typu naplnit `acs_agent_acl` (default deny!) a `ACS_EFFECT_TOOLS` mapu pro readback.
6. **Zbývající wiring (vědomě mimo tento PR):**
   - **F4 ingress (IP-6):** volání `ensureIntent()` v `routes/chat.ts` po vzniku runu + provléct `intent_id` do toolExecutor kontextu (nahradí placeholder anchor v `acsGuardToolExecution`). Záměrně nepatchováno — soubor je pod aktivním souběžným vývojem; jde o ~5 řádek na místě vzniku `tracer.runId`.
   - **F6 verifier (IP-9):** endpoint nad `acs.verify.request/result@1.0` + completion hook; kontrakty a ACL řádky už existují.
   - **Enforce hygiena:** ESLint ban přímých provider importů mimo llm-dispatch; naplnění `acs_message_schemas.json_schema` plnými dokumenty (nyní package refs) seedem z balíčku.

## Rollback

Kterákoli úroveň: `ACS_MODE=off` (env) + restart — žádný kód se nevrací. DB objekty jsou aditivní; případný revert migrací = DROP acs_* (žádná stávající tabulka není dotčena).

## Metriky (dashboardy F7)

`SELECT count(*) FROM acs_dead_letters WHERE created_at > now()-interval '1 day'` (DLQ rate), poměr `acs_message_log` vs. provoz, violations z logů (`ACS violation`), `acs_pending_effects` stavy (aborted rate), drift-per-depth z `acs.verify.result.tot_context` po F6.
