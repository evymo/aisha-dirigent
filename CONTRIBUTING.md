# Contributing to AISHA Platform

Language versions: English (this file, primary) · [Čeština](CONTRIBUTING.cs.md) (older, detailed
engineering conventions; being consolidated into the English set).

Thank you for considering a contribution. This document explains where development happens, what a
change needs before it can be merged, and the rules that the repository enforces automatically.

## Where development happens

- **GitHub** (`evymo/aisha-orchestrator`) is the public repository. Pull requests run the CI pipeline in
  **GitHub Actions** (`.github/workflows/`) on GitHub-hosted runners — no private runner, registry or
  forge is needed. A merge to `main` waits on a single required check, `PR: verdikt`.
- **Deployment is opt-in.** The deploy/provision jobs (Coolify), kiosk and mobile publishing, package
  publishing and the scheduled dependency sweep only run in a repository that configures them
  (repository variables such as `APP_NAME_PREFIX`, `VERDACCIO_URL`, `KIOSK_REGISTRY_REPO`); everywhere
  else they show as skipped. Nothing about a particular instance is written into the workflows.
- Public previews are produced by `npm run release:public-snapshot` from a known commit
  (see [docs/release/PUBLIC_PREVIEW.md](docs/release/PUBLIC_PREVIEW.md)).
- Every CI lane is also runnable **locally, without any forge** — see
  [Running the CI lanes locally](#running-the-ci-lanes-locally).

## Licence and CLA

- Code is licensed under the [Elastic License 2.0](LICENSE). You may use, modify, self-host and deploy
  it for clients; you may not offer it to third parties as a hosted or managed service.
- Contributions are accepted under a light [CLA](CLA.md): you keep your copyright and grant Evymo a
  licence including the right to re-license. Express agreement with a `Signed-off-by` trailer
  (`git commit -s`).
- The hosted AISHA service (internal models, evaluation and routing) is not part of the repository or
  the licence. Model: [docs/LICENSING_INTENT.md](docs/LICENSING_INTENT.md).

## What a change needs

1. **A measured reason.** Describe the defect or the capability and how you measured it (a failing
   test, a reproduced incident, a gate that was silent). "Status quo" is not design intent; neither is
   a guess.
2. **The fix at the source of truth.** Database changes go to `aisha/db/sql/` (plus `aisha/db/heals.sql`
   for running databases) — never hand-edit the generated baseline or compiled seeds. Instance values go
   to the instance overlay, not to the platform.
3. **Tests.** New code comes with tests; a new architectural rule comes with a gate in
   `src/tests/gates/` that fails on the defect it prevents (and a self-test proving it can see it).
4. **No regressions.** `npm run test:run`, `npm run test:gates`, `npm run type-check` and `npm run lint`
   pass. Database changes also pass `npm run test:db`.
5. **No secrets, no instance identity.** Nothing instance-specific (domains, hosts, tenant names,
   operator e-mails, developer account codes) in generic code, examples or comments. Gates reject
   committed secrets and real values in `*.example` files.
6. **Small, focused commits** with a conventional message: `type(scope): short description`
   (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`).

## Local setup

```bash
nvm use                      # Node 22
npm ci
npm run build:packages
bash scripts/local-warmup.sh --apps core,keycloak,ai-chat --seed-profile template --non-interactive --wait
npm run dev
```

The repository installs git hooks (`.husky/`): pre-commit runs type-check, lint, i18n parity, the
split-rule gate and secret guards; pre-push runs the CI-equivalent lanes for the changed paths. Do not
bypass them — if a hook is wrong, fix the hook.

More: [README.md](README.md), [docs/DEV_STACK.md](docs/DEV_STACK.md),
[docs/onboarding/LOCAL_BRINGUP.md](docs/onboarding/LOCAL_BRINGUP.md),
[docs/COMMIT_WORKFLOW.md](docs/COMMIT_WORKFLOW.md).

## Running the CI lanes locally

Every job in `.github/workflows/ci.yml` is a thin wrapper around an npm script or a repository script,
so the same checks run on a laptop with no forge, no secrets and no private registry. Install once
(`npm ci && npm run build:packages`), then:

| CI job | Local command |
|---|---|
| Detect Changes (path routing) | `bash scripts/ci/zmenene-cesty.sh --seznam origin/main HEAD \| bash scripts/ci/zmenene-cesty.sh` |
| Web: TypeScript & Lint | `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run i18n:check && npm run gate` |
| Web: Tests | `npm run test:run`, `npm run test:gates`, `npm run test:scripts` |
| Web: Build | `npm run build` |
| Services: Tests | `npm run test:services` |
| Surfaces: Contract & Overlays | `npm run test:surfaces && npm run surfaces:build:all` |
| Governance: DB & Security Gate | `npm run validate:static && node scripts/db/db-manager/access.mjs --static` |
| DB runtime lanes (Docker) | `npm run test:db`, `npm run test:db:rohatka`, `npm run test:db:surfaces` (throwaway Postgres) |
| AV / Blockchain integration (Docker) | `npm run test:integration:av`, `npm run test:integration:blockchain` |
| Disclosure / secret scan | `node scripts/verify-no-dev-codes.mjs`, `gitleaks detect --config .gitleaks.toml` |
| Mobile, Extension, n8n nodes, Cosmos | `npm --prefix mobile-app test`, `npm --prefix extensions/aisha-dirigent test`, `npm --prefix packages/n8n-nodes-aisha test`, `(cd cosmos && go test ./...)` |

The pre-push hook (`.husky/pre-push`) already runs the lanes that the changed paths select (same
router as CI, `scripts/ci/zmenene-cesty.sh`); `npm run test:gates:dotcene` runs just the gates your
change touches. To lint the workflow files themselves use
[`actionlint`](https://github.com/rhysd/actionlint); to replay a whole workflow in Docker,
[`act`](https://github.com/nektos/act) works too (its `.secrets`/`.actrc` are git-ignored).

## Engineering conventions (short form)

- **RPC-only data access** from every client; sensitive RPCs end with `_audited` and write the audit
  journal; `SECURITY DEFINER` functions pin `search_path` and answer only about the caller.
- **Validation at the boundary** with Zod; no `any`; errors through `safeError()` so no payload leaks
  into logs.
- **Fail-closed configuration**: no `${VAR:-our-default}` with an instance value, no allow-lists that
  decide capability, no silent skips — a step that did not run reports "not measured", not green.
- **i18n**: UI strings live in `src/i18n/segments/<locale>/`; every key exists in every declared
  locale (`npm run i18n:check`).
- **Documentation** is written in English first; other languages are generated from it.

The Czech document [CONTRIBUTING.cs.md](CONTRIBUTING.cs.md) still carries the longer code-standard
catalogue (naming, import order, test structure, RLS policy template) until it is translated.

## Reporting security issues

Do not open public issues for vulnerabilities — follow [SECURITY.md](SECURITY.md).
