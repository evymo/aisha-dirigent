# Partner Metrics Dashboard

Reference **full_stack** plugin for the AISHA sandbox platform.

## What it does

Aggregates partner KPIs (active users, completed projects, satisfaction, revenue),
persists daily snapshots in the plugin KV store, and generates AI summaries on demand.

## SandboxContext API Usage

| API | Used for |
|-----|----------|
| `ctx.rpc("get_partner_stats", ...)` | Fetch raw partner stats from Supabase |
| `ctx.kv.get/set/delete/list` | Persist daily metric snapshots (namespaced per tenant) |
| `ctx.llm.chat(...)` | Generate AI-powered business summary of KPIs |
| `ctx.schedule("0 2 * * *", ...)` | Daily cron rollup at 02:00 |
| `ctx.log(...)` | Structured logging for observability (Langfuse) |

## Capabilities

| Capability | Description |
|-----------|-------------|
| `http.GET./status` | Plugin health check |
| `http.GET./metrics` | Return current + 30-day historical metrics |
| `http.GET./summary` | AI-generated summary of current KPIs |
| `http.POST./refresh` | Manually trigger metrics aggregation |
| `cron.daily_rollup` | Auto-refresh at 02:00 daily |

## Quick Start

```bash
# Scaffold from CLI
aisha-plugin scaffold partner-metrics --kind full_stack

# Submit to AISHA
aisha-plugin submit ./plugins/partner-metrics

# Invoke via plugin-host
curl -X POST http://localhost:57421/functions/v1/plugin-host \
  -H "Authorization: Bearer <token>" \
  -d '{"plugin_id": "partner-metrics", "tenant_id": "<uuid>", "capability": "http.GET./status"}'
```

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `refresh_interval_hours` | number | 24 | Auto-refresh interval |
| `summary_model` | string | gpt-4 | LLM model for AI summaries |
