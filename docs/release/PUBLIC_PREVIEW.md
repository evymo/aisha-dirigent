# Public preview — how the GitHub snapshot is produced and verified

> **Audience:** maintainers who publish a public preview; contributors who want to know what the
> GitHub repository is.
> **Status:** process in use since public alpha preview 6 (2026-10-03).

## What the public repository is

`github.com/evymo/aisha-orchestrator` is **not a mirror with history**. It holds one commit per public
preview: an orphan commit whose tree is the verified tree of a known upstream commit. Upstream history
is never published, because it contains values that were valid at some point (tokens, personal data
in old seeds) and the owner decided not to rotate them but to publish only history-free snapshots.

Consequences:

- `git log` on GitHub shows the previews only. The upstream commit each preview was cut from is
  recorded in the commit message.
- There are no branches other than `main` on GitHub.
- **CI ships with the code** (owner's instruction 2026-10-08, superseding the 2026-10-03 "nothing
  runs on GitHub"): the private forge is not part of the public code, and the tests must stay usable
  in general — locally and on GitHub. The snapshot therefore carries `.github/workflows/` (GitHub
  Actions on GitHub-hosted runners, no private runner, registry or forge) and every lane also runs
  locally (`CONTRIBUTING.md`, "Running the CI lanes locally"). Instance-specific lanes (deploys, kiosk/mobile publishing,
  package publishing, the scheduled dependency sweep) are opt-in through repository variables and
  are skipped otherwise. Dependabot configuration stays excluded (`scripts/aisha-deps-update.mjs`
  is the updater). Whether Actions are switched on in the public repository is the owner's step
  (section "Flipping the repository to public").
- Replacing `main` is a forced push by design — and **a forced push does not remove history from a
  repository that already had some**. See the next section before making any repository public.

## A repository that ever had pull requests keeps their history

A forge keeps a ref `refs/pull/<n>/head` for every pull request ever opened. The owner cannot delete
those refs, a forced push does not touch them, deleting the branch does not touch them, and anyone who
can read the repository can fetch them together with everything they descend from.

Measured on the previous mirror, `github.com/evymo/aisha-dirigent`, on 2026-10-03, after its `main` had
long been a single squashed commit and all 65 Dependabot branches were deleted:

| | |
|---|---|
| pull-request refs | 389 |
| commits still reachable through them | 1 575 |
| distinct history roots | 5 — real development history from 2025-01 (8 refs), the 0.8.9-alpha snapshot (159), "public alpha preview" (1), preview 3 (82), preview 5 (139) |
| gitleaks over that history (redacted) | 701 findings; among them the compromised-credential signature (40), Coolify API token shape (7, four files), private-key blocks (8, including a TLS key file) |

So **that repository must never be flipped to public**, whatever its `main` holds. A public preview
needs a repository that never had those refs:

1. delete the repository and create it again under the same name (the owner does this — it is
   irreversible and needs the `delete_repo` permission), **or**
2. ask the forge's support to purge the pull-request refs and unreachable objects, **or**
3. publish into a new repository.

Then publish the same snapshot commit again; the tree hash in the manifest must match.

That is why the public repository is `evymo/aisha-orchestrator`, created on 2026-10-03 for preview 6:
it never had a pull request before its first snapshot. The previous mirror stays private until it is
deleted.

The tool enforces this: `--push` refuses a remote that keeps any ref outside `refs/heads/` and exits
with code 3. `--accept-retained-refs` overrides the refusal for a **private staging** push only; the
run then prints how many such refs the remote keeps.

## The tool

```bash
npm run release:public-snapshot -- --help
```

`scripts/release/public-snapshot.mjs` (tests: `scripts/release/public-snapshot.test.mjs`):

1. **Source tree.** `--source <rev>` (default `HEAD`) takes the committed tree of a revision;
   `--source worktree` builds a temporary index from the working tree (used when the snapshot must
   include changes that are committed upstream only later — the manifest records the base commit and
   every path that differs from it).
2. **Exclusions.** Paths listed in `config/public-snapshot.exclude` (gitignore-style patterns, one per
   line, reason in the comment above each) are removed from the published tree. The upstream tree is
   not modified.
3. **Checks (fail-closed).** The published tree is scanned and the run stops on the first class of
   findings:
   - forbidden paths — `00_prod_users*.sql`, real `.env*` files, private-key file extensions,
     `config/tenant.json`, `config/operators.json`, `.env-prod-backup`;
   - private-key bodies — a file that carries both a `BEGIN … PRIVATE KEY` header and a base64 body line;
   - PostgREST `service_role` tokens (the role-first JWT shape);
   - Coolify API tokens (`<id>|<40+ alphanumerics>`);
   - home-directory paths (`/Users/<name>`);
   - public IPv4 addresses outside reserved and documentation ranges;
   - free-mail addresses outside test fixtures and fictional templates.
   The checks are deliberately **not** an allowlist of known findings: every pattern must be absent.
4. **Commit.** `git commit-tree` with no parent. The message carries the preview label, the upstream
   commit, the tree hash, the excluded paths and the check summary. Trailers (for example
   `Co-Authored-By`) are passed with `--trailer`.
5. **Publish** (only with `--push <remote>`): refuses a remote that keeps refs outside `refs/heads/`
   (see above), then a forced push to `refs/heads/main` (or `--branch`); `--prune-remote-branches`
   deletes every other branch on that remote first. Without `--push` nothing leaves the machine;
   `--dry-run` builds, checks and prints the plan. The repository's pre-push hook runs for this push
   like for any other — the snapshot is cut from a tree the full local suite has accepted.

The tool complements, it does not replace, the repository gates that run upstream on every merge:
`no-instance-data-in-public`, `public-oss-boundary`, `no-committed-secrets`,
`no-real-secrets-in-example-env`, `license-consistency`, the split-rule gate, gitleaks in pre-commit.

## Repositories outside this one

The platform depends on four repositories that are not part of this tree. Each is published the same
way — a history-free snapshot through the same tool and the same checks (`--root <repo>`), under the
same licence as the platform (owner's decision 2026-10-03: one licence everywhere; the one exception is
the fork of somebody else's MIT project).

| Repository (upstream) | Role | Licence | Public repository | State for preview 6 |
|---|---|---|---|---|
| `insight` | submodule `packages/insight` — fork of `github.com/AlquistAI/insight` (RAG, dialog management, Czech-aware BM25) | MIT (upstream's) | `evymo/insight` | published: `a5a83cdb0` (upstream `96ec8f258`) |
| `potok` | submodule `packages/potok` — flow-definition runtime | Elastic-2.0 (licence text added for the snapshot) | `evymo/potok` | published: `95c9cf096` (upstream `8a2901ec8` + licence) |
| `aisha-local-ingest` | submodule `packages/local-ingest` — local document ingest | Elastic-2.0 (licence text added; instance names removed from comments, docs and one fixture) | `evymo/aisha-local-ingest` | published: `9dec168d5` (upstream `024108cea` + licence and clean-up) |
| `extranet-sdk` | npm packages `@aisha/extranet-sdk-ui`, `-native`, `-tokens` (workbench shell, mobile app) | Elastic-2.0 (declared in every `package.json`; licence text added) | `evymo/aisha-extranet-sdk` | published (private) from the SDK branch `bez-brandu-instanci`: the base carries no instance brand (tokens 0.3.0, ui 0.6.0, native 0.6.0). Verified from a fresh clone: one commit, builds, 69 tests pass |

The public names of the three submodule repositories are fixed by `.gitmodules`: the URLs are relative
(`../insight.git`, `../potok.git`, `../aisha-local-ingest.git`), so next to `evymo/aisha-orchestrator`
they resolve to `evymo/insight`, `evymo/potok` and `evymo/aisha-local-ingest`.

**Submodule pointers.** A history-free snapshot of a submodule is a different commit than the one
upstream records, so the pointer in the platform's public tree must be rewritten to the submodule's
public snapshot commit, otherwise nobody outside can resolve it:

```bash
npm run release:public-snapshot -- --source HEAD --label "public alpha preview N" \
  --gitlink packages/insight=<public commit> \
  --gitlink packages/potok=<public commit> \
  --gitlink packages/local-ingest=<public commit> \
  --push <remote>
```

The tool refuses a `--gitlink` path that is not a submodule pointer and an abbreviated commit id, and
records every rewrite in the snapshot's commit message. Order: publish the submodule repositories
first, then the platform with the rewritten pointers. Until then a public clone must be made without
`--recurse-submodules`.

**The extranet SDK** could not be published as it was: its token package shipped twelve brand
definitions of concrete instances and its default brand was one of them. The public snapshot is cut
from a branch of the SDK repository where instance brands left the base (a brand is instance data:
one JSON in the instance's own repository, built with `esdk-tokens --brands <dir> --out <dir>`), the
default look is a neutral template, and a test keeps it that way without listing anybody's name.
That branch is a breaking change for instances that used a bundled brand (migration guide in the SDK:
`docs/MIGRACE-BRANDY-INSTANCI.md`), so it reaches the upstream SDK repository through an ordinary
pull request coordinated with the instances. Until it is merged and released to the package registry,
the platform's lockfile still installs the previous `@aisha/extranet-sdk-ui` from the maintainers'
npm mirror; the SDK's own lockfile resolves through that mirror as well.

Changes made only for the snapshots (licence texts, instance names) are kept as patches for the
upstream repositories; they reach upstream through ordinary pull requests.

## Publishing checklist

1. Upstream `main` is green and deployed (never publish a tree that CI has not accepted).
2. `npm run test:gates` on the source tree is green, including the public-boundary gates.
3. `gitleaks dir . --config .gitleaks.toml` on the source tree — read every finding; test fixtures and
   i18n keys are expected, anything else is a stop.
4. `npm run release:public-snapshot -- --source <commit> --label "public alpha preview N" --dry-run`
   — read the plan: excluded paths, check summary, tree hash.
5. Publish: add `--push <remote>` (and `--trailer` lines). The remote must be a repository without
   pull-request refs; `git ls-remote <remote>` must list nothing but `HEAD` and `refs/heads/main`
   afterwards.
6. Verify from a fresh clone: `git rev-list --count HEAD` is `1`, excluded paths are absent, the tree
   hash matches the manifest, `npm ci` succeeds, the README renders. Run `gitleaks git` over the clone:
   its whole history is that one commit.
7. Update the GitHub repository description/homepage if the tagline changed; keep topics.
8. Record the preview (label, upstream commit, tree hash, date) in the table below.

## Flipping the repository to public (owner)

The repository is private until the owner flips it. Before flipping:

- make sure it is a repository **without pull-request refs** (section above) — the one that existed
  until 2026-10-03 is not;
- enable branch protection on `main` (force pushes only by the release identity);
- decide on Actions — the CI (`.github/workflows/`) runs on GitHub-hosted runners, but `npm ci`
  in CI initialises the `packages/extranet-sdk` submodule, whose repository is private: until it is
  public (or checked out with a token), CI on the public repository fails at install. Leave the
  instance variables (`APP_NAME_PREFIX`, `VERDACCIO_URL`, `KIOSK_REGISTRY_REPO`, …) unset unless the
  repository should deploy or publish;
- confirm the licence texts (`LICENSE`, `NOTICE`, `CLA.md`) against the official ELv2 source.

## Known limitations carried into the preview

| Item | State | Where tracked |
|------|-------|---------------|
| Gates that read `.github/workflows/*` and `.github/dependabot.yml` | previews up to 6 did not carry them, so those gates skipped (with the reason in the test name) in a public clone; from preview 7 the snapshot carries the workflows, so only the Dependabot checks skip | this document |
| Package metadata, plugin manifests and install instructions still name the previous mirror `evymo/aisha-dirigent` | links break once that repository is deleted | rename tracked as a follow-up (generated manifests + package versions) |
| Extranet SDK (`@aisha/extranet-sdk-*`) not public | carries instance brands; installs from the maintainers' npm mirror | section "Repositories outside this one" |
| Lockfiles resolve through the maintainers' npm mirror | anonymous read works; public lockfiles move to `registry.npmjs.org` upstream | B7, branch `fix/b7-instalace-bez-nasi-infra` |
| Maintainers' deployment named in defaults/examples/comments | counts in README "Known limitations"; no credentials | B6, "the base carries no instance identity" |
| Login from the apex domain loses OIDC state | fix on an upstream branch | B3 |
| Voice / Matrix end-to-end | deployed, not verified | audit 2026-09-29 |

## Preview log

| Preview | Date | Upstream commit | Notes |
|---------|------|-----------------|-------|
| public alpha preview 5 | 2026-07-09 | (squash, pre-process) | replaced; carried a seed file that must not be public |
| public alpha preview 6 | 2026-10-03 | branch `claude/github-cleanup-docs-09b0b1` (upstream `ffa0689af` + documentation and placeholder fixes) | first preview produced by the tool, published into the new repository `evymo/aisha-orchestrator`; no workflows in the snapshot, Actions disabled; submodule pointers rewritten to the public snapshots of `evymo/insight`, `evymo/potok` and `evymo/aisha-local-ingest`. The previous mirror `evymo/aisha-dirigent` keeps 389 pull-request refs and stays private |
