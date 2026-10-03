# Deploying audience Appsmith templates

This directory ships 5 starter Appsmith app templates (JSON config) that
marketers/operators can import as their audience intranet baseline. After import
they customize layouts, add widgets, write extra queries — Appsmith handles
the runtime.

## Prerequisites

1. **Appsmith instance running.** Aisha provides one at
   `https://appsmith.<your-aisha-domain>/` (configured via Coolify; see
   `docker-compose.coolify-admin.yml` in this fork).
2. **audience migrations applied to aisha-db.** Run
   `bash _platform/scripts/aisha-integration/apply-audience-migrations.sh`
   (assumes `aisha-db` container is reachable).
3. **PostgREST exposes the views + RPCs.** Aisha gateway PostgREST already
   serves `public.*` schema — `audience_admin_*` views appear automatically
   under `GET /audience_admin_<view>` once migrations are applied.
4. **User logged in with appropriate role** (admin or staff for write
   operations; partner for view_own_audience_stats).

## Import flow

### Manual (per-marketer, recommended for initial rollout)

1. Marketer logs in to Appsmith with their Keycloak credentials
2. Click **+ New app** → **Import** → **From file**
3. Pick a JSON from this directory:
   - `contact-directory.json` — main contact list
   - `campaign-performance.json` — campaign analytics
   - `followup-queue.json` — to-do bucket
   - `tier-funnel.json` — KPI dashboard
   - `cohort-manager.json` — cohort CRUD
4. On first import, Appsmith asks for the **PostgREST data source**:
   - Endpoint: `https://aisha-gateway.<your-domain>/` (or `http://aisha-gateway:3001`
     internally)
   - Auth: leave blank for templates (they use Bearer from logged-in user)
5. Appsmith opens the app in editor; customize as needed; **Deploy** for live use.

### Programmatic (via Appsmith REST API — for ops automation)

```bash
# Get an admin token from Appsmith (use service account if available)
TOKEN="<appsmith-admin-pat>"
ORG_ID="<your-appsmith-org-uuid>"
APPSMITH_URL="https://appsmith.<your-aisha-domain>"

for tmpl in contact-directory campaign-performance followup-queue tier-funnel cohort-manager; do
  curl -X POST "${APPSMITH_URL}/api/v1/applications/import/${ORG_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: multipart/form-data" \
    -F "file=@./${tmpl}.json"
done
```

## Permission requirements

Each template's queries require specific aisha permissions (see migration
`20260523200000_audience_permission_codes.sql`):

| Template | Required permission | Default roles with it |
|---|---|---|
| Contact Directory | `manage_actor_audience` | admin, staff |
| Campaign Performance | `compose_audience_message` | admin, staff |
| Follow-up Queue | `manage_actor_audience` | admin, staff |
| Tier Funnel | `manage_actor_audience` | admin, staff |
| Cohort Manager | `manage_actor_audience` | admin, staff |

If a marketer doesn't see data, check their role grants:

```sql
SELECT u.email, arp.role, p.code
FROM aisha_auth.users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN app_role_permissions arp ON arp.role = ur.role
JOIN permissions p ON p.id = arp.permission_id
WHERE u.email = 'marketer@example.org'
  AND p.category = 'audience';
```

## Customizing templates

Once imported, the marketer can:

- **Add new SQL queries** against any aisha view/RPC (queries inside Appsmith,
  not in this repo)
- **Add widgets** (charts, tables, forms) bound to existing queries
- **Add custom logic** in JavaScript-style snippets (Appsmith's expression
  language)
- **Bind to RPCs** like `audience_admin_bulk_tag` or `audience_admin_create_followup`
  for write operations (form submit → POST to PostgREST RPC endpoint)

All marketer-side iteration happens in Appsmith UI — **never requires a code
change in this repo**. That's the entire point of the audience module's
design: data substrate + templates here, runtime UI in Appsmith.

## What about the templates' "stub" nature?

The JSON templates in this directory document the **intended query bindings
and widget layout** — they're not fully fleshed-out Appsmith apps. On first
import the marketer will see the skeleton (tables + filters + key actions)
and fills in styling/layout decisions. This is intentional: the templates
declare _what_ data + RPCs, marketers decide _how_ to present it.

For production-grade ready-to-use apps, build them once in Appsmith UI then
export back as JSON and replace these stubs. PRs welcome.

## Troubleshooting

- **"No data" in tables** → check audience migrations applied (`SELECT count(*)
  FROM audience_actor_aggregate_latest_v` should return 0+ rows; if relation
  doesn't exist, migrations missing)
- **"Forbidden" from PostgREST** → check role grants (table above) + Keycloak
  JWT contains expected role
- **"Function not found" RPC errors** → migrations 20260523100200_audience_functions
  and 20260523100700_audience_operator_rpcs must be applied
- **Sync produces no rows** → broker not running or source-postgres GRANT not
  set; check `make aisha-integration-probe` from _platform
