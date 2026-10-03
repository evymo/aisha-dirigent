---
name: aisha-n8n-workflow
description: Create n8n workflows for the AISHA platform with proper aishaRpc integration, audit trail, approval gate routing, and idempotent execution. Use when creating new n8n workflows (WF_*), modifying existing ones, or designing autonomous loops. Triggers on "n8n workflow", "WF_", "aishaRpc", "approval gate", "scheduleTrigger", "splitInBatches", "log_integration_action", "autonomous workflow".
---

# AISHA n8n Workflow Skill

Vytváření n8n workflows pro AISHA platformu s důsledným audit trail, idempotency, a approval gate integrací.

## Konvence

### Naming

- Soubor: `n8n/workflows/WF_{NAME}.json` (uppercase snake)
- `name` field uvnitř JSON: `WF_{NAME}` (matches filename)
- Příklady: `WF_DRIFT_OBSERVER`, `WF_BLUE_GREEN_ORCHESTRATOR`, `WF_DEPLOY_STORY`

### Settings (každý workflow)

```json
{
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true,
    "timezone": "Europe/Prague",
    "callerPolicy": "workflowsFromSameOwner",
    "availableInMCP": false
  }
}
```

`callerPolicy: "workflowsFromSameOwner"` brání cross-account abuse.
`availableInMCP: false` pro interní workflows; `true` pokud má být volatelný z MCP klienta.

## Klíčové uzly (custom AISHA nodes)

### `n8n-nodes-aisha.aishaRpc`

Standard volání Postgres RPC. Používej **vždy** místo `n8n-nodes-base.httpRequest` pro RPC calls.

```json
{
  "parameters": {
    "category": "custom",
    "functionName": "record_drift_observation",
    "rpcParams": "={{ JSON.stringify({ p_app_uuid: $json.app_uuid, p_app_name: $json.app_name, p_drift_kind: $json.drift_kind, p_desired_value: $json.desired, p_actual_value: $json.actual, p_risk_level: $json.risk_level, p_metadata: { source: 'WF_DRIFT_OBSERVER' } }) }}",
    "authMode": "service_role",
    "options": {
      "timeout": 10000,
      "auditTrail": true
    },
    "onError": "continueRegularOutput"
  },
  "id": "record-drift",
  "name": "Record Drift",
  "type": "n8n-nodes-aisha.aishaRpc",
  "typeVersion": 1,
  "credentials": {
    "aishaPostgrestApi": {
      "id": "__REMAP__",
      "name": "AISHA PostgREST"
    }
  },
  "onError": "continueRegularOutput"
}
```

Klíčové parametry:
- `category`: `custom` pro user RPCs; jiné kategorie (`Knowledge`, `Delivery`, …) pro built-in
- `functionName`: snake_case match s SQL function name
- `rpcParams`: JSON string s `p_*` prefixed args (match SQL signature)
- `authMode`: `service_role` (n8n) | `user_jwt` (passthrough z webhook)
- `options.auditTrail: true` — automaticky injectuje `X-Aisha-Audit-*` headers; RPC sám loguje do `integration_actions`
- `options.timeout`: 10s default; up pro long-running RPCs (correlate_sentry_with_deploys může 30s)
- `onError: continueRegularOutput` — workflow neselže celý při RPC failure; node-level error handling

### `n8n-nodes-base.scheduleTrigger`

Cron-style trigger. Pro AISHA observability loops:

```json
{
  "parameters": {
    "rule": {
      "interval": [
        { "field": "minutes", "minutesInterval": 10 }
      ]
    }
  },
  "id": "cron-trigger",
  "name": "Every 10 Minutes",
  "type": "n8n-nodes-base.scheduleTrigger",
  "typeVersion": 1.2,
  "position": [220, 300]
}
```

Konvence:
- 5 min: Sentry observer (rapid response)
- 10 min: Drift observer (regular check)
- 15 min: General Sentry monitor (legacy)
- 30 min: Dashboard rebuilder (low-frequency regenerace)
- Daily 02:00: Nightly audit
- Daily 03:00: Langfuse performance review

### `n8n-nodes-base.webhook`

Manual trigger / external trigger:

```json
{
  "parameters": {
    "httpMethod": "POST",
    "path": "drift-now",
    "responseMode": "responseNode",
    "options": {}
  },
  "id": "webhook-trigger",
  "name": "Drift Now Trigger",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "position": [220, 300]
}
```

### `n8n-nodes-base.splitInBatches`

Per-item iteration:

```json
{
  "parameters": {
    "batchSize": 1,
    "options": {}
  },
  "id": "split-apps",
  "name": "Split Apps",
  "type": "n8n-nodes-base.splitInBatches",
  "typeVersion": 3
}
```

`batchSize: 1` zajistí, že každý item se zpracuje sériově (aishaRpc volání nejsou ideálně concurrent).

### `n8n-nodes-base.if` / `n8n-nodes-base.switch`

Risk-based routing:

```json
{
  "parameters": {
    "rules": {
      "values": [
        {
          "conditions": {
            "options": { "caseSensitive": true, "typeValidation": "strict" },
            "conditions": [{
              "leftValue": "={{ $json.risk_level }}",
              "rightValue": "low",
              "operator": { "type": "string", "operation": "equals" }
            }],
            "combinator": "and"
          },
          "outputKey": "low"
        }
      ]
    },
    "options": { "fallbackOutput": "extra" }
  },
  "id": "risk-router",
  "name": "Route By Risk",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.2
}
```

## Standard flow patterns

### Pattern 1: Observability cron loop

```
scheduleTrigger
  ↓
[Fetch data via aishaRpc / HTTP]
  ↓
splitInBatches (per item)
  ↓
[Process item — aishaRpc calls]
  ↓
[Risk evaluate]
  ↓
switch (route by risk)
  ├─ low → auto execute → log_integration_action
  ├─ medium → auto + notify dirigent → log_integration_action
  └─ high/critical → POST /webhook/approval-gate → log_integration_action
```

### Pattern 2: Webhook-driven action

```
webhook
  ↓
code: Validate Input
  ↓
aishaRpc: get_xxx (resolve context)
  ↓
[Action]
  ↓
if: Success?
  ├─ yes → respond 200 + log
  └─ no → escalate failure → respond 500 + log
```

### Pattern 3: Approval gate consumer

```
webhook (callback z approval gate)
  ↓
code: Parse Approval Response
  ↓
if: Approved?
  ├─ yes → execute pending action → log
  └─ no → cancel pending action → log
```

## Approval gate integrace

`WF_APPROVAL_GATE` je centrální workflow pro human-in-the-loop. Pošli HTTP request na `/webhook/approval-gate`:

```json
{
  "method": "POST",
  "url": "={{ $env.N8N_WEBHOOK_URL }}/webhook/approval-gate",
  "sendBody": true,
  "specifyBody": "json",
  "jsonBody": "={\n  \"action_description\": \"...\",\n  \"severity\": \"{{ $json.risk_level }}\",\n  \"context\": {{ JSON.stringify($json.context) }},\n  \"timeout_hours\": 24,\n  \"agent_slug\": \"drift_observer\",\n  \"category\": \"infrastructure\",\n  \"decision_reasoning\": \"...\"\n}"
}
```

Response:
```json
{
  "success": true,
  "approvalId": "uuid",
  "status": "pending",
  "expiresAt": "ISO8601",
  "approveLink": "https://...",
  "rejectLink": "https://..."
}
```

Po lidské akci dostane workflow callback na `/webhook/approval-response/{approvalId}`.

## Audit trail strategie

Každý workflow loguje **alespoň** dvě události:
1. **Start**: `log_integration_action('workflow_name_started', { trigger, params }, 'info')`
2. **End**: `log_integration_action('workflow_name_completed', { duration_ms, status }, 'success'|'failure')`

Plus per-akci specifické záznamy v audit_journal (přes RPC, ne přímo z n8n).

## Idempotency patterns

### Dedup po time bucket

V "Code" node:
```javascript
const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
const dedupKey = `${item.app_uuid}|${item.drift_kind}|${bucket}`;
return [{ json: { ...item, dedup_key: dedupKey } }];
```

### Skip if already in progress

V RPC:
```sql
SELECT EXISTS(
  SELECT 1 FROM table WHERE entity_id = p_id AND status = 'in_progress'
) INTO v_already_running;

IF v_already_running THEN
  RETURN json_build_object('status', 'skipped_in_progress');
END IF;
```

### Lock-based exclusive execution

```sql
-- Volat acquire_slot_lock RPC; raises pokud již lock drží
SELECT * FROM acquire_slot_lock(p_app_name, p_lock_owner);
```

## Error handling

### Network errors → retry s exponential backoff

```json
{
  "options": {
    "timeout": 10000,
    "retry": {
      "enabled": true,
      "maxAttempts": 3,
      "delay": 2000,
      "factor": 2
    }
  }
}
```

### RPC errors → continue + log

`onError: "continueRegularOutput"` na aishaRpc node — workflow pokračuje, ale příští node musí check `$json.success` field.

### Critical errors → escalate via expert-notification

```json
{
  "url": "={{ $env.N8N_WEBHOOK_URL }}/webhook/expert-notification",
  "method": "POST",
  "jsonBody": "={\n  \"source\": \"WF_DRIFT_OBSERVER\",\n  \"severity\": \"high\",\n  \"error\": \"...\",\n  \"context\": ...\n}"
}
```

## Connections (graph topology)

V `connections` field:
- Každý node connectuje na další přes `main.0`
- `if` node má `main.0` (true) a `main.1` (false)
- `switch` node má `main.0`, `main.1`, ... podle output keys

## Credentials

Standard credentials v AISHA:
- `aishaPostgrestApi` — pro aishaRpc node (auto-mapuje při deploy)
- `httpHeaderAuth` — generic Bearer auth (Coolify, Sentry, n8n)
- `OAuth2` — Keycloak SSO callbacks

V JSON: `"id": "__REMAP__"` placeholder; deploy-to-n8n.mjs replaces.

## Testing patterns

n8n nemá nativní testing; používej:
- **Manual execution**: workflow má `saveManualExecutions: true`, otevři v UI
- **Edge case payloads**: hardcoded test JSONs v webhook node `pinData`
- **Replay z audit log**: `integration_actions` má `action_detail` — restore jako webhook input
- **Gate test ve vitestu**: validovat workflow JSON struktury

## Security gotchas

❌ `process.env.SECRET` v Code node — exposes secret v execution log
✅ Použij credentials s `httpHeaderAuth`, references přes `$credentials`

❌ Dynamic code execution v Code node (eval-style patterns)
✅ Static JSON parsing, deklarativní transformace pouze

❌ Logování plain-text request bodies do `integration_actions.action_detail`
✅ Redact secrets před logem; ukládej jen hashes nebo IDs

❌ `responseMode: "responseNode"` ale žádný `respondToWebhook` node
✅ Vždy spárovat — jinak webhook timeout

❌ Sdílení credentials napříč workflows přes hardcoded ID
✅ Použij `__REMAP__` placeholder; auto-resolve při deploy

## Anti-patterns (NEDĚLAT)

❌ Workflow bez `scheduleTrigger`/`webhook`/manual trigger — orphan
❌ Workflow s `auditTrail: false` na production aishaRpc — chybí audit
❌ Hardcoded URLs (Coolify, Sentry) — používej `$env.{NAME}`
❌ Kompletní logika v jediném "Code" node — neopravitelné, debug obtížný
❌ Žádný timeout na httpRequest — visí na slow service
❌ `success` cesta i `failure` cesta jdou do stejného downstream — ztracený stav

## Workflow JSON quick template

```json
{
  "name": "WF_NEW_WORKFLOW",
  "nodes": [
    { "..." : "trigger" },
    { "..." : "validation" },
    { "..." : "action" },
    { "..." : "audit" }
  ],
  "connections": {
    "Trigger Name": { "main": [[{ "node": "Next Node", "type": "main", "index": 0 }]] }
  },
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true,
    "timezone": "Europe/Prague",
    "callerPolicy": "workflowsFromSameOwner",
    "availableInMCP": false
  }
}
```

## Reference

- `n8n/workflows/WF_DEPLOY_STORY.json` — exemplar webhook-driven action workflow
- `n8n/workflows/WF_APPROVAL_GATE.json` — approval gate kontrakt
- `n8n/workflows/WF_NODE_FACTORY.json` — exemplar autonomous regenerable workflow
- `packages/n8n-nodes-aisha/` — custom node source
- `docs/N8N_AGENT_ARCHITECTURE.md` — workflow design philosophy
