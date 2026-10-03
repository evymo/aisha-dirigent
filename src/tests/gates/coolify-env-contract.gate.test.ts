import { describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function viteBackendKey(suffix: string): string {
  return ["VITE", "AISHA", "BACKEND", suffix].join("_");
}

function expectAll(content: string, relPath: string, keys: string[]): void {
  const missing = keys.filter((key) => !content.includes(key));
  expect(missing, `${relPath} is missing env keys:\n${missing.join("\n")}`).toEqual([]);
}

describe("Coolify env contract", () => {
  test("secret generator treats .env-prod-backup as the authoritative cold-start foundation", () => {
    const dir = mkdtempSync(join(tmpdir(), "aisha-prod-backup-foundation-"));
    try {
      const backup = join(dir, ".env-prod-backup");
      const coolify = join(dir, ".env.coolify");
      // Values are floor-compliant (POSTGRES_PASSWORD ≥ 24 chars, JWT_SECRET ≥ 32
      // chars) so the preserved-secret strength floor never re-keys them — this
      // test asserts source PRECEDENCE; the floor itself is covered by
      // secret-strength-floor.gate.test.ts.
      writeFileSync(
        backup,
        [
          "POSTGRES_PASSWORD=prod-postgres-0123456789abcdef",
          "JWT_SECRET=prod-jwt-0123456789abcdefghijklmnopqrstuv",
          "COSMOS_SIGNER_MNEMONIC=prod mnemonic words",
          "OPENAI_API_KEY=prod-openai",
          "ADMIN_EMAIL=ops@example.test",
          "NETBIRD_MESH_HOST=netbird.prod-mesh.example.test",
          "MINIO_ROOT_USER_OLD=prod-minio-old-user",
          "",
        ].join("\n"),
      );
      writeFileSync(
        coolify,
        [
          "POSTGRES_PASSWORD=coolify-postgres-0123456789abcdef",
          "JWT_SECRET=coolify-jwt-0123456789abcdefghijklmnopqrstuv",
          "OPENAI_API_KEY=coolify-openai",
          "NETBIRD_MESH_HOST=netbird.coolify.example.test",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "node",
        [
          join(ROOT, "scripts/generate-secrets.mjs"),
          "--preserve=1",
          `--env-backup=${backup}`,
          `--env-coolify=${coolify}`,
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            APP_NAME_PREFIX: "aisha", // fixture must declare its instance — the generator no longer guesses one
            POSTGRES_PASSWORD: "process-postgres",
            OPENAI_API_KEY: "process-openai",
          },
          encoding: "utf8",
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("POSTGRES_PASSWORD='prod-postgres-0123456789abcdef'");
      expect(result.stdout).toContain("JWT_SECRET='prod-jwt-0123456789abcdefghijklmnopqrstuv'");
      expect(result.stdout).toContain("OPENAI_API_KEY='prod-openai'");
      expect(result.stdout).toContain("PGADMIN_EMAIL='ops@example.test'");
      expect(result.stdout).toContain("NETBIRD_MESH_HOST='netbird.prod-mesh.example.test'");
      expect(result.stdout).toContain("MINIO_ROOT_USER_OLD='prod-minio-old-user'");
      expect(result.stdout).not.toContain("coolify-postgres");
      expect(result.stdout).not.toContain("process-postgres");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cold-start and env-doctor load prod backup before derived topology fallbacks", () => {
    const coldStart = read("scripts/aisha-cold-start.sh");
    const envDoctor = read("scripts/aisha-env-doctor.mjs");

    expect(coldStart).toContain('load_env_file_keys "$ENV_PROD_BACKUP" "overwrite"');
    expect(coldStart).toContain("--env-backup=\"${ENV_PROD_BACKUP:-}\"");
    expect(envDoctor).toContain("hydrateProcessEnvFromProdBackup()");
    // dom() je blok (normalizace URL bez hostitele, nerozbalitelný odkaz), pořadí zdrojů
    // uvnitř drží týž záměr: deklarace operátora PŘED prostředím a derivací.
    expect(envDoctor).toMatch(/const dom = \(key\) => \{[^}]*?prodEnv\(key\) \|\| process\.env\[key\] \|\|/);
    expect(envDoctor).toMatch(/const topo = \(key\) => prodEnv\(key\) \|\| process\.env\[key\]/);
  });

  test("cold-start generates the critical cross-stack env contract", () => {
    const coldStart = read("scripts/aisha-cold-start.sh");

    expectAll(coldStart, "scripts/aisha-cold-start.sh", [
      "AISHA_SERVICE_KEY",
      "AISHA_API_URL",
      "AISHA_ANON_KEY",
      "AISHA_BACKEND_URL",
      "AISHA_BACKEND_ANON_KEY",
      "AISHA_BACKEND_SERVICE_KEY",
      viteBackendKey("URL"),
      viteBackendKey("ANON_KEY"),
      viteBackendKey("PUBLISHABLE_KEY"),
      "VITE_REQUIRE_AISHA_BACKEND_ENV",
      "VITE_KC_URL",
      "VITE_KC_AUTHORITY",
      "VITE_AUTH_REDIRECT_URI",
      "AUTH_DOMAIN_PUBLIC",
      "AUTH_UPSTREAM_PUBLIC",
      "AUTH_UPSTREAM_MESH",
      "NOCODB_JWT_SECRET",
      "NOCODB_OIDC_SECRET",
      "APPSMITH_OIDC_SECRET",
      "N8N_OIDC_SECRET",
      "N8N_COOKIE_SECRET",
      "RABBITMQ_USER",
      "RABBITMQ_PASS",
      "ELEMENT_CALL_DOMAIN",
      "NETBIRD_API_URL",
      "NETBIRD_AUTH_SCHEME",
      "NETBIRD_SANDBOX_GROUP",
      "NETBIRD_STACK_KEY_FRONTEND",
      "NETBIRD_STACK_KEY_INTEGRATION",
      "NETBIRD_STACK_KEY_EXPERIMENTAL",
    ]);
  });

  test("RabbitMQ adresu a port doručuje env-doktor z katalogu (derived), ne literál cold-startu", () => {
    // ⛔ 2026-09-17: RABBITMQ_HOST=backend.<mesh> a RABBITMQ_PORT=5673 (host port)
    // psal heredoc cold-startu přes generate-secrets. Host port kolidoval s jinou
    // instancí na sdíleném hostiteli; adresu teď odvozuje integration.internal_tcp_endpoints.
    const envDoctor = read("scripts/aisha-env-doctor.mjs");
    expect(envDoctor).toContain('["RABBITMQ_HOST", "derived", derivedTopo("RABBITMQ_HOST")]');
    expect(envDoctor).toContain('["RABBITMQ_PORT", "derived", derivedTopo("RABBITMQ_PORT")]');
    const katalog = JSON.parse(read("config/services.json"));
    const tcp = (katalog.services ?? katalog).integration?.internal_tcp_endpoints ?? [];
    expect(tcp.some((e: { env_aliases?: string[] }) => e.env_aliases?.includes("RABBITMQ_HOST"))).toBe(true);
    expect(tcp.some((e: { port_env_aliases?: string[] }) => e.port_env_aliases?.includes("RABBITMQ_PORT"))).toBe(true);
  });

  test("deploy-init maps critical envs to their stack setup paths", () => {
    const deployInit = read("scripts/coolify-deploy-init.sh");

    expectAll(deployInit, "scripts/coolify-deploy-init.sh", [
      viteBackendKey("URL"),
      viteBackendKey("ANON_KEY"),
      viteBackendKey("PUBLISHABLE_KEY"),
      "VITE_REQUIRE_AISHA_BACKEND_ENV",
      "VITE_KC_URL",
      "GIT_SHA",
      "NOCODB_OIDC_SECRET",
      "N8N_OIDC_SECRET",
      "RABBITMQ_DEFAULT_PASS",
      "RABBITMQ_HOST",
      "ELEMENT_CALL_DOMAIN",
      "NETBIRD_STACK_KEY_FRONTEND",
      "NETBIRD_STACK_KEY_INTEGRATION",
      "NETBIRD_STACK_KEY_EXPERIMENTAL",
      "NETBIRD_API_URL",
      "NETBIRD_AUTH_SCHEME",
      "NETBIRD_MGMT_SECRET",
      "POSTGREST_SERVICE_TOKEN",
      // Domain / topology keys from config/domains.env (and derive) that are
      // required at Coolify docker compose *build* time for aisha-edge / web
      // (Dockerfile.web does i18n:check + render-app-config which FATALs on
      // missing ${VAR} from VITE_PUBLIC_SITE_URL / VITE_KC_URL / VITE_API_URL
      // derivations + loadDomains fallback). Missing => build aborts with
      // "variable is not set" + render FATAL (seen in 2026-06-07 cold-start on
      // fresh multi-server setup).
      "APP_DOMAIN",
      "API_DOMAIN",
      "API_DOMAIN_PUBLIC",
      "PUBLIC_TLD",
      "INTERNAL_TLD",
      "KEYCLOAK_DOMAIN",
      // KEYCLOAK_DOMAIN_PUBLIC is also required for edge builds (warned in the
      // 2026-06-07 logs) but is set via domains handling / set_coolify_domains
      // paths; the direct bare set may be under a different identifier.
    ]);
  });

  test("deploy-init pushes VERDACCIO_URL + VERDACCIO_TOKEN to every app as BUILDTIME env", () => {
    // 18 service Dockerfiles (svc-matrix, svc-openclaw, svc-agent-runner, …)
    // hard-require ${VERDACCIO_URL:?} at BUILD time to fetch @aisha/* from the
    // private registry. Their compose build.args pass ${VERDACCIO_URL:-}
    // (empty default), so the value MUST be in the app's Coolify env or
    // `docker build` exits 2 — the aisha-messaging svc-matrix failure on Giah.
    // deploy-init must push BOTH, marked buildtime (4th arg "true"), so Coolify
    // exposes them to the image build. Regression guard for the gap where the
    // per-stack loop set runtime env but never these two.
    const deployInit = read("scripts/coolify-deploy-init.sh");
    expect(
      /set_coolify_env(_if)?\s+"\$\w+"\s+"VERDACCIO_URL"\s+"[^"]*"\s+"true"/.test(deployInit),
      "coolify-deploy-init.sh must push VERDACCIO_URL as a buildtime env (4th arg \"true\")",
    ).toBe(true);
    expect(
      /set_coolify_env(_if)?\s+"\$\w+"\s+"VERDACCIO_TOKEN"\s+"[^"]*"\s+"true"/.test(deployInit),
      "coolify-deploy-init.sh must push VERDACCIO_TOKEN as a buildtime env (4th arg \"true\")",
    ).toBe(true);
  });

  test("Coolify domain automation uses compose service names with dashes", () => {
    const deployInit = read("scripts/coolify-deploy-init.sh");
    const domainDoctor = read("scripts/coolify-domain-doctor.mjs");

    // n8n-auth carries the internal host + the public mcp/dirigent aliases
    // (oauth2 cookie zone fix, 2026-07-03 — see oauth2-proxy-config gate).
    expect(deployInit).toContain(
      '"n8n-auth=https://${N8N_DOMAIN}:4180,https://${MCP_DOMAIN:?MCP_DOMAIN required}:4180,https://${DIRIGENT_DOMAIN:?DIRIGENT_DOMAIN required}:4180"',
    );
    expect(deployInit).not.toContain("n8n_auth=https");
    expect(domainDoctor).toContain('name: "n8n-auth"');
  });

  test("edge/web build (Dockerfile.web + render-app-config) receives domain keys from domains.env via deploy-init", () => {
    const deployInit = read("scripts/coolify-deploy-init.sh");
    const dockerfileWeb = read("Dockerfile.web");
    const render = read("scripts/render-app-config.mjs");

    // The render step in the web SPA build (used by aisha-edge prebuilt and
    // web service in core deploys) derives operator URLs from build ARGs
    // (VITE_PUBLIC_SITE_URL etc. which come from APP_DOMAIN etc. pushed to the
    // edge app env) and falls back to loadDomains() from config/domains.env.
    // If the keys are blank at `docker compose build` time (Coolify build-time.env
    // + --build-arg), render does FATAL exit(1) and the whole image build fails
    // (exactly as seen in fresh cold-start logs on Giah/Talos).
    expect(dockerfileWeb).toContain("render-app-config");
    expect(dockerfileWeb).toContain("VITE_PUBLIC_SITE_URL");
    expect(dockerfileWeb).toContain("VITE_KC_URL");
    expect(dockerfileWeb).toContain("VITE_API_URL");
    expect(render).toContain("loadDomains");
    expect(render).toContain("config/domains.env");
    expect(render).toContain("FATAL: missing values for");

    // The FATAL must actually abort the image build: no `|| echo`-style swallow
    // after the render invocation (a 2026-06-09 hotfix added one and production
    // images silently shipped the invalid __VAR__ stub as the SPA fallback).
    const renderInvocation = dockerfileWeb
      .split("\n")
      .filter((l) => l.includes("render-app-config.mjs"))
      .filter((l) => !l.trim().startsWith("#"));
    expect(renderInvocation.length).toBeGreaterThanOrEqual(1);
    for (const line of renderInvocation) {
      expect(line, "render-app-config must hard-fail the build (no || swallow)").not.toMatch(/\|\|/);
    }

    // deploy-init must push the source domain keys for the edge stack so
    // Coolify can supply them as build args / in build-time.env.
    // We assert the explicit sets (or the domains section for edge).
    expect(deployInit).toContain('set_coolify_env "$local_uuid" "APP_DOMAIN"');
    expect(deployInit).toContain('set_coolify_env "$local_uuid" "API_DOMAIN"');
    expect(deployInit).toContain("Domains — edge (web + edge-proxy public hostnames)");
    // NETBIRD_STACK_KEY_FRONTEND is required for edge build (mesh-router etc.)
    // and was observed unset in the same failure.
    expect(deployInit).toContain("NETBIRD_STACK_KEY_FRONTEND");
  });

  test("Matrix bridges do not share the Synapse homeserver database", () => {
    const matrixCompose = read("docker-compose.coolify-matrix.yml");
    const homeserverConfig = read("coolify/synapse/homeserver.yaml");
    const bridgeFiles = [
      "coolify/synapse/bridges/mautrix-telegram.yaml",
      "coolify/synapse/bridges/mautrix-whatsapp.yaml",
      "coolify/synapse/bridges/mautrix-signal.yaml",
      "coolify/synapse/bridges/mautrix-discord.yaml",
      "coolify/synapse/bridges/mautrix-slack.yaml",
      "coolify/synapse/bridges/mautrix-meta.yaml",
      "coolify/synapse/bridges/postmoogle.yaml",
    ];

    expect(matrixCompose).toContain("synapse_bridge_telegram");
    expect(matrixCompose).toContain("synapse_bridge_email");
    expect(matrixCompose).toContain("CREATE SCHEMA IF NOT EXISTS synapse_hs AUTHORIZATION synapse_user");
    expect(matrixCompose).toContain("synapse:\n      condition: service_healthy");
    expect(matrixCompose).toMatch(/element-call:[\s\S]*?coolify\.managed=true/);
    // ⛔ 2026-08-19: tady stálo doslova `@aisha-db:` — jméno instance v bráně.
    // Vlastnost: DSN míří na ODVOZENÝ hostitel (${APP_NAME_PREFIX…}-db) a na
    // VLASTNÍ databázi mostu (synapse_bridge_email), ne na homeserver.
    expect(matrixCompose).toMatch(
      /POSTMOOGLE_DB_DSN: postgres:\/\/synapse_user:\$\{SYNAPSE_DB_PASSWORD\}@\$\{APP_NAME_PREFIX[^}]*\}-db:5432\/synapse_bridge_email\?sslmode=disable/,
    );
    expect(homeserverConfig).toContain('options: "-c search_path=synapse_hs"');

    for (const bridgeFile of bridgeFiles) {
      const bridgeConfig = read(bridgeFile);
      expect(bridgeConfig, `${bridgeFile} must use a synapse_bridge_* database`).toContain("/synapse_bridge_");
      // Nezávisle na prefixu hostitele: rozhoduje CÍLOVÁ databáze, ne jméno stroje.
      expect(bridgeConfig, `${bridgeFile} must not use the homeserver database`).not.toMatch(/-db:5432\/synapse\?sslmode=disable/);
    }
  });

  test("compose files consume the generated NetBird and web build envs", () => {
    const coreCompose = read("docker-compose.coolify.yml");
    const edgeCompose = read("docker-compose.coolify-prebuilt.yml");
    const execCompose = read("docker-compose.coolify-exec.yml");
    const integrationCompose = read("docker-compose.coolify-integration.yml");
    const ledgerCompose = read("docker-compose.coolify-cosmos.yml");

    expectAll(coreCompose, "docker-compose.coolify.yml", [
      "NETBIRD_STACK_KEY_FRONTEND",
      "host-gateway",
      "NB_MANAGEMENT_URL",
    ]);
    expect(coreCompose).not.toContain("./infra/netbird/agent-entrypoint.sh:/usr/local/bin/aisha-agent-entrypoint.sh:ro");
    expect(coreCompose).toContain("PENDING_BOOTSTRAP — awaiting netbird-bootstrap.sh + redeploy");
    // Coolify strips manual Traefik labels from compose containers.
    // Routing is driven by docker_compose_domains (coolify-domain-doctor.mjs).
    // We assert service names + compose structure, not manual Traefik labels.
    // Edge stack uses split architecture (mesh-router + edge-proxy):
    //   - mesh-router : NetBird agent + iptables DNAT (no public listener)
    //   - edge-proxy  : naked Caddy listener on coolify network
    // CORE_MESH_IP env points DNAT rules at the core peer's mesh IP.
    expectAll(edgeCompose, "docker-compose.coolify-prebuilt.yml", [
      "mesh-router",
      "edge-proxy",
      "CORE_MESH_IP",
      "host-gateway",
      "coolify-domain-doctor.mjs",
      viteBackendKey("URL"),
      viteBackendKey("ANON_KEY"),
      viteBackendKey("PUBLISHABLE_KEY"),
      "VITE_REQUIRE_AISHA_BACKEND_ENV",
      "VITE_KC_URL",
      "GIT_SHA",
    ]);
    expectAll(execCompose, "docker-compose.coolify-exec.yml", [
      "NETBIRD_API_URL",
      "NETBIRD_AUTH_SCHEME",
      "NETBIRD_KEYCLOAK_CLIENT_SECRET",
      "NETBIRD_SANDBOX_GROUP",
    ]);
    expectAll(integrationCompose, "docker-compose.coolify-integration.yml", [
      "NETBIRD_STACK_KEY_INTEGRATION",
      "RABBITMQ_DEFAULT_PASS",
    ]);
    expect(integrationCompose).not.toContain("./infra/netbird/agent-entrypoint.sh:/usr/local/bin/aisha-agent-entrypoint.sh:ro");
    expectAll(ledgerCompose, "docker-compose.coolify-cosmos.yml", [
      "NETBIRD_STACK_KEY_EXPERIMENTAL",
      "CHAIN_ID",
      "MONIKER",
    ]);
    expect(ledgerCompose).not.toContain("./infra/netbird/agent-entrypoint.sh:/usr/local/bin/aisha-agent-entrypoint.sh:ro");
  });

  test("runtime healthchecks match production image capabilities", () => {
    const coreCompose = read("docker-compose.coolify.yml");
    const postgrestDockerfile = read("Dockerfile.postgrest");
    const n8nCompose = read("docker-compose.coolify-n8n.yml");
    const matrixCompose = read("docker-compose.coolify-matrix.yml");
    const matrixRtcDockerfile = read("Dockerfile.matrix-rtc-auth");
    const netbirdCompose = read("docker-compose.coolify-netbird.yml");
    const netbirdDockerfile = read("Dockerfile.netbird-runtime");

    // FROM uses optional ${REGISTRY_PROXY} pull-through (per dockerfile-cache-prefix.gate.test.ts).
    // Iter 13 dropped the literal `cache.aisha.guru/` prefix in favour of operator-set REGISTRY_PROXY.
    expect(postgrestDockerfile).toContain("FROM ${REGISTRY_PROXY}postgrest/postgrest:v14.1");
    expect(postgrestDockerfile).toContain("FROM ${REGISTRY_PROXY}library/busybox:1.37.0-musl AS busybox");
    expect(postgrestDockerfile).toContain("COPY --from=busybox /bin/busybox /bin/busybox");
    expect(matrixRtcDockerfile).toContain("ARG MATRIX_RTC_AUTH_BASE_IMAGE=ghcr.io/element-hq/lk-jwt-service:0.2.1");
    expect(matrixRtcDockerfile).toContain("COPY --from=busybox /bin/busybox /bin/busybox");
    expect(netbirdDockerfile).toContain("ARG NETBIRD_BASE_IMAGE=netbirdio/management:0.70.0");
    expect(netbirdDockerfile).toContain("COPY --from=busybox /bin/busybox /bin/busybox");
    expect(coreCompose).toContain("PGRST_ADMIN_SERVER_PORT: 3001");
    expect(coreCompose).toContain("http://127.0.0.1:3001/ready");
    expect(coreCompose).not.toContain('["CMD", "/bin/postgrest", "--ready"]');
    expect(n8nCompose).toContain("http://127.0.0.1:5678/healthz");
    expect(n8nCompose).not.toContain("http://localhost:5678/healthz");
    expect(matrixCompose).toContain("Dockerfile.matrix-rtc-auth");
    expect(matrixCompose).toContain('["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "8080"]');
    const matrixRtcBlock = matrixCompose.match(/matrix-rtc-auth:[\s\S]*?# ===========================================================================/)?.[0] ?? "";
    expect(matrixRtcBlock).not.toContain("disable: true");
    expect(matrixRtcBlock).not.toContain("CMD-SHELL");
    expect(netbirdCompose).toContain("Dockerfile.netbird-runtime");
    expect(netbirdCompose).toContain('["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "10000"]');
    expect(netbirdCompose).toContain('["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "33080"]');
    const netbirdRuntimeBlock = netbirdCompose.match(/netbird-management:[\s\S]*?netbird-dashboard:/)?.[0] ?? "";
    const netbirdRelayBlock = netbirdCompose.match(/netbird-relay:[\s\S]*?volumes:/)?.[0] ?? "";
    if (netbirdRuntimeBlock.includes("DIAGNOSTIC WRAPPER")) {
      expect(netbirdRuntimeBlock).toContain("disable: true");
      expect(netbirdRuntimeBlock).not.toContain('["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "443"]');
    } else {
      expect(netbirdRuntimeBlock).toContain('["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "443"]');
    }
    expect(netbirdRuntimeBlock).not.toContain("CMD-SHELL");
    expect(netbirdRelayBlock).not.toContain("CMD-SHELL");
    expect(netbirdCompose).not.toContain("wget -q -O /dev/null http://localhost:443/api/peers");
  });

  test("optional Matrix bridges are profile-gated by generated env", () => {
    const coldStart = read("scripts/aisha-cold-start.sh");
    const deployInit = read("scripts/coolify-deploy-init.sh");
    const matrixCompose = read("docker-compose.coolify-matrix.yml");

    expect(coldStart).toContain("MATRIX_BRIDGE_PROFILES=${MATRIX_BRIDGE_PROFILES}");
    expect(deployInit).toContain('set_coolify_env "$local_uuid" "COMPOSE_PROFILES"');
    expect(deployInit).toContain('matrix_bridge_profiles="bridge-telegram"');
    for (const profile of [
      "bridge-telegram",
      "bridge-whatsapp",
      "bridge-signal",
      "bridge-discord",
      "bridge-slack",
      "bridge-meta",
      "bridge-email",
    ]) {
      expect(matrixCompose).toContain(`profiles: ["${profile}"]`);
    }
  });

  test("pgAdmin OAuth proxy does not initiate login for ACME probes", () => {
    // pgadmin-auth was extracted from the core compose to its own sibling stack
    // (2026-07-15) to keep core under the ARG_MAX gate.
    const pgadminCompose = read("docker-compose.coolify-pgadmin.yml");

    const skipAuthRoutes = pgadminCompose.match(/OAUTH2_PROXY_SKIP_AUTH_ROUTES:\s*"([^"]+)"/)?.[1] ?? "";
    expect(skipAuthRoutes).toContain("^/ping$");
    expect(skipAuthRoutes).toContain("^/\\\\.well-known/.*");
  });

  test("Coolify sync normalizes buildtime env metadata after value upsert", () => {
    const buildtimeLib = read("scripts/lib/coolify-buildtime-envs.sh");
    const syncEnvs = read("scripts/coolify-sync-envs.sh");
    const deployInit = read("scripts/coolify-deploy-init.sh");

    // Jména polí, která ta funkce v Coolify přepíná — to je API, ne obsah regexu.
    expectAll(buildtimeLib, "scripts/lib/coolify-buildtime-envs.sh", ["is_buildtime", "is_preview"]);
    expect(syncEnvs).toContain("coolify_normalize_buildtime_envs");
    expect(syncEnvs).toContain("APP_SENT\" -eq 0");
    expect(syncEnvs).toContain("bulk_response_ok");
    expect(syncEnvs).toContain("PREVIEW_RESP");
    expect(deployInit).toContain("coolify_normalize_buildtime_envs");

    // ⛔ ZDE SE DŘÍV HLEDAL SUBSTRING V CELÉM SOUBORU — a měřilo to jinou věc,
    // než na jakou se ptá. Ten soubor je z větší části kronika incidentů, kde
    // se jméno tajemství legitimně objeví jako DOKLAD, proč do buildu nepatří.
    // Naměřeno 2026-08-16: oprava, která `POSTGRES_PASSWORD` z build-time
    // množiny odstranila, tuhle bránu SHODILA — protože o tom napsala poznámku.
    // Brána tak trestala právě to, co má chránit.
    //
    // Vlastnost, o kterou jde, je „tenhle klíč se nedostane do buildu", a ta má
    // dva zdroje: ruční seznam (regex) a odvození z compose. Ptáme se obou.
    //
    // ⛔ DODĚLÁNO 2026-08-18: horní `expectAll` měl TUTÉŽ vadu a přežil ji o dva
    // dny. Hledal doslovné `SENTRY_(AUTH_TOKEN|URL|ORG|PROJECT)` ve zdrojáku,
    // takže shodil opravu, která `SENTRY_AUTH_TOKEN` z build-time množiny
    // odstranila — a odstranit ho bylo správně: `Dockerfile.web:180` ho čte přes
    // `--mount=type=secret` a build-time příznak tu ochranu rušil. Brána znovu
    // trestala právě to, co má chránit. Otázka „je ten klíč build-time?" se ptá
    // REGEXU, ne textu souboru.
    const regexSrc = spawnSync(
      "bash",
      ["-c", `. "${join(ROOT, "scripts/lib/coolify-buildtime-envs.sh")}"; coolify_buildtime_key_regex`],
      { cwd: ROOT, encoding: "utf8", timeout: 30_000 },
    );
    if (regexSrc.error || regexSrc.signal || regexSrc.status === null) {
      throw new Error(`coolify_buildtime_key_regex nedoběhl: status=${regexSrc.status}`);
    }
    const buildtimeRegex = new RegExp((regexSrc.stdout ?? "").trim());

    // Co build-time BÝT MUSÍ: web build tyhle hodnoty čte při `docker compose
    // build`, ne za běhu. Zároveň je to kotva proti „opravě" vyprázdněním —
    // kdyby regex zmizel, negativní tvrzení níž by zezelenala bez zásluh.
    for (const klic of ["VITE_AISHA_BACKEND_URL", "PUBLIC_SITE_URL", "GIT_SHA", "SENTRY_ORG", "SENTRY_URL"]) {
      expect(buildtimeRegex.test(klic), `${klic} musí zůstat build-time — web build ho čte při buildu`).toBe(true);
    }

    // Co build-time BÝT NESMÍ. SENTRY_AUTH_TOKEN je tu od 2026-08-18: chodí
    // přes `--mount=type=secret`, takže build-time příznak by tu ochranu zrušil
    // (Coolify by tutéž hodnotu poslal navíc jako `--build-arg`). Odvozeně to
    // hlídá secret-nesmi-cestovat-i-jako-build-arg; tady stojí jmenovitě, aby
    // se ta konkrétní regrese nedala udělat potichu.
    for (const secret of ["SERVICE_ROLE_KEY", "POSTGRES_PASSWORD", "SENTRY_AUTH_TOKEN"]) {
      expect(
        buildtimeRegex.test(secret),
        `${secret} je v ručním seznamu build-time klíčů — Coolify by ho poslal jako ` +
          "`--build-arg` a zapekl do `docker history`",
      ).toBe(false);
    }
  });

  test("Coolify per-app env extraction separates sync vars from required vars", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "aisha-compose-vars-"));
    try {
      const fixturePath = join(tempDir, "compose.yml");
      writeFileSync(
        fixturePath,
        `services:
  app:
    image: \${IMAGE_APP:-cache.aisha.guru/app:1}
    command: |
      LOCAL=$\${LOCAL_VAR}
      # BACKSLASH=\\\${IN_BLOCK_COMMENT}
      BACKSLASH=\\\${BACKSLASH_IS_NOT_ESCAPE}
      echo "$\${RUNTIME_ONLY}"
    environment:
      REQUIRED_BARE: \${REQUIRED_BARE}
      REQUIRED_ERROR: \${REQUIRED_ERROR:?required}
      REQUIRED_ERROR_NO_COLON: \${REQUIRED_ERROR_NO_COLON?required}
      OPTIONAL_EMPTY: \${OPTIONAL_EMPTY:-}
      OPTIONAL_DEFAULT: \${OPTIONAL_DEFAULT-default}
      SERVICE_FQDN_SKIP: \${SERVICE_FQDN_APP}
`,
      );

      const result = spawnSync(
        "bash",
        [
          "-lc",
          `source scripts/lib/coolify-app-vars.sh
echo '[all]'
extract_compose_vars "${fixturePath}"
echo '[required]'
extract_required_compose_vars "${fixturePath}"`,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);

      const allStart = result.stdout.indexOf("[all]\n");
      const requiredStart = result.stdout.indexOf("[required]\n");
      expect(allStart).toBeGreaterThanOrEqual(0);
      expect(requiredStart).toBeGreaterThan(allStart);

      const allVars = result.stdout
        .slice(allStart + "[all]\n".length, requiredStart)
        .trim()
        .split("\n")
        .filter(Boolean);
      const requiredVars = result.stdout
        .slice(requiredStart + "[required]\n".length)
        .trim()
        .split("\n")
        .filter(Boolean);

      // ⛔ Dvě jména tu dřív CHYBĚLA a fixtura to vydávala za správné chování:
      //   · `\${X}` — compose zpětné lomítko jako escape NEZNÁ a proměnnou
      //     interpoluje (`docker compose config`: "BACKSLASH_IS_NOT_ESCAPE
      //     variable is not set"). Escape je jen `$$`.
      //   · řádek začínající `#` UVNITŘ block-scalaru je hodnota, ne komentář;
      //     textový extraktor ho zahazoval — takhle se na prebuilt stacku
      //     nedoručovaly API_DOMAIN, INTERNAL_TLD a KEYCLOAK_DOMAIN.
      // Extrakce teď jde přes YAML parser (scripts/lib/compose-env-refs.mjs).
      expect(allVars).toEqual([
        "BACKSLASH_IS_NOT_ESCAPE",
        "IMAGE_APP",
        "IN_BLOCK_COMMENT",
        "OPTIONAL_DEFAULT",
        "OPTIONAL_EMPTY",
        "REQUIRED_BARE",
        "REQUIRED_ERROR",
        "REQUIRED_ERROR_NO_COLON",
      ]);
      expect(requiredVars).toEqual([
        "BACKSLASH_IS_NOT_ESCAPE",
        "IN_BLOCK_COMMENT",
        "REQUIRED_BARE",
        "REQUIRED_ERROR",
        "REQUIRED_ERROR_NO_COLON",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("buildtime envs reader retries on transient timeout + soft-fails (large stacks like aisha-core)", () => {
    // aisha-core has 70+ env vars and the GET response is ~85KB. Under
    // Coolify load this can exceed the curl timeout. A failure here
    // must NOT abort cold-start because env VALUES are already in place
    // (synced via prior bulk PATCH); only metadata-refresh is delayed.
    const buildtimeLib = read("scripts/lib/coolify-buildtime-envs.sh");

    // Retry loop present
    expect(
      buildtimeLib,
      "buildtime envs read MUST retry on timeout — without retry, single curl-28 aborts entire cold-start sync.",
    ).toMatch(/for\s+read_attempt\s+in\s+1\s+2\s+3/);

    // Generous timeout for large stacks (≥60s; default 30s caused failures)
    expect(
      buildtimeLib,
      "Read timeout must be ≥60s for large stacks (aisha-core 85KB response).",
    ).toMatch(/curl[^\n]+--max-time\s+(60|90|120|180)\b/);

    // Soft-fail on persistent transient timeouts (return 0 not 1)
    expect(
      buildtimeLib,
      "After exhausting retries, function MUST return 0 (soft-fail) to keep cold-start moving — env values already synced via bulk PATCH; metadata refresh is non-fatal meta.",
    ).toMatch(/avoids aborting cold-start[\s\S]+?return 0/);
  });

  test("render-app-config (called from Dockerfile.web build) hard-fails on missing domain keys from config/domains.env or env", () => {
    // This directly guards the failure mode from the logs: when domain vars
    // (APP_DOMAIN, API_DOMAIN_PUBLIC, KEYCLOAK_DOMAIN etc. from the separate
    // config/domains.env + coolify deploy push) are blank at edge/web build time,
    // the render step (after i18n:check) does FATAL + exit(1) and aborts the
    // Coolify docker compose build for the stack.
    const tempDir = mkdtempSync(join(tmpdir(), "aisha-render-app-config-"));
    try {
      // Provide a domains.env (the script falls back to it when process.env lacks).
      const goodDomainsDir = join(tempDir, "config");
      mkdirSync(goodDomainsDir, { recursive: true });
      writeFileSync(
        join(goodDomainsDir, "domains.env"),
        "API_DOMAIN_PUBLIC=api.example.com\nAPP_DOMAIN=web.example.com\nKEYCLOAK_DOMAIN=auth.example.com\nPUBLIC_TLD=example.com\nINTERNAL_TLD=example.internal\n",
      );

      // Run the real render (it always loads the committed template from the
      // script's location). Provide no (or insufficient) VITE_* / domain env
      // so derivations + fallback leave some ${} empty → FATAL.
      const resultMissing = spawnSync(
        "node",
        [join(ROOT, "scripts/render-app-config.mjs")],
        {
          cwd: tempDir,
          encoding: "utf8",
          env: {
            ...process.env,
            APP_NAME_PREFIX: "aisha", // fixture must declare its instance — the generator no longer guesses one
            HOME: tempDir,
            VITE_PUBLIC_SITE_URL: "",
            VITE_API_URL: "",
            VITE_KC_URL: "",
          },
        },
      );
      expect(resultMissing.status).not.toBe(0);
      const outMissing = (resultMissing.stdout || "") + (resultMissing.stderr || "");
      expect(outMissing).toContain("FATAL: missing values for");
      expect(outMissing).toContain("set them in env or config/domains.env");

      // Success path: extract every ${VAR} from the *real* template and provide
      // dummy-but-non-empty values for all of them (plus the build-critical VITE_*
      // that Dockerfile.web + deploy-init are responsible for). This proves that
      // when the domain keys from the separate config file are properly pushed
      // to the edge app (so Coolify supplies them at build), render succeeds.
      const realTplPath = join(ROOT, "public", ".well-known", "app-config.template.json");
      const realTpl = readFileSync(realTplPath, "utf8");
      const needed = new Set<string>();
      for (const m of realTpl.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) needed.add(m[1]);

      const goodEnv: Record<string, string> = { ...process.env, HOME: tempDir };
      for (const k of needed) {
        goodEnv[k] = goodEnv[k] || `dummy-${k.toLowerCase()}`;
      }
      // Ensure the ones the web build specifically derives/passes as ARGs.
      goodEnv.VITE_PUBLIC_SITE_URL = goodEnv.VITE_PUBLIC_SITE_URL || "https://web.example.com";
      goodEnv.VITE_API_URL = goodEnv.VITE_API_URL || "https://api.example.com";
      goodEnv.VITE_KC_URL = goodEnv.VITE_KC_URL || "https://auth.example.com";
      goodEnv.VITE_AISHA_BACKEND_ANON_KEY = goodEnv.VITE_AISHA_BACKEND_ANON_KEY || "anon-for-test";
      // CRITICAL: redirect the output into the temp dir. The script resolves its
      // default output from its OWN location (repo root), NOT cwd — without this
      // override every gates run overwrote the repo's tracked app-config.json
      // stub with dummy values (which then got committed on 2026-06-09).
      const outPath = join(tempDir, "app-config.rendered.json");
      goodEnv.APP_CONFIG_OUT = outPath;

      const resultGood = spawnSync(
        "node",
        [join(ROOT, "scripts/render-app-config.mjs")],
        { cwd: tempDir, encoding: "utf8", env: goodEnv },
      );
      expect(resultGood.status, (resultGood.stderr || "") + (resultGood.stdout || "")).toBe(0);
      expect((resultGood.stdout || "") + (resultGood.stderr || "")).toContain("wrote");
      // The render must land where directed — and nowhere else.
      expect(existsSync(outPath)).toBe(true);
      const renderedOut = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      expect(renderedOut.aisha_url).toBeTruthy();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
