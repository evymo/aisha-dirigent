/**
 * Úpravy Coolify mají v repu domov — a ten domov je úplný
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * `infra/coolify/` musí nést deklaraci verze, aplikační i zachytávací skript a
 * aspoň jeden diff. Každý diff musí být čitelný unified patch, který jmenuje
 * soubor pod `app/`.
 *
 * ── PROČ (naměřeno 2026-09-05 na Talosu) ──────────────────────────────────────
 * Šest PHP souborů Coolify bylo upravených POUZE v zapisovatelné vrstvě
 * běžícího kontejneru:
 *
 *     obraz kontejneru  = sha256:f76979ac…  ==  tag coollabsio/coolify:4.3.16
 *     náš text v OBRAZU:     0×      v KONTEJNERU: 4×
 *     patch skript v obrazu: žádný   cron/systemd na hostiteli: žádný
 *
 * Na těch úpravách visí přenos obrazů na cílový uzel, chunkování compose přes
 * ARG_MAX a ochrany disku — tedy nasazování VŠECH instancí. Jeden
 * `--force-recreate` je smaže a nasazení se rozbije způsobem, který vypadá
 * jako úplně jiná porucha.
 *
 * ⭐ TŘÍDA: co běží mimo pipeline, musí mít v repu aspoň domov. Táž jako
 * `infra/sentry` a `infra/ci-runner`, jen s největším dosahem.
 *
 * ── CO TAHLE BRÁNA NEOVĚŘUJE ─────────────────────────────────────────────────
 * ⚠️ Že NASAZENÝ Coolify odpovídá těmhle diffům. Na to by musela sáhnout na
 * Talos, a brány běží offline. Od toho je `apply-coolify-patch.sh --check`,
 * který se spouští na tom stroji. Tady se měří, že domov existuje a je úplný.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const KDE = join(ROOT, "infra/coolify");

describe("úpravy Coolify mají v repu domov", () => {
  it("deklarace verze existuje a jmenuje kontejner i obraz", () => {
    const p = join(KDE, "coolify.env");
    expect(existsSync(p), "chybí infra/coolify/coolify.env").toBe(true);
    const src = readFileSync(p, "utf8");
    // ⛔ Bez verze je diff neaplikovatelný: patch je proti KONKRÉTNÍ vrstvě.
    expect(src, "coolify.env musí deklarovat COOLIFY_CONTAINER").toMatch(/^COOLIFY_CONTAINER=\S+/m);
    expect(src, "coolify.env musí deklarovat COOLIFY_IMAGE i s tagem").toMatch(/^COOLIFY_IMAGE=\S+:\S+/m);
  });

  it("oba skripty existují a odmítnou běžet bez deklarace", () => {
    for (const s of ["apply-coolify-patch.sh", "capture.sh"]) {
      const p = join(KDE, s);
      expect(existsSync(p), `chybí infra/coolify/${s}`).toBe(true);
      const src = readFileSync(p, "utf8");
      expect(src, `${s} musí číst coolify.env`).toContain("coolify.env");
      // Stráž nad chybějící deklarací i nad neshodou verze — bez nich by se
      // patch aplikoval naslepo na cizí verzi.
      expect(src, `${s} musí skončit, když deklarace chybí`).toMatch(/exit 2/);

      // ⛔ MĚŘÍ SE VLASTNOST, NE PŘÍTOMNOST ŘETĚZCE. První podoba téhle brány
      // hledala jen `COOLIFY_IMAGE` kdekoli v souboru — a mutace, která
      // nahradila povinnou deklaraci fallbackem (`${COOLIFY_IMAGE:-neco}`),
      // ji NESHODILA: proměnná v souboru pořád byla, jen už nic nehlídala.
      // Vyžaduje se tedy trojice: povinná deklarace, ZJIŠTĚNÍ běžícího obrazu
      // a NENULOVÝ konec při neshodě.
      expect(src, `${s} musí deklaraci vyžadovat, ne dosazovat`).toMatch(
        /:\s*"\$\{COOLIFY_IMAGE:\?[^}]*\}"/,
      );
      expect(src, `${s} musí zjistit, na čem kontejner BĚŽÍ`).toMatch(
        /docker inspect[^\n]*\.Config\.Image/,
      );
      expect(src, `${s} musí při neshodě verze skončit nenulově`).toMatch(
        /!=\s*"\$COOLIFY_IMAGE"[\s\S]{0,400}?exit [1-9]/,
      );
    }
  });

  it("diffy existují a každý jmenuje soubor pod app/", () => {
    const dir = join(KDE, "diff");
    expect(existsSync(dir), "chybí infra/coolify/diff/").toBe(true);
    const patche = readdirSync(dir).filter((f) => f.endsWith(".patch"));
    // Prázdný adresář by bránu uspokojil mlčením — proto spodní mez.
    expect(patche.length, "v infra/coolify/diff/ není žádný patch").toBeGreaterThan(0);

    const spatne: string[] = [];
    for (const f of patche) {
      const src = readFileSync(join(dir, f), "utf8");
      if (!/^--- /m.test(src) || !/^\+\+\+ /m.test(src)) spatne.push(`${f}: není unified diff`);
      // Jméno kóduje cestu PODTRŽÍTKY (`app_Jobs_X.php.patch`), protože je to
      // jeden soubor na disku, ne strom — `apply` si ji zpátky přeloží přes
      // `tr '_' '/'`. Hledat tu `app/` je chyba měřidla, ne dat.
      if (!/^app_.+\.php\.patch$/.test(f)) spatne.push(`${f}: jméno nekóduje cestu pod app/`);
      if (!/^@@ /m.test(src)) spatne.push(`${f}: nemá jediný hunk`);
    }
    expect(spatne.join("\n")).toBe("");
  });

  it("narovnání vlastníka běží jako ROOT a ověření jako APP USER", () => {
    // ⛔ Naměřeno 2026-09-05: `docker cp` zapsal uid 501 / mód 600, `chown` pod
    // výchozím www-data spadl a `set -e` ukončil skript PŘED `php -l`. Coolify by
    // deploy job nenačetl. Stráž: chown+chmod přes `-u 0`, php -l BEZ `-u 0`.
    const src = readFileSync(join(KDE, "apply-coolify-patch.sh"), "utf8");
    expect(src, "chown/chmod musí běžet jako root (-u 0)").toMatch(
      /docker exec -u 0 [^\n]*chown [^\n]*chmod 644/,
    );
    expect(src, "php -l musí běžet jako app user (bez -u 0)").toMatch(
      /^\s*docker exec "\$COOLIFY_CONTAINER" php -l/m,
    );
    // ⛔ POŘADÍ SE MĚŘÍ NA PŘÍKAZECH, NE NA TEXTU. První verze brala
    // `indexOf("php -l")` — a trefila KOMENTÁŘ o řádek výš, který ten řetězec
    // cituje (naměřeno 2026-09-05: 3146 < 3161, brána červená na správném
    // skriptu). Dnes potřetí táž třída: vzor, který nepočítá s tím, kde text
    // bydlí. Kotvy na začátek řádku míří na skutečné příkazy.
    const iChown = src.search(/^\s*docker exec -u 0 /m);
    const iLint = src.search(/^\s*docker exec "\$COOLIFY_CONTAINER" php -l/m);
    expect(iChown, "příkaz chown nenalezen").toBeGreaterThanOrEqual(0);
    expect(iLint, "příkaz php -l nenalezen").toBeGreaterThanOrEqual(0);
    expect(iChown, "chown musí předcházet php -l").toBeLessThan(iLint);
  });

  it("runbook vysvětluje, co se stane po bumpu verze", () => {
    const p = join(KDE, "README.md");
    expect(existsSync(p), "chybí infra/coolify/README.md").toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src, "README musí popsat postup po bumpu verze").toMatch(/capture/i);
    expect(src, "README musí říct, že se spouští na tom stroji").toMatch(/ssh talos/i);
  });
});
