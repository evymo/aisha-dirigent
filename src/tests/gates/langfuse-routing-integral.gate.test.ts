/**
 * Langfuse (aisha-observability) Routing — Coolify-owned Design Gate
 *
 * Mirrors keycloak-routing-integral. The service exposes :8080 and the dynamic
 * ${LANGFUSE_DOMAIN} route is owned by docker_compose_domains.
 *
 *   COMPOSE — exposes :8080 and opts the gateway into Coolify.
 *   ROUTING — deploy-init set_coolify_domains +
 *     domain-doctor entry (docker_compose_domains).
 *
 * WHY both planes (empirical correction, verified 2026-06-09 in prod): Coolify
 * escapes every `$` → `$$` in Traefik label VALUES at deploy time, so a
 * compose label `Host(\`${LANGFUSE_DOMAIN}\`)` becomes a literal string that
 * Traefik never matches. Hand-written router names are also global on the
 * shared proxy. Coolify-generated project-scoped routers are the only routing
 * owner. See feedback_coolify_label_dollar_escape.md.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COMPOSE = join(ROOT, "docker-compose.coolify-langfuse.yml");
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
const DOMAIN_DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");

describe("Langfuse (observability) Routing — Coolify-owned Design", () => {
  test("compose exposes the gateway but declares no globally named custom Traefik objects", () => {
    const compose = readFileSync(COMPOSE, "utf-8");

    expect(
      compose,
      "langfuse compose MUST opt langfuse-gateway into Coolify routing.",
    ).toContain('"traefik.enable=true"');

    expect(
      compose,
      "langfuse-gateway must expose its Coolify routing port 8080.",
    ).toMatch(/expose:\s*\n\s*- "8080"/);
    expect(compose).not.toMatch(/traefik\.http\.(routers|services|middlewares)\./);
  });

  test("PLANE 2: coolify-deploy-init registers langfuse routing via set_coolify_domains (dynamic)", () => {
    const init = readFileSync(DEPLOY_INIT, "utf-8");

    const obsCaseMatch = init.match(/observability\)\s*\n([\s\S]*?)\n\s*;;/);
    expect(obsCaseMatch, "Could not find `observability)` case in deploy-init switch.").toBeTruthy();
    if (!obsCaseMatch) return;
    const block = obsCaseMatch[1];

    expect(
      block,
      "deploy-init observability case MUST call set_coolify_domains — Coolify escapes $ in compose labels, so docker_compose_domains is the only working production path.",
    ).toMatch(/set_coolify_domains\b/);

    expect(
      block,
      "deploy-init langfuse domain MUST be the dynamic `langfuse-gateway=https://${LANGFUSE_DOMAIN}:8080`.",
    ).toMatch(/langfuse-gateway=https:\/\/\$\{LANGFUSE_DOMAIN\}:8080/);
  });

  test("PLANE 2: coolify-domain-doctor carries the matching langfuse domain (recovery/SoT, dynamic)", () => {
    const doctor = readFileSync(DOMAIN_DOCTOR, "utf-8");

    const obsEntry = doctor.match(/\{\s*app:\s*"aisha-observability"[\s\S]*?\n\s*\]\s*\}\s*,/);
    expect(obsEntry, "Could not find `aisha-observability` entry in domain-doctor contract.").toBeTruthy();
    if (!obsEntry) return;

    expect(
      obsEntry[0],
      "domain-doctor aisha-observability MUST register langfuse-gateway → https://${LANGFUSE_DOMAIN}:8080 (dynamic), matching deploy-init.",
    ).toMatch(/name:\s*"langfuse-gateway",\s*domain:\s*`https:\/\/\$\{env\.LANGFUSE_DOMAIN\}:8080`/);
  });
});
