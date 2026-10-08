/**
 * Brána: doslovná hostitelská cesta je SPOLEČNÁ všem instancím na stroji.
 *
 * ⛔ NAMĚŘENO 2026-09-14 (sdílený frontend stroj). Web základu mountoval
 * `/var/lib/aisha/web-static` a `/var/lib/aisha/web-shell`; tytéž cesty
 * mountoval web a generátor předrenderování JINÉ instance na témž stroji.
 * Veřejná tvář jedné instance servírovala stránky druhé a druhá renderovala
 * nad skořápkou první (odkazy na cizí JS bundle → 404).
 *
 * Doslovná cesta NIKDY nenese identitu, a proto ji sdílí každá instance, která
 * se na stroj dostane. Pojmenovaný svazek takovou vadu nemá — Coolify ho
 * jmenuje podle UUID aplikace — jenže mezi DVĚMA aplikacemi ho sdílet nejde.
 *
 * ⛔ OPRAVENÁ PREMISA (naměřeno 2026-09-23). Tady stálo „identitu do cesty dát
 * nejde, Coolify `${` odmítá". To platilo jen pro Coolify beta.441–442; dnešní
 * Coolify (4.3.16) `${VAR}` ve zdroji PŘIJME a docker compose ho rozvine z env
 * aplikace. Ta mylná premisa vyrobila doslovné cesty, které tahle brána nese
 * jako dluh (commit 2a1630df0: „interpolaci zakazuje brána"). Naměřeno živě:
 * renderer dvou instancí zapisoval do jednoho `web-static`, tři exec stacky
 * sdílely `agent-runs` a `base-repo`.
 *
 * ⛔ PREMISA OPRAVENA ZNOVU (naměřeno živě 2026-09-28, Coolify 4.3.16 na talos):
 * ani `${VAR}` s celou cestou identitu do cesty NEDÁ. Coolify rozhoduje bind vs.
 * pojmenovaný svazek jen podle TEXTU zdroje (`sourceIsLocal()`, shared.php:1692 —
 * lokální je jen `/`, `./`, `~`, `..`) a hodnotu VAR předtím nedosadí → `${VAR}`
 * skončí jako svazek `<uuid>_<slug>`. `${VAR:-x}` se rozvine vždy na `x` (tady se
 * počítá jako doslovné `x`). Data instance proto = POJMENOVANÝ svazek v témže
 * compose; `${…}` ve zdroji chytá `coolify-compose-compliance` (pastNaPromennou).
 *
 * CO SE MĚŘÍ (vlastnost, ne výčet služeb): bind mount, jehož zdroj je
 * absolutní cesta k DATŮM (ne k prostředku hostitele jako `/dev/net/tun`,
 * `/proc`, docker socket), je nález. Známý dluh smí jen ubývat.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { rozvinVychoziHodnotu, zdrojeSvazku } from "./lib/zdroje-svazku";

const ROOT = resolve(__dirname, "../../..");

/** Prostředky hostitele — sdílené z podstaty, nejsou to data instance (kořen `/` čte monitoring). */
const PROSTREDEK_HOSTITELE = /^\/$|^\/(dev|proc|sys|run|etc|tmp)(\/|$)|^\/var\/run(\/|$)|^\/var\/lib\/docker(\/|$)/;

type Nalez = { klic: string; zdroj: string };

export function sdileneHostitelskeCesty(soubor: string, obsah: string): Nalez[] {
  const nalezy: Nalez[] = [];
  for (const { sluzba, zdroj, tvar, typ } of zdrojeSvazku(soubor, obsah)) {
    if (tvar === "dlouhy" && typ !== "bind") continue;
    // `${VAR:-x}` → x (tak to udělá Coolify); `${VAR}` → null (cestu nese env instance).
    const cesta = rozvinVychoziHodnotu(zdroj);
    if (!cesta || !cesta.startsWith("/")) continue;
    if (PROSTREDEK_HOSTITELE.test(cesta)) continue;
    nalezy.push({ klic: `${soubor}:${sluzba}:${cesta}`, zdroj: cesta });
  }
  return nalezy;
}

/** Proměnné, které jsou ve zdroji bind mountu celou cestou (`${VAR}`). */
export function promenneHostitelskychCest(soubor: string, obsah: string): { klic: string; promenna: string }[] {
  return zdrojeSvazku(soubor, obsah)
    .filter((z) => z.tvar === "kratky" || z.typ === "bind")
    .flatMap((z) => {
      const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(z.zdroj.trim());
      return m ? [{ klic: `${soubor}:${z.sluzba}:\${${m[1]}}`, promenna: m[1] }] : [];
    });
}

/** Generátor odvozuje hodnotu z identity instance (`deployPrefix`) — jinak by ji sdílely všechny. */
export function odvozenoZIdentity(promenna: string, generator: string): boolean {
  const vzor = new RegExp(
    `emit\\(\\s*'${promenna}'\\s*,\\s*preservedValue\\(\\s*'${promenna}'\\s*,\\s*\`[^\`]*\\$\\{deployPrefix\\}[^\`]*\`\\s*\\)\\s*\\)`,
  );
  return vzor.test(generator);
}

/**
 * Známý dluh — smí jen ubývat. Každá položka je adresář, který si instance na
 * jednom stroji sdílejí. Od 2026-09-24 PRÁZDNÝ: exec (poslední dvě položky)
 * pracuje v pevném adresáři kontejneru a hostitelskou cestu instance
 * (${AGENT_RUNS_DIR}) dává jen dětem v Binds; sdílený base-repo zmizel.
 */
const DLUH: string[] = [];

describe("doslovná hostitelská cesta k datům se sdílí mezi instancemi", () => {
  const soubory = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f)).sort();
  const obsahy = soubory.map((f) => [f, readFileSync(join(ROOT, f), "utf-8")] as const);
  const nalezy = obsahy.flatMap(([f, o]) => sdileneHostitelskeCesty(f, o));
  const generator = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf-8");

  test("negativní sonda: detektor chytí data, ne prostředky hostitele ani pojmenované svazky", () => {
    const vzorek = [
      "services:",
      "  a:",
      "    volumes:",
      "      - /var/lib/aisha/x:/x:ro",
      "      - \"${NECO:-/srv/aisha/y}:/y\"",
      "      - { type: bind, source: /srv/data, target: /z }",
      "      - /dev/net/tun:/dev/net/tun",
      "      - /var/run/docker.sock:/var/run/docker.sock",
      "      - /:/rootfs:ro",
      "      - pojmenovany:/data",
      "      - /jen-cil-bez-zdroje",
      "      - \"${HOST_DIR}:/w\"",
      "      - { type: volume, source: jmeno, target: /v }",
    ].join("\n");
    expect(sdileneHostitelskeCesty("vzorek.yml", vzorek).map((n) => n.zdroj)).toEqual([
      "/var/lib/aisha/x",
      "/srv/aisha/y",
      "/srv/data",
    ]);
  });

  test("web základu nemountuje předrenderované stránky ani skořápku z DOSLOVNÉ cesty", () => {
    const web = nalezy.filter((n) => n.klic.startsWith("docker-compose.coolify-prebuilt.yml:web:"));
    expect(
      web.map((n) => n.klic),
      "web servíruje veřejnou tvář instance — doslovná hostitelská cesta by mu podstrčila obsah jiné instance na témž stroji",
    ).toEqual([]);
  });

  test("web a renderer si předrender předávají PO SÍTI — žádný sdílený zdroj svazku", () => {
    // ⛔ OTOČENO 2026-10-02 (varianta d-ii, rozhodnutí majitele). Dřív tu stálo „obě
    // aplikace musí brát TUTÉŽ proměnnou" — jenže Coolify 4.3.16 holý `${VAR}` ve
    // zdroji převede na svazek KAŽDÉ aplikace zvlášť, takže se nesdílelo nic a web
    // četl prázdný `_static` (rozbor 2026-09-28). Brána vynucovala nefunkční
    // mechanismus. Teď: web stránky TÁHNE a skořápku POSÍLÁ přímo MESHEM (vlastní
    // routa); renderer má výstup i skořápku ve VLASTNÍCH pojmenovaných svazcích.
    // Měří se vlastnost „mezi aplikacemi nic sdíleného na disku ani relay na sdílené síti".
    const zdroje = (soubor: string) =>
      zdrojeSvazku(soubor, obsahy.find(([f]) => f === soubor)?.[1] ?? "");
    const web = zdroje("docker-compose.coolify-prebuilt.yml").filter((z) => z.sluzba === "web");
    const renderer = zdroje("docker-compose.coolify-web-render.yml").filter((z) => z.sluzba === "svc-web-render");
    expect(renderer.length, "kontrolní vzorek: renderer má svazky — brána by měřila prázdno").toBeGreaterThan(0);

    expect(
      web.filter((z) => z.cil === "/usr/share/nginx/html/_static" || z.cil === "/shell").map((z) => `${z.zdroj} → ${z.cil}`),
      "web nesmí montovat předrender ani skořápku — předání je po síti (mesh)",
    ).toEqual([]);

    for (const cil of ["/out", "/shell"]) {
      const z = renderer.find((x) => x.cil === cil);
      expect(z, `renderer nemá svazek na ${cil}`).toBeDefined();
      expect(z!.zdroj, `${cil} rendereru musí být POJMENOVANÝ svazek (per instance konstrukcí), ne cesta ani \${VAR}`)
        .toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    }

    const spolecne = web.filter((w) => renderer.some((r) => r.zdroj === w.zdroj) && w.zdroj !== "pki-certs").map((w) => w.zdroj);
    expect(spolecne, "web a renderer jsou dvě Coolify aplikace — týž zdroj svazku v obou se NESDÍLÍ").toEqual([]);

    // ⛔ ŽÁDNÝ RELAY NA SDÍLENÉ SÍTI (nález nezávislé revize 2026-10-02). První tvar
    // d-ii šel přes posluchač edge-proxy :8091 — edge-proxy je ale i na síti `coolify`
    // s ostatními nájemníky hostitele: cizí kontejner by měl neověřený vstup do meshe
    // a jméno `<prefix>-edge-proxy` šlo na sdílené síti přivlastnit (token skořápky,
    // podvržené HTML). Web proto jde k web-renderu PŘÍMO MESHEM s vlastní routou.
    const prebuilt = parseYaml(obsahy.find(([f]) => f === "docker-compose.coolify-prebuilt.yml")?.[1] ?? "") as {
      services?: Record<string, { cap_add?: string[]; environment?: Record<string, string>; networks?: unknown }>;
    };
    const webSluzba = prebuilt.services?.web;
    expect(webSluzba, "kontrolní vzorek: prebuilt nemá službu web — brána by měřila prázdno").toBeDefined();
    const env = webSluzba!.environment ?? {};
    expect(String(env.WEB_RENDER_UPSTREAM_MESH ?? ""), "web musí dostat mesh cíl web-renderu z derivace")
      .toMatch(/^\$\{WEB_RENDER_UPSTREAM_MESH/);
    for (const k of ["MESH_ENABLED", "NETBIRD_PEER_CIDR", "NETBIRD_DNS_IP"]) {
      expect(String(env[k] ?? ""), `web potřebuje ${k} pro routu do meshe`).toMatch(new RegExp(`^\\$\\{${k}:\\?`));
    }
    expect(webSluzba!.cap_add ?? [], "web bez NET_ADMIN — routa do meshe skončí na Permission denied").toContain("NET_ADMIN");
    const textPrebuilt = obsahy.find(([f]) => f === "docker-compose.coolify-prebuilt.yml")?.[1] ?? "";
    expect(textPrebuilt, "relay do web-renderu na edge-proxy (posluchač :8091) se nesmí vrátit")
      .not.toMatch(/:8091 \{|WEB_RENDER_PROXY/);

    // ⛔ MESH JMÉNO SE NEPŘEKLÁDÁ VESTAVĚNÝM DNS DOCKERU (revize RIQi Detail firmy,
    // kolo 2, 2026-10-02). 127.0.0.11 dává PŘEDNOST aliasům ze sítí kontejneru —
    // i ze sdílené `coolify` — takže cizí kontejner s aliasem
    // `<prefix>-web-render.mesh.<tld>` by návštěvníkům podstrčil vlastní HTML
    // (naměřeno: s resolverem 127.0.0.11 vrátil web obsah „squattera“). Upstream
    // i push skořápky se proto ptají PŘÍMO mesh DNS (NETBIRD_DNS_IP).
    const start = readFileSync(join(ROOT, "docker/web-start.sh"), "utf-8");
    const skorapka = readFileSync(join(ROOT, "docker/web-skorapka.sh"), "utf-8");
    expect(start, "upstream web-renderu nesmí jít přes vestavěné DNS Dockeru").not.toMatch(/resolver 127\.0\.0\.11/);
    expect(start, "upstream web-renderu se musí ptát mesh DNS (NETBIRD_DNS_IP)").toMatch(/dns="\$\{NETBIRD_DNS_IP/);
    expect(skorapka, "push skořápky musí překládat jméno mesh DNS (`--dns-servers`)").toMatch(/--dns-servers "\$dns"/);
  });

  test("hostitelská cesta z proměnné je per instance: generátor ji odvozuje z identity", () => {
    // Kontrolní vzorky: odvozená proměnná projde, doslovná výchozí hodnota ne.
    const vzorGen = [
      "emit('A_DIR',  preservedValue('A_DIR',  `/var/lib/${deployPrefix}/a`));",
      "emit('B_DIR',  preservedValue('B_DIR',  '/srv/doslovna/b'));",
    ].join("\n");
    expect(odvozenoZIdentity("A_DIR", vzorGen)).toBe(true);
    expect(odvozenoZIdentity("B_DIR", vzorGen)).toBe(false);
    expect(odvozenoZIdentity("C_DIR", vzorGen)).toBe(false);

    const promenne = obsahy.flatMap(([f, o]) => promenneHostitelskychCest(f, o));
    const neodvozene = promenne.filter((p) => !odvozenoZIdentity(p.promenna, generator)).map((p) => p.klic);
    expect(
      neodvozene,
      "Zdroj svazku `${VAR}` sdílí stejně jako doslovná cesta, pokud VAR nemá hodnotu odvozenou z identity\n" +
        "instance. Vydej ji v scripts/generate-secrets.mjs jako\n" +
        "  emit('VAR', preservedValue('VAR', `/<kořen>/${deployPrefix}/<adresář>`));",
    ).toEqual([]);
  });

  test("nový sdílený adresář nepřibude; opravený se z dluhu odebere", () => {
    expect(
      nalezy.map((n) => n.klic).sort(),
      "Bind mount doslovné hostitelské cesty k datům: sdílí ho KAŽDÁ instance na stroji. Použij `${VAR}` s celou\n" +
        "cestou, kterou generátor odvodí z identity instance (test výš), nebo pojmenovaný svazek (Coolify ho\n" +
        "jmenuje podle UUID aplikace), nebo data vůbec nesdílej přes disk. Opravenou položku smaž z DLUH.",
    ).toEqual([...DLUH].sort());
  });
});
