# Instance-data overlay — template for new adopters

This directory is a **copy-me skeleton** for the *private* per-instance overlay
repo that turns a clean AISHA stack into *your* instance: your knowledge base,
your web content, your Keycloak clients, and your operator accounts.

> **Why a separate repo?** The overlay carries PII (real operator emails) and
> instance-specific content. It must live in a **private** repo — never in this
> public platform repo. The platform repo stays fork-safe and tenant-free; the
> overlay is the one place your instance's identity lives.

A fork = *this platform repo* (unchanged) **+** *your private overlay repo*. Point
the stack at the overlay with a single variable and cold-start does the rest.

---

## 1. Create your overlay repo

Copy the contents of this directory into a new **private** git repo on your
git host. The name is up to you — the stack only knows the URL you declare
(§4); nothing is derived from an org or naming convention. A natural choice:

```
<your-org>/<your-org>-instance-data
```

e.g. org `acme` → `acme/acme-instance-data`.

## 2. Repo layout (the file contract)

Everything is **top-level** except Keycloak clients. Every file is optional —
include only what your instance needs.

```
<overlay-repo>/
├── operators.json              # who gets a Keycloak account + app roles
├── keycloak/
│   └── NN-<name>-client.json   # extra OIDC clients (one file each)
├── 00_<name>.sql               # instance SQL, applied in filename order
├── 01_<name>.sql               # (00_, 01_, 02_ … — lexicographic)
└── README.md                   # your notes (ignored by the stack)
```

| File | Consumed by | When |
|------|-------------|------|
| `operators.json` | `scripts/db/provision-operators.mjs` (via cold-start / `instance-rollout.sh`) | KC accounts created host-side; DB roles applied in the migrate container |
| `keycloak/*-client.json` | `keycloak/configure-realms.sh` + `scripts/instance-rollout.sh` | upserted into the app realm via the Admin API |
| top-level `NN_*.sql` | `scripts/deploy/instance-data-hook.sh` | applied inside the core `migrate` container on every deploy |

### `operators.json`

The operator roster. **No `user_id`/`sub`** — `provision-operators.mjs` resolves
each operator's *live* Keycloak `sub` by email, so the roster survives a fresh
Keycloak (a `--wipe`). Missing accounts are auto-created with a one-time
temporary password printed **once** to the cold-start / rollout terminal
(`[TEMP-PASSWORD]` block); first login forces a password change. Existing
accounts are **never** modified. See [`operators.json`](operators.json) and the
fuller annotated template at
[`config/operators.json.example`](../../../config/operators.json.example).

### `keycloak/*-client.json`

One OIDC client per file, in the [Keycloak client representation][kc-client]
shape. Upsert is idempotent (PUT when the `clientId` exists, POST otherwise).
See [`keycloak/01-example-client.json`](keycloak/01-example-client.json).

### `NN_*.sql`

Your instance's SQL, applied in filename order on **every** core deploy — so it
**must be idempotent** (`INSERT … ON CONFLICT … DO UPDATE`, `CREATE … IF NOT
EXISTS`). It runs against the same DB as the platform seed; write to your own
rows, never `TRUNCATE`/`DROP` platform tables. See
[`00_example_seed.sql`](00_example_seed.sql).

## 3. Idempotency contract

Cold-start, `instance-rollout.sh`, and the migrate hook are all **re-runnable**.
Anything you add must be too:

- SQL: guard every write (`ON CONFLICT`, `IF NOT EXISTS`). Assume it runs N times.
- Keycloak clients: the upsert handles create-vs-update for you.
- Roster: create-missing only; re-runs never touch existing users.

This is what makes `wipe = repo/fork is the source of truth` hold: a full wipe +
cold-start reconstructs your instance from the platform repo + this overlay.

## 4. Wire it to the stack

The stack reads one variable:

```bash
AISHA_INSTANCE_DATA_GIT_URL=https://<git-host>/<org>/<org>-instance-data.git#main
GIT_TOKEN=<read token for the private repo>
```

- The `#main` suffix pins a branch/tag/SHA (optional; defaults to the repo default).
- Declare the URL **token-free**; cold-start adds `GIT_TOKEN` for the clone
  (`oauth2:<token>@…`) and builds get it through the BuildKit secret `git_token`.
  Any credential is **redacted in every log line**. Keep tokens out of the public
  repo; supply them via `.env-prod-backup` / your environment.
- **No derivation:** unset = community install, no overlay. The URL is never
  guessed from an org or naming convention.

## 5. Lifecycle

**Fresh fork / cold-start** — `scripts/aisha-cold-start.sh` reads the overlay's
`operators.json` for the roster (this repo is the single source of truth;
`config/operators.json` is only a fallback), imports the realm + your KC clients
via `configure-realms.sh`, host-side auto-creates missing operator accounts, then
the core migrate applies your `NN_*.sql` and the operator DB-role grants. All
automatic — no manual step.

**Day-2 (you changed the overlay)** — from an operator host:

```bash
scripts/instance-rollout.sh                 # KC plane: clients + roster (idempotent)
scripts/instance-rollout.sh --redeploy-core # + apply the SQL/DB plane via a core re-migrate
```

`instance-rollout.sh --help` documents every phase.

## 6. Security checklist

- [ ] Overlay repo is **private**. Real operator emails (PII) live only here.
- [ ] No secrets in `NN_*.sql` or client JSON — use env/Vault references, not literals.
- [ ] Clone URL (with token) supplied via env / `.env-prod-backup`, never committed.
- [ ] `NN_*.sql` only writes your instance's rows; never drops/truncates platform tables.

[kc-client]: https://www.keycloak.org/docs-api/latest/rest-api/index.html#ClientRepresentation
