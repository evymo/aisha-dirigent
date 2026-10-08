# Kickoff preparation — session handoff, 8 October 2026

This is a preparation checkpoint for continuation. Narrow live OAuth configuration was
updated as recorded below; application code and database changes have not been deployed.
Target: `evymo/aisha-dirigent`, PR #3 against its existing `main` (renamed from
`evymo/aisha-orchestrator`; the original URL redirects). The GitHub repository's
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
   overlay for the EXISTING default story. The new kickoff users register and sign in first;
   an existing administrator then grants them `admin` in `/admin/roles`. Verify their
   individual story/IDE access. Pre-collecting emails for invitations is not a prerequisite.
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

No application deployment, database mutation, invitation, live rehearsal, trainer run or
visibility change has been performed by this preparation session. The operator later
confirmed successful direct Keycloak login; see the update below.
The additive Keycloak client/mapper changes below are the only live configuration writes.

## Historical validation record at the first checkpoint

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

### Historical continuation list (superseded by the current status below)

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


## Current task: user login, MCP and new projects

The operator's latest instruction is to enable AISHA MCP and let users log in and use
AISHA Dirigent for new projects. The earlier default-story kickoff remains available;
new work projects have their own caller-owned stories. Medical study/consent creation
continues through its existing RPC and authorization path.

### Implemented and measured

- Dirigent creates work projects through `create_project_story_audited`, with identity
  derived exclusively from the verified caller. Summary/goals/constraints, owner
  participation and audit are written atomically. First-time subjects use the existing
  JIT user provisioning hook. Input is bounded; anonymous and foreign users are denied.
- The project owner can update project context/preview, recommend visible expert rules
  and pin published visible rules. Existing staff/admin and study consent restrictions
  are preserved. `heals.sql` includes the canonical SQL sources for upgrades without
  resetting data; cold-start baseline and web/mobile types are regenerated.
- MCP exposes `detect_project_context_from_analysis`, `recommend_ruleset_for_story`,
  `create_story_ruleset` and `generate_copilot_instructions`. Calls use verified user
  claims, strict schemas and the existing story-binding check for delegated tokens.
- The Dirigent template now selects the existing `aisha` API profile by default and
  leaves `storyId` empty. Select an accessible story or create a project in the wizard;
  do not point unrelated repositories at a single hardcoded story. Keycloak URL is
  derived by the existing config resolver from API origin and realm configuration.
- The F8 credential dependency is explicitly mocked in two existing ai-chat test
  fixtures, so their P2 knowledge/identity assertions exercise the intended production
  path. Production credential behavior and test expectations are unchanged.
- `scripts/keycloak/sync-mcp-login.mjs` reconciles only the dedicated MCP public PKCE
  client, its declared role scopes and missing MCP audience mappers on the two existing
  Dirigent login clients. Default mode is read-only; `--apply` performs additive writes.
  Existing login client roles, redirects, secrets and unrelated mappers are preserved.

### Live evidence and remaining deployment boundary

Verified on 8 October 2026 through scoped Coolify/Keycloak APIs and public endpoints:

- API health, web landing and Keycloak OIDC discovery respond successfully; the
  orchestration web redirects to its existing Keycloak client. These probes do not
  prove a complete human login or new-project workflow.
- Latest successful core and Keycloak application deployments are
  `0f992f64777f48c35704fcf3913d16db21a22bc4`. The application still serves the older
  gateway/tool set; this preparation branch has not been deployed.
- The missing dedicated `aisha-mcp-client` was created with public PKCE S256,
  restricted scopes and its declared localhost callback URLs. MCP audience mappers
  were added to `aisha-app` and `aisha-dirigent-device`. A second sync dry-run returned
  no actions, confirming idempotency against the live configuration.
- Core's live client allowlist still omits `aisha-mcp-client`. An unauthenticated MCP
  initialize request currently receives 401 without the required OAuth discovery
  challenge. The new gateway handling, project SQL and MCP tools must reach core
  before claiming the end-to-end scenario is enabled.
- Realm self-registration is currently enabled, but SMTP is unconfigured. Invitation
  delivery and a human login were not verified in the initial audit. The operator has
  since confirmed successful direct Keycloak login (report below). Per the operator's latest decision, new
  kickoff users register/sign in themselves and are then promoted to `admin` through
  AISHA administration. No account invitation or role elevation was performed here.

### Exact next-session steps

1. Resolve the remaining full gate failures recorded below; preserve the existing
   invariants. Review the final branch before any application deployment or merge.
2. Confirm private instance-data/operator identities and effective production settings.
   Use the canonical environment resolver and deployment plan; never publish the
   operator overlay, environment values or credentials to this repository. New kickoff
   users first register and sign in; an existing admin grants `admin` under `/admin/roles`
   using their registered email. This is a selected-user action, not automatic admin
   access for every new registration.
3. Inspect OAuth reconciliation, then apply only displayed missing configuration:

   ```sh
   KEYCLOAK_URL=<instance-auth-origin> node scripts/keycloak/sync-mcp-login.mjs \
     --dry-run --config-root=<private-operator-config-root>
   # Only when the displayed changes are intended:
   KEYCLOAK_URL=<instance-auth-origin> node scripts/keycloak/sync-mcp-login.mjs \
     --apply --config-root=<private-operator-config-root>
   ```

4. Deploy the reviewed core change through the existing deployment workflow, preserving
   the current database and running its canonical migrations/heals. Verify the effective
   allowed-client list includes the dedicated MCP client, public OAuth resource discovery,
   and the MCP 401 challenge before testing authenticated calls. Do not reset the DB.
5. Build/install the prepared Dirigent extension from source (`npm ci`, `npm run compile`,
   and the installed `vsce package --no-dependencies` inside `extensions/aisha-dirigent`).
   Open a new repository, copy the template into its `.aisha/dirigent.json` (or configure
   equivalent settings), and use `aisha.dirigent.connect`. The `aisha` profile derives its
   Keycloak URL; use `aisha.dirigent.loginWithPkce` for browser login. Then create
   its work project and run `@aisha` / onboarding. Verify rules are visible to that user
   and a second user cannot read or mutate their project.
6. Connect an OAuth-capable MCP client to the API's existing
   `/functions/v1/mcp-knowledge-server` route using the declared client/callback settings.
   Verify initialize, tools/list and a caller-scoped tool with an actual human token.
   An admin API token, a health probe or an anonymous tools listing is not that evidence.
7. Record login, project creation, rule pinning and IDE/MCP evidence. Keep the PR in draft
   until the full checks and the intended live scenarios have passed.

### Current validation (8 October 2026)

| Check | Result |
|---|---|
| Full root unit tests | 6,582 passed; 0 failed; 1,217 environment-dependent skips |
| Full services/packages/plugins | 53 suites passed in the post-F8 full run; the remaining ai-chat suite passed after fixture repair (752 tests, 48 environment-dependent skips) |
| MCP service | 323 passed, 5 environment-dependent skips; TypeScript build passed |
| Dirigent extension | 327 passed; TypeScript and compile passed; local VSIX packaged |
| New project DB runtime | 11 passed on fresh isolated PostgreSQL 18, with migrations/heals; no production DB access |
| OAuth sync + public snapshot scripts | 26 passed |
| Targeted config, MCP and generated DB type gates | 41 passed across 9 files after repairs |
| Web | Build and TypeScript passed |
| Lint / i18n | 0 errors / 0 blocking findings; existing warnings/copy findings remain |
| Full gates, both lanes | 10,183 passed; 12 failed; 55 skipped. Heavy lane green; light lane blocked |

A local VSIX was produced for the operator, but has not been published to the marketplace.
The source is sufficient to rebuild it; no binary or private operator configuration is
required in the public repository.

### Remaining full gate failures in the final preparation tree

- `src/tests/gates/brick4-locale-ingestion.gate.test.ts`
- `src/tests/gates/comms-wiring-consistency.gate.test.ts`
- `src/tests/gates/drahy-bran-manifest.gate.test.ts`
- `src/tests/gates/nasazeni-drzene-aplikace.gate.test.ts`
- `src/tests/gates/rag-locale-foundation.gate.test.ts`
- `src/tests/gates/silent-degradation.gate.test.ts`
- `src/tests/gates/sluzba-cte-compose-deklaruje.gate.test.ts`
- `src/tests/gates/stack-nesmi-znat-jmeno-instance.gate.test.ts`
- `src/tests/gates/vyber-bran-je-fail-closed.gate.test.ts`
- `src/tests/gates/zadny-fallback-nad-identitou.gate.test.ts`
- `src/tests/gates/znalosti-viditelnost-kazda-cesta.gate.test.ts`
- `src/tests/gates/aitg/aitg-app-04-input-leakage.gate.test.ts`

The measured findings include missing capability replay consumption, locale RPC signature
expectations, gate-lane/class selection, an obsolete excluded-workflow exception, snapshot
scanner error handling, runner environment/fallback declarations, submodule workspace
visibility and the knowledge writer's explicit security class. The Stripe customer-portal
route also needs its existing caller-identity guard reconciled with the session-boundary
check. Re-measure each against its source and preserve the intended behavior; do not add
blanket allowlists or skip the failed assertions to declare deployment readiness.

The final public-tree scan found no forbidden paths, operator roster, private environment,
credential tokens, private-key bodies or hardcoded test IPs in its measured scope. It scanned
13,216 tree entries and explicitly left 159 binary files and 20 lockfiles unscanned. All four
submodule pointers match the GitHub base. This scan is a scoped safeguard, not a general
security audit or an application readiness verdict.


### Operator decision: new kickoff users become admins through administration

The operator confirmed that selected new kickoff users will be made administrators in
AISHA administration. Use the existing `/admin/roles` screen after their registration
and first login. `useGrantUserRole` calls `grant_user_role_admin(p_email, p_role)` with
`p_role = 'admin'`; the SQL requires an existing administrator and records the grant
in the audit journal. No pre-created admin accounts or invitation emails are required
for this chosen path. No live user role was changed during this checkpoint update.

The application grant writes `user_roles`. MCP's separate admin-only tool filter reads
verified token roles; this RPC does not modify Keycloak realm roles. Include effective
application access and MCP admin-tool visibility in the live role verification rather
than assuming a DB role grant also changes an existing OAuth token. Project onboarding
MCP tools use authenticated caller RPCs and their database authorization.


### Operator confirmation: direct Keycloak login is sufficient for the current task

On 8 October 2026 the operator reported a successful login using their existing account
through Keycloak. This initial report was subsequently verified independently as recorded below.
Do not treat login as proof of project creation,
MCP tool execution or the other colleagues' effective permissions.

The operator reported problems with Apple ID and Google ID sign-in, and explicitly
accepted direct Keycloak login for the current scope. Defer those external identity
provider repairs. No Apple/Google client configuration or live user roles were changed
by this update. The remaining core/MCP deployment and gate work above is unchanged.


### Independent developer-workstation verification (8 October 2026)

This round used the operator's real online Keycloak session, not an admin API token,
service-role credential or an anonymous request. No private account identifiers,
tokens, authorization codes, project titles or response contents are included here.

| Path | Observed result |
|---|---|
| Browser | Direct Keycloak login reaches the authenticated `/admin/warmup` view |
| Developer PKCE session | `aisha-app`, S256, `openid profile email`; token contains the MCP audience |
| MCP protocol | `initialize` and `tools/list` return HTTP 200; live server 2.2.0 exposes 40 tools |
| Actual MCP tools | `get_expertise_areas`, `search_knowledge` and read-only `admin_health_check` succeed |
| Caller API | `get_my_stories_audited` returns HTTP 200 and five accessible stories |
| Installed VS Code Dirigent | `evymo.aisha-dirigent` 0.7.0 selects AISHA Cloud in the isolated preparation worktree; device-code login completes, the extension displays the authenticated account and its project picker |
| MCP from VS Code | Refresh AI Models reaches MCP but returns a JSON-RPC error; a matching direct probe identifies `get_model_registry_admin`: `Admin or staff role required` |
| Model-registry identity isolation | The caller's roles RPC confirms admin/staff; the same registry RPC called with the caller token succeeds (HTTP 200, 221 rows). The MCP alias uses a service identity |
| Claude CLI OAuth | CLI 2.1.294 discovers the root resource metadata, but authorization fails with `invalid_scope` for its requested `openid email profile offline_access` |
| Claude CLI MCP transport | Existing restricted/strict isolated run reports only `aisha-readonly` with `status: connected` in its initialization trace, using the temporary online bearer token |
| Claude agent execution | That run stops at the account's weekly usage limit; zero tools called, zero model cost |
| New project tools | `my_next_steps` and `detect_project_context_from_analysis` are absent from the live older tool set; their end-to-end deployment scenario remains unverified |

The installed VS Code extension and the prepared source had hardcoded the old callback
publisher (`aisha.aisha-dirigent`) while the installed identity is `evymo.aisha-dirigent`.
The preparation source now derives the callback from `ExtensionContext.extension.id`.
Realm declaration and the existing additive redirect reconciliation include the current
publisher's exact callbacks for VS Code, Insiders, Cursor and VSCodium, preserving every
legacy callback. An OAuth callback/exchange regression test checks the actual identity,
matching redirect and S256 verifier. A gate checks declared callbacks against the package
publisher/name. All 327 extension tests, type checking, compilation and VSIX packaging
pass after this repair. The repaired VSIX is prepared locally; it is not installed or
published. The new redirect entries have not been applied live in this verification round.

The preparation worktree has an ignored `.aisha/dirigent.local.json` selecting AISHA Cloud;
the original shared worktree's local backend settings were preserved. Existing device-code
login provides a verified current login path while PKCE callback repair awaits installation
and live redirect reconciliation. The model-registry alias is now repaired in the preparation source to use
`rpcUserClaims` with the verified caller. The SQL `is_admin_or_staff()` guard is unchanged;
no live role grants were needed. Tests cover the caller identity and failure without a
service-role fallback. All 323 MCP service tests pass (5 environment-dependent skips),
and the service builds. This repair is not deployed; re-test the actual VS Code command
after the reviewed core rollout. DB roles and token-only admin tool visibility still
require separate verification as recorded above.

The dedicated MCP client intentionally has no optional scopes. Claude CLI asks for
`offline_access`, which the live client rejects. Pinning only the three ordinary scopes
must not be presented as a verified solution. Resolve client scope/session-duration policy
before enabling long-lived access, then re-test the real CLI login. Core's missing MCP
client allowlist entry, path-specific protected-resource metadata (404) and missing 401
challenge also remain to be deployed; CLI root-metadata fallback does not prove compliance.
The account usage limit independently blocks the final Claude agent/tool-call rehearsal.

Next session should install the reviewed callback repair and reconcile its exact redirects,
deploy and re-test the model-registry caller repair, resolve and re-test Claude OAuth, deploy the
reviewed project/MCP changes through the existing workflow, and complete one real project
creation and caller-scoped IDE tool run. Preserve the recorded full gate failures above.

The auth/extension/realm targeted gate run passed all 89 tests in three files. The initial
full gate re-run was interrupted after sandbox fixture-listener/timeouts; the unrestricted
local-fixture re-run completed with 10,036 passed, 13 failed and 55 skipped; heavy lane
is green. Twelve failures are the previously recorded source/convergence findings.
The extra instance-identity failure came from the temporary ignored IDE profile
explicitly spelling the realm. That profile now uses the existing Keycloak derivation;
the instance-identity gate and service-security gate passed in a follow-up run (79 tests).
Those sandbox timeouts are not a source regression verdict. No gate assertions or
classifications were weakened.

The final unrestricted root unit re-run produced a separate JSON report: 6,582 passed,
0 failed, 1,217 environment-dependent skips (434 passed files, 184 skipped). The earlier
sandbox run reached per-file output but did not produce a final verdict and was stopped;
it is not counted as an additional successful run.

Before claiming the model tree/chat UI complete, also reconcile its response contract:
the MCP alias returns the RPC row array, whereas `refreshModelsTree` and `/models`
currently read a `{ models: [...] }` object and `extractJson` only recognizes object text.
The identity repair addresses the reproduced permission error. The model display path
still needs an additive compatible adapter and a real post-deployment UI check.
