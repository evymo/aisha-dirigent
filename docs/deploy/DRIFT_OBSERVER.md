# DRIFT_OBSERVER.md — Phase 1: Infrastructure Drift Detection

> **Status:** SPEC — Phase 1 z [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md)
> **Verze:** 1.0
> **Datum:** 2026-04-28

---

## TL;DR

AISHA každých 10 minut porovná **desired state** (kombinace `aisha-stack.yml` + `story_environments` tabulka + compose souborů) s **actual state** (Coolify API). Detekuje drift v env vars, image tagách, replica count, secrets, rogue/missing apps. Nízkorizikový drift opraví autonomně, vysokorizikový eskaluje na `WF_APPROVAL_GATE`.

---

## 1. Co je "drift"?

**Drift** = divergence mezi tím, co manifest (zdroj pravdy) říká, že má být v Coolify nasazené, a tím, co tam skutečně běží.

### 1.1 Zdroje pravdy (desired state)

V tomto pořadí priority (vyšší přepisuje nižší):

1. **`aisha-stack.yml`** — top-level manifest celého AISHA stacku. Field per app: `image`, `replicas`, `env_required`, `domains`, `traefik_routes`, `slot_managed: true|false`.
2. **`docker-compose.coolify-{story}.yml`** — per-story compose s service definicemi. Drift checker parsuje pro `image:`, `environment:`, `deploy.replicas:`, `labels:` (Traefik).
3. **`story_environments.config` jsonb** — per-environment override (např. preview má jinou image tag než prod).
4. **Database `coolify_app_slots`** — pro B/G-managed apps: `active_slot` určuje, který slot má veřejné Traefik labely.

### 1.2 Aktuální stav (actual state)

Coolify API endpoints:
- `GET /api/v1/applications` — list všech aplikací: UUID, name, status (running/exited/etc.), image tag, replicas
- `GET /api/v1/applications/{uuid}/envs` — env vars (kromě těch s `is_secret: true` — server vrátí `***REDACTED***`)
- `GET /api/v1/applications/{uuid}/deployments?per_page=1` — last deployment + image SHA z registru
- Coolify ukládá Traefik labels v `applications.docker_labels` (newline-separated string)

### 1.3 Drift kinds

| Kind | Popis | Detekce |
|---|---|---|
| `env_var_value` | Hodnota env var v Coolify ≠ hodnota v manifestu (non-secret) | String compare |
| `env_var_missing` | Env var v manifestu, chybí v Coolify | Set difference |
| `env_var_extra` | Env var v Coolify, chybí v manifestu | Set difference |
| `secret_drift` | Env var match `.*_(SECRET\|KEY\|TOKEN\|PASSWORD\|DSN)$` má jiný hash | Hash compare (Coolify exposuje SHA-256 secret hash) |
| `image_tag` | Image tag v Coolify ≠ tag v manifestu | String compare (e.g., `gateway:v1.2.3` vs `gateway:v1.2.4`) |
| `replicas` | Replica count se rozchází | Int compare |
| `traefik_labels` | Traefik labels v Coolify ≠ labels v manifest/B-G slot rule | Set difference |
| `missing_app` | Manifest says app should exist, Coolify nemá | Set difference |
| `extra_app` | Coolify má app, manifest neuvádí | Set difference (s allowlist pro coolify-managed init apps) |
| `domain_mismatch` | App má jiný `traefik.http.routers.X.rule` než manifest očekává | Regex extract + compare |

---

## 2. Komponenty

### 2.1 `scripts/coolify-drift-check.mjs`

Standalone Node.js skript, výstup `--json`. Reuses `deploy/connectors/coolify.mjs` pro API calls.

**CLI signature:**
```bash
node scripts/coolify-drift-check.mjs [options]

Options:
  --json                  Output JSON instead of human-readable
  --app <name>            Check single app (default: all)
  --story <slug>          Check apps for specific story
  --include-secrets       Include secret hash compare (default: skip — faster)
  --apply                 Auto-remediate low-risk drift (DANGEROUS, requires confirmation)
  --rpc-host <url>        Override default Postgres REST URL (default from env)
  --coolify-url <url>     Override Coolify URL (default from env)
  --coolify-token <token> Override Coolify token (default from env)
  --quiet                 Suppress info logs
  --help                  Show this help
```

**Output schema (`--json`):**
```typescript
{
  observed_at: string;        // ISO8601
  total_apps_checked: number;
  drift_count: number;
  drifts: Array<{
    app_uuid: string;
    app_name: string;
    drift_kind: string;        // viz tabulka výše
    desired_value: any;
    actual_value: any;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    suggested_action: 'auto_remediate' | 'request_approval' | 'manual_review' | 'ignore';
  }>;
  errors: Array<{
    app_uuid?: string;
    error: string;
  }>;
}
```

### 2.2 `n8n/workflows/WF_DRIFT_OBSERVER.json`

n8n workflow s následujícími nodes:

```
1. scheduleTrigger          (every 10 min)
2. code: Run Drift Check    (executes scripts/coolify-drift-check.mjs --json via shell exec)
                            (alternative: HTTP call do edge fn that wraps the script)
3. splitInBatches           (batch_size: 1, iterates per drift)
4. aishaRpc                 (record_drift_observation RPC — inserts row to drift_state)
5. aishaRpc                 (fn_evaluate_proposal_risk('infrastructure_drift', metadata))
6. switch                   (route by risk_level)
   ├─ low/medium → 7a: Auto-Remediate Branch
   └─ high/critical → 7b: Request Approval Branch

7a. httpRequest             (Coolify API: PATCH or POST to fix)
8a. aishaRpc                (resolve_drift RPC: marks drift_state row resolved)
9a. log_integration_action  (success path)

7b. httpRequest             (POST to /webhook/approval-gate with metadata)
8b. aishaRpc                (mark_drift_pending_approval RPC)
9b. log_integration_action  (approval_pending path)
```

Workflow callerPolicy: `workflowsFromSameOwner`. Available in MCP: `false` (interní).

### 2.3 `supabase/migrations/[ts]_drift_state.sql`

Schema (vide AUTONOMOUS_DEPLOY_FLOW.md §3.3):

```sql
CREATE TABLE drift_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at     timestamptz NOT NULL DEFAULT now(),
  app_uuid        text NOT NULL,
  app_name        text NOT NULL,
  drift_kind      text NOT NULL CHECK (drift_kind IN (
    'env_var_value', 'env_var_missing', 'env_var_extra',
    'secret_drift', 'image_tag', 'replicas',
    'traefik_labels', 'missing_app', 'extra_app', 'domain_mismatch'
  )),
  desired_value   jsonb,
  actual_value    jsonb,
  risk_level      text NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  remediation     text NOT NULL DEFAULT 'pending'
                  CHECK (remediation IN ('pending','auto','approved','manual','ignored','approval_pending')),
  approval_id     uuid,
  resolved_at     timestamptz,
  resolved_by     uuid,
  resolution_note text,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drift_state_unresolved
  ON drift_state (app_uuid, drift_kind, observed_at)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_drift_state_recent
  ON drift_state (observed_at DESC);
```

RPCs (security definer + revoke/grant pattern dle CLAUDE.md):
- `record_drift_observation(p_payload jsonb)` — bulk insert nové drift observation; deduplikuje na `(app_uuid, drift_kind, observed_at_5min_bucket)` — pokud už unresolved record existuje pro tento klíč, vrátí jeho id; jinak insert.
- `resolve_drift(p_drift_id uuid, p_remediation text, p_resolved_by uuid, p_note text)` — označí drift jako resolved.
- `mark_drift_pending_approval(p_drift_id uuid, p_approval_id uuid)` — link na approval_id.
- `get_latest_drift_state()` returns `TABLE (...)` — pro Phase 4 dashboard.
- `get_unresolved_drift_count()` returns `int` — pro StatBox widget.

---

## 3. Risk evaluation pro `infrastructure_drift`

`fn_evaluate_proposal_risk('infrastructure_drift', metadata)` rozhoduje podle metadata:

```typescript
metadata: {
  drift_kind: string;
  app_name: string;
  app_role: 'frontend' | 'backend' | 'database' | 'auth' | 'observability';
  desired_value: any;
  actual_value: any;
  is_production: boolean;
}
```

Pravidla (od strongest do weakest):

| Pravidlo | Kategorie | Rule |
|---|---|---|
| Secret drift | `compliance_policy` | Vždy `high` |
| Production database app drift | `compliance_policy` | Vždy `critical` |
| Auth service (Keycloak) drift | `compliance_policy` | Vždy `high` |
| Extra app | `compliance_policy` | Vždy `critical` (rogue deploy?) |
| Missing app | `orchestration_policy` | `high` |
| Image tag drift in production | `orchestration_policy` | `medium` (může být intentional) |
| Image tag drift in preview/staging | `orchestration_policy` | `low` |
| Replicas drift | `orchestration_policy` | `medium` |
| Traefik labels drift | `orchestration_policy` | `medium` (může být intentional B/G switch by jiný workflow) |
| Env var value drift (non-secret, non-prod) | `model_heuristic` | `low` |
| Env var value drift (non-secret, prod) | `model_heuristic` | `medium` |
| Env var missing | `model_heuristic` | `low` |
| Env var extra (whitelist allowed) | `fallback` | `low` |
| Default | `fallback` | `medium` |

Decision provenance se zaznamenává do `audit_journal.metadata.decision_provenance` při každé evaluaci.

---

## 4. Auto-remediation patterns

### 4.1 Bezpečně auto-fix (low/medium risk)

| Drift kind | Coolify API call |
|---|---|
| `env_var_value` (non-secret, non-prod) | `POST /api/v1/applications/{uuid}/envs/bulk { is_preview: false, data: [{ key, value }] }` |
| `env_var_missing` | Same endpoint, value z manifestu |
| `image_tag` (preview/staging only) | `PATCH /api/v1/applications/{uuid} { image: "..." }` + `POST /api/v1/applications/{uuid}/restart` |
| `replicas` (non-prod) | Coolify nemá direct replica change endpoint — log + Slack notify, manual fix |
| `traefik_labels` (managed B/G app) | Volat `commit_slot_switch` RPC pokud drift odpovídá legitimnímu B/G switchi; jinak revert na desired labels |

### 4.2 Approval-gated remediation (high/critical)

Vytvořit `WF_APPROVAL_GATE` request s payload:

```json
{
  "action_description": "Drift detected: {drift_kind} on {app_name} — proposed fix: {fix_description}",
  "severity": "high",
  "context": {
    "drift_id": "uuid",
    "app_name": "...",
    "drift_kind": "...",
    "desired_value": ...,
    "actual_value": ...,
    "proposed_action": "..."
  },
  "timeout_hours": 24,
  "agent_slug": "drift_observer",
  "category": "infrastructure",
  "decision_reasoning": "..."
}
```

Po approval, callback workflow re-spustí remediation s `remediation = 'approved'`.

### 4.3 Auto-ignore patterns

Některé drifts jsou **legitimate**:
- B/G switch in progress: `coolify_app_slots.switch_lock = true` → skip drift detection pro tu app
- Ephemeral preview deploys: app name match `*-preview-*` a older than 7 days → flag for cleanup, ne drift
- Coolify-managed init containers: `coolify-coolify-proxy`, `coolify-realtime` → allowlist

Ignore patterns jsou v `scripts/coolify-drift-check.mjs` jako konstanta `IGNORE_PATTERNS` + override z `aisha-stack.yml` field `drift_ignore: true`.

---

## 5. Idempotency

### 5.1 Dedup key

```typescript
function driftDedupKey(drift: Drift): string {
  const bucket = Math.floor(drift.observed_at_ms / (5 * 60 * 1000)); // 5-min buckets
  return `${drift.app_uuid}|${drift.drift_kind}|${bucket}`;
}
```

`record_drift_observation` RPC zkontroluje, zda už existuje unresolved row se stejným `(app_uuid, drift_kind)` v posledních 5 minutách — pokud ano, vrací její ID a inkrementuje `metadata.observation_count`.

### 5.2 Auto-remediate rate limit

Per app, max 5 auto-remediations per hour. Tracking v `audit_journal`:
```sql
SELECT count(*) FROM audit_journal
WHERE action = 'drift_auto_remediate'
  AND metadata->>'app_uuid' = $1
  AND created_at > now() - interval '1 hour';
```

Pokud >= 5, eskalovat na approval (suspicious — proč drift opakovaně?).

---

## 6. Integration s ostatními fázemi

### 6.1 Drift → B/G

Pokud drift je `image_tag` na B/G-managed app, drift observer **netvoří** přímý fix. Místo toho:
1. Loguje drift jako `pending` s remediation = 'manual'
2. Dispatchuje webhook `WF_BLUE_GREEN_ORCHESTRATOR` s `triggered_by = 'drift_remediation'` a `target_image_tag = desired_value`
3. B/G orchestrator řídí kompletní switch (smoke test, gate, atd.)

Tím drift detection se **stává triggerem** pro řízený B/G deploy, ne přímým env-patcher.

### 6.2 Drift → Phase 4 dashboard

Phase 4 dashboard zobrazuje:
- **Unresolved drift count** (StatBoxWidget z `get_unresolved_drift_count()`)
- **Recent drift table** (TableWidget z `get_latest_drift_state()`)
- **Drift by kind chart** (ChartWidget — agregát z 24h)
- **Action button**: "Run drift check now" (admin only) → POST n8n webhook `/webhook/drift-now`

---

## 7. Bezpečnostní úvahy

### 7.1 Secret handling

Secret drift detection **nenahlíží do hodnot**. Coolify API exposuje `secret_hash` (SHA-256 prvních 32 chars) — porovnává se hash z manifestu (computed při deploy time z `.env.coolify-aisha.example` → CI/CD ukládá hash do `aisha-stack.yml` při release).

`drift_state.desired_value` a `actual_value` pro secret drift obsahují **pouze hashes**, nikdy plain values.

### 7.2 RBAC pro auto-remediation

Service role klíč pro auto-remediation je odlišný od admin. **`drift_remediator` service role** má:
- Read-only access k `drift_state`, `audit_journal`
- Write access pouze přes `record_drift_observation`, `resolve_drift` RPCs
- **Žádný direct table access**

`apikey: ${DRIFT_REMEDIATOR_KEY}` v environment, scoped restrictions enforce přes RLS policies.

### 7.3 Audit trail

Každá auto-remediation generuje:
- Záznam v `audit_journal` s `action = 'drift_auto_remediate'`, `metadata` s drift_id + before/after
- Záznam v `integration_actions` s `service_name = 'n8n'`, `action = 'drift_remediation'`
- Decision provenance v audit_journal.metadata.decision_provenance

---

## 8. Konfigurace a tunables

| Env var / config | Default | Účel |
|---|---|---|
| `DRIFT_CHECK_INTERVAL_MIN` | `10` | Cron interval n8n workflow |
| `DRIFT_AUTO_REMEDIATE_MAX_PER_HOUR` | `5` | Per-app rate limit |
| `DRIFT_DEDUP_BUCKET_MIN` | `5` | Bucket size pro dedup |
| `DRIFT_INCLUDE_SECRETS` | `true` | Zda kontrolovat secret hash drift |
| `DRIFT_RISK_OVERRIDE_TABLE` | `drift_risk_overrides` | Per-app risk override (DB-driven) |

---

## 9. Otevřené otázky

1. **Manifest update flow**: pokud admin manuálně přidá env var v Coolify UI, drift observer ho označí jako `env_var_extra`. Měl by **auto-update manifest** (commit do `aisha-stack.yml` přes git server)? — *future enhancement, riskantní*
2. **Drift remediation logs in dashboard**: viditelnost kdo/kdy schválil je nutná. Phase 4 dashboard musí mít Drift History page s approver, timestamp, decision reasoning.
3. **Cross-server drift**: Frontend vs Backend vs Experimental apps — jeden Coolify spravuje vše. Drift checker iteruje po Coolify aplikacích bez ohledu na server. OK pro V1.

---

## 10. Reference

- [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md) — master spec
- [BLUE_GREEN_DESIGN.md](BLUE_GREEN_DESIGN.md) — image_tag drift triggers B/G
- [COOLIFY.md](COOLIFY.md) — Coolify integrace
- [`scripts/regen-aisha-stack.mjs`](../../scripts/regen-aisha-stack.mjs) — komplementární tool (regeneruje manifest z live state, opačný směr)
- [`deploy/connectors/coolify.mjs`](../../deploy/connectors/coolify.mjs) — Coolify API client (reused)
