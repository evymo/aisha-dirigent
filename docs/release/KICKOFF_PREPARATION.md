# Kickoff preparation — session handoff, 8 October 2026

This is a preparation checkpoint for continuation, not a deployment or a public release.
Target: `evymo/aisha-orchestrator`, PR against its existing `main`. The GitHub repository's
history and merged fixes remain the base; upstream commits are transferred as reviewed
file changes, without importing upstream history.

## Integrated scope

- Kickoff branch and convergence batches 8/9: story/workflow access, SQL corrections,
  knowledge search, IDE tools and ingestion safety. Preserve GitHub subscription status
  filtering and concurrent DB fixture fixes.
- F9: authenticated IDE tools `my_next_steps`, `complete_step`, `report_progress`.
- F2/F4: `add_knowledge` and `request_capability`, strict input schemas, caller-scoped RPCs,
  story binding, private quarantined documentation, pending high-risk capability proposals,
  per-user quota and deduplication. A clean automatic scan cannot release content awaiting
  human review. Cross-user deduplication does not disclose the proposal id.
- Capability bridge: approved proposal -> held Claude run -> approval by another administrator
  -> successful run -> human registration -> replay request. The SQL replay function returns
  the original question and emits a notification; a chat/MC consumer must perform the replay.
  Human review of the PR and CI evidence is still required before registering the tool.
- F3 runner: measured Docker mount, named runs volume with per-run subpath, isolated clone,
  closed network with authenticated proxy, namespaced output branch, ephemeral story context,
  image build/tag helper, real push failure propagation. Default Claude concurrency is one.
- F8: provider credential catalog and administration, instance vault, per-call credential readers
  for services and CLI runs. Values and operator identities do not belong in this repository.
- GPU lane: operator configuration, chat, runtime LoRA loading and watchdog. Preserve the
  newer embedding backfill and model/weights identity checks. Training is not implemented
  by these changes and must not be presented as complete.
- Release checks: strengthened snapshot/dev-code detection; GitHub Actions remain excluded.

## Required before the rehearsal

1. Finish all checks listed in the PR validation record. Reconcile any remaining failure;
   do not suppress tests or use a bypassed hook to claim readiness.
2. Inspect the final diff, regenerate baseline/seed when SQL changes, run a clean disposable
   database and verify upgrade compatibility. Never reset the instance database.
3. In the private instance-data repository, finish operator identities/roles and the program
   overlay for the EXISTING default story. Invite the two teammates and verify their individual
   story/IDE access. Their contacts are still pending; do not create another story as a shortcut.
4. Set provider credentials through administration. Confirm a change is visible to the next
   service call/run, including credential-cache delay. Never put values in a commit or runbook.
5. On the execution host, verify Docker API >= 1.45, named runs volume, agent image tag,
   closed runs network, runner membership in that network and declared model/forge/registry
   proxy targets. `AGENT_RUNS_DIR` is legacy compatibility, not the child's bind source.
6. Rehearse one approved Claude run: actual clone contains the repository; transient context
   is not committed; push reaches only `aisha/run/<run-id>/...`; failed push means failed run;
   sibling runs are isolated; cleanup succeeds. Local tests are not evidence of that host probe.
7. Exercise MCP knowledge write -> unreadable quarantine -> human reinstatement -> searchable
   knowledge with the intended embedding model and weight identity.
8. Exercise missing capability -> pending proposal -> human approval -> held run -> distinct
   approver -> code/CI review -> tool registration -> actual replay in chat. Integrate a replay
   consumer/UI if absent; notification alone is not a completed replay.
9. Verify live GPU health, embedding generation, chat and loading an approved LoRA adapter.
   Keep training disabled until its implementation and live validation exist.
10. Run the two colleague scenarios, record evidence and prepare the short demo/video.
    Deployment, merge and changing repository visibility are separate actions.

## Continuation locations

- Prepared branch: `codex/kickoff-preparation-2026-10-08`.
- Original kickoff: `claude/aisha-public-kickoff-086857`.
- Integrated additional refs: `integrace/2026-10-06-8`, `integrace/2026-10-06-9`,
  `fix/vychozi-hodnoty-upsert-a-kotva-navrhu`, `feat/f9-tri-ide`, `feat/accel-chat-lane`,
  the delta of `feat/accel-hlidac-v5`, `fix/runner-na-serveru`,
  `fix/umisteni-sonda-porovnane`, `feat/tokeny-poskytovatelu-v-administraci`,
  and the SQL work from `feat/wp-e-frankenstein`.
- Local orchestration plan: `HACKATHON-2026-10-08.md` and `KONVERGENCE-2026-10-06.md`
  in the operator's private shared working directory. Keep those operator files private.
- New DB tests: `znalost-z-mcp.runtime.test.ts`, `schopnost-navrh-a-most.runtime.test.ts`.
- Runner tests: `cesty-behu.unit.test.ts`, `claude-cli-egress.unit.test.ts`,
  `claude-entrypoint.unit.test.ts`, `run-auth.unit.test.ts`.
- MCP tests: `prace-pod-uzivatelem.unit.test.ts` and `tool-input-schemas.unit.test.ts`.

No production deployment, invitation, live rehearsal, trainer run or visibility change has
been performed by this preparation session.

## Validation record at checkpoint

These runs measured a changing preparation tree; they are evidence of their stated scope,
not a green merge verdict for the final commit. Re-run the full suites after convergence.

| Check | Observed result |
|---|---|
| Package builds | 21 package builds passed after F8 integration |
| Web build | Passed; bundle-size warnings |
| Lint | 0 errors, 85 warnings |
| i18n check | 0 blocking findings; 47 existing untranslated-copy findings |
| Runner targeted suite | 250 passed, 2 optional real-CLI integration tests skipped |
| MCP targeted suite | 316 passed, 5 environment-dependent tests skipped |
| GPU targeted suite | 150 passed before F8 integration |
| New knowledge/capability DB tests | 12 passed on a disposable PostgreSQL database, including distinct-approver RLS and held-run/replay behavior |
| Full services/packages/plugins | All 54 suites passed before F8 integration; full post-F8 rerun required |
| Full root unit run | 6,558 passed, 1 failed, 1,179 environment-dependent skips; failure was baseline metadata before regeneration. Final full rerun required |
| Full gates, both lanes | 10,168 passed, 21 failed, 55 skipped; NOT a green verdict |
| Snapshot check | No forbidden paths/tokens/operator data/test IP literals found in measured text; 159 binary files and 20 lockfiles unscanned by this check. Submodule pointers match the GitHub base |

### Start here next session

1. Refresh the final generated DB types for web and mobile using the disposable-DB generator
   (`npm run db:types:refresh:throwaway`), then check exposed RPC coverage.
2. Re-run `npm run test:run`, `npm run test:services` and both gate lanes after regeneration.
3. Resolve the gate findings below rather than loosening their expectations. Some findings
   came from intermediate seed/state while integration was still underway; measure again
   before assuming they persist.
4. Keep `main` untouched until the resulting branch has passed review and required checks.

Full gate-run failing files (captured before the last SQL/seed corrections):
- `src/tests/gates/aisha-branding.gate.test.ts`
- `src/tests/gates/aitg/aitg-app-04-input-leakage.gate.test.ts`
- `src/tests/gates/brick4-locale-ingestion.gate.test.ts`
- `src/tests/gates/comms-wiring-consistency.gate.test.ts`
- `src/tests/gates/db-types-cover-exposed-rpcs.gate.test.ts`
- `src/tests/gates/db-types-mobile-web-sync.gate.test.ts`
- `src/tests/gates/demo-seed-nesmi-do-produkce.gate.test.ts`
- `src/tests/gates/drahy-bran-manifest.gate.test.ts`
- `src/tests/gates/git-v-testech-bez-prostredi.gate.test.ts`
- `src/tests/gates/nasazeni-drzene-aplikace.gate.test.ts`
- `src/tests/gates/rag-locale-foundation.gate.test.ts`
- `src/tests/gates/seed-compiled-sync.gate.test.ts`
- `src/tests/gates/silent-degradation.gate.test.ts`
- `src/tests/gates/sluzba-cte-compose-deklaruje.gate.test.ts`
- `src/tests/gates/stack-nesmi-znat-jmeno-instance.gate.test.ts`
- `src/tests/gates/vyber-bran-je-fail-closed.gate.test.ts`
- `src/tests/gates/zadny-fallback-nad-identitou.gate.test.ts`
- `src/tests/gates/znalosti-viditelnost-kazda-cesta.gate.test.ts`
