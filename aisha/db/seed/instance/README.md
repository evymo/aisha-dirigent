# Instance seed layer — not included in the open-source distribution

This directory is where a deployment's **own real project data** (the "instance"
seed layer) lives — its stories, partners, knowledge items and operator-tier
expert rules. It is intentionally **empty in the open-source repository**.

## Why it's empty here

The public platform ships only the neutral base + demo showcase. Real
deployment content is private and lives in a separate, private repository
(mounted here as a git submodule in the maintainers' own checkout). It must
never be published to the open-source mirror.

## How to use it

- **Run the platform without it:** nothing to do. `compile-seed.mjs` detects an
  empty/absent `instance/` directory and simply skips the instance layer
  (`AISHA_SEED_PROFILE` falls back to core + translations, optionally + demo).
- **Add your own instance data:** drop ordered `NN_*.sql` files here (idempotent,
  `ON CONFLICT`), or wire this path to your own private content repo as a
  submodule. They are applied at cold-start when `AISHA_SEED_PROFILE=instance`.

See `scripts/db/compile-seed.mjs` and `scripts/db/seed-instance.mjs`.

## A fork's deliberate deviation

This **private deployment fork** commits its own instance overlay directly here
(e.g. `01_<instance>_story.sql` — story registration + Dirigent delegation ruleset;
low-sensitivity, no member data/PII) instead of using a private submodule. The
trade-off is documented in `docs/planning/zadani/WP-09-boundary-hardening.md`;
leak protection for the tenant name in PUBLIC artifacts (compiled seed, realm,
baseline, composes) is enforced by `no-instance-data-in-public.gate.test.ts`
(`OWN_TENANT_SENTINELS`) and `public-oss-boundary.gate.test.ts`. If this repo is
ever mirrored publicly, move the overlay to a private content repo first
(`AISHA_INSTANCE_DATA_GIT_URL` hook).
