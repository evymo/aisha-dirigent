---
description: Switch AISHA router slot profile (budget / balanced / maxQuality) for the current dev session. Updates .aisha/dirigent.json locally; never pushes prod env. Use when router-coach advisory suggests profile change due to cost overrun, or when you want to opt into cheap models for an exploratory pass.
---

# /aisha-router-config — switch slot profile

Updates the local `.aisha/dirigent.json` `routerCoach.slotProfile` setting. Does **not** modify production env or backend orchestration. AISHA backend continues to decide profile per task via `aisha_choose_execution_strategy` based on `budget_remaining_usd` and `criticality`.

## Read current state

```bash
cat .aisha/dirigent.json 2>/dev/null | jq '.routerCoach // {}'
```

## Profiles

- `budget` — force cheapest model in each slot (~40% savings vs balanced)
- `balanced` (default) — matrix default per slot
- `maxQuality` — force premium model in each slot (slower, more $$)

## Switch profile

Replace `<profile>` with one of `budget|balanced|maxQuality`:

```bash
# Ensure .aisha/dirigent.json exists with default shape
if [[ ! -f .aisha/dirigent.json ]]; then
  cp -n .aisha/dirigent.template.json .aisha/dirigent.json 2>/dev/null || \
    echo '{}' > .aisha/dirigent.json
fi

# Atomic write via jq
TMP=$(mktemp)
jq --arg p "<profile>" '.routerCoach.slotProfile = $p | .routerCoach.enabled = true' \
  .aisha/dirigent.json > "$TMP" && mv "$TMP" .aisha/dirigent.json

cat .aisha/dirigent.json | jq '.routerCoach'
```

## Set cost threshold (optional)

```bash
TMP=$(mktemp)
jq --argjson t 0.30 '.routerCoach.costThresholdUsd = $t' \
  .aisha/dirigent.json > "$TMP" && mv "$TMP" .aisha/dirigent.json
```

## See live cost

```bash
cat .aisha/session-cost.jsonl | jq -s '[.[].cost_usd] | add'
```

## See slot routing matrix (DB-side)

```bash
psql "${AISHA_DB_URL}" -c "SELECT slot, tier, model_id, provider FROM get_slot_routing_table() ORDER BY slot, tier;"
```

## Restore default

```bash
TMP=$(mktemp)
jq '.routerCoach = {"enabled": true, "costThresholdUsd": 0.50, "slotProfile": "balanced"}' \
  .aisha/dirigent.json > "$TMP" && mv "$TMP" .aisha/dirigent.json
```

## Related

- Skill: `.claude/skills/aisha-router-tuning/SKILL.md` (deep dive)
- Subagent: `.claude/agents/dirigent-router-coach.md` (auto-suggests profile switch when cost crosses threshold)
- Hook: `.claude/hooks/migration-sot-pair-check.sh` (advisory `[router-coach]` lines on stderr)
