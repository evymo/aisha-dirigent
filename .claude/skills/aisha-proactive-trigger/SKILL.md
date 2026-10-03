---
name: aisha-proactive-trigger
description: Activate and build proactive loops for the AISHA platform — event-driven triggers, scheduled AI jobs, idempotent cron workflows, approval gate routing, and audit. Use when activating inactive WF_* workflows (Fáze 7 Modul 4 / Roadmap Fáze 6), designing a proactive/proaktivní loop, or verifying idempotence of a cron workflow. Triggers on "proactive", "proaktivní", "trigger", "scheduled job", "cron workflow", "aktivace workflow", "WF_ activation", "event-driven".
---

# AISHA Proactive Trigger Skill

V tomto repu **proaktivní smyčka ≡ n8n workflow (`n8n/workflows/WF_*.json`), který se spouští sám** — cronem (`scheduleTrigger`) nebo událostí (`webhook`) — a jehož efekt je idempotentní a auditovaný v DB. Tento skill pokrývá **aktivaci a návrh těchto smyček**: výběr triggeru, idempotence na úrovni RPC, approval gate routing a ověření prvního běhu. Je to doplněk k `aisha-n8n-workflow` (base vzory nodů, aishaRpc, credentials) — jeho obsah zde NEduplikuj, odkazuj.

Plan-linkage: [docs/MASTER_PLAN.md](../../../docs/MASTER_PLAN.md) §7.4 „Module 4: Proactive Activation" a [docs/AI_AGENT_ROADMAP.md](../../../docs/AI_AGENT_ROADMAP.md) Fáze 6 (§6.1 event-driven triggers, §6.2 scheduled AI jobs, §6.3 study monitoring agent). Kontrakt pro delegaci: [docs/planning/zadani/WP-04-proactive-activation.md](../../../docs/planning/zadani/WP-04-proactive-activation.md).

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Aktivace neaktivního `WF_*` workflow v n8n (Modul 4) | **Ano** |
| Návrh nové proaktivní smyčky (cron / event-driven) | **Ano** — trigger volba + idempotence + audit |
| Ověření idempotence existujícího cron workflow | **Ano** — viz vzor `process_due_story_reminders` |
| Routing proaktivní akce přes approval gate | **Ano** — kdy routovat; kontrakt gate viz `aisha-n8n-workflow` |
| Struktura n8n JSON, aishaRpc node, credentials, `__REMAP__` | **Ne** — viz `aisha-n8n-workflow` skill |
| Nová/změněná RPC funkce (claim, audit, SECURITY DEFINER) | **Ne** — viz `aisha-rpc` skill |
| Nová tabulka/index pro frontu úloh | **Ne** — viz `aisha-migration` skill |
| n8n instance neběží (503) | **Ne** — eskaluj na WP-00 (Tier-A), neopravuj sám |

## Modul 4: workflows k aktivaci

Dle MASTER_PLAN §7.4 jsou to tyto 4 existující + 1 nový (všechny JSON existují v `n8n/workflows/`):

| Workflow | Trigger | Účel |
|----------|---------|------|
| `WF_ADMIN_HEALTH_MONITOR.json` | `scheduleTrigger` | System health check + alert escalation (circuit breaker) |
| `WF_NIGHTLY_STORY_AUDIT.json` | `scheduleTrigger` cron `0 2 * * *` | Kontrola story progress, stale stories (RPC `get_active_stories_for_audit`) |
| `WF_STORY_REMINDER_CRON.json` | `scheduleTrigger` | Due připomínky → notifikace (idempotence exemplar) |
| `WF_EXPERT_NOTIFICATION.json` | `webhook` | Severity-routed notifikace expertům (low→log … critical→email+callback) |
| `WF_RULE_PROPAGATION.json` | `webhook` | Nový — z Module 1 |

Aktivační sekvence (MASTER_PLAN): **Health Monitor → Nightly Audit → Reminder → Expert Notification**. Před aktivací ověř credentials (`npm run aisha:workflows:creds`), po aktivaci sleduj první běh (`npm run aisha:workflows:executions`).

> **Pozor:** žádný z těchto JSON nemá `"active": true` — aktivace se NEdělá editací JSON, ale přes n8n REST API: `scripts/deploy-workflows.mjs` („creates new, updates existing, activates all"). Lokální JSON je source of truth pro strukturu, live n8n pro stav aktivace.

## Kanonický vzor 1 — idempotentní cron smyčka (scheduled job)

Exemplar: `n8n/workflows/WF_STORY_REMINDER_CRON.json` → RPC `process_due_story_reminders`.

```
scheduleTrigger (rule.interval)
  ↓
POST /rest/v1/rpc/process_due_story_reminders   (service_role)
  ↓
if (processed_count > 0)
  ↓
code: log summary
```

**Idempotence žije v DB, ne v n8n.** SoT: `aisha/db/sql/functions/process_due_story_reminders.sql`:

```sql
FOR v_reminder IN
  SELECT ... FROM public.story_reminders sr
  WHERE sr.is_completed = false AND sr.remind_at <= now()
  ORDER BY sr.remind_at ASC
  FOR UPDATE OF sr SKIP LOCKED          -- concurrent-safe: dva běhy si nevezmou stejný řádek
LOOP
  INSERT INTO public.notifications (...);
  UPDATE public.story_reminders SET is_completed = true ...;  -- flip = už se nevybere znovu
  PERFORM public.write_audit_journal('scheduled_task', 'system', ...);  -- audit každé akce
END LOOP;
```

Tři vrstvy, všechny povinné pro každou proaktivní smyčku:
1. **Claim guard** — `FOR UPDATE SKIP LOCKED` + status flip (`is_completed`, `pending→claimed`). Další claim RPCs jako vzor: `aisha/db/sql/functions/claim_queued_claude_run.sql`, `claim_pending_workbench_requests.sql`, `retry_pending_blockchain_syncs.sql`. Nový claim RPC piš dle `aisha-rpc` skillu.
2. **Audit** — `write_audit_journal` (SoT: `aisha/db/sql/functions/write_audit_journal.sql`) uvnitř RPC, plus workflow-level `log_integration_action` (SoT: `aisha/db/sql/functions/log_integration_action.sql`, signatura `p_service_name, p_action, p_action_detail, p_status, ...`).
3. **Grant jen pro service_role** — `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO service_role;` — cron RPC nikdy `authenticated`.

Roadmap §6.2 zmiňuje `pg_cron` variantu — v tomto repu je **kanonický scheduler n8n `scheduleTrigger`**, pg_cron je jen okrajově (reset `llm_quota`, viz komentář v `aisha/db/sql/tables/llm_quota.sql`). Nezaváděj nové pg_cron joby bez Tier-A rozhodnutí.

## Kanonický vzor 2 — scheduled AI job (batch + per-item audit)

Exemplar: `n8n/workflows/WF_NIGHTLY_STORY_AUDIT.json`:

```
scheduleTrigger (cron 0 2 * * *)
  ↓
aishaRpc: get_active_stories_for_audit     (service_role)
  ↓
code: parse → if (Any Stories?)
  ↓
splitInBatches (batchSize 5)
  ↓
[per item: validate → evaluate → aishaRpc: create_ai_run]   ← per-item provenance
  ↓
code: aggregate → POST audit_journal summary                ← run-level audit
```

Pokud job volá LLM: dispatch jde přes svc-ai-chat s AITG guardem (viz `aisha-edge-fn` skill) a **high/critical akce se před vykonáním routují na approval gate** — proaktivní agent nikdy neposílá notifikace/mutace s vysokým dopadem bez human-in-the-loop.

## Kanonický vzor 3 — event-driven trigger

Repo-kanonická forma události je **n8n `webhook` node** (exemplar: `n8n/workflows/WF_EXPERT_NOTIFICATION.json` — validace payloadu v Code nodu, severity routing low/medium/high/critical na různé kanály). Approval gate je speciální případ: `WF_APPROVAL_GATE.json` poslouchá na `webhook/approval-gate` a `webhook/approval-response` — request/response kontrakt viz `aisha-n8n-workflow` skill (sekce „Approval gate integrace"), neduplikuj.

Roadmap §6.1 (pg_notify → Realtime → edge fn) je v repu zatím jen u knowledge embeddings (`aisha/db/sql/triggers/trg_knowledge_embedding_auto.sql`, `aisha/db/sql/functions/fn_notify_knowledge_change.sql`). Plnohodnotné DB-event triggery pro health/lab data **zatím neexistují — vzniknou v Roadmap Fázi 6**. Study monitoring agent (§6.3) **zatím neexistuje — vznikne v Roadmap Fázi 6**; do té doby je nejbližší vzor `WF_NIGHTLY_STORY_AUDIT`.

## Checklist aktivace workflow

1. `npm run test:gates` — n8n gates zelené PŘED deployem.
2. `npm run aisha:workflows:verify` — n8n běží, credentials namapované. Pokud 503 → **eskaluj WP-00, stop**.
3. `node scripts/n8n-schedules.mjs --local` — audit schedule pravidel v lokálních JSON (viz pitfall níže).
4. `npm run aisha:workflows:deploy` (`--force` variantu jen vědomě) — import + aktivace.
5. Manuální „Execute Workflow" v n8n UI → úspěšný běh v execution logu.
6. **Dvojitý trigger** rychle za sebou → právě jedna notifikace/akce (idempotence test dle WP-04 §8).
7. Audit ověření: řádek v `audit_journal` (read RPC) + `integration_actions` se správným `action`.
8. `npm run aisha:workflows:sync` — stáhni live stav zpět do `n8n/workflows/`, commitni drift.

## Common pitfalls

❌ **Věřit názvu trigger nodu.** `WF_STORY_REMINDER_CRON` má node „Every 5 min", ale `rule.interval` je `days` + `triggerAtHour: 3`; `WF_ADMIN_HEALTH_MONITOR` má „Every 5 Minutes" se stejným daily pravidlem. Validuj vždy `rule.interval` v JSON, ne label. (Pozadí: `scripts/n8n-schedules.mjs --fix` na produkci stahuje periodické triggery na max 1×/den.)
❌ Editovat `"active": true` v JSON a čekat, že se něco stane — aktivace jde přes REST (`scripts/deploy-workflows.mjs`), JSON flag live instanci nezmění.
❌ Idempotence řešená v n8n Code nodu místo v RPC — při retry/parallel běhu vzniknou duplicitní notifikace. Claim guard patří do SQL (`FOR UPDATE SKIP LOCKED` + status flip).
❌ Cron RPC s `GRANT ... TO authenticated` — proaktivní RPC volá jen n8n service_role.
❌ Proaktivní LLM akce bez AITG guardu a bez approval gate u high/critical severity.
❌ Nová proaktivní akce bez audit zápisu — každý běh musí zanechat stopu (`write_audit_journal` per akce, `log_integration_action` per workflow run).
❌ Řešit n8n 503 v rámci aktivace — to je WP-00 (Tier-A). Eskaluj.
❌ Měnit signaturu `log_integration_action` či jiných RPC při aktivaci — out-of-scope WP-04, eskaluj na Tier-A / `aisha-rpc`.

## Gates & validace

| Kontrola | Příkaz / soubor |
|---|---|
| Advisory hook po Edit/Write na `n8n/workflows/WF_*.json` (valid JSON, povinná pole, `callerPolicy`, `auditTrail`) | `.claude/hooks/n8n-workflow-validation.sh` (PostToolUse, neblokuje) |
| Workflow integrity gate (valid JSON, `onError: continueRegularOutput` na aishaRpc, žádné hardcoded URL, KC token v toolCode) | `src/tests/gates/n8n-workflow-integrity.gate.test.ts` |
| Drift gate (lokální JSON vs. template source) | `src/tests/gates/n8n-workflow-drift.gate.test.ts` |
| Všechny gates najednou | `npm run test:gates` |
| Deploy + aktivace | `npm run aisha:workflows:deploy` |
| Health / credentials check | `npm run aisha:workflows:verify` |
| Execution log | `npm run aisha:workflows:executions` |
| Sync live → repo | `npm run aisha:workflows:sync` |
| Schedule audit (lokální) | `node scripts/n8n-schedules.mjs --local` |

## Reference

- `n8n/workflows/WF_STORY_REMINDER_CRON.json` + `aisha/db/sql/functions/process_due_story_reminders.sql` — cron + idempotence exemplar
- `n8n/workflows/WF_NIGHTLY_STORY_AUDIT.json` — scheduled AI job s batch + per-item audit
- `n8n/workflows/WF_EXPERT_NOTIFICATION.json` — event-driven severity routing
- `n8n/workflows/WF_APPROVAL_GATE.json` — human-in-the-loop kontrakt
- `docs/planning/zadani/WP-04-proactive-activation.md` — delegační kontrakt, DoD, eskalace

## Související

- **`aisha-n8n-workflow`** — base vzory: aishaRpc node, scheduleTrigger/webhook JSON, credentials `__REMAP__`, approval gate request/response kontrakt
- **`aisha-rpc`** — psaní claim/audit RPC (SECURITY DEFINER, REVOKE/GRANT, `write_audit_journal`)
- **`aisha-migration`** — nové tabulky/fronty pro proaktivní smyčky (SoT pairing)
- **`aisha-edge-fn`** — AITG guard pro LLM dispatch volaný z proaktivních jobů
