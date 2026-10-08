# Public preview — how the GitHub snapshot is produced and verified

> **Audience:** maintainers who publish a public preview; contributors who want to know what the
> GitHub repository is.
> **Status:** process in use since public alpha preview 6 (2026-10-03).

## What the public repository is

`github.com/evymo/aisha-orchestrator` is **not a mirror with history**. Its `main` is one commit — the
current public preview: an orphan commit whose tree is the verified tree of a known upstream commit. Upstream history
is never published, because it contains values that were valid at some point (tokens, personal data
in old seeds) and the owner decided not to rotate them but to publish only history-free snapshots.

Consequences:

- `git log` on GitHub shows that one commit. The upstream commit the preview was cut from is
  recorded in its message. Earlier previews are not in the log, but the forge keeps them readable by
  their ids — every preview must be publishable on its own.
- There are no branches other than `main` on GitHub.
- **Nothing runs on GitHub** (owner's decision, 2026-10-03): the snapshot carries no
  `.github/workflows/` and no Dependabot configuration, and Actions are disabled on the repository.
  CI, deployment and dependency updates live upstream (`.forgejo/workflows/`,
  `scripts/aisha-deps-update.mjs`).
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
| gitleaks over that history (redacted) | among the findings: `service_role` tokens (42, thirteen files — invisible to the rule as it was then), the compromised-credential signature (40), Coolify API token shape (7, four files), private-key blocks (8, including a TLS key file) |

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

## A head that was replaced stays readable

A forced push removes the ref, not the commit. The forge keeps the replaced commit, serves it to
whoever asks for it by its id, and lists that id in the repository's activity log — so "what `main`
holds now" says nothing about what the repository hands out.

Measured on 2026-10-04 on the repository that received the uploads of preview 6:

| | |
|---|---|
| activity log | lists the forced update of `main` with the id of the head it replaced |
| the replaced head, asked for by that id through the forge's commit API | still returned, with its whole tree |
| `git ls-remote` | `HEAD` and `refs/heads/main` only — the replaced head is invisible to it |

The rule is therefore the same as for pull-request refs, one step wider: **a repository may become
public only if every head it was ever given may.** Staging and the public repository are two
repositories — or the same name, deleted and created again before the one push that counts.

This is not hypothetical for preview 6. Its first two uploads carried the detection literals described
in "What a second pair of eyes found" below, so the repository that received them stays private; the
public `evymo/aisha-orchestrator` is created again and receives the final snapshot as its first and only
push. The same holds for `evymo/insight`, whose first upload carried upstream's deploy token.

The tool reports what it can see: with `--push` (also in `--dry-run`) it prints a `WARNING` line for
the head it is about to replace and for every branch `--prune-remote-branches` would delete. It cannot
see the heads before those — the forge's activity log can.

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
3. **Checks (fail-closed).** The published tree is scanned and the run stops on any finding:
   - forbidden paths — `00_prod_users*.sql`, real `.env*` files, private-key file names and
     extensions, `config/tenant.json`, `config/operators.json`, `config/dev-codes.json`,
     `.env-prod-backup`;
   - submodule pointers that were not rewritten to a public snapshot commit;
   - private-key bodies — a header followed by a base64 body at any line width, with CRLF, indented
     in YAML, or on one line of a JSON string;
   - `service_role` tokens — every JWT-shaped string is decoded and its payload read, so the role is
     found whether it is the first claim or not;
   - Coolify API tokens and the token shapes of the forges and providers the project talks to;
   - home-directory paths (`/Users/<name>`, `/home/<name>` other than container accounts);
   - every public IPv4 address on a line, outside reserved and documentation ranges;
   - free-mail addresses outside test fixtures, also when written inside a regular expression.
   The checks are deliberately **not** an allowlist of known findings: every pattern must be absent.
   The run also reports what it did **not** measure (binary files, lockfiles), in the output and in
   the snapshot's commit message — `=0` must not read as "measured, nothing" for files nobody read.

   The first version of these checks was reviewed by the aisha-team council on 2026-10-03 and missed
   20 of 21 probed shapes; the `service_role` rule matched no real token at all. Each check is now
   exercised by a test that builds its input (a token with a real payload, a key body at several
   widths) instead of a string shaped after the regular expression.
4. **Commit.** `git commit-tree` with no parent. The message carries the preview label, the upstream
   commit, the tree hash, the excluded paths and the check summary. Trailers (for example
   `Co-Authored-By`) are passed with `--trailer`.
5. **Publish** (only with `--push <remote>`): refuses a remote that keeps refs outside `refs/heads/`
   (see above), then a forced push to `refs/heads/main` (or `--branch`); `--prune-remote-branches`
   deletes every other branch on that remote first. Every head the push replaces is named in a
   `WARNING` line (see "A head that was replaced stays readable"). Without `--push` nothing leaves the machine;
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
| `insight` | submodule `packages/insight` — fork of `github.com/AlquistAI/insight` (RAG, dialog management, Czech-aware BM25) | MIT (upstream's) | `evymo/insight` | snapshot `a6e6662a5` (upstream `96ec8f258`; upstream's deploy token in `config.env` replaced by a placeholder). It supersedes the first upload, which still carried that token |
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

Changes made only for the snapshots (licence texts, instance names, a third party's deploy token
replaced by a placeholder) are kept as patches for the upstream repositories; they reach upstream
through ordinary pull requests.

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
- make sure **every head it was ever given is publishable** — read the forge's activity log, not
  `git ls-remote`. A repository that served as staging is recreated first, and the final snapshot is
  its first and only push (same for each submodule repository);
- enable branch protection on `main` (force pushes only by the release identity);
- keep Actions disabled — nothing runs on GitHub, the full CI runs upstream;
- confirm the licence texts (`LICENSE`, `NOTICE`, `CLA.md`) against the official ELv2 source.

## What a second pair of eyes found (2026-10-03)

The council's read-only review of preview 6 is the reason for three rules of this process:

1. **A denylist of real identifiers is itself the disclosure.** `scripts/verify-no-dev-codes.mjs`
   carried, as detection strings, the very values it guards: an Apple Team ID, an App Store Connect
   key id and personal e-mail addresses. The guard is structural now (a person's address at the
   vendor domain is anything that is not a role alias; a free-mail address is a shape); exact values
   live outside the tree (`AISHA_DEV_CODE_SENTINELS` or the gitignored `config/dev-codes.json`).
2. **A third party's credential is still a credential.** The `insight` fork shipped the deploy token
   its upstream publishes. The platform never used it; the fork carries a placeholder.
3. **A pointer nobody outside can resolve is a defect of the snapshot**, not of the reader: the tool
   refuses a tree whose submodule pointers were not rewritten.

Following the review up added a fourth:

4. **The forge remembers every head.** Fixing the tree and pushing again does not take back what the
   earlier uploads carried: they stay readable by their ids. Corrections therefore end with a fresh
   repository, not with one more forced push.

The same review measured the previous mirror again with the corrected rule: 42 `service_role` tokens
in the history kept reachable by its pull-request refs.

## Known limitations carried into the preview

| Item | State | Where tracked |
|------|-------|---------------|
| Four gates read `.github/workflows/*` and `.github/dependabot.yml`, which the snapshot does not carry | red in a public clone (`ci-deploy-honesty`, `no-hardcoded-coolify-uuids`, `owasp-orchestrator-adoption`, `sbom-coverage`); green upstream | this document |
| Package metadata, plugin manifests and install instructions still name the previous mirror `evymo/aisha-dirigent` | links break once that repository is deleted | rename tracked as a follow-up (generated manifests + package versions) |
| Extranet SDK packages (`@aisha/extranet-sdk-*`) install from the maintainers' npm mirror | the source is published as `evymo/aisha-extranet-sdk`; the brand-free versions reach the registry with the upstream SDK pull request (breaking for instances that used a bundled brand) | section "Repositories outside this one" |
| Lockfiles resolve through the maintainers' npm mirror | anonymous read works; public lockfiles move to `registry.npmjs.org` upstream | B7, branch `fix/b7-instalace-bez-nasi-infra` |
| Maintainers' deployment named in defaults/examples/comments | counts in README "Known limitations"; no credentials | B6, "the base carries no instance identity" |
| Login from the apex domain loses OIDC state | fix on an upstream branch | B3 |
| Voice / Matrix end-to-end | deployed, not verified | audit 2026-09-29 |

## Preview log

| Preview | Date | Upstream commit | Notes |
|---------|------|-----------------|-------|
| public alpha preview 5 | 2026-07-09 | (squash, pre-process) | replaced; carried a seed file that must not be public |
| public alpha preview 6 | 2026-10-03 | branch `claude/github-cleanup-docs-09b0b1` (upstream `ffa0689af` + documentation and placeholder fixes) | first preview produced by the tool, published into the new repository `evymo/aisha-orchestrator`; no workflows in the snapshot, Actions disabled; submodule pointers rewritten to the public snapshots of `evymo/insight`, `evymo/potok` and `evymo/aisha-local-ingest`. The previous mirror `evymo/aisha-dirigent` keeps 389 pull-request refs and stays private. The uploads of 2026-10-03 were staging: after the council review the tree changed (guard without literals, hardened checks, `insight` without upstream's token), so the public repositories are created again and receive the final snapshot once |
