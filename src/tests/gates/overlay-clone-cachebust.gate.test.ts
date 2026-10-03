/**
 * Gate: KAŽDÝ `git clone` overlaye v Dockerfilu musí mít cachebust.
 *
 * ⛔ Vada, kterou to hlídá, je tichá a nasazovací:
 * BuildKit kešuje vrstvu podle TEXTU příkazu. Text klonu se mezi nasazeními
 * nemění (URL i cesta jsou tytéž), takže `git clone` proběhne JEDNOU a pak už
 * nikdy — v obrazu zůstane obsah instančního repa ze dne prvního buildu.
 * Build přitom projde zeleně, kontejner nastartuje, nic nespadne. Naměřeno
 * 2026-08-02 na Dockerfile.keycloak: přepsané téma se do obrazu nedostalo,
 * přejímka ukázala soubory smazané o hodinu dřív.
 *
 * Táž třída jako „deploy přijat, ale neproveden" — a u vzhledu je horší, protože
 * jediný důkaz je oko: nasazení hlásí úspěch a povrch vypadá „nějak postaru".
 *
 * Brána je ZÁMĚRNĚ generická. Nehlídá tři konkrétní soubory, ale vlastnost:
 * najde v repu každý Dockerfile, který klonuje z URL dodané build argumentem,
 * a vyžádá si u něj proměnnou hodnotu + fail-closed kontrolu. Čtvrtý overlay
 * tak past nezdědí, aniž by si toho někdo všiml.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next",
]);

/**
 * ⭐ CIZÍ PRACOVNÍ KOPIE SE POZNÁ PODLE `.git`, NE PODLE JMÉNA.
 *
 * Do 2026-08-04 stál v `SKIP_DIRS` výčet jmen (`wt-rls-perf`, `wt-overlay`) —
 * dopsaný ručně vždycky, když někoho potkal další. Naměřeno: v pracovním stromu
 * ležel navíc `wt-narok/` (kopie repa z 2026-08-02), který ve výčtu nebyl,
 * a brána v něm našla Dockerfily ⇒ **8 falešných pádů** a zablokované nasazení.
 * Jméno adresáře je volba člověka, kdežto „je to jiná pracovní kopie" je
 * VLASTNOST — a ta se dá změřit: vnořený `.git` (adresář u klonu, soubor
 * u worktree).
 *
 * Brána má měřit TENHLE repozitář, ne všechno, co leží na disku vedle.
 */
function jeCiziPracovniKopie(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function findDockerfiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (full !== ROOT && jeCiziPracovniKopie(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // rozbitý symlink / závod se souborovým systémem
    }
    if (st.isDirectory()) findDockerfiles(full, acc);
    else if (entry.startsWith("Dockerfile")) acc.push(full);
  }
  return acc;
}

/** RUN blok (včetně pokračovacích řádků), který obsahuje `git clone`. */
function cloneRunBlocks(dockerfile: string): string[] {
  const lines = dockerfile.split("\n");
  const blocks: string[] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (cur) {
      // Dockerfile parser komentářové řádky uvnitř pokračování zahazuje —
      // musíme taky, jinak nám blok skončí uprostřed příkazu.
      if (/^\s*#/.test(line)) continue;
      cur.push(line);
      if (!line.trimEnd().endsWith("\\")) {
        blocks.push(cur.join("\n"));
        cur = null;
      }
      continue;
    }
    if (/^\s*RUN\s/.test(line)) {
      cur = [line];
      if (!line.trimEnd().endsWith("\\")) {
        blocks.push(cur.join("\n"));
        cur = null;
      }
    }
  }
  return blocks.filter((b) => /git\s+clone/.test(b));
}

const dockerfiles = findDockerfiles(ROOT)
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf-8") }))
  // Zajímají nás jen klony ŘÍZENÉ build argumentem — ty jsou instanční kanál.
  // Klon pevné veřejné závislosti (verze v textu) se cache chová správně.
  .filter((f) => cloneRunBlocks(f.text).some((b) => /\$\{?[A-Z_]*(GIT_URL|REPO_URL)/.test(b)));

describe("overlay clone cachebust", () => {
  it("v repu je aspoň jeden overlay klon — jinak brána měří nad prázdnem", () => {
    // Bez tohohle by brána zezelenala i ve chvíli, kdy by se regexp rozešel
    // se skutečností a nenašel nic ([[brana-si-univerzum-hleda-nepise]]).
    expect(dockerfiles.length).toBeGreaterThan(0);
  });

  for (const { path, text } of dockerfiles) {
    describe(path, () => {
      const blocks = cloneRunBlocks(text);

      it("klon má v příkazu proměnnou, která se mezi nasazeními mění", () => {
        for (const block of blocks) {
          expect(
            /CACHEBUST/.test(block),
            `RUN s 'git clone' v ${path} nepoužívá žádnou *CACHEBUST proměnnou — ` +
              `BuildKit vrstvu zakešuje a overlay se nasadí jen jednou`
          ).toBe(true);
        }
      });

      it("prázdný cachebust build ZASTAVÍ, místo tichého starého obsahu", () => {
        for (const block of blocks) {
          expect(
            /-z\s+"\$[A-Z_]*CACHEBUST"|-n\s+"\$[A-Z_]*CACHEBUST"/.test(block) &&
              /exit 1/.test(block),
            `${path}: chybí fail-closed kontrola prázdného cachebustu`
          ).toBe(true);
        }
      });

      it("cachebust je deklarovaný jako ARG (jinak se do klíče keše nedostane)", () => {
        expect(text).toMatch(/^ARG\s+[A-Z_]*CACHEBUST=/m);
      });

      it("do logu jde otisk obsahu — jinak z hotového buildu nepoznáš, co v něm je", () => {
        for (const block of blocks) {
          expect(
            /md5sum|sha256sum|shasum/.test(block),
            `${path}: klon nezapisuje otisk obsahu do logu`
          ).toBe(true);
        }
      });
    });
  }
});

/*
  KAŽDÁ CESTA NASAZENÍ OBNOVUJE CACHEBUST — ne jen ta ruční.

  ⛔ NAMĚŘENO 2026-09-23 (<fork>-source-broker, nasazení z CI po sloučení
  brokeru): build padl v kroku `source-adapters`, protože
  `SOURCE_ADAPTER_OVERLAY_CACHEBUST` byl prázdný. `refresh-overlay-cachebust.sh`
  volal jen ruční `deploy.yml`; cesta CI (`deploy-and-verify.sh`, kterou jdou
  core/edge/extranet i všechny vlny) ho nevolala. Skript si to přitom píše
  do hlavičky: „aby na cestě nasazení nezáleželo".

  Měří se: obě cesty ho volají, v `deploy-and-verify.sh` DŘÍV než se spustí
  build (`/api/v1/deploy`), a úlohy s řídkým checkoutem ho mají staženého
  i s pomocníkem `overlay-cachebust.sh` — jinak by volání tiše nenašlo soubor.
*/
describe("každá cesta nasazení obnovuje cachebust před buildem", () => {
  const DAV = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
  const bezKomentaru = (t: string) =>
    t
      .split("\n")
      .filter((r) => !r.trim().startsWith("#"))
      .join("\n");

  it("deploy-and-verify.sh volá refresh-overlay-cachebust.sh — a DŘÍV než spustí build", () => {
    const kod = bezKomentaru(DAV);
    const volani = kod.indexOf("scripts/deploy/refresh-overlay-cachebust.sh");
    const build = kod.indexOf("/api/v1/deploy?uuid=");
    expect({ volani: volani >= 0, predBuildem: volani >= 0 && build >= 0 && volani < build }).toEqual({
      volani: true,
      predBuildem: true,
    });
  });

  it("ruční deploy.yml ho volá dál", () => {
    expect(bezKomentaru(readFileSync(join(ROOT, ".forgejo/workflows/deploy.yml"), "utf8"))).toContain(
      "scripts/deploy/refresh-overlay-cachebust.sh",
    );
  });

  it("ruční deploy.yml má oba skripty cachebustu v řídkém checkoutu (jinak volání tiše nenajde soubor)", () => {
    // NAMĚŘENO 2026-09-23 (run 51695): „bash: scripts/deploy/refresh-overlay-cachebust.sh:
    // No such file or directory" → jen ::warning:: a nasazení pokračovalo se starým cachebustem.
    const dy = readFileSync(join(ROOT, ".forgejo/workflows/deploy.yml"), "utf8");
    const blok = /sparse-checkout: \|\n((?: {12}\S.*\n)+)/.exec(dy)?.[1] ?? "";
    expect({
      refresh: blok.includes("scripts/deploy/refresh-overlay-cachebust.sh"),
      pomocnik: blok.includes("scripts/deploy/overlay-cachebust.sh"),
    }).toEqual({ refresh: true, pomocnik: true });
  });

  it("žádná cesta nespouští nasazení GETem — Coolify na GET vrací 405 a nenasadí nic", () => {
    const cesty = [".forgejo/workflows/deploy.yml", ".forgejo/workflows/ci.yml", "scripts/ci/deploy-and-verify.sh"];
    const get = cesty.filter((c) => /-X\s+GET\s+"[^"]*\/api\/v1\/deploy\?/.test(bezKomentaru(readFileSync(join(ROOT, c), "utf8"))));
    expect(get).toEqual([]);
  });

  it("úlohy, které stahují deploy-and-verify.sh řídce, stahují i oba skripty cachebustu", () => {
    const ci = readFileSync(join(ROOT, ".forgejo/workflows/ci.yml"), "utf8");
    const bloky = [...ci.matchAll(/sparse-checkout: \|\n((?: {12}\S.*\n)+)/g)].map((m) => m[1]);
    const sDeployem = bloky.filter((b) => b.includes("scripts/ci/deploy-and-verify.sh"));
    expect(sDeployem.length).toBeGreaterThan(0);
    const chybi = sDeployem.filter(
      (b) => !b.includes("scripts/deploy/refresh-overlay-cachebust.sh") || !b.includes("scripts/deploy/overlay-cachebust.sh"),
    );
    expect(chybi).toEqual([]);
  });
});

/*
  CACHEBUST MLUVÍ PRAVDU — a má čím číst HEAD.

  ⛔ NAMĚŘENO 2026-09-24 (CI běh 51874, riq main 3e0886282, `Deploy: Extranet`
  i `Deploy: Core`):
      ::warning::SURFACE_OVERLAY_CACHEBUST: HEAD overlay repa se nepodařilo přečíst …
      PROVEDENO: refresh-overlay-cachebust.sh doběhl před buildem
  Dvě vady naráz: (1) deploy joby neměly FORGEJO_TOKEN, takže `git ls-remote`
  soukromého overlay repa selhal; (2) skript přesto skončil 0 — smyčka běžela
  v rouře (podskořepina) a neúspěch byl jen `continue` — a souhrn z toho udělal
  „PROVEDENO". Core i extranet se postavily z KEŠOVANÉHO overlaye.

  Měří se chování, ne text: skript se pustí proti zastrčenému `curl`
  (envy aplikace) a `git` (soukromé repo = ls-remote projde JEN s tokenem v URL).
*/
describe("cachebust mluví pravdu a má čím číst HEAD", () => {
  const bezKomentaru = (t: string) =>
    t
      .split("\n")
      .filter((r) => !r.trim().startsWith("#"))
      .join("\n");

  function ulohy(yml: string): Array<{ jmeno: string; telo: string }> {
    const casti = yml.split(/\n(?= {2}[a-zA-Z0-9_-]+:\n)/);
    return casti
      .map((c) => ({ jmeno: /^\s*([a-zA-Z0-9_-]+):\n/.exec(c)?.[1] ?? "", telo: c }))
      .filter((u) => u.jmeno);
  }

  it("každá úloha, která nasazuje přes deploy-and-verify / vlny / refresh, dostává FORGEJO_TOKEN", () => {
    const bezTokenu: string[] = [];
    let nasazujicich = 0;
    for (const wf of [".forgejo/workflows/ci.yml", ".forgejo/workflows/deploy.yml"]) {
      for (const u of ulohy(readFileSync(join(ROOT, wf), "utf8"))) {
        const kod = bezKomentaru(u.telo);
        const nasazuje =
          /bash scripts\/ci\/deploy-and-verify\.sh|bash scripts\/ci\/nasad-podle-vln\.sh|bash scripts\/deploy\/refresh-overlay-cachebust\.sh/.test(kod);
        if (!nasazuje) continue;
        nasazujicich++;
        if (!/^\s+FORGEJO_TOKEN:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}\s*$/m.test(kod)) bezTokenu.push(`${wf}:${u.jmeno}`);
      }
    }
    // Nula nasazujících úloh by podmínku splnila triviálně.
    expect(nasazujicich).toBeGreaterThanOrEqual(6);
    expect(bezTokenu).toEqual([]);
  });

  it("ruční deploy.yml rozliší kód 3 (NEDOKÁZÁNO) od chyby zadání — nesplývají v jedné větě", () => {
    // Recenze aisha-team 2026-09-24: `|| echo "::warning::…nepodařilo obnovit"` dávalo
    // kódu 1 (chybí COOLIFY_API_TOKEN/BASE_URL = konfigurace k opravě) i kódu 3 TUTÉŽ větu.
    const kod = bezKomentaru(readFileSync(join(ROOT, ".forgejo/workflows/deploy.yml"), "utf8"));
    const blok = /case "\$CB_RC" in([\s\S]*?)esac/.exec(kod)?.[1] ?? "";
    expect({
      tri: /^\s*3\)\s*echo "::warning title=cachebust NEDOKÁZÁN::/m.test(blok),
      jinak: /^\s*\*\)\s*echo "::error title=cachebust: chyba zadání::/m.test(blok),
      zadneSlitiRourou: !/refresh-overlay-cachebust\.sh "\$UUID" "\$STACK"\s*\\?\s*\n?\s*\|\|\s*echo/.test(kod),
    }).toEqual({ tri: true, jinak: true, zadneSlitiRourou: true });
  });

  it("refresh nezahazuje stderr pomocníka a pomocník volá ls-remote mimo workspace", () => {
    // Běh 1528: `2>/dev/null` schoval „could not read Password" a extraheader
    // z actions/checkout přebil token v URL, protože ls-remote běžel ve workspace.
    const refresh = bezKomentaru(readFileSync(join(ROOT, "scripts/deploy/refresh-overlay-cachebust.sh"), "utf8"));
    const pomocnik = bezKomentaru(readFileSync(join(ROOT, "scripts/deploy/overlay-cachebust.sh"), "utf8"));
    const volani = refresh.split("\n").filter((r) => r.includes("overlay-cachebust.sh\" \"$URL\""));
    const lsRemote = pomocnik.split("\n").filter((r) => /\bgit\b.*\bls-remote\b/.test(r));
    expect({
      volani: volani.length,
      zahazuje: volani.some((r) => r.includes("2>/dev/null")),
      lsRemote: lsRemote.length > 0,
      mimoWorkspace: lsRemote.every((r) => /git -C "\$NEUTRAL"/.test(r)),
      bezDevNull: lsRemote.every((r) => !r.includes("2>/dev/null")),
    }).toEqual({ volani: 1, zahazuje: false, lsRemote: true, mimoWorkspace: true, bezDevNull: true });
  });

  it("souhrn deploy-and-verify řekne DOKÁZÁNO jen na kód 0 a NEDOKÁZÁNO na kód 3", () => {
    const kod = bezKomentaru(readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8"));
    const blok = /case "\$CACHEBUST_RC" in([\s\S]*?)esac/.exec(kod)?.[1] ?? "";
    expect({
      nula: /^\s*0\)\s*CACHEBUST_STAV="DOKÁZÁNO/m.test(blok),
      tri: /^\s*3\)\s*CACHEBUST_STAV="NEDOKÁZÁNO/m.test(blok),
      // „PROVEDENO podle toho, že skript doběhl" se vrátit nesmí.
      zadneProvedeno: !/CACHEBUST_STAV="PROVEDENO/.test(kod),
    }).toEqual({ nula: true, tri: true, zadneProvedeno: true });
  });
});
