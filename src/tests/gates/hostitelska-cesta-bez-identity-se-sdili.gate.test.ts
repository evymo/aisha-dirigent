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
 * jednom stroji sdílejí (naměřeno 2026-09-23 na varra: exec tří instancí).
 *
 * Zbývá jen exec, a to ZÁMĚRNĚ: runner (svc-agent-runner) používá TUTÉŽ cestu
 * ve svém kontejneru i jako hostitelskou pro dětské kontejnery přes docker.sock
 * (`Binds: [worktree:/work]`), a Coolify `${` v CÍLI svazku odmítá. Per-instance
 * cesta tu proto chce štěpení „cesta v kontejneru / na hostiteli" v kódu
 * runneru — navazující úkol. Proměnné `AGENT_RUNS_DIR` / `AGENT_REPO_PATH` už
 * generátor odvozuje z identity; chybí jen jejich spotřeba ve zdroji svazku.
 */
const DLUH = [
  "docker-compose.coolify-exec.yml:svc-agent-runner:/srv/aisha/base-repo",
  "docker-compose.coolify-exec.yml:svc-agent-runner:/var/lib/aisha/agent-runs",
];

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

  test("web a renderer TÉŽE instance sdílejí předrenderování přes tutéž proměnnou identity", () => {
    // Obnoveno 2026-09-24: web publikuje skořápku do /shell (Dockerfile.web kopíruje
    // index.html při startu) a servíruje výstup rendereru z /_static (nginx try_files).
    // Web a renderer jsou DVĚ Coolify aplikace — pojmenovaný svazek by Coolify
    // přejmenoval podle UUID aplikace, proto hostitelská cesta. Aby se potkaly, musí
    // obě brát TUTÉŽ proměnnou; jiná proměnná (nebo doslovná cesta) = web servíruje
    // něco jiného, než renderer vyrobil.
    const zdroj = (soubor: string, sluzba: string, cil: string): string | undefined => {
      const obsah = obsahy.find(([f]) => f === soubor)?.[1] ?? "";
      return zdrojeSvazku(soubor, obsah).find((z) => z.sluzba === sluzba && z.cil === cil)?.zdroj;
    };
    const dvojice: Array<[string, string, string]> = [
      ["výstup rendereru", "/usr/share/nginx/html/_static", "/out"],
      ["skořápka webu", "/shell", "/shell"],
    ];
    for (const [co, cilWebu, cilRendereru] of dvojice) {
      const web = zdroj("docker-compose.coolify-prebuilt.yml", "web", cilWebu);
      const renderer = zdroj("docker-compose.coolify-web-render.yml", "svc-web-render", cilRendereru);
      expect(web, `${co}: web ho nemountuje na ${cilWebu} — předrenderování se nikde nepotká`).toMatch(/^\$\{[A-Z0-9_]+\}$/);
      expect(web, `${co}: web a renderer mountují RŮZNÉ zdroje`).toBe(renderer);
    }
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
