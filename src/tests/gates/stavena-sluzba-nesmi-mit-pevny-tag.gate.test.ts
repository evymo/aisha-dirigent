/**
 * Stavěná služba nesmí nést PEVNÝ `image:` — takový obraz se na cíl nedostane
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Služba, která má `build:`, nesmí mít zároveň `image:` s pevným jménem.
 * Pojmenování si dělá Coolify samo (`<uuid>_<sluzba>:<sha>`) a právě podle
 * něj pozná, které obrazy má po buildu PŘENÉST na cílový uzel.
 *
 * ── PROČ (naměřeno 2026-09-05, nasazení <fork>-exec) ─────────────────────────────
 * `plugin-exec-image` měla `build:` i `image: aisha/plugin-exec:v1`. Build na
 * build serveru proběhl, ale přenos ji vynechal — v logu je to vidět jako
 * rozpor dvou čísel:
 *
 *     Image …_pki-init:<sha>            Built
 *     Image aisha/plugin-exec:v1        Built          ← 3 postavené
 *     Image …_svc-agent-runner:<sha>    Built
 *     Transferring 2 built image(s) from Soren to RIQi. ← 2 přenesené
 *
 * Na cíli pak compose obraz zkusil STÁHNOUT (`pull access denied` — na Hubu
 * nic takového není) a pak POSTAVIT, jenže tam repo není:
 *
 *     resolve : lstat /data/coolify/applications/<uuid>/images: no such file or directory
 *
 * Celý stack tím spadl, ne jen ta jedna služba. Ověřeno přímo na hostiteli:
 * `…_svc-agent-runner:<sha>` a `…_pki-init:<sha>` tam jsou, `aisha/plugin-exec:v1`
 * ne, a `/data/coolify/applications/<uuid>/` obsahuje jen `config`,
 * `docker-compose.yaml` a `README.md` — žádný checkout.
 *
 * Záměr té služby byl správný (obraz sandboxu MÁ vzniknout tam, kde se
 * spotřebovává). Chybný byl předpoklad, že se staví a běží na TÉMŽE uzlu.
 * Stabilní jméno proto vzniká PŘEZNAČENÍM na cíli (`plugin-exec-tag`), ne
 * pevným `image:`.
 *
 * ── DRUHÁ POLOVINA: přeznačené jméno musí přežít úklid Coolify ────────────────
 * Naměřeno 2026-09-30 v `docker_cleanup_executions` Coolify: úklid Dockeru na
 * cílovém uzlu vypsal `Untagged: aisha/plugin-exec:v1` DEVĚTKRÁT od 2026-09-06
 * — po každém nasazení `<fork>-exec` přeznačovač jméno vyrobil a nejbližší
 * úklid (denní i vynucený nad prahem disku) ho zase smazal. Pluginy pak mají
 * obraz jen v okně mezi nasazením a dalším úklidem.
 *
 * Úklid obrazů je upstream Coolify, ne náš patch: bere každý obraz s tagem,
 * jehož jméno nezačíná uuid prostředku, a ušetří ho, jen když
 *
 *     docker inspect --format '{{index .Config.Labels "coolify.managed"}}' <obraz> | grep -q true
 *
 * Běžící kontejner `plugin-exec-image` jistí jen OBRAZ (ID), ne JMÉNO —
 * `docker rmi <tag>` u obrazu s dalším tagem jen odznačí. Štítek z
 * `build.labels` je v konfiguraci obrazu, takže ho nese i jméno vzniklé
 * `docker tag` (změřeno v DinD, Docker 29: bez štítku úklid jméno odznačí,
 * se štítkem nechá).
 *
 * Proto: služba, jejíž obraz jiná služba přeznačuje (`docker tag`, zdroj v
 * `SLUZBA`), nese `build.labels` `coolify.managed: "true"`.
 *
 * ── UNIVERZUM ────────────────────────────────────────────────────────────────
 * Všechny compose soubory, které zná git — ne ručně psaný seznam. V okamžiku
 * psaní byl v 32 souborech přesně JEDEN takový případ; brána drží nulu.
 * Přeznačovač byl 2026-09-30 v celém univerzu jeden (`plugin-exec-tag`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();

function composeSoubory(): string[] {
  return execFileSync("git", ["ls-files", "docker-compose*.yml"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

type Nalez = { soubor: string; sluzba: string; image: string };

/**
 * Vrátí služby, které mají `build:` A ZÁROVEŇ `image:`.
 *
 * Parsuje se YAML, ne odsazení: compose soubory tu používají kotvy (`x-*`) a
 * merge klíče, takže řádkové heuristiky by braly i šablony mimo `services:`.
 */
function pevnyTagNadBuildem(soubor: string): Nalez[] {
  const doc = parse(readFileSync(path.join(ROOT, soubor), "utf8")) as
    | { services?: Record<string, unknown> }
    | null;
  const sluzby = doc?.services;
  if (!sluzby || typeof sluzby !== "object") return [];

  const out: Nalez[] = [];
  for (const [jmeno, telo] of Object.entries(sluzby)) {
    if (!telo || typeof telo !== "object") continue;
    const s = telo as Record<string, unknown>;
    if (s.build === undefined || s.image === undefined) continue;
    out.push({ soubor, sluzba: jmeno, image: String(s.image) });
  }
  return out;
}

type Preznaceni = {
  soubor: string;
  preznacovac: string;
  zdroj: string | undefined;
  stitek: string | undefined;
  maBuild: boolean;
};

/** `environment` i `labels` smí být v compose mapa i seznam `KLIC=hodnota`. */
function hodnota(pole: unknown, klic: string): string | undefined {
  if (Array.isArray(pole)) {
    const radek = pole.map(String).find((r) => r.startsWith(`${klic}=`));
    return radek === undefined ? undefined : radek.slice(klic.length + 1);
  }
  if (pole && typeof pole === "object") {
    const v = (pole as Record<string, unknown>)[klic];
    return v === undefined || v === null ? undefined : String(v);
  }
  return undefined;
}

/**
 * Najde služby, které obraz JINÉ služby přeznačují na stabilní jméno
 * (`docker tag` v entrypointu nebo command), a u služby ze `SLUZBA` přečte
 * `build.labels` → `coolify.managed`.
 */
function preznaceni(soubor: string): Preznaceni[] {
  const doc = parse(readFileSync(path.join(ROOT, soubor), "utf8")) as
    | { services?: Record<string, unknown> }
    | null;
  const sluzby = doc?.services;
  if (!sluzby || typeof sluzby !== "object") return [];

  const out: Preznaceni[] = [];
  for (const [jmeno, telo] of Object.entries(sluzby)) {
    if (!telo || typeof telo !== "object") continue;
    const s = telo as Record<string, unknown>;
    const spousti = JSON.stringify([s.entrypoint ?? null, s.command ?? null]);
    if (!/docker tag /.test(spousti)) continue;
    const zdroj = hodnota(s.environment, "SLUZBA");
    const cil = zdroj === undefined ? undefined : sluzby[zdroj];
    const build =
      cil && typeof cil === "object" ? (cil as Record<string, unknown>).build : undefined;
    const labels =
      build && typeof build === "object" ? (build as Record<string, unknown>).labels : undefined;
    out.push({
      soubor,
      preznacovac: jmeno,
      zdroj,
      stitek: hodnota(labels, "coolify.managed"),
      maBuild: build !== undefined,
    });
  }
  return out;
}

describe("přeznačený obraz přežije úklid Coolify", () => {
  it("univerzum přeznačovačů není prázdné — jinak by brána mlčela z neznalosti", () => {
    expect(composeSoubory().flatMap(preznaceni).length).toBeGreaterThan(0);
  });

  it("obraz, který jiná služba přeznačuje, nese build.labels coolify.managed=true", () => {
    const popis = composeSoubory()
      .flatMap(preznaceni)
      .filter((p) => p.zdroj === undefined || !p.maBuild || p.stitek !== "true")
      .map((p) =>
        p.zdroj === undefined
          ? `${p.soubor}: '${p.preznacovac}' volá docker tag, ale nemá SLUZBA — nelze ověřit, čí obraz přeznačuje`
          : !p.maBuild
            ? `${p.soubor}: '${p.preznacovac}' přeznačuje '${p.zdroj}', která nemá build: — přeznačovat se má stavěný obraz`
            : `${p.soubor}: '${p.zdroj}' (přeznačuje ji '${p.preznacovac}') nemá build.labels coolify.managed: "true" — ` +
              `úklid Coolify stabilní jméno při nejbližším běhu odznačí`,
      )
      .join("\n");
    expect(popis).toBe("");
  });
});

describe("stavěná služba nesmí mít pevný tag", () => {
  it("univerzum není prázdné — jinak by brána mlčela z neznalosti", () => {
    const soubory = composeSoubory();
    expect(soubory.length).toBeGreaterThan(10);
    // A aspoň jeden soubor musí obsahovat `build:`, jinak pravidlo nemá co měřit.
    const sBuildem = soubory.filter((f) =>
      readFileSync(path.join(ROOT, f), "utf8").includes("build:"),
    );
    expect(sBuildem.length).toBeGreaterThan(0);
  });

  it("žádná služba nekombinuje build: s image:", () => {
    const nalezy = composeSoubory().flatMap(pevnyTagNadBuildem);
    const popis = nalezy
      .map(
        (n) =>
          `${n.soubor}: služba '${n.sluzba}' má build: i image: ${n.image} — ` +
          `Coolify ji postaví na builderu a NEPŘENESE na cíl`,
      )
      .join("\n");
    expect(popis).toBe("");
  });
});
