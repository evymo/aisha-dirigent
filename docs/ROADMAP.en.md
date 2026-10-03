# AISHA Platform Roadmap

> Public roadmap as of the public alpha preview 6 (2026-10-03). Items are stated as measured
> states, not promises with dates.

## Current state

Version `0.9.0-alpha.3`. The platform runs as one deployable stack: web application, gateway and
30 services, PostgreSQL 18 with an RPC-only data layer, Keycloak identity, n8n orchestration with
AISHA Dirigent, an MCP knowledge layer, editor integrations, a mobile app and device management.
Quality is enforced by 786 gate files and the CI on the upstream forge. The public repository is a
history-free snapshot of upstream (see [release/PUBLIC_PREVIEW.md](release/PUBLIC_PREVIEW.md)).

## Done since the previous preview (July → October 2026)

- Security hardening across the gateway, database functions, migration logs, plugin catalogue,
  outbound fetches and social login (details in the README highlights).
- MCP protocol on the gateway with story-scoped personal access tokens.
- Wave-based, detector-driven deployment; convergence of an existing instance; PostgreSQL major as an
  instance parameter; hermetic service images; registry proxy for every image.
- Mesh-only service traffic with instance-scoped names; single-packet-authorisation door.
- One-world data model, twins with ratified identities, federated sources through the broker.
- Field devices: driver app with offline capture, Android kiosk guardian, package distribution outside
  app stores.
- Light/heavy gate lanes, path-based pre-push, CI verdicts from artifacts, mutation checks for gates.

## In progress

- **Installable by anyone without the maintainers' infrastructure** — public lockfiles resolved from
  the public npm registry, optional private submodules declared from instance data.
- **The base carries no instance identity** — removing the maintainers' own domains and names from
  defaults, examples, tests and comments.
- **Login from any public face of the web** — one session origin for the OIDC callback.
- **Self-improvement loop** — AISHA turning operational experience into knowledge-base entries, with
  an embedding lane on shared GPU capacity.
- **Voice and chat end-to-end** (LiveKit, Matrix) on a public face.
- **Automation identity** — n8n and other automations calling MCP under a system identity with a
  personal access token, never a service key.

## After the preview

- Deeper agent observability and answer-quality evaluation (eval harness, LLM-as-judge).
- Broader tool system and dynamic agent workflows (Flowboard out of beta).
- Session and long-term memory layers; proactive triggers and more automation loops.
- Public documentation consolidated in English with generated language versions.
- Versioned releases with a support matrix (today only `main` is supported).

## Principle

A preview is not the finished platform. It is the point at which the project is coherent enough, safe
enough to publish, and honestly described — including what does not work yet.
