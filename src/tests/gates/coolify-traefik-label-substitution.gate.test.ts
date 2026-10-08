/**
 * Coolify Traefik Label Substitution Gate
 *
 * OWNS: the FORM of Traefik label values.
 * Coverage/topology is owned by traefik-host-coverage.gate.test.ts — neither
 * gate may assume the other covers a case (that assumption is exactly how 56
 * dead labels survived; see "THE GAP" below).
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A Traefik label must never contain a hostname — not `${VAR}`, not a literal.
 * Public routing is declared ONLY in Coolify `docker_compose_domains`
 * (scripts/coolify-domain-doctor.mjs). Host-less routers are banned too: on a
 * shared ingress they match every tenant.
 *
 * ⛔ BEZ VÝJIMEK. Do 2026-08-18 tu stálo „the sole custom service label is the
 * APP_NAME_PREFIX-scoped NetBird proxy h2c transport" — jediná povolená výjimka.
 * Stála celodenní výpadek mesh: u JMÉNA SLUŽBY není nedosazený ${VAR} mrtvý jako
 * u Host(), ale SDÍLENÝ — cizí nájemník má týž literál a Traefik obě instance
 * sloučí do jedné služby. Pravidlo proto platí i na jména, nejen na hodnoty.
 *
 * ── WHY: THE ESCAPE HITS LABEL VALUES ONLY ────────────────────────────────
 * Coolify rewrites `$` → `$$` when rendering a container's label VALUES, and
 * only there. Docker then reads `$$` as an escaped literal `$`, so the variable
 * never expands and Traefik searches for a host literally named "${VAR}".
 * It matches nothing, forever, with NO error and NO log line.
 *
 * Every other YAML site is untouched. Measured across this repo (2026-07-18):
 *     environment:      751 ${VAR} → expands  OK
 *     command/health:   181 ${VAR} → expands  OK
 *     networks:           4 ${VAR} → expands  OK
 *     labels:            56 ${VAR} → ESCAPED  DEAD
 * 1036 uses; 980 work; 56 die. IDENTICAL SYNTAX.
 *
 * THAT ASYMMETRY IS THE TRAP: a contributor learns "we write ${VAR}" from 980
 * working examples and applies it in a label. Trust the SITE, not the pattern.
 *
 * Proven with `docker compose config`:
 *     jeden.dolar: Host(`auth.example.com`)   ← ${DOM} interpolated
 *     dva.dolary:  Host(`$${DOM}`)            ← $${DOM} stayed literal
 * And live on the keycloak container: `KC_HOSTNAME=auth.<PUBLIC_TLD>` expanded
 * under `environment:` sitting beside
 * `keycloak-https.rule=Host(`${KEYCLOAK_DOMAIN_PUBLIC}`)` unexpanded under
 * `labels:` — same variable, same file, opposite fate.
 *
 * ── NOT A FIX: the literal hostname ───────────────────────────────────────
 * `Host(`auth.example.com`)` does match — and bakes a deployment into the
 * platform contract (template-only directive; the public TLD is a DEFAULT, not
 * a constant). Worse, it would ACTIVATE routers carrying `priority=99999` under
 * bare, un-namespaced router/service names on a Traefik shared across forks,
 * out-ranking Coolify's own correct generated router. Converting is more
 * dangerous than the dead label. BOTH forms are banned; delete the router.
 *
 * ── THE GAP THIS GATE CLOSED ──────────────────────────────────────────────
 * Until 2026-07-18 this file said "Fix: use bare `${VAR}` in Host() labels" —
 * i.e. it recommended the dead form, repo-wide, while a later section of the
 * SAME file stated the correct rule and enforced it on netbird's compose only.
 * traefik-host-coverage.gate.test.ts skipped `${VAR}` forms as "caught by a
 * separate gate". Each gate assumed the other covered it; neither did.
 * Commit 3fd92028 followed the bad advice and produced another dead label;
 * 7ed24a86 designed a tri-host Keycloak router on top of dead labels, so that
 * design could never take effect.
 *
 * Historical incident (commit 81037966+, ~4h debug): the `${VAR:-literal}` form
 * in docker-compose.coolify-netbird.yml. Same root cause; the fallback
 * additionally baked a reference host into the contract.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { reHost, vnitrniHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();

interface Violation {
  file: string;
  line: number;
  label: string;
}

function findTraefikLabelFallbackViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const name of readdirSync(ROOT)) {
    if (!name.startsWith("docker-compose") || !name.endsWith(".yml")) continue;
    if (name.includes("local")) continue;

    const content = readFileSync(join(ROOT, name), "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/traefik\.http\.routers\.[\w-]+\.(rule|priority|entrypoints|tls|service|middlewares)[=.]/i);
      if (!match) continue;

      // Allow ${VAR} only in router NAME (left side of =), not in VALUE.
      // Split on first =, check the right-hand side.
      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) continue;
      const value = line.slice(eqIdx + 1);

      if (/\$\{[A-Z_][A-Z0-9_]*:-/.test(value)) {
        violations.push({ file: name, line: i + 1, label: line.trim() });
      }
    }
  }
  return violations;
}

describe("Coolify Traefik Label Substitution Gate", () => {
  test("Traefik router VALUES must not use ${VAR:-literal} fallbacks", () => {
    const violations = findTraefikLabelFallbackViolations();

    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line}\n    ${v.label}`).join("\n");
      throw new Error(
        `Found ${violations.length} Traefik label(s) with \${VAR:-literal} fallback in VALUE.\n` +
        `Do NOT "fix" this by switching to bare \${VAR} — Coolify escapes $ -> $$ in label\n` +
        `VALUES, so BOTH forms are dead (see this file's header: 980 \${VAR} uses work in\n` +
        `environment:/command:/networks:, 56 die in labels:).\n` +
        `A Traefik label must carry NO hostname at all. Declare the route in Coolify\n` +
        `docker_compose_domains instead — add the host to scripts/coolify-domain-doctor.mjs\n` +
        `and run it (read-only by default; --apply needs resolved operator env).\n\n` +
        `Violations:\n${msg}`
      );
    }
    expect(violations).toEqual([]);
  });

  // ── NetBird routing convention (2026-07 rewrite) ─────────────────────────
  // Coolify ALWAYS escapes `$` → `$$` in label VALUES, so Host(`${VAR}`)
  // router rules never match on Coolify (feedback_coolify_label_dollar_escape),
  // and the template-only directive forbids literal deployment hostnames in
  // git. NetBird therefore must not rely on ${VAR} Host() rules AT ALL:
  //   - gRPC (management + signal): host-less PathPrefix routers on the
  //     protobuf service FQNs with scheme=h2c (deployment-agnostic, no `$`).
  //   - HTTP surface (dashboard, /api, /relay): netbird-proxy Caddy demux,
  //     registered as a REAL docker_compose_domains entry (doctor +
  //     deploy-init), replacing the old netbird-disabled.invalid sentinel.
  test("netbird compose declares NO ${VAR}-interpolated Host() router rules (dead on Coolify)", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-netbird.yml"), "utf-8");
    const violations = compose
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /traefik\.http\.routers\.[\w-]+\.rule=/.test(line) && line.includes("Host(`${"));
    expect(
      violations.map((v) => `line ${v.n}: ${v.line}`),
      "Coolify $-escapes label values — Host(`${VAR}`) never matches. Route the " +
        "HTTP surface via netbird-proxy docker_compose_domains and gRPC via " +
        "host-less PathPrefix h2c routers instead.",
    ).toEqual([]);
  });

  // ⛔ TENHLE TEST DŘÍV VADU PŘEDEPISOVAL. Do 2026-08-18 VYŽADOVAL label
  //     traefik.http.services.${APP_NAME_PREFIX:?…}-netbird-proxy.loadbalancer…
  // a hlavička ho jmenovala jako „the sole custom service label" — jedinou
  // povolenou výjimku z pravidla „žádné ${VAR} v Traefik labelech".
  //
  // Ta výjimka stála celodenní výpadek mesh. Zdůvodnění zdědila od JINÉHO
  // případu: u `Host(...)` je nedosazený `${VAR}` MRTVÝ (nic nematchne, škoda
  // nulová). U JMÉNA SLUŽBY mrtvý není — literál `${APP_NAME_PREFIX:?…}-netbird-proxy`
  // je platné jméno, a protože ho má i cizí nájemník na témže hostiteli,
  // Traefik obě instance SLOUČÍ DO JEDNÉ SLUŽBY a rozloží mezi ně zátěž.
  //
  // NAMĚŘENO na živých kontejnerech, 12 požadavků s týmž tokenem na tentýž URL:
  //     200 401 200 401 200 401 200 401 200 401 200 401
  // Routery přitom směrovaly správně — každý nájemník má svůj Host. Rozpadlo se
  // to až na druhém kroku, který o identitě neví.
  //
  // Label byl navíc NADBYTEČNÝ: schopnost h2c nese Caddyho vlastní konfigurace
  // (`protocols h1 h2 h2c`, ověřeno hned níž), ne tenhle label. Port si Coolify
  // bere z mapování domény a svoje routery i služby odlišuje UUID aplikace.
  //
  // Pravidlo tedy nemá výjimku: v Traefik labelu nesmí být ${VAR} NIKDE —
  // ani v hodnotě (mrtvý router), ani ve JMÉNĚ (sloučená služba).
  test("netbird nedeklaruje ŽÁDNÝ Traefik label — jednoznačnost dodává Coolify", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-netbird.yml"), "utf-8");
    expect(compose).not.toContain("traefik.http.routers.");
    expect(compose).not.toContain("traefik.http.middlewares.");
    const jmenaZeSablony = compose
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /traefik\.http\.(services|routers|middlewares)\.[^"=]*\$\{/.test(line));
    expect(
      jmenaZeSablony.map((v) => `line ${v.n}: ${v.line}`),
      "Jméno Traefik služby/routeru nesmí záviset na interpolaci: Coolify ručně " +
        "psané labely neinterpoluje, takže do kontejneru jde literál — a cizí " +
        "nájemník má týž literál. Traefik pak dva kontejnery považuje za jednu " +
        "službu a rozloží mezi ně zátěž (naměřeno 2026-08-18: 200 401 200 401 …).",
    ).toEqual([]);
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
    expect(compose).toMatch(/@grpcMgmt path \/management\.ManagementService\/\*/);
    expect(compose).toMatch(/@grpcSignal path \/signalexchange\.SignalExchange\/\*/);
  });

  test("netbird: přímá tvář na netbird-proxy, veřejná na edge (doctor + deploy-init, no sentinel)", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-netbird.yml"), "utf-8");
    expect(compose, "netbird-proxy Caddy demux service must exist").toMatch(/^ {2}netbird-proxy:/m);
    // /api → management over plaintext HTTP/2. The scheme-prefixed
    // `h2c://…:443` literal is a hard ERROR in current Caddy (conflicting
    // scheme and HTTPS port → crash-loop); the canonical shape is a bare
    // upstream + `transport http { versions h2c }` (same as internal-tls).
    expect(compose, "proxy must demux /api to management (h2c transport idiom)").toMatch(
      new RegExp(
        `reverse_proxy ${reHost("netbird-management", 443)} ` +
          "\\{\\s*transport http \\{\\s*versions h2c\\s*\\}\\s*\\}",
      ),
    );
    expect(compose, "proxy must demux /relay to the relay").toContain(`reverse_proxy ${vnitrniHost("netbird-relay", 33080)}`);
    expect(compose, "proxy must default to the dashboard").toContain(`reverse_proxy ${vnitrniHost("netbird-dashboard", 80)}`);

    // ⛔ NAMĚŘENO 2026-09-16 — premisa „veřejnou tvář vlastní demux Caddy sám,
    // ne edge" (2026-08-25) neplatí. pfSense posílá veřejnou zónu na uzel s edge,
    // takže veřejné jméno registrované u netbird-proxy bylo router tam, kam provoz
    // nedorazí: veřejně 404 na /, /api, /relay i gRPC a tamní Traefik servíroval
    // „TRAEFIK DEFAULT CERT" (ACME výzva přistála na edge). Přímá tvář téhož
    // proxy odpovídala (401 / grpc-status 0). Pravidlo teď: netbird-proxy nese
    // JEN přímou tvář; veřejnou obslouží edge → přímá tvář. Že edge opravdu
    // vyrenderuje trasu, měří `netbird-verejna-tvar-obsluhuje-edge`.
    const doctor = readFileSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"), "utf-8");
    const netbirdKontrakt = doctor.slice(doctor.indexOf('{ app: "aisha-netbird"'));
    const netbirdPolozka = netbirdKontrakt.slice(0, netbirdKontrakt.indexOf("},\n") + 2);
    expect(netbirdPolozka, "doctor: netbird-proxy nese přímou tvář").toMatch(
      /name: "netbird-proxy", domain: `https:\/\/\$\{env\.NETBIRD_DOMAIN_DIRECT\}`/,
    );
    expect(netbirdPolozka, "doctor: veřejné jméno NESMÍ být u netbird-proxy").not.toMatch(/env\.NETBIRD_DOMAIN\b(?!_)/);
    // Úsek tváří edge-proxy. Dřív začínal u `function webPublicDomains` — ta je od
    // 2026-10-04 pryč (domény webu skládá lib/domeny-webu.mjs), kotvou je teď
    // sama funkce tváří edge-proxy.
    const webFaces = doctor.slice(doctor.indexOf("function edgeProxyDomains"), doctor.indexOf("const expected = ["));
    expect(doctor.indexOf("function edgeProxyDomains"), "doctor: chybí edgeProxyDomains()").toBeGreaterThan(-1);
    expect(webFaces, "doctor: veřejnou tvář registruje edge, jen s přímou tváří").toMatch(
      /skutecne\(env\.NETBIRD_DOMAIN\) && skutecne\(env\.NETBIRD_DOMAIN_DIRECT\)[\s\S]{0,80}domains\.push\(`https:\/\/\$\{env\.NETBIRD_DOMAIN\}`\)/,
    );
    // Jedno jméno pro obě tváře (jednouzlová topologie): edge ho nesmí vzít —
    // dva Host routery pro týž host na jednom Traefiku (2026-09-23, fork cheers).
    expect(webFaces, "doctor: shodné jméno obou tváří si edge nebere").toMatch(
      /skutecne\(env\.NETBIRD_DOMAIN_DIRECT\) && env\.NETBIRD_DOMAIN !== env\.NETBIRD_DOMAIN_DIRECT\)/,
    );
    expect(doctor, "the netbird-disabled sentinel must not return").not.toContain("netbird-disabled.invalid");

    const deployInit = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf-8");
    // ⛔ 2026-08-29: přímá tvář je POVINNÁ — deploy-init běží při každém nasazení
    // a bez ní přepsal registraci na jméno, na které nic nedosáhne (mesh DNS
    // prázdné → api 502). Proto `:?`, ne podmínka.
    expect(deployInit, "deploy-init: netbird-proxy = povinná přímá tvář").toMatch(
      /"netbird-proxy=https:\/\/\$\{NETBIRD_DOMAIN_DIRECT:\?/,
    );
    expect(deployInit, "deploy-init: veřejné jméno NESMÍ být u netbird-proxy").not.toMatch(
      /"netbird-proxy=[^"]*\$\{NETBIRD_DOMAIN(?!_)/,
    );
    expect(deployInit, "deploy-init: veřejnou tvář připojí k edge-proxy").toMatch(
      /case "\$\{NETBIRD_DOMAIN:-\}\|\$\{NETBIRD_DOMAIN_DIRECT:-\}" in[\s\S]{0,120}EDGE_PROXY_DOMAINS="\$\{EDGE_PROXY_DOMAINS\},https:\/\/\$\{NETBIRD_DOMAIN\}"/,
    );
    expect(deployInit, "deploy-init: shodné jméno obou tváří si edge nebere").toMatch(
      /if \[ "\$\{NETBIRD_DOMAIN:-\}" != "\$\{NETBIRD_DOMAIN_DIRECT:-\}" \]; then\s*\n\s*case "\$\{NETBIRD_DOMAIN:-\}\|/,
    );
    expect(deployInit).not.toContain("netbird-disabled.invalid");
  });
});
