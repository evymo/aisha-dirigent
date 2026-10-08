# CI concurrency & the converge remedy

> Why a deep stack of open PRs could end up with **zero** checks ("can't merge"),
> how to recover by converging the stack into one PR — and what changed with the
> move to GitHub Actions.

Related: [stack-topology.md](stack-topology.md) · [../../.github/workflows/ci.yml](../../.github/workflows/ci.yml)

## Today (GitHub Actions)

`ci.yml` uses a **per-ref** concurrency group
(`${{ github.workflow }}-${{ github.ref }}`), cancelling superseded runs on PR
branches only — never on `main`, where deploy jobs hang off the run. Each job
gets its own GitHub-hosted VM, so there is no shared runner to protect and no
global lock to wedge. A merge to `main` waits on ONE required check,
`PR: verdikt` (see `main-visi-na-jedne-kontrole.gate.test.ts`).

## History: the shared lock (self-hosted runner era)

The pipeline used to run on a single memory-limited self-hosted runner and
serialized itself with a **static, shared** concurrency group
(`aisha-ci-runner`, `cancel-in-progress: false`) so heavy jobs would not
OOM-kill each other. Two failure modes came with it — worth knowing because
any repository that reintroduces a global group gets them back:

- **Supersession.** With many PRs queueing into one group, only the newest
  pending run survives; a stacked PR whose run was superseded ends up with no
  checks at all, which presents as *"can't merge"*.
- **Approval zombies.** Runs from fork pull requests wait for a maintainer's
  approval. A fork PR merged while its run was still unapproved left a run that
  could never be approved or cancelled — and, as the head of the ONE global
  queue, it blocked every later run of the workflow (incident 2026-07-26: ~33 h
  without CI). Recovery needed a database edit on the forge.

### The rule (still valid on GitHub)

**Never merge a fork PR while its workflow run is awaiting approval.** Approve it,
or cancel it, *while the PR is still open*. With per-ref groups a stranded run
no longer blocks other refs — but it still leaves that PR's verdict unmeasured.

## Remedies for a deep PR stack (in order of preference)

1. **Keep ≤ 1–2 open PRs.** A deep stack mostly re-measures the same commits.
2. **Converge a deep stack into ONE PR vs `main`.** When PR B is built on top of PR
   A's branch (B ⊇ A), retarget B's base to `main` and close A — B now carries every
   commit of A plus its own, as a single mergeable PR. Verify B ⊇ A first:
   `git merge-base --is-ancestor <A-head> <B-head>`.
3. **Re-trigger a run with a push** (an empty commit is enough) — a re-target or
   re-open does not necessarily start CI.

## Worked example

PR #507 (`feat/cli-runtime-unification`) was stacked on PR #504
(`feat/design-verified-hardening`); #507's branch already contained every #504 commit.
Both PRs' runs fought for the shared group, leaving #507's head without checks.
Remedy: retargeted #507 to `base=main` and closed #504; the single run could go green.

## Don't

- Don't reintroduce a global concurrency group to "save the runner" — it gates
  BEFORE the scheduler and only makes runs queue (measured median wait 30 min).
- Don't assume a re-target re-runs CI. Push to re-trigger.
- Don't read a combined commit *status* to learn whether CI passed — GitHub
  Actions reports **check runs** (`/commits/{sha}/check-runs`); the combined
  status (`/commits/{sha}/status`) only covers external status contexts and is
  `pending` when there are none.
