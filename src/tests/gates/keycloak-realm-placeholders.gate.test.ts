/**
 * Realm placeholders reach the Keycloak container — Integral Design Gate
 *
 * `keycloak/render-realm-and-start.sh` substitutes every `${UPPER_CASE}` name in
 * the realm template that the CONTAINER's environment defines, and leaves the
 * rest literal. A name that never reaches the container therefore ships into the
 * rendered realm as the seven characters `${VAR}` — and what happens next
 * depends on where it sat:
 *
 *   · in a redirectUri  → Keycloak REFUSES TO START ("Invalid client
 *     openclaw-proxy: A redirect URI is not a valid URI"). Measured once
 *     already; the script's own comment carries the post-mortem.
 *   · in a client secret → the client is created with an unusable password and
 *     everything starts GREEN. The service that holds the real secret then fails
 *     to authenticate, far from the cause.
 *
 * Both only fire on a FRESH database, because an already-imported realm is not
 * re-imported. So the drift is invisible for months and then blocks a rebuild at
 * the worst possible moment — which is exactly why it needs a gate and not a
 * convention.
 *
 * Being mentioned in the compose file is NOT delivery. `KC_HOSTNAME:
 * ${KEYCLOAK_DOMAIN_PUBLIC}` and traefik labels are substituted by Coolify when
 * it renders the compose; they put nothing in the container's environment. Only
 * a key under the keycloak service's `environment:` does that — so that is what
 * this gate measures.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const REALM = join(ROOT, "keycloak/aisha-realm.json");
const KC_COMPOSE = join(ROOT, "docker-compose.coolify-keycloak.yml");

/**
 * Lower-case `${client_id}` / `${role_...}` are Keycloak's OWN message-bundle
 * placeholders and are supposed to stay literal — the render script skips them
 * for the same reason, so the gate must not demand an environment value.
 */
function realmPlaceholders(): string[] {
  const tmpl = readFileSync(REALM, "utf8");
  return [...new Set([...tmpl.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]!))].sort();
}

/** Keys the keycloak service actually puts into the container's environment. */
function containerEnvKeys(): Set<string> {
  const doc = yaml.load(readFileSync(KC_COMPOSE, "utf8")) as {
    services?: Record<string, { environment?: Record<string, unknown> | string[] }>;
  };
  const keys = new Set<string>();
  for (const svc of Object.values(doc.services ?? {})) {
    const env = svc.environment;
    if (Array.isArray(env)) {
      for (const line of env) keys.add(String(line).split("=")[0]!.trim());
    } else if (env && typeof env === "object") {
      for (const k of Object.keys(env)) keys.add(k);
    }
  }
  return keys;
}

describe("Keycloak realm placeholders (gate)", () => {
  test("the realm template still has placeholders to reason about", () => {
    expect(realmPlaceholders().length).toBeGreaterThan(10);
  });

  test("every realm placeholder is delivered to the container's environment", () => {
    const env = containerEnvKeys();
    const undelivered = realmPlaceholders().filter((v) => !env.has(v));
    expect(
      undelivered,
      `these names appear as \${...} in keycloak/aisha-realm.json but no key under the ` +
        `keycloak service's environment: puts them in the container, so render-realm leaves ` +
        `them LITERAL in the imported realm — a broken redirect URI stops Keycloak from ` +
        `starting, a broken secret starts green and fails later:\n  ` + undelivered.join("\n  ")
    ).toEqual([]);
  });
});
