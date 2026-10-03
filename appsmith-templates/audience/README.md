# Aisha Audience — Appsmith app templates

Pre-built Appsmith application templates that marketers/operators can import
as starting points for their intranet dashboards. All templates query the
SQL views and RPCs added by the audience module (`audience_*` prefix).

> **Looking for a ready-to-render dashboard?** The files here are minimal
> skeletons (see [Stubs](#stubs)). A full, multi-page **Audience** dashboard
> now lives in the native Appsmith builder system at
> [`appsmith/dashboards/audience.template.json`](../../appsmith/dashboards/audience.template.json)
> and is rendered by `node scripts/build-aisha-appsmith.mjs --slug audience`
> (same pipeline as the AISHA Ops dashboard). It is **backend-agnostic**: it
> binds to the `audience_admin_*_v` views, which read aisha's own data
> (profiles, partner_profiles, story_entries, …). A source broker
> (`svc-source-broker` — a CRM source, AdWords, …) is **optional**; it only enriches
> engagement metrics. The dashboard is useful on a standalone aisha stack with
> no external source connected.

## Templates

| File | Drives | Data sources |
|---|---|---|
| `contact-directory.json` | Contact list with tier badges, tags, last-comm | `audience_admin_contact_directory_v`, `audience_admin_search_contacts` RPC |
| `campaign-performance.json` | Per-campaign dashboard (channels, open/click) | `audience_admin_campaign_performance_v` |
| `followup-queue.json` | Marketer to-do list (overdue/today/this_week) | `audience_admin_followup_queue_v`, `audience_admin_create_followup` RPC |
| `tier-funnel.json` | Tier pipeline KPIs + monthly transitions | `audience_admin_tier_funnel_v`, `audience_admin_get_funnel_metrics` RPC |
| `cohort-manager.json` | Cohort CRUD with registrations + engagement | `audience_admin_cohort_overview_v`, `audience_cohort_register_actor` RPC |

## How to import

1. Log into Appsmith at `https://appsmith.<your-aisha-domain>/`
2. New App → Import → Upload JSON
3. Pick a template file from this directory
4. On first run: connect the PostgREST data source pointing to aisha gateway
5. Customize layout, add fields, save as your own app

## Why no custom React frontend?

The audience module backend (`audience_*` SQL views + RPCs) is rich enough
that operators can build their entire audience intranet in Appsmith — drag-drop
forms, tables, dashboards. No need for custom React admin pages.

Benefits:
- Marketers can iterate on UI without engineering tickets
- Multiple intranet apps (e.g., per-team, per-region) without forks
- Standard Appsmith permissions + audit work out of the box
- One less codebase to maintain

## Template structure (all 5 files follow this convention)

```json
{
  "applicationName": "Audience: <feature>",
  "version": 1,
  "dataSources": [
    {
      "name": "aisha-postgrest",
      "type": "PostgresREST",
      "endpoint": "{{appsmith.env.POSTGREST_URL}}",
      "headers": { "Authorization": "Bearer {{user.jwt}}" }
    }
  ],
  "queries": [ /* ... view + RPC calls ... */ ],
  "widgets": [ /* ... drag-drop UI definitions ... */ ],
  "permissions": {
    "view": ["admin", "staff", "marketer"],
    "edit": ["admin", "staff"]
  }
}
```

## Stubs

The JSON files in this directory are **minimal skeletons** documenting the
intended query bindings + widget layout. Marketers fill in full layout in
Appsmith UI after import. They serve as "documentation as code" for the
audience module data substrate.
