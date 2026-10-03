/**
 * Admin (NocoDB + Appsmith) Routing — Coolify-owned Design Gate
 *
 * Mirrors keycloak-routing-integral and langfuse-routing-integral. Routing for
 * NocoDB + Appsmith + Intranet is declared from the SAME dynamic ${VAR}/env
 * values (no hardcoded hostnames):
 *
 *   COMPOSE — exposes each backend port and opts the service into Coolify.
 *   ROUTING — deploy-init set_coolify_domains +
 *     domain-doctor entry (docker_compose_domains).
 *
 * The admin stack has multiple internal hostnames:
 *   - ${NOCODB_DOMAIN}    → nocodb :8080 (NocoDB OSS, no native OIDC).
 *   - ${APPSMITH_DOMAIN}  → appsmith-auth :4180 (OAuth2 Proxy sidecar).
 *   - ${INTRANET_DOMAIN}  → intranet-auth :4180 (OAuth2 Proxy sidecar).
 *
 * Coolify generates project/application-scoped Traefik router and service names
 * from docker_compose_domains. Hand-written router names are global on a shared
 * proxy, and ${VAR} values are escaped by Coolify, so they are both collision
 * prone and dead. The compose therefore MUST NOT declare custom HTTP objects.
 * See feedback_coolify_label_dollar_escape.md.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { naSiti, reHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const COMPOSE = join(ROOT, "docker-compose.coolify-admin.yml");
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
const DOMAIN_DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");

describe("Admin (NocoDB + Appsmith) Routing — Coolify-owned Design", () => {
  test("compose exposes routed services but declares no globally named custom Traefik objects", () => {
    const compose = readFileSync(COMPOSE, "utf-8");

    for (const [service, port] of [["nocodb", "8080"], ["appsmith-auth", "4180"], ["intranet-auth", "4180"]] as const) {
      const start = compose.indexOf(`\n  ${service}:`);
      expect(start, `compose must define ${service}`).toBeGreaterThan(-1);
      const rest = compose.slice(start + 1);
      const nextHeader = rest.match(/\n {2}[a-z0-9][a-z0-9._-]*:\s*\n/);
      const next = nextHeader?.index === undefined ? -1 : start + 1 + nextHeader.index;
      const block = compose.slice(start, next === -1 ? undefined : next);
      expect(block, `${service} must expose its Coolify routing port ${port}`).toMatch(
        new RegExp(`expose:\\s*\\n\\s*- "${port}"`),
      );
      expect(
        naSiti(compose, service, "coolify"),
        `${service} must be attached to the shared Coolify proxy network`,
      ).toBe(true);
    }

    expect(compose).not.toMatch(/traefik\.http\.(routers|services|middlewares)\./);
  });

  test("PLANE 2: coolify-deploy-init registers admin routing via set_coolify_domains (dynamic)", () => {
    const init = readFileSync(DEPLOY_INIT, "utf-8");

    const adminCaseMatch = init.match(/(?:^|\n) {4}admin\)\n([\s\S]*?)\n\s*;;/);
    expect(adminCaseMatch, "Could not find `admin)` case in deploy-init switch.").toBeTruthy();
    if (!adminCaseMatch) return;
    const block = adminCaseMatch[1];

    expect(
      block,
      "deploy-init admin case MUST call set_coolify_domains — Coolify escapes $ in compose labels, so docker_compose_domains is the only working production path.",
    ).toMatch(/set_coolify_domains\b/);
    expect(
      block,
      "deploy-init admin MUST register the dynamic nocodb=https://${NOCODB_DOMAIN}:8080.",
    ).toMatch(/nocodb=https:\/\/\$\{NOCODB_DOMAIN\}:8080/);
    expect(
      block,
      "deploy-init admin MUST register the dynamic appsmith-auth=https://${APPSMITH_DOMAIN}:4180.",
    ).toMatch(/appsmith-auth=https:\/\/\$\{APPSMITH_DOMAIN\}:4180/);
    expect(
      block,
      "deploy-init admin MUST register the dynamic intranet-auth=https://${INTRANET_DOMAIN}:4180.",
    ).toMatch(/intranet-auth=https:\/\/\$\{INTRANET_DOMAIN\}:4180/);
  });

  test("PLANE 2: coolify-domain-doctor carries the matching admin domains (recovery/SoT, dynamic)", () => {
    const doctor = readFileSync(DOMAIN_DOCTOR, "utf-8");

    const adminEntry = doctor.match(/\{\s*app:\s*"aisha-admin"[\s\S]*?\n\s*\]\s*\}\s*,/);
    expect(adminEntry, "Could not find `aisha-admin` entry in domain-doctor contract.").toBeTruthy();
    if (!adminEntry) return;
    const entry = adminEntry[0];

    expect(
      entry,
      "domain-doctor aisha-admin MUST register nocodb → https://${NOCODB_DOMAIN}:8080 (dynamic).",
    ).toMatch(/name:\s*"nocodb",\s*domain:\s*`https:\/\/\$\{env\.NOCODB_DOMAIN\}:8080`/);
    expect(
      entry,
      "domain-doctor aisha-admin MUST register appsmith-auth → https://${APPSMITH_DOMAIN}:4180 (dynamic).",
    ).toMatch(/name:\s*"appsmith-auth",\s*domain:\s*`https:\/\/\$\{env\.APPSMITH_DOMAIN\}:4180`/);
    expect(
      entry,
      "domain-doctor aisha-admin MUST register intranet-auth → https://${INTRANET_DOMAIN}:4180 (dynamic).",
    ).toMatch(/name:\s*"intranet-auth",\s*domain:\s*`https:\/\/\$\{env\.INTRANET_DOMAIN\}:4180`/);
  });
});
