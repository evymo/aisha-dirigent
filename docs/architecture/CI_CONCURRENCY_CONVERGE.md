# Forgejo CI concurrency & the converge remedy

> Why a deep stack of open PRs can end up with **zero** commit statuses
> ("can't merge"), and how to recover by converging the stack into one PR.

Related: [stack-topology.md](stack-topology.md) · [../../.forgejo/workflows/ci.yml](../../.forgejo/workflows/ci.yml)

## The mechanic

The Forgejo CI workflow uses a **static, shared** concurrency group
(`aisha-ci-runner`, `cancel-in-progress: false`) so that the single
memory-limited self-hosted runner never runs several heavy jobs at once (they would
OOM-kill each other).

> Renamed from `aisha-ci-serialized` on 2026-07-26 to escape a wedged lock — see
> [Fork-PR approval zombies](#fork-pr-approval-zombies) below. The name changed;
> the serialization did not.

The side effect: when multiple PRs (or multiple pushes) queue runs into that one
group, only the **newest pending** run survives — older queued runs are superseded
and never report. A stacked PR whose run was superseded ends up with **0 commit
statuses**, which presents in the UI as *"can't merge"* (there is nothing green to
gate on, and there is no branch protection to force a re-run).

## Symptoms

- A PR head commit returns an empty status set (`tally {}` from
  `/commits/{sha}/status`), while a *different* PR shows `pending` on ~all lanes.
- Pushing a new commit to PR A appears to cancel PR B's in-flight run.
- A re-target or re-open does **not** re-trigger CI (only a push does).

## Fork-PR approval zombies

A second, nastier way the shared group jams — and unlike supersession, this one
takes the **whole repository's CI** down until someone intervenes.

Forgejo holds Actions runs from **fork** pull requests until a maintainer approves
them (the standard gate against running untrusted code). If such a PR is **merged
and closed while its run is still unapproved**, the run is stranded: it can never
be approved (there is nothing left to approve it for), the UI cancel does not act
on it, and Forgejo 15.0.1 exposes no cancel/approve API at all — `/actions/runs/{id}`
answers `allow: GET`. It sits at `status = 5` (Waiting) forever.

Because the group is ONE static global lock, that single stranded run owns the head
of the queue and **every later ci.yml run queues behind it**, each new arrival
cancelling the previous pending one. The tell is a trail of `cancelled` runs whose
`started` is the epoch — they never began — and no run in `running`, which reads
misleadingly as "the lock is held by nothing".

**Incident 2026-07-26.** Run #3012 (fork PR #813) was merged unapproved on 07-24;
ci.yml dispatched nothing for ~33 h (last run to actually start: #3011, 07-24
16:05). The runner was healthy throughout and kept serving this repo — restarting
Forgejo and the runner changed nothing, because approval state is a database
record. Recovered by renaming the group; the stranded row itself had to be retired
in the Forgejo database (`UPDATE action_run SET status = 3, need_approval = false
WHERE id = <run id> AND status = 5`, 3 = Cancelled) since nothing in the product
can touch it.

### The rule

**Never merge a fork PR while its Actions run is unapproved.** Approve it, or
cancel it, *while the PR is still open* — that is the only window in which the UI
can act on the run at all. Renaming the group is a recovery step, not a fix: the
next unapproved fork run wedges the new name exactly the same way.

Note these "forks" are usually branches of this very repository (`head.repo` is
`aisha/evymo-ai-orchestrator`), so the approval gate is guarding us against our own
code while carrying this failure mode. Dropping the approval requirement for
internal PRs, or moving to per-ref groups so one wedged run cannot block everyone,
are the structural alternatives if the rule above proves hard to keep.

## Remedies (in order of preference)

1. **Keep ≤ 1–2 open PRs.** The group can only meaningfully service one run at a
   time; a deep stack starves itself.
2. **Converge a deep stack into ONE PR vs `main`.** When PR B is built on top of PR
   A's branch (B ⊇ A), retarget B's base to `main` and close A — B now carries every
   commit of A plus its own, as a single mergeable PR, and there is only one run to
   service. Verify B ⊇ A first: `git merge-base --is-ancestor <A-head> <B-head>`.
3. **Re-trigger a superseded run with a push** (an empty commit is enough) once the
   group is free, so the surviving run is the one you want green.

## Worked example

PR #507 (`feat/cli-runtime-unification`) was stacked on PR #504
(`feat/design-verified-hardening`); #507's branch already contained every #504 commit
plus the CLI-runtime work *and* the single-runner OOM lane serialization. Both PRs'
runs fought for the shared group, leaving #507's head with 0 statuses. Remedy:
retargeted #507 to `base=main` (one PR vs main, carrying everything) and closed #504;
the serialization in #507 then let the heavy AV + Blockchain integration lanes run
serialized without collateral OOM, and the single run could go green.

## Don't

- Don't lower or remove the concurrency group to "fix" this — it is what protects the
  memory-limited runner from OOM. Converge the work instead.
- Don't keep renaming the group when CI jams. Once is a recovery; twice means the
  fork-PR rule above is not being kept, and the fix is that rule (or one of its
  structural alternatives), not a `-v3`.
- Don't assume a re-target re-runs CI. Push to re-trigger.
- Don't read `state` off Forgejo status objects — the field is `status` on
  `/commits/{sha}/statuses`; use `/commits/{sha}/status` (singular) for the combined
  latest-per-context view.
