# Contributing to AISHA Platform

Language versions: English (this file, primary) · [Čeština](CONTRIBUTING.cs.md) (older, detailed
engineering conventions; being consolidated into the English set).

Thank you for considering a contribution. This document explains where development happens, what a
change needs before it can be merged, and the rules that the repository enforces automatically.

## Where development happens

- **Upstream** is the maintainers' own private git server. CI, gates and deployments run there.
- **GitHub** (`evymo/aisha-orchestrator`) is the public, history-free snapshot of upstream. Issues and pull
  requests opened here are reviewed by the maintainers and ported upstream; expect a reply, not an
  automatic CI run: nothing runs on GitHub — the public snapshot carries no workflows.
- Every public preview is produced by `npm run release:public-snapshot` from a known upstream commit
  (see [docs/release/PUBLIC_PREVIEW.md](docs/release/PUBLIC_PREVIEW.md)).

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
