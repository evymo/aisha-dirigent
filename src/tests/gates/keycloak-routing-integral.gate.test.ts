/**
 * Keycloak Routing — Coolify-owned Design Gate
 *
 * Enforces that Keycloak exposes its backend port while the hostname/router is
 * owned by Coolify's docker_compose_domains contract.
 *
 *   COMPOSE — exposes :80 and opts the service into Coolify.
 *   ROUTING — scripts/coolify-deploy-init.sh registers the
 *     domain via set_coolify_domains (docker_compose_domains PATCH, with
 *     retry + force_domain_override + post-PATCH verify), and
 *     scripts/coolify-domain-doctor.mjs carries the matching entry as the
 *     recovery/source-of-truth pass run before wave deploy.
 *
 * WHY one routing owner (the empirical correction, verified in production):
 *   The earlier "integral design" assumed Coolify would substitute ${VAR}
 *   inside Traefik label VALUES, so it declared routing ONLY in compose
 *   labels and forbade the docker_compose_domains PATCH. Production proved
 *   that assumption false: Coolify escapes every `$` → `$$` in label values
 *   at deploy time, so the running container carries the LITERAL string
 *   `Host(\`${KEYCLOAK_DOMAIN_PUBLIC}\`)` — Traefik never matches it, and
 *   auth.aisha.guru returned 404, cascading into OIDC-discovery failures for
 *   grafana-auth, netbird-management and svc-matrix. Registering the domain
 *   via docker_compose_domains makes Coolify auto-generate a correct router
 *   with a real hostname. The original silent-drop concern that motivated the
 *   label-only design is handled by set_coolify_domains' retry+verify loop and
 *   domain-doctor's recovery pass. See feedback_coolify_label_dollar_escape.md.
 *
 * Topology note: KC runs on Backend and registers ONLY the internal direct
 * host (auth.backend.${INTERNAL_TLD}). The public auth.${PUBLIC_TLD} hostname
 * is served by edge-proxy on Frontend, which reverse-proxies to this internal
 * host (asserted by the edge entry in domain-doctor, not here).
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const KC_COMPOSE = join(ROOT, "docker-compose.coolify-keycloak.yml");
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
const DOMAIN_DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");

describe("Keycloak Routing — Coolify-owned Design", () => {
  test("compose exposes Keycloak but declares no globally named custom Traefik objects", () => {
    const compose = readFileSync(KC_COMPOSE, "utf-8");

    expect(compose).toMatch(/expose:\s*\n\s*- "80"/);
    expect(compose).toContain('"traefik.enable=true"');
    expect(compose).toContain('"traefik.docker.network=coolify"');
    expect(compose).not.toMatch(/traefik\.http\.(routers|services|middlewares)\./);
  });

  test("PLANE 2: coolify-deploy-init registers KC routing via set_coolify_domains (internal host, dynamic)", () => {
    const init = readFileSync(DEPLOY_INIT, "utf-8");

    const kcCaseMatch = init.match(/keycloak\)\s*\n([\s\S]*?)\n\s*;;/);
    expect(kcCaseMatch, "Could not find `keycloak)` case in deploy-init switch.").toBeTruthy();
    if (!kcCaseMatch) return;
    const kcBlock = kcCaseMatch[1];

    // MUST register the domain (Coolify escapes $ in labels — compose labels
    // alone don't route on Coolify).
    expect(
      kcBlock,
      "deploy-init keycloak case MUST call set_coolify_domains — Coolify escapes $ → $$ in compose labels, so docker_compose_domains is the only working production path.",
    ).toMatch(/set_coolify_domains\b/);

    // MUST use the mesh-INDEPENDENT direct backend host (KEYCLOAK_DOMAIN_DIRECT,
    // = KEYCLOAK_DOMAIN when mesh is off), never a hardcoded hostname, and never
    // the public alias (served by edge-proxy). Under MESH_ENABLED=true the plain
    // KEYCLOAK_DOMAIN is mesh-overlaid → KC would get a router only for the mesh
    // host and be unreachable at auth.backend/auth.<public> (incident 2026-07-16).
    expect(
      kcBlock,
      "deploy-init keycloak domain MUST be the direct backend host `keycloak=https://${KEYCLOAK_DOMAIN_DIRECT:-${KEYCLOAK_DOMAIN}}:80`.",
    ).toMatch(/keycloak=https:\/\/\$\{KEYCLOAK_DOMAIN_DIRECT:-\$\{KEYCLOAK_DOMAIN\}\}:80/);
    expect(
      kcBlock,
      "deploy-init keycloak case MUST NOT register the public KEYCLOAK_DOMAIN_PUBLIC here — that hostname is served by edge-proxy on Frontend.",
    ).not.toMatch(/keycloak=https:\/\/\$\{KEYCLOAK_DOMAIN_PUBLIC\}/);
  });

  test("PLANE 2: coolify-domain-doctor carries the matching KC domain (recovery/SoT, dynamic)", () => {
    const doctor = readFileSync(DOMAIN_DOCTOR, "utf-8");

    // Match the single-line contract entry up to its terminating `},`. (The
    // previous `[\s\S]*?\n\s*\}\s*,` variant only "matched" by accidentally
    // spilling ~200 lines into an unrelated inline helper that has since
    // moved to scripts/lib/coolify-http.mjs — it never scoped to the entry.)
    const kcEntry = doctor.match(/\{\s*app:\s*"aisha-keycloak"[\s\S]*?\},/);
    expect(kcEntry, "Could not find `aisha-keycloak` entry in domain-doctor contract.").toBeTruthy();
    if (!kcEntry) return;

    // Must be POPULATED (not []) and use the mesh-INDEPENDENT direct host
    // (KEYCLOAK_DOMAIN_DIRECT, falling back to KEYCLOAK_DOMAIN when mesh is off),
    // matching deploy-init — Coolify needs docker_compose_domains, not $-escaped
    // compose labels.
    expect(
      kcEntry[0],
      "domain-doctor aisha-keycloak MUST register keycloak → https://${env.KEYCLOAK_DOMAIN_DIRECT || env.KEYCLOAK_DOMAIN}:80 (dynamic direct host), matching deploy-init.",
    ).toMatch(/name:\s*"keycloak",\s*domain:\s*`https:\/\/\$\{env\.KEYCLOAK_DOMAIN_DIRECT \|\| env\.KEYCLOAK_DOMAIN\}:80`/);
  });
});
