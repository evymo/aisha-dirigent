/**
 * PKI-Bridge Cross-Server Routing — Integral Design Gate
 *
 * Enforces that ${PKI_BRIDGE_DOMAIN} routing is declared declaratively
 * in docker-compose.coolify-pki.yml via explicit Traefik labels.
 *
 * Background — the cross-server reachability problem (2026-05-10):
 *   pki-init runs in the aisha-netbird stack on Frontend and needs to call
 *   pki-bridge for cert issuance during cold-start. pki-bridge runs in
 *   the aisha-pki stack on Backend. Docker DNS only resolves within the
 *   same server's bridge network — `http://aisha-pki-bridge:3040` from
 *   Frontend times out (Connection timed out after 60s).
 *
 *   The mesh isn't an option here either: NetBird mesh requires
 *   netbird-management to be healthy, which requires the cert from
 *   pki-bridge — circular dependency on first boot.
 *
 *   Integral fix: expose pki-bridge via Backend's Coolify Traefik with a
 *   public hostname (`${PKI_BRIDGE_DOMAIN}`). JWT auth on `/v1/issue`
 *   gates access (only valid aisha-pki-bootstrap ROPC tokens accepted),
 *   so public exposure is safe.
 *
 * Two-plane routing (both dynamic from the env contract, no hardcoded hosts):
 *   PLANE 1 — local dev: compose Traefik labels with `${PKI_BRIDGE_DOMAIN}`
 *     (`docker compose up` substitutes them).
 *   PLANE 2 — Coolify production: deploy-init set_coolify_domains +
 *     coolify-domain-doctor.mjs register pki-bridge via docker_compose_domains.
 *     Required because Coolify escapes every `$` → `$$` in label VALUES at
 *     deploy time, so the compose `${PKI_BRIDGE_DOMAIN}` label never matches
 *     on Coolify. See feedback_coolify_label_dollar_escape.md.
 *
 * The contract enforced here:
 *   1) pki-bridge service has `coolify` network attached (Coolify-managed
 *      Traefik can only route to containers on its own network)
 *   2) `traefik.enable=true` on pki-bridge
 *   3) `traefik.docker.network=coolify` (multi-network disambiguation)
 *   4) Service port 3040 declared
 *   5) HTTPS router with `${PKI_BRIDGE_DOMAIN}` hostname from env/topology
 *   6) tls=true + certresolver=letsencrypt for cert auto-issue
 *   7) HTTP→HTTPS redirect router pointing at the same host
 *   8) deploy-init + domain-doctor register pki-bridge via docker_compose_domains
 *      using the dynamic `${PKI_BRIDGE_DOMAIN}` (PLANE 2)
 *   9) cold-start.sh writes PKI_BRIDGE_DOMAIN and PKI_BRIDGE_URL from the
 *      production env foundation / derived topology
 *  10) PKI_BRIDGE_URL in netbird compose env block matches
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const PKI_COMPOSE = join(ROOT, "docker-compose.coolify-pki.yml");
const NETBIRD_COMPOSE = join(ROOT, "docker-compose.coolify-netbird.yml");
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");
const ISSUE_CERT = join(ROOT, "infra/pki/issue-netbird-mesh-cert.sh");
const REDEPLOY = join(ROOT, "scripts/aisha-redeploy.mjs");

describe("pki-bridge Cross-Server Routing — Integral Design", () => {
  test("pki-bridge service is on `coolify` network (Traefik can only route on its own network)", () => {
    const compose = readFileSync(PKI_COMPOSE, "utf-8");
    const blockMatch = compose.match(/^\s+pki-bridge:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m);
    expect(blockMatch, "pki-bridge block must be parseable").toBeTruthy();
    if (!blockMatch) return;

    const block = blockMatch[0];

    // Compose accepts BOTH network syntaxes and they mean the same thing:
    //   networks: [- name]        (sequence)
    //   networks: { name: {...} } (mapping — the ONLY form that can carry `aliases`)
    // Asserting the sequence spelling made this gate reject a service that IS attached,
    // merely because it also needed an alias. Assert the PROPERTY (attachment), not the
    // spelling: pull the networks block and look for the name as a list item or a key.
    const attachedNetworks = (() => {
      const lines = block.split("\n");
      const start = lines.findIndex((l) => /^\s+networks:\s*$/.test(l));
      if (start < 0) return [] as string[];
      const baseIndent = lines[start].search(/\S/);
      const names: string[] = [];
      for (const line of lines.slice(start + 1)) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const indent = line.search(/\S/);
        if (indent <= baseIndent) break;                 // block ended
        if (indent !== baseIndent + 2) continue;          // deeper = aliases/driver/etc.
        // `sit: {}` je třetí platný zápis — a od 2026-08-13 POVINNÝ pro položky
        // bez těla: holé `sit:` (null) Coolify při nasazení zahodí (brána
        // compose-sit-neni-null). Parser, který `{}` nečte, by tuhle bránu
        // shodil přesně na správném zápisu.
        const m = line.trim().match(/^(?:-\s*)?([a-z][\w.-]*):?(?:\s*\{\s*\})?$/);
        if (m) names.push(m[1]);
      }
      return names;
    })();

    // Networks: must include `coolify` (the network Coolify's Traefik watches)
    expect(
      attachedNetworks,
      "pki-bridge MUST attach to the `coolify` network — Coolify-managed Traefik can only resolve containers on its own bridge.",
    ).toContain("coolify");

    // Networks: still on `internal` for stack-internal traffic (pki-renewer, etc.)
    expect(
      attachedNetworks,
      "pki-bridge MUST also stay on `internal` so pki-renewer + pki-webui can reach it without going through Traefik.",
    ).toContain("internal");
  });

  test("PKI compose top-level networks block defines BOTH `internal` and `coolify` aliases", () => {
    // Footgun discovered 2026-05-10: Docker Compose silently DROPS network
    // references in services if those networks aren't declared at the
    // top-level `networks:` key. The deploy succeeds, the container reports
    // healthy — but it's only attached to networks that ARE defined.
    // Combined with `traefik.docker.network=coolify` label, Traefik then
    // looks for the container on a network it isn't on, and returns 404.
    //
    // Mirror of langfuse/admin/keycloak compose pattern: both `internal:`
    // and `coolify:` aliased to the same external `coolify` Docker network.
    const compose = readFileSync(PKI_COMPOSE, "utf-8");

    // Networks block must exist
    const networksBlock = compose.match(/^networks:[\s\S]+$/m);
    expect(networksBlock, "PKI compose must declare a top-level `networks:` block").toBeTruthy();
    if (!networksBlock) return;

    // ZMĚNĚNO 2026-08-10: `internal` už NENÍ alias globální `coolify`. Bylo jím
    // ve 28 compose a znamenalo to, že „interní" provoz jde po sdílené síti
    // celého hostitele — právě proto se `pki-db` trefovalo do databáze cizího
    // nájemníka a PKI nikdy nenabootovalo. Viz compose-external-network-exists.
    // Chráněná vlastnost té původní brány ale platí dál a je OBECNĚJŠÍ: compose
    // TIŠE ZAHODÍ odkaz na síť, kterou nahoře nikdo nedeklaroval. Kontejner pak
    // běží, hlásí healthy, a Traefik ho nenajde. Testuje se tedy ta vlastnost,
    // ne konkrétní jméno.
    expect(
      networksBlock[0],
      "PKI compose top-level `networks:` MUSÍ definovat `internal:` jako INSTANČNÍ síť, ne globální coolify. " +
        "Je EXTERNAL: zakládá ji warmup na hostiteli, protože vlastník sítě ji při teardownu maže " +
        "a shodí nasazení, když na ní visí kontejner jiného projektu.",
    ).toMatch(/^\s+internal:[\s\S]{0,600}?name:\s*\$\{APP_NAME_PREFIX[^}]*\}-shared-net/m);

    expect(
      networksBlock[0],
      "PKI compose top-level `networks:` MUSÍ definovat i `coolify:` — pki-bridge a pki-auth mají veřejnou doménu a bez deklarace by je compose ze sítě tiše vynechal.",
    ).toMatch(/^\s+coolify:\s*\n\s+external:\s*true\s*\n\s+name:\s*coolify/m);

    // Obecně: KAŽDÁ síť, na kterou se některá služba odkazuje, musí být nahoře
    // deklarovaná. Tohle je ta původní vada z 2026-05-10, vyjádřená jako pravidlo.
    const doc = parseYaml(compose) as {
      services?: Record<string, { networks?: string[] | Record<string, unknown> } | undefined>;
      networks?: Record<string, unknown>;
    };
    const deklarované = new Set(Object.keys(doc?.networks ?? {}));
    const chybějící: string[] = [];
    for (const [svc, def] of Object.entries(doc?.services ?? {})) {
      const n = def?.networks;
      const keys = Array.isArray(n) ? n.map(String) : n && typeof n === "object" ? Object.keys(n) : [];
      for (const k of keys) if (!deklarované.has(k)) chybějící.push(`${svc} → "${k}"`);
    }
    expect(
      chybějící,
      "Služba se odkazuje na síť, kterou horní blok `networks:` nedeklaruje — compose ten odkaz TIŠE ZAHODÍ (kontejner běží, Traefik vrací 404).",
    ).toEqual([]);
  });

  test("pki-bridge exposes its port and delegates routers to Coolify", () => {
    const compose = readFileSync(PKI_COMPOSE, "utf-8");
    const blockMatch = compose.match(/^\s+pki-bridge:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m);
    expect(blockMatch).toBeTruthy();
    if (!blockMatch) return;
    const block = blockMatch[0];

    // Coolify attaches its UUID-scoped router from docker_compose_domains.
    expect(
      block,
      "pki-bridge MUST remain eligible for the Coolify-generated router.",
    ).toContain('"traefik.enable=true"');

    // 2) Multi-network disambiguation (pki-bridge is on both `internal` and `coolify`)
    expect(
      block,
      "pki-bridge MUST set `traefik.docker.network=coolify` so Traefik knows which interface to use when the container has multiple networks.",
    ).toContain('"traefik.docker.network=coolify"');

    // Service port discovery (pki-bridge listens on 3040 internally).
    expect(
      block,
      "pki-bridge must expose 3040 so Coolify discovers the target port.",
    ).toMatch(/expose:\s*\n\s*- "3040"/);
    expect(block).not.toContain("traefik.http.routers.");
    expect(block).not.toContain("traefik.http.services.");
  });

  test("PLANE 2: deploy-init + domain-doctor register pki-bridge via docker_compose_domains (dynamic)", () => {
    const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
    const DOMAIN_DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");
    const init = readFileSync(DEPLOY_INIT, "utf-8");
    const doctor = readFileSync(DOMAIN_DOCTOR, "utf-8");

    // deploy-init pki case must register pki-bridge with the dynamic domain +
    // the real compose service name (`pki-bridge`, not svc-pki-bridge).
    const pkiCase = init.match(/\n {4}pki\)\s*\n([\s\S]*?)\n\s*;;/);
    expect(pkiCase, "Could not find `pki)` case in deploy-init switch.").toBeTruthy();
    if (pkiCase) {
      expect(
        pkiCase[1],
        "deploy-init pki case MUST register the dynamic pki-bridge=https://${PKI_BRIDGE_DOMAIN}:3040 (Coolify $-escapes compose labels).",
      ).toMatch(/pki-bridge=https:\/\/\$\{PKI_BRIDGE_DOMAIN\}:3040/);
    }

    // domain-doctor must carry the matching dynamic pki-bridge entry.
    expect(
      doctor,
      "domain-doctor aisha-pki MUST register pki-bridge → https://${PKI_BRIDGE_DOMAIN}:3040 (dynamic), matching deploy-init.",
    ).toMatch(/name:\s*"pki-bridge",\s*domain:\s*`https:\/\/\$\{env\.PKI_BRIDGE_DOMAIN\}:3040`/);
  });

  test("scripts/aisha-cold-start.sh declares PKI_BRIDGE_URL (operator-set, no in-script default per template-only directive)", () => {
    const sh = readFileSync(COLD_START, "utf-8");
    // Cold-start propagates PKI_BRIDGE_URL through the HEREDOC into aisha-netbird's
    // Coolify env. Per iter 10 cleanup (template-only repo), no in-script default
    // — operator provides the public cross-server URL via .env-prod-backup or
    // env-doctor, as an operator supplied PKI_BRIDGE_URL. Cross-server routing
    // requirement (pki-init on edge server, pki-bridge on backend server) still
    // applies; the operator sets the URL accordingly.
    expect(sh, "cold-start MUST reference PKI_BRIDGE_URL bare (no fallback) so empty env propagates failure.").toMatch(
      /PKI_BRIDGE_URL=\$\{PKI_BRIDGE_URL\}/,
    );

    // Belt-and-braces: must NOT contain any Docker-DNS Docker-network default
    // (which would mask the operator-set requirement and silently break
    // cross-server routing during cold-start).
    expect(
      sh,
      "cold-start MUST NOT default PKI_BRIDGE_URL to http://aisha-pki-bridge:3040 — that's a Docker DNS name unreachable from a separate-server pki-init.",
    ).not.toMatch(/PKI_BRIDGE_URL=\$\{PKI_BRIDGE_URL:-http:\/\/aisha-pki-bridge:3040\}/);
  });

  test("infra/pki/issue-netbird-mesh-cert.sh declares PKI_BRIDGE_URL (operator-set, no in-script default)", () => {
    const sh = readFileSync(ISSUE_CERT, "utf-8");
    // Per iter 10 cleanup, the issue script consumes PKI_BRIDGE_URL from env
    // without a hardcoded fallback. Operator sets the cross-server public URL
    // via Coolify env on the aisha-netbird app — env-doctor propagates from
    // .env-prod-backup.
    expect(
      sh,
      "issue-netbird-mesh-cert.sh MUST reference PKI_BRIDGE_URL — operator sets the cross-server public URL via env.",
    ).toMatch(/PKI_BRIDGE_URL/);
    expect(
      sh,
      "issue-netbird-mesh-cert.sh MUST NOT bake a deployment-specific default (template-only directive).",
    ).not.toMatch(/PKI_BRIDGE_URL="\$\{PKI_BRIDGE_URL:-https?:\/\/[a-z][^"]*\.(?:id3a\.cz|aisha\.guru)[^"]*"\}/);
  });

  test("netbird compose pki-init declares PKI_BRIDGE_URL bare (operator-set, no in-compose default)", () => {
    const compose = readFileSync(NETBIRD_COMPOSE, "utf-8");
    // Compose references PKI_BRIDGE_URL bare; Coolify env (populated by
    // env-doctor + .env-prod-backup) supplies the actual URL. Iter 10 removed
    // the in-compose deployment default.
    expect(
      compose,
      "netbird compose pki-init MUST reference PKI_BRIDGE_URL — empty env propagates as empty so cert acquisition fails fast.",
    ).toMatch(/PKI_BRIDGE_URL:\s*\$\{PKI_BRIDGE_URL\}/);
  });

  test("redeploy gates NetBird wave on aisha-pki container health (operator is off-mesh — NO HTTP route probe)", () => {
    const js = readFileSync(REDEPLOY, "utf-8");
    // Design change (unified issuer + mesh cutover): the operator running
    // cold-start is NOT a mesh peer. Post cutover the bridge lives at
    // pki-bridge.mesh.<MESH_TLD>, resolvable ONLY from inside the NetBird mesh —
    // so an HTTP /health probe from the operator can NEVER pass (it aborted
    // wave 4 with "fetch failed"). Wave 4 now gates pki-bridge readiness via the
    // aisha-pki app's Coolify CONTAINER health: reachable through the Coolify API
    // the operator already uses, faithful (aisha-pki reports healthy only when
    // pki-bridge's own :3040/health check passes), and keeps PKI internal-only.
    expect(
      js,
      "wave 4 MUST gate pki-bridge readiness via the aisha-pki app's Coolify container status (operator is off-mesh; an HTTP probe to pki-bridge.mesh.<tld> can never resolve).",
    ).toMatch(/\{\s*app:\s*"aisha-pki",\s*hard:\s*false\s*\}/);
    // Must NOT reintroduce an HTTP-route probe to the bridge — that URL is
    // mesh-internal and unreachable from the off-mesh operator.
    expect(
      js,
      "redeploy MUST NOT probe pki-bridge over HTTP (PKI_BRIDGE_HEALTH_URL) — mesh-internal host is operator-unreachable and aborts cold-start.",
    ).not.toContain("PKI_BRIDGE_HEALTH_URL");
    expect(
      js,
      "a gate abort must make aisha-redeploy exit non-zero; otherwise cold-start continues into NetBird and reports false success.",
    // ⛔ 2026-08-24: tohle připínalo TEXTOVÝ TVAR ternárního výrazu
    // (`gate_aborted.length > 0 … ? 1`). Ten výraz se rozpadl, když návratový
    // kód dostal třetí hodnotu (3 = nezdravé jsou jen měkké appky nebo běžící
    // stacky v bootstrap okně před vznikem meshe). VLASTNOST se nezměnila,
    // změnil se zápis — a brána spadla na refaktoru, ne na vadě.
    //
    // Tvrdí se proto to, o co jde: `gate_aborted` MUSÍ vstupovat do rozhodnutí
    // o tvrdém selhání, a tvrdé selhání MUSÍ končit jedničkou.
    ).toMatch(/gate_aborted\.length\s*>\s*0/);
    expect(
      js,
      "gate_aborted musí vstupovat do rozhodnutí o TVRDÉM selhání (ne jen být zmíněn).",
    ).toMatch(/tvrdyProblem\s*=[\s\S]*?gate_aborted\.length\s*>\s*0/);
    expect(
      js,
      "tvrdé selhání musí končit nenulovým kódem — jinak cold-start pokračuje do NetBirdu a hlásí falešný úspěch.",
    ).toMatch(/if\s*\(tvrdyProblem\)\s*process\.exit\(1\)/);
  });

  test("no wave gate probes an HTTP url or a mesh host — operator gates must be Coolify app-status", () => {
    // Anti-regression lock for the wave-4 off-mesh footgun: the operator runs
    // cold-start OFF the NetBird mesh, so ANY `url:` gate risks targeting a
    // *.mesh.<MESH_TLD> or bare-Docker host it cannot resolve (that "fetch failed"
    // aborted the whole cold-start). Every wave gate MUST be a Coolify
    // container-status gate ({ app: "…" }), never an HTTP probe.
    const js = readFileSync(REDEPLOY, "utf-8");
    const wavesMatch = js.match(/const WAVES = \[([\s\S]*?)\n\];/);
    expect(wavesMatch, "WAVES array must be parseable").toBeTruthy();
    // Strip // comment lines — the surrounding comments legitimately DOCUMENT the
    // mesh-URL footgun; we only assert on actual gate CODE.
    const wavesCode = (wavesMatch ? wavesMatch[1] : "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(
      wavesCode.includes("url:"),
      "A wave gate uses an HTTP `url:` probe — the operator is off-mesh; gate on { app } Coolify container status instead.",
    ).toBe(false);
    expect(
      /mesh\./.test(wavesCode),
      "WAVES gate code references a `.mesh.` host — mesh-internal names are unreachable from the off-mesh operator.",
    ).toBe(false);
  });

  test("netbird dashboard declares AUTH_SUPPORTED_SCOPES (required by netbirdio/dashboard:v2.37.1+)", () => {
    const compose = readFileSync(NETBIRD_COMPOSE, "utf-8");
    // Dashboard image checks this env at startup; container exits with
    // "AUTH_SUPPORTED_SCOPES environment variable must be set" otherwise.
    // Reasonable default for OIDC: "openid profile email offline_access api"
    expect(
      compose,
      "netbird-dashboard MUST set AUTH_SUPPORTED_SCOPES — image v2.37.1+ refuses to start without it.",
    ).toMatch(/AUTH_SUPPORTED_SCOPES:\s*"openid\s+profile\s+email\s+offline_access\s+api"/);
  });
});
