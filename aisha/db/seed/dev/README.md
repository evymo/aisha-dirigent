# Dev fixtures layer

Committed, deterministic **dev/test** reference data — applied by the `dev` seed
profile (`AISHA_SEED_PROFILE=dev`, the default for `npm run warmup:local` and the
local dev/test stack). Kept **separate from `demo/`**: demo is public showcase
data; this layer is neutral fixtures a developer works against while building and
running tests.

## Principles

- **FK-safe**: rows use `NULL` for optional foreign keys (`partner_id`,
  `user_id`, …) so the layer never depends on demo partners/users/studies.
- **Idempotent**: every insert uses `ON CONFLICT (...) DO UPDATE`, so re-seeding
  a running dev DB is safe.
- **Stable reference data only** — NOT ephemeral runtime rows. Live agent
  sessions, trace events and blocked spend runs are created at runtime (by the
  supervisor relay, the VS Code extension, or the e2e specs), never seeded here.
- **Admin-visible**: stories have `is_stack_default=false` + `NULL` participants,
  so an admin/staff operator sees them (RLS admin-sees-all), giving Mission
  Control / Kanban real rows out of the box.

## Files

| File | Seeds |
|------|-------|
| `01_dev_stories.sql` | A handful of dev stories across kanban statuses |
| `02_dev_spend_policy.sql` | A sensible global `ai_spend_policies` default so the spend-governance surfaces show a rule |
