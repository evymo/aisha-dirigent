# AISHA — Deploy Flow Operations

Provádí operace na 4-fázovém samořídicím deploy flow (drift, B/G, Sentry, dashboard).

## Arguments: $ARGUMENTS

Sub-commands:
- `status` (default) — souhrn current state
- `drift` — detail unresolved drift
- `slots` — current B/G slot state
- `rollbacks` — pending + recent rollbacks
- `dashboard-rebuild` — vyvolá manual dashboard rebuild
- `drift-now` — vyvolá manual drift check
- `bg-switch <app> <slot> <tag>` — spustí B/G switch (admin only)
- `request-rollback <app>` — vytvoří pending rollback request

## Instructions

Parse `$ARGUMENTS` první slovo jako sub-command.

### `status` (default)

Show:
1. Unresolved drift count: `SELECT get_unresolved_drift_count('low')` + breakdown by risk
2. Active slots overview: `SELECT * FROM get_active_slots()`
3. Recent B/G switches (last 5): `SELECT * FROM get_recent_b_g_switches(5)`
4. Pending rollbacks: `SELECT get_pending_rollback_count()`
5. Pending approvals: `SELECT get_pending_approval_count()`
6. Last dashboard rebuild: `SELECT * FROM get_dashboard_render_history('aisha-ops', 1)`

### `drift`

```sql
SELECT app_name, drift_kind, risk_level, observation_count, age_minutes
FROM get_latest_drift_state(50, true)
ORDER BY
  CASE risk_level
    WHEN 'critical' THEN 0
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
  END,
  observed_at DESC;
```

Show table + akční doporučení per drift.

### `slots`

```sql
SELECT app_name, active_slot, active_image_tag, active_health,
       inactive_image_tag, inactive_health,
       last_switch_at, switch_lock, switch_lock_age_min,
       managed_kind
FROM get_active_slots()
ORDER BY app_name;
```

Flag pokud `switch_lock = true` AND `switch_lock_age_min > 5` — stale lock.

### `rollbacks`

```sql
SELECT * FROM get_rollback_history(20);
```

Group by `approval_status`. Highlight pending.

### `dashboard-rebuild`

```bash
curl -X POST "$N8N_WEBHOOK_URL/webhook/appsmith-rebuild?force=true"
```

Wait for response, log result.

### `drift-now`

```bash
curl -X POST "$N8N_WEBHOOK_URL/webhook/drift-now"
```

### `bg-switch <app> <slot> <tag>`

Validuj args, pak:
```bash
curl -X POST "$N8N_WEBHOOK_URL/webhook/blue-green-switch" \
  -H "Content-Type: application/json" \
  -d "{\"app_name\":\"<app>\",\"target_slot\":\"<slot>\",\"image_tag\":\"<tag>\",\"triggered_by\":\"manual\"}"
```

Warn user — projde fn_evaluate_proposal_risk + možná approval gate.

### `request-rollback <app>`

```bash
PGRST_URL="${POSTGREST_URL:-https://api.aisha.guru}"
curl -X POST "$PGRST_URL/rpc/request_rollback" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_app_name\":\"<app>\",\"p_triggered_by\":\"manual\"}"
```

Returns rollback_history row. Inform user, že rollback je high-risk → musí projít approval.

## Notes

- Vždy show audit-relevant info (timestamps, who triggered)
- Pro write akce (bg-switch, request-rollback): explicit warning + confirmation
- Pokud `POSTGREST_URL` nebo `N8N_WEBHOOK_URL` chybí: error message s instrukcí kde nastavit
- Skill: `.claude/skills/aisha-deploy-flow/SKILL.md` má detailní recepty
