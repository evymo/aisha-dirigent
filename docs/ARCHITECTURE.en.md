# Platform Architecture

> Public architecture overview. No internal tokens, personal accounts or operational runbooks.
> Measured on the public alpha preview 6 snapshot (2026-10-03); the one-page diagram and the
> component inventory are in the root [README.md](../README.md).

## What AISHA Platform is

AISHA Platform orchestrates product, development and operations around an autonomous AI conductor
(AISHA Dirigent). It combines a web application, a gateway with domain microservices, workflow
automation, an MCP-based knowledge layer, editor integrations, and an auditable data layer — all
deployable as one stack on the operator's own infrastructure.

## Core layers

| Layer | Role | Where |
|-------|------|-------|
| Web and surfaces | React/Vite web application (public site, admin, StoryLoop, page builder); data-driven extranet surfaces; Expo mobile app; Android kiosk guardian | `src/`, `apps/`, `mobile-app/` |
| Edge and gateway | Public edge (Caddy / Traefik via Coolify) in front of one Fastify gateway: OIDC → PostgREST JWT translation, auth, storage, realtime, MCP, personal access tokens | `services/gateway`, `infra/caddy` |
| Identity | Keycloak realm rendered from a template per instance; social login with verified linking; MFA on sensitive routes; OAuth2 Proxy for admin tools | `keycloak/` |
| Knowledge | MCP knowledge server (40 tools), expert rules, story context, hybrid retrieval (Elasticsearch BM25 + kNN, pgvector) | `services/svc-mcp-knowledge`, `packages/llm-dispatch` |
| Workflow | n8n in queue mode with custom AISHA nodes; 95 workflows for delivery, compliance, self-evaluation and proactive loops; Flowboard visual builder (beta); Agent Communication Standard for structured agent messages | `n8n/`, `packages/n8n-nodes-aisha`, `packages/acs-*` |
| Domain services | 30 microservices on a private mesh: AI chat, sources and twins, plugins and sandboxed runners, web rendering, storage with antivirus, communications, devices, integrations | `services/` |
| Data | PostgreSQL 18 + PostgREST; RPC-only access through audited `SECURITY DEFINER` functions behind Row-Level Security; schema source of truth compiled into one baseline plus an upgrade path | `aisha/db/` |
| Network and PKI | NetBird mesh with instance-scoped names, OpenXPKI internal CA, single-packet-authorisation door for the admin plane | `infra/mesh`, `infra/pki`, `services/svc-knock` |
| Observability | Langfuse traces, Prometheus/Loki/Grafana, Sentry, OpenTelemetry bootstrap in every service | `packages/observability`, `grafana/`, `prometheus/` |
| Delivery | Manifest-driven Coolify deployment in waves; cold-start from zero; convergence of an existing instance; doctor pre-flight; CI workflows | `coolify/manifests`, `scripts/aisha-cold-start.sh`, `.github/workflows` |

## Architectural principles

- **RPC-only data access.** Applications and agents reach data only through explicit, audited RPC
  functions; predicates about third parties are never exposed to the caller.
- **Fail-closed, no silent defaults.** A missing secret, host or capability stops the deployment or the
  request. Capability gates decide what deploys at all.
- **Everything is instance-specific.** The platform is a generic template; an instance resolves every
  domain, host, secret and name from its own declaration and a private instance-data overlay.
- **Public edge, private mesh.** Only the edge is reachable from the internet.
- **Auditability by default.** Sensitive operations leave an audit trail; CI produces release evidence.
- **Gates are the specification.** Architecture rules are tests (786 gate files) that run before every
  merge; a rule that cannot be measured is not a rule.
- **One world model.** A kernel of domain-free primitives (entity, relation, context, record, proposal,
  rule-as-data, run, beat, confirmation, view, dialog, source); an instance supplies names, kinds and
  templates as overlay data.

Deeper material: [architecture/ONE_WORLD_MODEL.md](architecture/ONE_WORLD_MODEL.md),
[architecture/CAPABILITY_GATES.md](architecture/CAPABILITY_GATES.md),
[architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md](architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md),
[deploy/STACK_TOPOLOGY.md](deploy/STACK_TOPOLOGY.md), [adr/](adr/).

## What is intentionally excluded from the public architecture set

- Internal operational runbooks of the maintainers' own deployment
- Detailed security audits and incident playbooks
- Historical drafts and working materials

For broader public context, see [README.md](../README.md), the roadmap in [ROADMAP.md](ROADMAP.md),
and the preview process in [release/PUBLIC_PREVIEW.md](release/PUBLIC_PREVIEW.md).
