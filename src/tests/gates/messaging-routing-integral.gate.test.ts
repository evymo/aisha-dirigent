/**
 * Messaging Routing — Coolify-owned Design Gate
 *
 * Mirrors keycloak / langfuse / admin routing gates. Routing for the 3
 * messaging hostnames is declared from the SAME dynamic ${VAR}/env values.
 *
 *   COMPOSE — each routed service exposes its backend port.
 *   ROUTING — deploy-init set_coolify_domains +
 *     domain-doctor entry (docker_compose_domains).
 *
 * Hostnames covered by the env/domain contract:
 *   - ${MATRIX_DOMAIN}       → synapse :8008 (Matrix homeserver)
 *   - ${ELEMENT_DOMAIN}      → element-web nginx :80 (Element web client)
 *   - ${ELEMENT_CALL_DOMAIN} → element-call :8080 (LiveKit-backed Matrix Calls)
 *
 * WHY one routing owner (empirical correction, verified in production): Coolify
 * escapes every `$` → `$$` in Traefik label VALUES at deploy time, so compose
 * labels alone don't route on Coolify. Hand-written names are global on the
 * shared proxy. docker_compose_domains generates project-scoped routers.
 * See feedback_coolify_label_dollar_escape.md.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { naSiti, reHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const COMPOSE = join(ROOT, "docker-compose.coolify-matrix.yml");
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
const DOMAIN_DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");

describe("Messaging Routing — Coolify-owned Design", () => {
  test("compose exposes all three services but declares no globally named custom Traefik objects", () => {
    const compose = readFileSync(COMPOSE, "utf-8");

    for (const [service, port] of [["synapse", "8008"], ["element-web", "80"], ["element-call", "8080"]] as const) {
      const start = compose.indexOf(`\n  ${service}:`);
      expect(start, `compose must define ${service}`).toBeGreaterThan(-1);
      const rest = compose.slice(start + 1);
      const nextHeader = rest.match(/\n {2}[a-z0-9][a-z0-9._-]*:\s*\n/);
      const next = nextHeader?.index === undefined ? -1 : start + 1 + nextHeader.index;
      const block = compose.slice(start, next === -1 ? undefined : next);
      expect(block, `${service} must expose ${port}`).toMatch(new RegExp(`expose:\\s*\\n\\s*- "${port}"`));
      expect(
        naSiti(compose, service, "coolify"),
        `${service} must be attached to the shared Coolify proxy network`,
      ).toBe(true);
    }
    expect(compose).not.toMatch(/traefik\.http\.(routers|services|middlewares)\./);
  });

  test("PLANE 2: coolify-deploy-init registers matrix routing via set_coolify_domains (dynamic)", () => {
    const init = readFileSync(DEPLOY_INIT, "utf-8");

    // The case label is `matrix|messaging)` (alternation) — match either form.
    const matrixCaseMatch = init.match(/(?:matrix\|messaging|matrix)\)\s*\n([\s\S]*?)\n\s*;;/);
    expect(matrixCaseMatch, "Could not find `matrix)` or `matrix|messaging)` case in deploy-init switch.").toBeTruthy();
    if (!matrixCaseMatch) return;
    const block = matrixCaseMatch[1];

    expect(
      block,
      "deploy-init matrix case MUST call set_coolify_domains — Coolify escapes $ in compose labels, so docker_compose_domains is the only working production path.",
    ).toMatch(/set_coolify_domains\b/);
    expect(
      block,
      "deploy-init matrix MUST register the dynamic synapse=https://${MATRIX_DOMAIN}:8008.",
    ).toMatch(/synapse=https:\/\/\$\{MATRIX_DOMAIN\}:8008/);
    expect(
      block,
      "deploy-init matrix MUST register the dynamic element-web=https://${ELEMENT_DOMAIN}:80.",
    ).toMatch(/element-web=https:\/\/\$\{ELEMENT_DOMAIN\}:80/);
    expect(
      block,
      "deploy-init matrix MUST register the dynamic element-call=https://${ELEMENT_CALL_DOMAIN}:8080.",
    ).toMatch(/element-call=https:\/\/\$\{ELEMENT_CALL_DOMAIN\}:8080/);
  });

  test("PLANE 2: coolify-domain-doctor carries the matching messaging domains (recovery/SoT, dynamic)", () => {
    const doctor = readFileSync(DOMAIN_DOCTOR, "utf-8");

    const entry = doctor.match(/\{\s*app:\s*"aisha-messaging"[\s\S]*?\n\s*\]\s*\}\s*,/);
    expect(entry, "Could not find `aisha-messaging` entry in domain-doctor contract.").toBeTruthy();
    if (!entry) return;
    const block = entry[0];

    expect(
      block,
      "domain-doctor aisha-messaging MUST register synapse → https://${MATRIX_DOMAIN}:8008 (dynamic).",
    ).toMatch(/name:\s*"synapse",\s*domain:\s*`https:\/\/\$\{env\.MATRIX_DOMAIN\}:8008`/);
    expect(
      block,
      "domain-doctor aisha-messaging MUST register element-web → https://${ELEMENT_DOMAIN}:80 (dynamic).",
    ).toMatch(/name:\s*"element-web",\s*domain:\s*`https:\/\/\$\{env\.ELEMENT_DOMAIN\}:80`/);
    expect(
      block,
      "domain-doctor aisha-messaging MUST register element-call → https://${ELEMENT_CALL_DOMAIN}:8080 (dynamic).",
    ).toMatch(/name:\s*"element-call",\s*domain:\s*`https:\/\/\$\{env\.ELEMENT_CALL_DOMAIN\}:8080`/);
  });
});
