# Per-Implementation Seed Layers

The public repository separates reusable platform data from concrete stack
implementations.

- `platform`: schema SoT, operational seed and neutral platform translations.
- `demo`: public showcase data.
- `implementations/<name>`: one concrete implementation of the platform.
- `instance`: private overlay for one deployment.

`AISHA_IMPLEMENTATION` selects the implementation layer. `AISHA_STORY` and
`STORY` are supported only as legacy fallbacks because they are also used by
older deployment scripts for app naming.

## Profiles

`scripts/db/compile-seed.mjs` composes layers as follows:

- `platform` or `empty`: `core/` + `translations/`
- `demo`: platform + `demo/`
- `implementation`: platform + `implementations/<AISHA_IMPLEMENTATION>/`
- `instance`: platform + implementation + `instance/`
- `full`: platform + implementation + `instance/` + `demo/`

The default profile is `platform`, so public seed artifacts cannot accidentally
include implementation or private data. Production/private deployments must set
`AISHA_SEED_PROFILE=instance` explicitly.

## Client Implementations

Client stacks such as patient, Buddhist, union or other customer installations
are the same class of thing as the public `aisha` implementation: each is a
full concrete use of the AISHA platform. Their data belongs outside this public
repo, typically as:

- a private submodule mounted at `aisha/db/seed/implementations/<name>/`,
- a private `aisha/db/seed/instance/` overlay, or
- `AISHA_IMPLEMENTATION_HOOK=<path>/migrate-hook.sh`.

`AISHA_TENANT_HOOK` remains a legacy alias for the hook.

## Public `aisha` Implementation

`implementations/aisha/` contains only public, non-sensitive reference data for
our AISHA service implementation. It must be idempotent SoT seed data, not
upgrade-only rebrand deltas. Operators, private customers, real production
content and secrets stay in env/private overlays.
