/**
 * NetBird Peers Gate
 *
 * Asserts the AISHA mesh peer discovery + sync pipeline exists and is
 * structurally correct. The gate has two halves:
 *
 *   1. Offline (always runs):
 *      - `scripts/netbird-peer-discover.mjs` exists + executable
 *      - `scripts/coolify-mesh-sync.mjs` exists + executable
 *      - Both are referenced by package.json `mesh:*` scripts
 *      - Discover script prints clear error when secrets missing (exit 2)
 *
 *   2. Online (skipped via AISHA_SKIP_ONLINE=1):
 *      - Discover script returns at least one peer with a 100.x.x.x mesh IP
 *      - At least one expected peer hostname is enrolled
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile, spawnSync } from "node:child_process";
import { reHost, vnitrniHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const SKIP_ONLINE = process.env.AISHA_SKIP_ONLINE === "1" || process.env.CI === "true";

describe("NetBird mesh discovery — script presence", () => {
  test("scripts/netbird-peer-discover.mjs exists", () => {
    expect(existsSync(join(ROOT, "scripts/netbird-peer-discover.mjs"))).toBe(true);
  });

  test("scripts/coolify-mesh-sync.mjs exists", () => {
    expect(existsSync(join(ROOT, "scripts/coolify-mesh-sync.mjs"))).toBe(true);
  });

  test("discover script has a Node shebang", () => {
    const content = readFileSync(join(ROOT, "scripts/netbird-peer-discover.mjs"), "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  test("sync script has a Node shebang", () => {
    const content = readFileSync(join(ROOT, "scripts/coolify-mesh-sync.mjs"), "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});

describe("NetBird mesh discovery — package.json wiring", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const scripts = pkg.scripts || {};

  test("mesh:discover script is registered", () => {
    expect(scripts["mesh:discover"], "package.json must declare `mesh:discover`").toBeTruthy();
  });

  test("mesh:sync script is registered", () => {
    expect(scripts["mesh:sync"], "package.json must declare `mesh:sync`").toBeTruthy();
  });

  test("mesh:sync:apply script is registered", () => {
    expect(scripts["mesh:sync:apply"], "package.json must declare `mesh:sync:apply`").toBeTruthy();
  });
});

describe("NetBird mesh discovery — Traefik routing", () => {
  const compose = readFileSync(join(ROOT, "docker-compose.coolify-netbird.yml"), "utf-8");
  const managementTemplate = readFileSync(join(ROOT, "coolify/netbird-management.json.template"), "utf-8");

  // 2026-08 multi-tenant routing rewrite: every public NetBird protocol goes
  // through Coolify's UUID-scoped Host router into one Caddy demux. Host-less
  // protobuf routers match all tenant domains on shared Traefik and are unsafe.
  test("gRPC is tenant-scoped through netbird-proxy with h2c on both hops", () => {
    expect(compose).not.toContain("traefik.http.routers.");
    // ⛔ ZDE SE DŘÍV VYŽADOVAL label `traefik.http.services.${APP_NAME_PREFIX:?…}
    // -netbird-proxy.loadbalancer.server.scheme=h2c`. Odstraněn 2026-08-18:
    // Coolify ručně psané labely NEINTERPOLUJE, takže do kontejneru šel literál
    // `${APP_NAME_PREFIX:?…}` — a cizí nájemník měl týž. Traefik obě instance
    // sloučil do JEDNÉ služby a rozložil mezi ně zátěž (naměřeno: 12 požadavků
    // s týmž tokenem → 200 401 200 401 …). Jednoznačnost dodává Coolify, které
    // svoje routery i služby odlišuje UUID aplikace.
    //
    // h2c tím NEZMIZELO — nese ho Caddyho konfigurace, ověřená hned níž
    // (`protocols h1 h2 h2c` na vstupu, `versions h2c` na obou skocích dál).
    // Label byl duplicitní deklarací téhož.
    expect(compose).not.toMatch(/traefik\.http\.(services|routers|middlewares)\.[^"=]*\$\{/);
    // ⭐ VLASTNOST, NE TVAR. Do 2026-09-02 tu stálo
    // `/servers \{\s*protocols h1 h2 h2c\s*\}/` — doslovný text tehdejšího
    // Caddyfile. Jenže právě ten tvar NESL VADU: `trusted_proxies` se emitoval
    // jako první globální blok podmíněně a tenhle jako druhý vždy, takže Caddy
    // při DORUČENÉM seznamu nenastartoval a spadla s ním celá řídicí rovina
    // meshe. Brána tu vadu DRŽELA — opravit ji nešlo, aniž by zčervenala.
    //
    // Ověřuje se proto pořadí (`servers {` … `protocols h1 h2 h2c`) bez ohledu
    // na to, jestli se blok píše doslova, nebo skládá `printf`em. Že je blok
    // právě JEDEN, hlídá `caddyfile-jeden-globalni-blok.gate.test.ts`.
    expect(compose).toMatch(/servers \{[\s\S]{0,600}?protocols h1 h2 h2c/);
    expect(compose).toMatch(
      new RegExp(
        "@grpcMgmt path /management\\.ManagementService/\\*[\\s\\S]{0,220}" +
          `reverse_proxy ${reHost("netbird-management", 443)}[\\s\\S]{0,100}versions h2c`,
      ),
    );
    expect(compose).toMatch(
      new RegExp(
        "@grpcSignal path /signalexchange\\.SignalExchange/\\*[\\s\\S]{0,160}" +
          `reverse_proxy h2c://${reHost("netbird-signal", 10000)}`,
      ),
    );
  });

  test("HTTP surface (/api, /relay, dashboard) is demuxed by netbird-proxy", () => {
    // /api → management over h2c. The intent is "plaintext HTTP/2 upstream to
    // management:443"; the OLD literal `h2c://netbird-management:443` is a hard
    // ERROR in current Caddy ("conflicting scheme (h2c://) and port (:443)")
    // and crash-looped netbird-proxy from its first deploy. The canonical idiom
    // (identical to the working netbird-internal-tls sidecar) is a bare
    // upstream + `transport http { versions h2c }` — assert exactly that shape,
    // and reject any regression back to the crashing scheme-prefixed form.
    const apiHandle = compose.match(
      new RegExp(
        `handle @api \\{\\s*reverse_proxy ${reHost("netbird-management", 443)} ` +
          "\\{\\s*transport http \\{\\s*versions h2c\\s*\\}\\s*\\}\\s*\\}",
      ),
    );
    expect(apiHandle, "/api must reach management:443 via the transport-http-h2c idiom").not.toBeNull();
    expect(
      compose.includes(`reverse_proxy h2c://${vnitrniHost("netbird-management", 443)}`),
      "h2c://…:443 upstream is a hard error in current Caddy (crash-loop) — use the transport block idiom",
    ).toBe(false);
    expect(compose, "/relay must reach the relay").toContain(`reverse_proxy ${vnitrniHost("netbird-relay", 33080)}`);
    expect(compose, "default route must be the dashboard").toContain(`reverse_proxy ${vnitrniHost("netbird-dashboard", 80)}`);
  });

  test("management advertises Signal + Relay via the internal mesh endpoint (:33073, AISHA cert)", () => {
    // Intra-cluster mesh routing (landed 2026-07-07): Signal + Relay are advertised
    // on ${NETBIRD_MESH_HOST}:33073 — the netbird-internal-tls Caddy sidecar, which
    // terminates TLS with the AISHA-PKI cert and routes
    // /signalexchange.SignalExchange/* → netbird-signal:10000 and /relay → netbird-relay.
    //
    // Agents resolve ${NETBIRD_MESH_HOST} via a STATIC extra_hosts entry (not mesh
    // DNS), so they reach :33073 pre-mesh-join — exactly as they already do for
    // Management. No host port exposure, no pfSense NAT-hairpin (which mangled the
    // Signal gRPC stream on the old public netbird.aisha.guru:443 path). Agents trust
    // the cert via aisha-ca-bundle.pem mounted from the pki-certs volume.
    //
    // See also: src/tests/gates/netbird-internal-tls.gate.test.ts.
    const config = JSON.parse(managementTemplate);

    expect(config.Signal).toEqual({
      Proto: "https",
      URI: "${NETBIRD_MESH_HOST}:${NETBIRD_MESH_PORT}",
      Username: "",
      Password: null,
    });
    expect(config.Relay.Addresses).toContain("rels://${NETBIRD_MESH_HOST}:${NETBIRD_MESH_PORT}/relay");
  });
});

describe("NetBird mesh discovery — Keycloak client selection", () => {
  test("discover script supports bootstrap owner auth and avoids dashboard OIDC client", () => {
    const content = readFileSync(join(ROOT, "scripts/netbird-peer-discover.mjs"), "utf-8");
    expect(content).toContain("AISHA_BOOTSTRAP_PASSWORD");
    expect(content).toContain("AISHA_BOOTSTRAP_CLIENT_SECRET");
    expect(content).toContain("NETBIRD_KEYCLOAK_CLIENT_ID");
    expect(content).toContain("NETBIRD_BACKEND_CLIENT_ID");
    expect(content).toContain("netbird-backend");
    expect(content).toContain("NETBIRD_OIDC_CLIENT_ID is the dashboard/frontend client");
  });
});

describe("NetBird mesh discovery — duplicate peer handling", () => {
  test("mesh sync prefers connected peers, then latest lastSeen for duplicate hostnames", () => {
    // Volba peera má od 2026-09-15 jeden domov (lib/mesh-peers.mjs, chování
    // pokrývá scripts/lib/mesh-peers.test.mjs); mesh sync ji musí POUŽÍVAT,
    // ne mít vlastní kopii, která se rozejde.
    const content = readFileSync(join(ROOT, "scripts/coolify-mesh-sync.mjs"), "utf-8");
    expect(content).toMatch(/import \{[^}]*nejlepsiPeerPodleJmena[^}]*\} from "\.\/lib\/mesh-peers\.mjs"/);
    expect(content).not.toContain("function shouldReplacePeer");
    const lib = readFileSync(join(ROOT, "scripts/lib/mesh-peers.mjs"), "utf-8");
    expect(lib).toContain("kandidat.connected");
    expect(lib).toContain("lastSeenMs(kandidat) - lastSeenMs(soucasny)");
  });

  test("mesh sync handles legacy BACKEND_MESH_IP and duplicate Coolify env rows", () => {
    const content = readFileSync(join(ROOT, "scripts/coolify-mesh-sync.mjs"), "utf-8");
    expect(content).toContain('BACKEND_MESH_IP: ["aisha-backend-host", "backend-host", "backend", "frontend-core", "core"]');
    expect(content).toContain("function currentEnvValue");
    expect(content).toContain("function hasEnvDrift");
    expect(content).toContain("if (merged[i].key !== d.key) continue");
  });

  test("edge stack routes mcp/api/dirigent via env-driven upstreams", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    // ⛔ DNAT SE SEM NESMÍ VRÁTIT (změřeno 2026-08-21). Do té doby tu stála dvě
    // pravidla PREROUTING --dport {3001,8080} → ${CORE_MESH_IP}, a tenhle test
    // je VYŽADOVAL. Držel tím vadu: DNAT klíčuje POUZE PORTEM, takže jakmile
    // do mesh vstoupil druhý stack, port 8080 (imgproxy jádra i n8n) poslal
    // veřejný provoz mcp/dirigent do jádra a přísný ingress ho odmítl 421.
    // Port není adresa — edge dnes míří JMÉNEM a do mesh se dostane routou.
    expect(
      compose,
      "mesh-router nesmí mít DNAT na CORE_MESH_IP — port není adresa, provoz " +
        "jiných stacků by skončil v jádru (421). Cesta je routa + jméno.",
    ).not.toMatch(/-j DNAT --to-destination \$\$\{CORE_MESH_IP/);
    // edge-proxy routuje přes proměnné (mesh i veřejná lane). Scope: MCP, API, DIRIGENT.
    expect(compose).toMatch(/reverse_proxy \$\$\{MCP_UPSTREAM\}/);
    expect(compose).toMatch(/reverse_proxy \$\$\{API_UPSTREAM\}/);
    expect(compose).toMatch(/reverse_proxy \$\$\{DIRIGENT_UPSTREAM\}/);
  });

  test("mesh-router NetBird state persists across redeploys", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    // Volume drží NetBird stav edge napříč redeployy. Jméno je INSTANČNÍ
    // (${APP_NAME_PREFIX}_edge-proxy-data) — víc instancí na hostu nesmí sdílet
    // stejný state volume (jinak by si přepisovaly enrollment). v2 přípona
    // zahozena při wipe-clean přechodu na instanční jména (2026-08-09).
    expect(compose).toContain("edge-proxy-data:/etc/netbird");
    expect(compose).toMatch(/name:\s*\$\{APP_NAME_PREFIX[^}]*\}_edge-proxy-data/);
  });

  test("NetBird agents reconnect from persisted config before using setup key", () => {
    const composeFiles = [
      "docker-compose.coolify.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-cosmos.yml",
      "docker-compose.coolify-integration.yml",
    ];
    const combined = composeFiles.map((file) => readFileSync(join(ROOT, file), "utf-8")).join("\n");

    expect(combined).not.toContain("Wipe-on-start");
    expect(combined).toContain("NB_FORCE_REENROLL=1");
    expect(combined).toContain("Existing config found at $$CONFIG_FILE");
    expect(combined).toContain("No existing config");
  });
});

describe("NetBird mesh discovery — error handling without secrets", () => {
  test("discover script exits 2 with clear error when secrets missing", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/netbird-peer-discover.mjs")], {
      encoding: "utf-8",
      env: {
        ...process.env,
        // Strip secrets to test failure path
        NETBIRD_MGMT_SECRET: "",
        NETBIRD_API_TOKEN: "",
        // Prevent fallback from .env-prod-backup
        NETBIRD_API_URL: "https://example.invalid",
        KEYCLOAK_URL: "https://example.invalid",
        // ISOLATION SEAM: point the secret-backup fallback at a nonexistent
        // file. URL overrides alone did NOT isolate — the script still read
        // the real .env-prod-backup for NETBIRD_MGMT_SECRET, so a populated
        // operator vault made this test attempt a live fetch ("fetch failed")
        // instead of asserting the secrets-missing fail-fast.
        AISHA_ENV_BACKUP_FILE: "/nonexistent/netbird-gate-isolated.env",
      },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/NETBIRD_MGMT_SECRET|NETBIRD_API_TOKEN|Need/i);
  });
});

/**
 * ⛔ NAMĚŘENO 2026-09-13 (doktor, fáze N): „sonda Keycloaku přeskočena: KEYCLOAK_REALM
 * není deklarovaná" — přestože `.env.coolify` instance realm deklaroval. Discovery
 * četla realm JEN z prostředí, sourozenecké klíče téhož dotazu (NETBIRD_DOMAIN,
 * KEYCLOAK_DOMAIN_PUBLIC, *_DOMAIN_DIRECT) z konfiguračního řetězu. Doktor
 * `.env.coolify` nesourcuje, takže adresu dostal a realm ne.
 *
 * Měří se CHOVÁNÍ, ne text: kopie nástroje v dočasném kořeni (ROOT se odvozuje
 * z umístění skriptu, takže řetěz čte `.env.coolify` té kopie), prostředí bez
 * KEYCLOAK_REALM a místní HTTP server, který zapisuje, na jaké cesty se discovery
 * ptá. Realm z řetězu se musí objevit v dotazu na OIDC discovery.
 */
async function discoveryVKopii(
  retez: string | null,
  env: Record<string, string> = {},
): Promise<{ kod: number | null; stderr: string; cesty: string[] }> {
  const koren = mkdtempSync(join(tmpdir(), "nb-realm-z-retezu-"));
  mkdirSync(join(koren, "scripts/lib"), { recursive: true });
  copyFileSync(join(ROOT, "scripts/netbird-peer-discover.mjs"), join(koren, "scripts/netbird-peer-discover.mjs"));
  for (const f of ["config-env-files.mjs", "env-hodnota.mjs", "netbird-auth.mjs", "cli-entry.mjs", "mesh-peers.mjs"]) {
    copyFileSync(join(ROOT, "scripts/lib", f), join(koren, "scripts/lib", f));
  }
  if (retez !== null) writeFileSync(join(koren, ".env.coolify"), retez);
  const cesty: string[] = [];
  const server = createServer((req, res) => {
    cesty.push(req.url ?? "");
    res.statusCode = 404;
    res.end("nic");
  });
  await new Promise<void>((hotovo) => server.listen(0, "127.0.0.1", () => hotovo()));
  const adresa = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await new Promise((vysledek) => {
      execFile(
        process.execPath,
        [join(koren, "scripts/netbird-peer-discover.mjs"), "--json"],
        {
          // Prostředí se staví OD NULY: realm ani pověření z prostředí běžce do měření nesmí.
          env: {
            PATH: process.env.PATH ?? "",
            KEYCLOAK_PUBLIC_URL: adresa,
            NETBIRD_API_URL: adresa,
            AISHA_ENV_BACKUP_FILE: "/nonexistent/nb-realm-z-retezu.env",
            ...env,
          },
          timeout: 30_000,
        },
        (err, _stdout, stderr) =>
          vysledek({ kod: err ? (typeof err.code === "number" ? err.code : null) : 0, stderr: String(stderr), cesty }),
      );
    });
  } finally {
    server.close();
    rmSync(koren, { recursive: true, force: true });
  }
}

describe("NetBird mesh discovery — realm chodí toutéž cestou jako ostatní klíče", () => {
  const DISCOVERY = "/.well-known/openid-configuration";

  test("realm deklarovaný jen v .env.coolify se dostane do dotazu na Keycloak", async () => {
    const r = await discoveryVKopii("KEYCLOAK_REALM=realm-z-retezu\n");
    expect(r.kod, `nástroj neskončil dohodnutým kódem 2 (import kopie selhal?): ${r.stderr}`).toBe(2);
    expect(r.stderr).not.toMatch(/KEYCLOAK_REALM není deklarovaná/);
    expect(r.cesty).toContain(`/realms/realm-z-retezu${DISCOVERY}`);
  }, 40_000);

  test("výslovně exportovaný realm má přednost před řetězem", async () => {
    const r = await discoveryVKopii("KEYCLOAK_REALM=realm-z-retezu\n", { KEYCLOAK_REALM: "realm-z-prostredi" });
    expect(r.cesty).toContain(`/realms/realm-z-prostredi${DISCOVERY}`);
    expect(r.cesty).not.toContain(`/realms/realm-z-retezu${DISCOVERY}`);
  }, 40_000);

  test("sonda jde rozsvítit — realm nedeklarovaný nikde: žádný dotaz na realm a nahlas proč", async () => {
    const r = await discoveryVKopii("NETBIRD_DOMAIN=netbird.example.invalid\n");
    expect(r.kod).toBe(2);
    expect(r.stderr).toMatch(/KEYCLOAK_REALM není deklarovaná/);
    expect(r.cesty.filter((c) => c.startsWith("/realms/"))).toEqual([]);
  }, 40_000);
});

describe.skipIf(SKIP_ONLINE)("NetBird mesh discovery — live API", () => {
  test("discover script lists at least one peer with mesh IP", async () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/netbird-peer-discover.mjs"), "--json"], {
      encoding: "utf-8",
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error(`Discovery failed (exit ${result.status}): ${result.stderr}`);
    }
    const peers = JSON.parse(result.stdout);
    expect(Array.isArray(peers)).toBe(true);
    const withIp = peers.filter((p: { ip?: string }) => p.ip && /^100\./.test(p.ip));
    expect(withIp.length, `expected at least one mesh peer with 100.x.x.x IP, got: ${JSON.stringify(peers)}`).toBeGreaterThan(0);
  }, 30_000);
});
