# AISHA Platform

Language versions:

- English: [README.md](README.md) (this file, primary)
- Čeština: [README.cs.md](README.cs.md) (generated from this file)

> **Public alpha preview** · version `0.9.0-alpha.3` · [Elastic License 2.0](LICENSE)
>
> This GitHub repository is a **history-free snapshot** of the upstream repository. Upstream
> development happens on the maintainers' own forge; every public preview is published from a
> verified snapshot of a known upstream commit (see [docs/release/PUBLIC_PREVIEW.md](docs/release/PUBLIC_PREVIEW.md)).

AISHA is a self-hosted, self-managing platform in which an autonomous AI conductor — **AISHA
Dirigent** — governs how software and operations are delivered: it keeps the knowledge base and
expert rules, supervises the agents working in developers' editors, runs compliance and quality
gates, deploys the stack and heals it. The platform is a **generic template**: everything that
identifies a deployment (domains, secrets, operators, content, legal texts) is injected at deploy
time from a private *instance-data* overlay, never committed here.

---

## Two ways in

| | What you get | Start here |
|---|---|---|
| **A. Run your own AISHA** | A full stack on your own servers (Coolify), with your domains, your data, your users. | [docs/onboarding/CONNECTION_GUIDE.md § A](docs/onboarding/CONNECTION_GUIDE.md) |
| **B. Connect your editor to a hosted AISHA** | AISHA Dirigent supervising *your* project from VS Code, Zed, Claude Code or Cursor, with no infrastructure to run. Uses a personal access token issued by the hosted instance you have an account on. | [docs/onboarding/CONNECTION_GUIDE.md § B](docs/onboarding/CONNECTION_GUIDE.md) |

You can start with B today and move to A later — they are not exclusive.

---

## What is in this repository

Measured on the snapshot commit (counts are files/directories, not estimates):

| Area | Where | What |
|------|-------|------|
| Web application | `src/` | React 18 + Vite + TypeScript SPA: public site, admin, StoryLoop, page builder (GrapesJS), 6 UI locales (`en cs de fr ru th`) |
| Services | `services/` (30) | Fastify microservices behind one gateway — see the inventory below |
| Shared packages | `packages/` (27, 3 of them submodules published as separate repositories) | `@aisha/*` workspace packages: security primitives, LLM dispatch, PostgREST client, observability, surface blocks, design language, ACS (agent communication standard), AITG (OWASP AI testing), broker kit, … |
| Database source of truth | `aisha/db/sql/` | 459 tables, 1 845 functions, 901 policy files, 342 RLS files; compiled into one generated baseline (`aisha/db/migrations/00000000000000_baseline.sql`) plus an upgrade path (`aisha/db/heals.sql`) |
| Seeds | `aisha/db/seed/` | layered: `core` (platform), `demo` (fictional showcase), `translations`; `instance`/`implementations` are overlay slots that ship empty |
| Orchestration | `n8n/` (95 workflows), `packages/n8n-nodes-aisha` (community nodes 0.5.13) | AISHA Dirigent agents, delivery, compliance, self-evaluation and proactive loops |
| Knowledge / MCP | `services/svc-mcp-knowledge` | MCP server with 40 tools over the knowledge base, expert rules, stories and agents |
| Editor integrations | `extensions/` (4) | VS Code extension `aisha-dirigent` 0.7.0, Claude Code plugin + Claude Desktop extension, Zed extension, tiered-delegation kit for Claude Code |
| IDE build | `workbench/` | AISHA Workbench — a VSCodium-based IDE build that bundles the extension |
| Mobile and devices | `mobile-app/` (Expo / React Native), `apps/hlidac/` (Android device-owner kiosk guardian, Java) | field app with offline capture, push, voice; tablet kiosk management without an app store |
| Extranet surfaces | `apps/workbench-shell/`, `packages/surface-blocks` | data-driven surfaces: sections are rows, block renderers are a closed catalogue |
| Plugins | `plugins/` (5) | reference connector plugins (fleet telematics, partner metrics, a supplier portal) that run in the sandboxed plugin runner |
| Deployment | `docker-compose.coolify-*.yml` (33 stacks), `coolify/manifests/aisha.manifest`, `scripts/aisha-cold-start.sh` | manifest-driven Coolify deployment in waves, cold-start from zero, convergence of an existing instance, doctor pre-flight |
| Infrastructure | `infra/`, `openxpki-config/`, `keycloak/` | PostgreSQL image, PKI (OpenXPKI), mesh (NetBird), identity (Keycloak realm template), observability, CI runner |
| Quality gates | `src/tests/gates/` (786 gate files), `e2e/` (92 Playwright specs), `src/tests/db/` | executable architecture rules — "the gate is the spec" |
| Documentation | `docs/` (339 Markdown files) | architecture, ADRs, runbooks, security, onboarding — see the map at the end |

### Service inventory (`services/`)

| Service | Role |
|---------|------|
| `gateway` | The single public API: Keycloak OIDC → PostgREST JWT translation, `/auth`, `/rest`, `/storage`, `/realtime`, `/mcp`, `/v1`, personal access tokens, intranet and device routes |
| `svc-ai-chat` | AI chat, story consultation, evaluation and orchestration; every LLM call passes the AITG guard |
| `svc-mcp-knowledge` | MCP knowledge server (40 tools), PAT-scoped |
| `svc-ide-context` | Source of truth for the agent instructions broadcast to IDEs (Claude Code, Cursor, Copilot) |
| `svc-source-broker` | Federated data sources: connector chassis, identity matching, "twins" of people and things, audience module |
| `svc-money`, `svc-fio-bank`, `svc-stripe`, `svc-packeta` | Accounting (Money S5), bank, payments and parcel integrations |
| `svc-plugin-system`, `svc-agent-runner` | Plugin catalogue, approvals and the sandboxed runner (`node:vm` + Docker isolation) |
| `svc-web-artifact`, `svc-web-render` | Web page storage/ingest and static rendering of published pages |
| `storage-auth` | Object storage (MinIO/S3) behind authentication, upload pre-flight and antivirus (ClamAV) |
| `svc-pki-bridge`, `svc-knock` | Internal PKI bridge (OpenXPKI) and the single-packet-authorisation "door" for the admin plane |
| `svc-matrix`, `svc-livekit`, `svc-communications`, `svc-push` | Chat (Matrix/Synapse + bridges), voice (LiveKit), e-mail/SMS, web and mobile push |
| `svc-openclaw`, `svc-health-ai`, `svc-aitg-probes`, `svc-playwright-runner` | Advisory daemon, health reasoning, OWASP AI runtime probes, browser test runner |
| `svc-homeassistant`, `svc-github-app`, `svc-blockchain`, `svc-aisha-kronos-shim` | Home Assistant bridge, GitHub App, token ledger (Cosmos SDK, experimental), scheduling shim |
| `ws-gateway`, `event-worker` | WebSocket fan-out and the asynchronous event worker |

---

## Architecture in one page

```
 editors (VS Code · Zed · Claude Code · Cursor) ── MCP / PAT ──┐
 web app (React) · mobile app · extranet surfaces ─────────────┤
                                                               ▼
                 edge (Caddy/Traefik, public TLS) ── gateway (Fastify)
                                                               │
        ┌────────────────┬────────────────┬────────────────────┼─────────────────┐
        ▼                ▼                ▼                    ▼                 ▼
   PostgreSQL 18    Keycloak 26      n8n (queue mode)   svc-* microservices   object storage
   + PostgREST      (OIDC, SSO)      AISHA Dirigent     (mesh-only network)   (MinIO, ClamAV)
   RPC-only, RLS,   realm from       95 workflows,      LLM gateway → OpenAI /
   audited RPCs     template         custom nodes       Anthropic / Google / local models
```

Principles that the gates enforce:

- **RPC-only data access.** Clients never query tables; they call audited `SECURITY DEFINER`
  functions behind Row-Level Security. Predicates about third parties are oracles and are not exposed.
- **Fail-closed, no silent defaults.** A missing secret, host or capability stops the deploy or the
  request; it never falls back to a guessed value. Configurable choices are user-supplied, generated by
  the cold-start, or explicitly absent.
- **Everything is instance-specific, nothing is shared.** The platform resolves every domain, host,
  secret and resource name from the instance's declaration (`derive-domains`, instance profile,
  instance-data overlay). Two instances never contend for a name.
- **Public edge, private mesh.** Only the edge is reachable from the internet; services talk over a
  NetBird mesh with per-instance identities and an internal PKI.
- **Secrets never live in the tree.** Generated at cold-start, stored in the operator's vault, delivered
  as environment; gates reject committed secrets, weak secrets and example files with real values.
- **Gates are the specification.** Architecture rules live as tests in `src/tests/gates/` and run in CI
  before every merge; a rule that cannot be measured is not a rule.

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/architecture/](docs/architecture/) (ADRs,
one-world model, capability gates, seed layers), [docs/deploy/STACK_TOPOLOGY.md](docs/deploy/STACK_TOPOLOGY.md).

---

## Technology stack

| Layer | Technology (pinned in `config/image-versions.env` and the Dockerfiles) |
|-------|------------------------------------------------------------------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, GrapesJS page builder |
| API | Fastify gateway + domain microservices (Node 22), Zod validation, `@aisha/security` (helmet, CORS allowlists, rate limits, SSRF guard) |
| Database | PostgreSQL 18 (new instances; major version is an instance parameter), PostgREST, pgvector, pgcrypto vault |
| Identity | Keycloak 26.0.8 (OIDC, social login with verified linking, MFA), OAuth2 Proxy for admin tools |
| Orchestration | n8n 1.79 in queue mode with `n8n-nodes-aisha` custom nodes; AISHA Flowboard (visual agent builder, beta) |
| LLM access | LLM gateway (multi-provider: OpenAI, Anthropic, Google), local model serving (llama.cpp, `svc-model`), model registry and cost control in the database |
| Retrieval | Hybrid RAG: Elasticsearch BM25 + kNN (Ragnarok) and pgvector; Alquist Insight dialog management (private submodule) |
| Messaging / realtime | Redis, RabbitMQ, WebSocket gateway, Matrix (Synapse + mautrix bridges), LiveKit, coturn |
| Storage / AV | MinIO (built from source), ClamAV |
| Network / PKI | NetBird mesh 0.70, OpenXPKI internal CA, Caddy edge, Traefik (Coolify) |
| Observability | Langfuse, Prometheus, Loki, Grafana, Sentry, OpenTelemetry (`@aisha/observability`) |
| Admin tooling | NocoDB (analytical backend), Appsmith (operations dashboards), pgAdmin, Dozzle |
| Delivery | Docker Compose stacks deployed through Coolify; CI on Forgejo Actions (upstream) |
| Mobile | Expo / React Native; native Android kiosk guardian |

---

## Getting started

### Prerequisites

- Node.js 22 (`.nvmrc`), npm
- Docker with Compose v2 (local stack) — or a Coolify installation for a real deployment
- `git clone --recurse-submodules` to include the three submodules; a plain `git clone` is enough for the
  core stack

### Local development stack

```bash
npm ci
npm run build:packages
bash scripts/local-warmup.sh --apps core,keycloak,ai-chat --seed-profile template --non-interactive --wait
npm run dev
```

`local-warmup.sh` generates a complete local environment from `config/local-presets.mjs`, renders an
isolated Compose project (`aisha-local`, prefixed containers), applies the baseline, seeds the chosen
profile and brings the services up. `--preset optimum` adds orchestration and integration;
`npm run dev:stack` is the preset wrapper. Details: [docs/DEV_STACK.md](docs/DEV_STACK.md),
[docs/onboarding/LOCAL_BRINGUP.md](docs/onboarding/LOCAL_BRINGUP.md).

### Your own instance (Coolify)

1. Collect the instance inputs with the guided workbench: `node scripts/operator-setup.mjs`
   (`--check` reports what is still missing; the full input list is generated into
   `config/fork-instance-inputs.env.example`).
2. Create your private instance-data overlay from
   [docs/onboarding/instance-data-template/](docs/onboarding/instance-data-template/) — operators,
   extra OIDC clients, instance SQL.
3. Run the doctor and the cold-start: `bash scripts/cold-start-doctor.sh`, then
   `bash scripts/aisha-cold-start.sh` (`--dry-run` first). Re-running with `--skip-create` converges an
   existing instance to the current manifest.

Runbooks: [docs/deploy/COLD_START_RUNBOOK.md](docs/deploy/COLD_START_RUNBOOK.md),
[docs/deploy/COOLIFY_SETUP.md](docs/deploy/COOLIFY_SETUP.md),
[docs/deploy/MULTI_INSTANCE.md](docs/deploy/MULTI_INSTANCE.md),
[docs/deploy/UPGRADE_NASAZENE_INSTANCE.md](docs/deploy/UPGRADE_NASAZENE_INSTANCE.md).

### Tests and gates

```bash
npm run test:run        # unit tests (vitest)
npm run test:gates      # architecture gates, light and heavy lanes
npm run test:db         # database tests against a throwaway PostgreSQL
npm run test:services   # per-service test suites
npm run test:e2e        # Playwright
```

Pre-commit and pre-push hooks run the same checks as CI (`.husky/`); the lanes and their measured
durations are declared in `src/tests/gates/lanes.json`.

---

## Instance data stays out of this repository

A deployment is *this repository* plus a *private overlay*. The overlay carries the operator roster,
extra Keycloak clients, instance SQL, legal texts, web content and brand assets. The platform repository
ships neutral defaults only (`instances/_default/`, `domains/default/`, `aisha/db/seed/core`).

What enforces it:

- `no-instance-data-in-public` and `public-oss-boundary` gates — structural detection of tenant
  identities in shipped artifacts (Keycloak realm, compiled seeds, configs), without a committed list of
  real tenants (a denylist would itself disclose them);
- `no-committed-secrets`, `no-real-secrets-in-example-env`, `secret-strength-floor`,
  `wp-3-7-secrets-no-plaintext` — secrets and example files;
- `split-rule` (`npm run gate`) — generic code must not name an implementation;
- the snapshot tool (`npm run release:public-snapshot`) re-checks the published tree for forbidden
  paths, private-key bodies, service-role tokens, API-token shapes, home-directory paths and public IPs
  before anything is pushed.

See [docs/architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md](docs/architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md)
and [docs/deploy/ALPHA_RELEASE_STATUS.md](docs/deploy/ALPHA_RELEASE_STATUS.md).

---

## Highlights since the previous public preview (July 2026)

About 1 300 merges reached upstream `main` between the previous snapshot and this one. The themes:

- **Security hardening.** Fail-closed redirect allowlist in the gateway; migration logs no longer carry
  operator e-mails; voice/Matrix RPCs guarded by a single predicate; database passwords never on a
  command line or in a readable log; definer functions answer only about the caller; plugin catalogue
  never returns connector configuration; outbound fetches never forward the caller's credentials across
  origins; first social login no longer auto-links an existing account.
- **MCP and tokens.** `/mcp` speaks the MCP protocol; story-scoped personal access tokens (`mcp_…`)
  with a server-enforced tool allowlist; anonymous chat is fail-closed.
- **Deployment.** Wave-based deployment driven by a change detector; convergence of an existing instance
  without recreation; doctor pre-flight phases; PostgreSQL major as an instance parameter (18 by default);
  hermetic service images; every image through a configurable registry proxy; MinIO built from source.
- **Network.** All service-to-service traffic over the NetBird mesh with instance-scoped names; the
  public face served only by the edge; single-packet-authorisation door in front of the admin plane.
- **Data model.** One-world kernel (entities, relations, records, proposals, runs, confirmations) shared
  by every domain; "twins" with ratified identity proposals; federated sources through the broker with
  adapters supplied by the instance overlay.
- **Devices and field work.** Driver app (Expo) with offline capture and package distribution outside
  app stores; Android kiosk guardian; tablets enrolled by QR.
- **Developer experience.** Light/heavy gate lanes with measured durations; path-based pre-push;
  CI verdicts from artifacts rather than exit codes; mutation checks for gates; IDE instruction
  generators (`npm run gen:ide`) for Claude Code, Cursor, Copilot and Zed.

---

## Known limitations of this preview

- **Submodules are separate repositories.** `packages/insight` (fork of Alquist Insight, MIT),
  `packages/potok` and `packages/local-ingest` are published as history-free snapshots in
  `evymo/insight`, `evymo/potok` and `evymo/aisha-local-ingest`; this tree points at those public
  commits. `npm ci` and the core stack work without them; dialog management, streaming ingest and
  local document ingest need them.
- **Package registry.** Lockfiles currently resolve through the maintainers' npm mirror (anonymous
  read). Moving the public lockfiles to `registry.npmjs.org` is in progress upstream; the workbench
  shell depends on `@aisha/extranet-sdk-ui`, which is published only on that mirror so far. Its source
  is public in `evymo/aisha-extranet-sdk`.
- **Identity residue.** Defaults, examples and comments still mention the maintainers' own deployment
  in places (235 files mention `aisha.guru`, 149 mention `id3a.cz`), and comments, tests and fixtures
  still name downstream forks by their short names. None of it is a credential; the
  cleanup is tracked upstream as "the base carries no instance identity". Set your own values through
  the documented variables — never rely on those defaults.
- **Login from an apex domain** starts on a different origin than the OIDC callback and loses the
  session state (fix on an upstream branch, not yet merged).
- **Voice and chat (LiveKit, Matrix)** are deployed but not verified end-to-end.
- **Self-improvement loop** (AISHA improving its own knowledge from experience) is specified and
  partially implemented.
- **Repository links in package metadata.** `package.json` files, plugin manifests and the Claude plugin
  install instructions still name the previous mirror `evymo/aisha-dirigent`; this repository is
  `evymo/aisha-orchestrator`.
- Alpha quality overall: APIs, schemas and names can still change between previews.

---

## Documentation map

| Topic | Start at |
|-------|----------|
| Public documentation index | [docs/index.md](docs/index.md) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/architecture/ONE_WORLD_MODEL.md](docs/architecture/ONE_WORLD_MODEL.md), [docs/adr/](docs/adr/) |
| Connect or self-host | [docs/onboarding/CONNECTION_GUIDE.md](docs/onboarding/CONNECTION_GUIDE.md) |
| Deployment and operations | [docs/deploy/](docs/deploy/), [docs/operations/OPERATOR_HANDBOOK.md](docs/operations/OPERATOR_HANDBOOK.md) |
| Security | [SECURITY.md](SECURITY.md), [docs/security/OWASP_ORCHESTRATOR.md](docs/security/OWASP_ORCHESTRATOR.md), [docs/security/](docs/security/) |
| Database | [docs/deploy/DATABASE_MIGRATION_SYSTEM.md](docs/deploy/DATABASE_MIGRATION_SYSTEM.md), [docs/db/RELATIONSHIPS.md](docs/db/RELATIONSHIPS.md) |
| Agents, MCP, n8n | [docs/N8N_AGENT_ARCHITECTURE.md](docs/N8N_AGENT_ARCHITECTURE.md), [docs/MCP_SCOPE_REFERENCE.md](docs/MCP_SCOPE_REFERENCE.md), [docs/AGENT_COMMUNICATION_STANDARD.md](docs/AGENT_COMMUNICATION_STANDARD.md) |
| Editor integrations | [docs/integrations/AISHA_IDE_EXTENSION_CONTRACT.md](docs/integrations/AISHA_IDE_EXTENSION_CONTRACT.md), [extensions/](extensions/) |
| Testing | [docs/testing/](docs/testing/), [docs/testing/BRANY_DRAHY_A_VYBER.md](docs/testing/BRANY_DRAHY_A_VYBER.md) |
| Release process | [docs/release/PUBLIC_PREVIEW.md](docs/release/PUBLIC_PREVIEW.md), [docs/deploy/ALPHA_RELEASE_STATUS.md](docs/deploy/ALPHA_RELEASE_STATUS.md) |
| Roadmap | [docs/ROADMAP.md](docs/ROADMAP.md) |

Some runbooks and audits are written in Czech; English translations are generated from the English
sources as the documentation set is consolidated.

---

## Contributing

Contributions are welcome under a light [CLA](CLA.md) (you keep your copyright and grant Evymo a licence
including re-licensing; sign with `git commit -s`). Issues and pull requests on this GitHub repository
are reviewed by the maintainers and ported to the upstream repository, where CI and deployment run.
See [CONTRIBUTING.md](CONTRIBUTING.md).

Security issues: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

The source code in this repository is licensed under the **Elastic License 2.0** (ELv2), a fair-code
licence in the spirit of n8n. You are free to use, modify, self-host and deploy it for your clients.
The ELv2 restrictions apply: you may not provide the software to third parties as a hosted or managed
service, circumvent licence-key functionality, or remove licensing notices.

The hosted **AISHA** service (internal models, evaluation and routing of queries) is a separate
proprietary offering operated by Evymo s.r.o. and is not part of this repository.

Exception: `packages/n8n-nodes-aisha` is intentionally MIT-licensed (the n8n community convention).

Full text and model: [LICENSE](LICENSE) · [NOTICE](NOTICE) · [docs/LICENSING_INTENT.md](docs/LICENSING_INTENT.md) · [CLA.md](CLA.md)

## Credits

AISHA stands on the work of many people and projects — see [Credits.md](Credits.md).
