---
name: aisha-surfaces
description: Work on the extranet surfaces — sections, block masks, and deploying a surface SPA. Use when adding or changing a section (porada, workbench, registry, ask, mission_control), adding a block type, wiring a block to a data RPC, or provisioning/redeploying the extranet. Triggers on "extranet", "surface", "section", "block type", "surface_layouts", "surface_blocks", "get_surface_layout", "get_block_data", "timing tower", "mission control", "porada", "provision-surfaces", "surface-host", "workbench-shell". Critical: sections are open DATA (backend decides), block_type is a CLOSED mask (a renderer the client must ship) — and surfaces deploy via provision-surfaces.sh, NOT via aisha-redeploy.mjs.
---

# AISHA Surfaces Skill

The extranet is one app made of **sections**, each a list of **blocks**, each
block rendered by a **mask** and fed by an allowlisted **data RPC**.

## The one rule that governs everything here

**Sections are open. Masks are closed.**

| | open (DATA — backend decides) | closed (MASK — client must ship it) |
|---|---|---|
| what | `surface_layouts.surface`, which blocks, order, `audience` | `surface_blocks.block_type`, `chart.kind`, `intent`, run `flag` |
| change = | a row | a release of every client |

A new section is a row in the instance overlay — never a migration, never a
client release. A new block type is a renderer, and a renderer cannot be sent
over the wire, so it stays a closed catalogue.

**Why this matters more than it looks:** JSON Schema is all-or-nothing. If a
client's list is *narrower* than the DB's, one unknown value invalidates the
WHOLE layout, `get_block_data` is never called, and the screen says "data could
not be loaded" — a contract bug that looks like a data bug. Always widen the
bundle BEFORE the data.

**Arrangement is a hint, not a mask.** `source_params.presentation` (lifted
into the layout by `get_surface_layout`) tells the shell how the block WANTS to
sit; an unknown value degrades to the default drawing, never drops the layout.
Values the shells understand: `tape` (a review_queue drawn as the day's stream)
and `detail` (the block reads ONE record — it must be PLACED in the section so
the dispatcher admits it, but it is fetched and drawn only in the record detail
pane via `workbench.detail_by_kind`, never in the section list; without the hint
each such block is an empty frame plus a wasted request on every open — measured
2026-09-05 on the twin registry). Web: `apps/workbench-shell/src/App.tsx`
`loadConsole`; mobile: `mobile-app/src/app/porada.tsx`.

## Adding or changing a section

Sections live in instance data, not in this repo:
`<instance-data-repo>/42_surface_layouts.sql` is the **single authority** on
placement. It declares the full desired state and deletes anything not declared,
so it converges from any prior state.

- Never place blocks from another file. A second writer (43 once did) re-inserts
  rows 42 just deleted, and the layout never converges.
- Blocks may appear in several sections — `unique` is `(surface, block_id)`.
- Verify with the RPC, not by reading the file:
  `SET LOCAL ROLE service_role; SELECT * FROM jsonb_to_recordset(public.list_surface_sections()) AS x(section text, block_count int);`

Clients **discover** sections through `list_surface_sections()` and render a nav
tab per section. Nothing hardcodes a section name; a shell that does is the bug
that once left `porada` — 7 blocks of real data — with no web client at all.

## Adding a block type (the closed side)

Three places move in **lockstep** or the parity test fails:

1. `packages/surface-blocks/src/types.ts` — `BlockType` union + interface
2. `packages/surface-blocks/src/schemas.ts` — `blockSchema.anyOf` branch **and**
   the `layoutSchema` enum
3. `aisha/db/sql/tables/surface_blocks.sql` — the `block_type` CHECK

Then `aisha/db/heals.sql` must widen the CHECK on existing DBs **before** any row
can carry the new type (a fresh baseline only reaches new databases).

**Renderers ship with the type.** `surface-renderer-parity.gate.test.ts` fails
until every client draws it — `apps/workbench-shell` and
`mobile-app/src/extranet/BlockRenderer.tsx`. That pressure is deliberate: a
catalogue entry nobody can draw is worse than no entry.

Prefer ONE type with a closed discriminator over several near-identical types —
`chart` covers trend/bar/donut via `kind` because they are one renderer picking a
visualisation, not three renderers.

Device adaptation is the **renderer's** job, never an axis of the layout. The
phone may draw a ring as a fill bar; it must not get a different section.

## Wiring a block to data

`get_block_data(slug)` dispatches through an allowlist:

- the RPC must exist AND have a row in `surface_data_rpcs` with
  **`is_active = true`** — the column defaults to `false`, so an inserted-but-
  inactive row is rejected with `data rpc not allowlisted`. Fail-closed by design.
- block RPCs are fail-closed on identity: no `auth.uid()` and not service_role →
  **empty data, not an error**.
- `SECURITY DEFINER` functions must declare `SET search_path TO 'public', 'pg_temp'`
  in exactly that form, or the OWASP gate fails them.
- every block carries provenance — `source_slug`, `freshness_at`, `trace_id`.
  No figure without a source.

## Actions from the surface (writes, ADR-003 K4)

Reads are blocks; writes are **actions**, and actions are data too. A row in
`surface_actions` is the whole declaration: `action_slug`, `target_kind`
(`twin` | `actor` | `story` | `none`), the target RPC (`rpc_name`), an
`arg_map` (how each RPC argument is filled: `target.*`, `caller.user_id`,
`const`, `payload`), the form `fields` the client should draw (type,
required, enum options, default), and an `audience` mask evaluated by RLS.
The client never learns `rpc_name` or `arg_map` — it gets slug + title +
fields from the `action_form` mask (`get_surface_actions_block`, placed in a
section with `presentation: 'detail'` and `client_params` for the identity)
and submits through ONE RPC, `submit_surface_action(slug, target, payload)`,
which is SECURITY INVOKER on purpose: the target function runs with the
caller's own EXECUTE rights and its own admin/staff checks, never as owner.
Payload is validated against the declaration server-side (unknown keys are
dropped, missing required → 22023, unknown/inactive slug → 42501) and every
submit lands in `audit_journal` as `surface_action` with payload *keys*, not
values. A new operator action is therefore a new row in the instance overlay
(see `43_audience_surface.sql` in `<fork>-instance-data`, section 5),
not a new function and not a new client branch. Tests:
`src/tests/db/surface-actions-contract.test.ts` (DB) and
`apps/workbench-shell/test/action-form.test.tsx` (shell).

## Axes of the view (the lens, ADR-003 K5)

The lens above a section — "show me only X" — is **data, not a constant**. A row
in `surface_scope_axes` declares one axis: `title_key`, the `dim` (the parameter
name the chosen value travels under), `params` (which substrate to derive options
from), and `surfaces` (which sections offer it; empty = all). `get_surface_scope_axes`
returns the axes the caller may use for one section, each already carrying its
options; an axis with no options is not returned, so the lens never offers an
empty choice.

Options are **derived, never kept in a codebook**. `get_scope_options` knows six
substrate KINDS and no names: `registry` (document header field), `twin` (twin
parameter), `twin_kind` (`twin_entities.entity_type`), `relation`
(`twin_relations.relation_kind`), `label` (`story_labels` by resource kind), and
`template` (workflow template name, counted by runs). A new instance adds an axis
by adding a row, never by editing the fork.

An axis only works if a block **accepts** it: the value arrives as `p_params[dim]`,
so a restricted block must declare it in `client_params` (K3) and name the column
in `filters`. A filter takes an operator — `eq` (default) or `contains` for a
column holding several values (tags, relation kinds). Declaring an axis no block
accepts produces a lens that filters nothing, which is worse than no lens.

⛔ Until 2026-09-06 the axis list was a constant in `apps/workbench-shell/src/App.tsx`
carrying another product's names (`owner_company`, `unit_site`, inherited from the
shared fork ancestor); an instance that does not know those names got a lens that
silently rendered nothing, and one of the two axes had no consumer RPC at all. If a
section declares no axis, there is simply no lens — that is the honest answer.

⛔ **A changed view must be REPLACEABLE, not just creatable.** `CREATE OR REPLACE VIEW`
can only append columns after the last one; inserting one in the middle is a rename to
Postgres and the deploy fails ("cannot change name of view column …"). A throwaway
database never sees this because there the view is CREATED, while production REPLACES
it — measured in production 2026-09-06 (migrate exit 1, stack without gateway, API 502).
Put a new column last, or make heals drop the view first when it has no SQL consumers.
Tests: `src/tests/db/scope-axes-contract.test.ts`,
`apps/workbench-shell/test/osy-pohledu-jsou-data.test.tsx`,
`src/tests/db/pohled-jde-nahradit.test.ts`.

## Measuring a surface (do this before claiming anything)

An unauthenticated query hits the fail-closed branch and returns empty, which is
indistinguishable from "there is no data". **Always ask with an identity:**

```sql
SET LOCAL ROLE service_role;
SELECT left((public.get_block_data('mc_tower','{}'::jsonb))::text, 400);
```

This exact mistake produced a false "porada has no data" report while the block
was returning tenants, amounts and confidences.

## Deploying a surface

**`aisha-redeploy.mjs --only=extranet` does nothing** — surfaces are not compose
stacks and are not in `WAVES`. It exits successfully, which reads like success.

Use `scripts/provision-surfaces.sh` (idempotent; creates/reconciles the Coolify
app **and** its Keycloak client, then triggers the deploy). Full runbook and
traps: `docs/release/AISHA_SURFACES_DEPLOY.md`.

Surfaces stay separate on purpose: their own cadence and blast radius. A label
fix ships without touching the core, the DB or a migration, and a broken surface
build cannot take the backend down.

Deploying the core does **not** rebuild a surface. After merging a change to the
shells, redeploy the surface too, or you will verify against the old bundle.
