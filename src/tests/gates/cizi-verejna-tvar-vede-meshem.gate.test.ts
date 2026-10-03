/**
 * Cizí veřejná tvář vede MESHEM (proměnná instance EXTERNAL_FACES)
 *
 * ⭐ POTŘEBA (2026-09-18): instance chtěla veřejnou adresu pro aplikaci, kterou
 * sama NENASAZUJE (testovací <fork>-api jako vlastní Coolify app na tomtéž
 * serveru). První návrh byl port na LAN a Traefik vedle — to je přesně
 * „boční cesta", kterou pravidlo majitele zakazuje: veřejné jde přes edge
 * DO MESHE, nic vedle. Deklarativní kanál chyběl, takže by si ho instance
 * vynutila obchvatem.
 *
 * Tvář proto vede přes mesh-ingress PLATFORMNÍHO stacku (`via`) na tomtéž
 * serveru; cizí aplikace se nestává peerem a mesh tajemství nedostane.
 * Deklarace je JEDNA proměnná instance (`<subdomain>=<container>:<port>@<via>, …`)
 * — další aplikace je úprava hodnoty, ne commit.
 *
 * Brána hlídá celou cestu, protože každá rovina bez ostatních vyrobí tvář,
 * která se přeloží a NESPOJÍ:
 *   derivace  → trasa v tabulce peeru `via` + EDGE_EXTERNAL_FACES(_HOSTS)
 *   edge      → compose proměnnou čte a Caddy blok skládá (smyčka ověřena během)
 *   Traefik   → doktor domén i deploy-init hostitele registrují
 *   mesh DNS  → jméno míří na peer `via`, bez záchrany docker aliasem
 *   bez meshe → tvář se NEVYDÁ (a derivace to řekne)
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const EDGE_COMPOSE = join(ROOT, "docker-compose.coolify-prebuilt.yml");

const REF = {
  PUBLIC_TLD: "public.example",
  INTERNAL_TLD: "internal.example",
  MESH_TLD: "mesh.example",
  APP_NAME_PREFIX: "acme",
  // source-broker je opt-in (provision_when_env) — tvář přes něj ho potřebuje nasazený.
  SOURCE_API_URL: "http://source.example:8000",
};

const FACE = "partner-api=partner-api:8000@source-broker";

function run(externalFaces: string | undefined, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // EXTERNAL_FACES je mezi vstupy resolveru — z okolního prostředí se sem nedostane.
  for (const key of RESOLVER_ENV_INPUTS) delete env[key];
  delete env.AISHA_PROFILE;
  return spawnSync("node", [DERIVE, "--profile=cloud-multi", ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...env, ...REF, ...(externalFaces === undefined ? {} : { EXTERNAL_FACES: externalFaces }) },
  });
}

function shell(externalFaces: string | undefined, mesh: "on" | "off") {
  const r = run(externalFaces, [`--mesh=${mesh}`, "--shell"]);
  expect(r.status, r.stderr).toBe(0);
  const vars = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) vars.set(m[1], m[2].replace(/^'(.*)'$/, "$1"));
  }
  return { vars, stderr: r.stderr };
}

describe("derivace: tvář jde do tabulky peeru `via` a na edge", () => {
  test("mesh zapnutý → trasa v SOURCE_BROKER tabulce + dvojice pro edge", () => {
    const { vars } = shell(FACE, "on");
    const mesh = "acme-partner-api.mesh.example";
    const verejne = "partner-api.public.example";
    expect(vars.get("EDGE_EXTERNAL_FACES")).toBe(`${verejne}|http://${mesh}:8000`);
    expect(vars.get("EDGE_EXTERNAL_FACE_HOSTS")).toBe(verejne);
    const trasy = (vars.get("SOURCE_BROKER_MESH_INGRESS_ROUTES") ?? "").split(";");
    expect(trasy).toContain(`8000|${mesh},${verejne}|partner-api:8000`);
    // Vlastní trasa stacku zůstala — cizí tvář se PŘIDÁVÁ, nepřepisuje.
    expect(trasy.some((t) => t.endsWith("|acme-svc-source-broker:8090"))).toBe(true);
  });

  test("mesh vypnutý → tvář se nevydá a derivace to řekne (boční cesta se nedosazuje)", () => {
    const { vars, stderr } = shell(FACE, "off");
    expect(vars.get("EDGE_EXTERNAL_FACES")).toBe("");
    expect(vars.get("EDGE_EXTERNAL_FACE_HOSTS")).toBe("");
    expect(vars.get("SOURCE_BROKER_MESH_INGRESS_ROUTES") ?? "").not.toContain("partner-api");
    expect(stderr).toMatch(/external_faces\.partner-api .*NEVYSTAVÍ/);
  });

  test("bez deklarace se obě proměnné vydají PRÁZDNÉ — odebraná tvář z trezoru zmizí", () => {
    const { vars } = shell(undefined, "on");
    expect(vars.has("EDGE_EXTERNAL_FACES")).toBe(true);
    expect(vars.get("EDGE_EXTERNAL_FACES")).toBe("");
    expect(vars.get("EDGE_EXTERNAL_FACE_HOSTS")).toBe("");
  });
});

describe("derivace: vadná deklarace padá nahlas", () => {
  test.each([
    ["tvar položky", "partner-api", /čekám <subdomain>=<container>:<port>@<via>/],
    ["via mimo topologii", "partner-api=partner-api:8000@neexistuje", /via 'neexistuje' v topologii NENÍ/],
    ["via bez mesh-ingressu", "partner-api=partner-api:8000@keycloak", /nemá mesh-ingress/],
    ["subdoména není DNS label", "Partner_API=partner-api:8000@source-broker", /není DNS label/],
    ["port mimo rozsah", "partner-api=partner-api:70000@source-broker", /není TCP port/],
    ["container není docker jméno", "partner-api=-x:8000@source-broker", /není docker jméno/],
    ["dvakrát táž subdoména", `${FACE}, partner-api=jiny:9000@source-broker`, /deklarovaná dvakrát/],
  ])("%s", (_popis, hodnota, chyba) => {
    const r = run(hodnota, ["--mesh=on", "--shell"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(chyba);
  });

  test("víc tváří oddělených čárkou i středníkem, mezery nevadí", () => {
    const { vars } = shell(" a=a-app:8000@source-broker ; b=b-app:9000@source-broker ,", "on");
    expect(vars.get("EDGE_EXTERNAL_FACE_HOSTS")).toBe("a.public.example,b.public.example");
  });

  test("jméno služby cizí tvář nezabere (--check hlásí duplicitu)", () => {
    const r = run("api=partner-api:8000@source-broker", ["--mesh=on", "--check"]);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/duplicate URL 'api\.public\.example' claimed by 'external_faces\.api'/);
  });

  test("env-doktor zná EXTERNAL_FACES jako ruční deklaraci operátora", () => {
    const doktor = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    expect(doktor).toMatch(/\["EXTERNAL_FACES", "static", ""\]/);
    expect(RESOLVER_ENV_INPUTS).toContain("EXTERNAL_FACES");
  });
});

describe("edge: compose proměnnou čte a blok skládá", () => {
  const compose = readFileSync(EDGE_COMPOSE, "utf8");

  test("edge-proxy dostává EDGE_EXTERNAL_FACES a blok je vložen do Caddyfile", () => {
    expect(compose).toContain("EDGE_EXTERNAL_FACES: ${EDGE_EXTERNAL_FACES:-}");
    expect(compose).toContain("$${external_faces_block}");
  });

  // Smyčka se spouští, ne čte: `$${…}` escapování a rozklad `;`/`|` v ash se
  // pohledem ověřit nedá. Úsek se vyřízne z compose a `$$` → `$` (jako compose).
  function blok(hodnota: string): { out: string; block: string } {
    const radky = compose.split("\n");
    const od = radky.findIndex((r) => r.trim() === 'external_faces_block=""');
    const po = radky.findIndex((r, i) => i > od && r.includes("external faces: none"));
    expect(od, "úsek external_faces_block v compose nenalezen").toBeGreaterThan(0);
    // Úsek se musí OPRAVDU vyříznout — `po` za `od`. Jinak by se spustil prázdný
    // skript, prošel se statusem 0 a brána by tvrdila zelenou nad ničím.
    expect(po, "konec úseku (external faces: none) nenalezen za jeho začátkem").toBeGreaterThan(od);
    const skript = radky
      .slice(od, po + 1)
      .map((r) => r.replace(/^ {8}/, "").replace(/\$\$/g, "$"))
      .join("\n") + '\nprintf "%s" "$external_faces_block" >&2\n';
    // ⛔ REŽIM SHELLU JAKO V ENTRYPOINTU (review 2026-09-19, bod B; změřeno 2026-09-24):
    // entrypoint edge dělá `set -eu` a po mesh routě `set +e` — to vypne JEN errexit,
    // `-u` platí dál i v téhle smyčce. Jediná nedefinovaná proměnná by tak shodila celý
    // entrypoint a nenaběhla by žádná veřejná tvář. Test bez `set -u` by to neviděl.
    const r = spawnSync("sh", ["-c", `set -u\n${skript}`], { encoding: "utf-8", env: { PATH: process.env.PATH, EDGE_EXTERNAL_FACES: hodnota } });
    expect(r.status, r.stderr).toBe(0);
    return { out: r.stdout, block: r.stderr };
  }

  test("dvě tváře → dva bloky s vlastním matcherem; Host se nepřepisuje", () => {
    const { block } = blok("a.public.example|http://acme-a.mesh.example:8000;b.public.example|http://acme-b.mesh.example:9000");
    expect(block).toContain("@external_face_1 host a.public.example");
    expect(block).toContain("reverse_proxy http://acme-a.mesh.example:8000 {");
    expect(block).toContain("@external_face_2 host b.public.example");
    expect(block).toContain("reverse_proxy http://acme-b.mesh.example:9000 {");
    expect(block).toContain("header_up X-Forwarded-Proto https");
    expect(block).not.toMatch(/header_up Host /);
  });

  /**
   * ⛔ OBSAH POLOŽKY JDE DO CADDYFILE DOSLOVA (review 2026-09-19, bod A).
   * Mezera, `{` nebo `}` v hostiteli či upstreamu by rozbily syntaxi CELÉHO Caddyfile —
   * nenaběhla by žádná veřejná tvář, ne jen ta vadná. Ověřeno i v alpine (busybox sh)
   * 2026-09-24 na položkách tvaru skutečných tváří instance.
   */
  test("položka s nepovoleným znakem se přeskočí nahlas a platná vedle ní žije", () => {
    const { out, block } = blok(
      "a.public.example|http://acme-a.mesh.example:8000;zla polozka.example|http://x:1;spatne{.example|http://y:2;" +
        "druhe.example|http://w:1|navic;zavorka}.example|http://z:3",
    );
    expect(out).toMatch(/položka 'zla polozka\.example\|http:\/\/x:1' má nepovolený znak/);
    expect(out).toMatch(/položka 'spatne\{\.example\|http:\/\/y:2' má nepovolený znak/);
    // Druhé `|` spadne do upstreamu (dělí se na PRVNÍM) — filtr ho musí chytit tam.
    expect(out).toMatch(/položka 'druhe\.example\|http:\/\/w:1\|navic' má nepovolený znak/);
    expect(out).toMatch(/položka 'zavorka\}\.example\|http:\/\/z:3' má nepovolený znak/);
    expect(block).toContain("@external_face_1 host a.public.example");
    expect(block, "vadná položka nesmí do Caddyfile ani zčásti").not.toMatch(/zla polozka|spatne\{|druhe\.example|navic|zavorka\}/);
    expect(block, "číslování matcherů bez děr — přeskočená položka číslo nespotřebuje").not.toContain("@external_face_2");
  });

  test("vadná položka se přeskočí nahlas, prázdno je čitelný stav", () => {
    expect(blok("vadna;a.public.example|http://m:1").out).toMatch(/vadná položka 'vadna'/);
    const prazdno = blok("");
    expect(prazdno.block).toBe("");
    expect(prazdno.out).toMatch(/external faces: none/);
  });
});

describe("Traefik a mesh DNS: hostitele registrují obě roviny", () => {
  test("doktor domén i deploy-init čtou EDGE_EXTERNAL_FACE_HOSTS", () => {
    for (const f of ["scripts/coolify-domain-doctor.mjs", "scripts/coolify-deploy-init.sh"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toContain("EDGE_EXTERNAL_FACE_HOSTS");
    }
  });

  test("DNS provisioning míří na peer `via` a nemá záchranu aliasem", () => {
    const src = readFileSync(join(ROOT, "scripts/netbird-dns-provision.mjs"), "utf8");
    const usek = src.slice(src.indexOf("topo.external_faces"), src.indexOf("return { plan, unresolved }"));
    expect(usek).toContain("peerIp.get(f.via_compose)");
    expect(usek).not.toMatch(/aliasIp/);
  });
});
