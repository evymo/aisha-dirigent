/**
 * Brána: per-env doménový overlay se MUSÍ uplatnit.
 *
 * ⛔ NAMĚŘENO 2026-09-01. `aisha-cold-start-env.sh` overlay jen EXPORTUJE
 * (DOMAINS_FILE), zatímco `aisha-cold-start.sh` tutéž proměnnou vzápětí
 * bezpodmínečně přepsal na base `config/domains.env`. Overlay se tak NIKDY
 * nezdrojoval: APP_NAME_PREFIX, WEB_FQDNS, KEYCLOAK_REALM ani veřejné hostnames
 * instance se do nasazení nedostaly a Coolify si dosadil vygenerované
 * `*.<server>.<tld>` hashe (změřeno na 14 aplikacích forku).
 *
 * Tahle brána drží tři invarianty, na kterých ta oprava stojí. Každý je
 * negativně testovatelný: odeber ho a brána zčervená.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");

describe("per-env doménový overlay se uplatní", () => {
  test("overlay se zachytí DŘÍV, než se DOMAINS_FILE přepíše na base", () => {
    const capture = SRC.indexOf("DOMAINS_OVERLAY_REQUESTED=");
    const clobber = SRC.indexOf('DOMAINS_FILE="${REPO_ROOT}/config/domains.env"');
    expect(capture, "zachycení overlaye v cold-startu chybí").toBeGreaterThan(-1);
    expect(clobber, "přiřazení base DOMAINS_FILE nenalezeno").toBeGreaterThan(-1);
    expect(
      capture,
      "overlay se zachytává AŽ PO přepisu DOMAINS_FILE — v tu chvíli je hodnota z wrapperu už ztracená",
    ).toBeLessThan(clobber);
  });

  test("cesta se rozkládá AŽ PO naklonování privátního overlaye", () => {
    // ⛔ Past, na kterou jsem sám spadl při psaní téhle opravy: rozklad stál
    // ~75 řádků NAD `_fetch_instance_overlay`, takže AISHA_INSTANCE_CONFIG_DIR
    // byl prázdný a overlay v instance-data se nikdy nenašel — tiše se propadlo
    // na repo. Pořadí je invariant, ne detail.
    const fetch = SRC.indexOf("\n_fetch_instance_overlay\n");
    const resolve = SRC.indexOf('DOMAINS_OVERLAY_FILE=""');
    expect(fetch, "volání _fetch_instance_overlay nenalezeno").toBeGreaterThan(-1);
    expect(resolve, "rozklad cesty overlaye nenalezen").toBeGreaterThan(-1);
    expect(
      resolve,
      "cesta se rozkládá DŘÍV, než je overlay naklonovaný — AISHA_INSTANCE_CONFIG_DIR je v tu chvíli prázdný",
    ).toBeGreaterThan(fetch);
  });

  // ⛔ 2026-10-05 (revize, bod D): vyžádaný a nenalezený overlay už NENÍ varování,
  // ale KONEC běhu — se šablonou by krok 4 (doktor domén --apply) zapsal web jen
  // s APP_DOMAIN a smazal routy značek. Měří se CHOVÁNÍ vyříznutého bloku.
  const blokRozkladu = () => {
    const od = SRC.indexOf('  DOMAINS_OVERLAY_FILE=""\n');
    const m = /\n {2}if \[ -n "\$\{DOMAINS_OVERLAY_REQUESTED:-\}" \]; then\n[\s\S]*?\n {2}fi\n/.exec(SRC.slice(od));
    expect(od, "rozklad cesty overlaye nenalezen").toBeGreaterThan(-1);
    expect(m, "blok rozkladu overlaye nenalezen").not.toBeNull();
    return SRC.slice(od, od + m!.index + m![0].length);
  };
  const spustBlok = (pozadovany: string, overlay: string) =>
    spawnSync(
      "bash",
      ["-c", `set -uo pipefail\nerr() { printf 'ERR %s\\n' "$*"; }\nwarn() { printf 'WARN %s\\n' "$*"; }\n${blokRozkladu()}\necho "SOUBOR=$DOMAINS_OVERLAY_FILE"`],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", REPO_ROOT: ROOT, DOMAINS_OVERLAY_REQUESTED: pozadovany, AISHA_INSTANCE_CONFIG_DIR: overlay },
        timeout: 20_000,
      },
    );

  test("⛔ vyžádaný a nenalezený overlay ZASTAVÍ běh (kód 1, pojmenovaný) — žádný propad na šablonu", () => {
    const overlay = mkdtempSync(join(tmpdir(), "overlay-domen-"));
    try {
      const r = spustBlok("config/domains-neexistuje.env", overlay);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toMatch(/ERR\s+Domain overlay 'config\/domains-neexistuje\.env' requested but not found/);
      expect(r.stdout, "běh pokračoval za nenalezeným overlayem").not.toMatch(/SOUBOR=/);
    } finally {
      rmSync(overlay, { recursive: true, force: true });
    }
  });

  test("kotva: nalezený overlay (instance-data má přednost) projde a vydá cestu", () => {
    const overlay = mkdtempSync(join(tmpdir(), "overlay-domen-"));
    try {
      mkdirSync(join(overlay, "config"));
      writeFileSync(join(overlay, "config/domains-test.env"), "WEB_FQDNS=\n");
      const r = spustBlok("config/domains-test.env", overlay);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain(`SOUBOR=${join(overlay, "config/domains-test.env")}`);
    } finally {
      rmSync(overlay, { recursive: true, force: true });
    }
  });

  // ⛔ 2026-10-05 (revize 27d6f3f5e): env-doktor má pro „WEB_FQDNS neznám" vlastní
  // kód 3. Heal pass ho dřív schoval pod „missing externals (non-fatal)" — a krok 4
  // by pak srovnal domény hodnotou ze shellu, kterou doktor jako deklaraci odmítl.
  const vyhodnoceni = () => {
    const m = /\n {2}vyhodnot_env_doktora\(\) \{\n[\s\S]*?\n {2}\}\n/.exec(SRC);
    expect(m, "vyhodnot_env_doktora v cold-startu chybí").not.toBeNull();
    return m![0];
  };
  const spustVyhodnoceni = (kod: number) =>
    spawnSync("bash", ["-c", `set -uo pipefail\nerr() { printf 'ERR %s\\n' "$*"; }\nwarn() { printf 'WARN %s\\n' "$*"; }\n${vyhodnoceni()}\nvyhodnot_env_doktora ${kod}\necho POKRACUJI`], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 20_000,
    });

  test("⛔ heal pass: kód 3 env-doktora (WEB_FQDNS neznám) ZASTAVÍ cold-start, jiné kódy jako dosud nefatálně", () => {
    const tri = spustVyhodnoceni(3);
    expect(tri.status, tri.stdout + tri.stderr).toBe(1);
    expect(tri.stdout).toMatch(/ERR env-doctor: WEB_FQDNS \(domény webu\) NEZNÁ/);
    expect(tri.stdout).not.toMatch(/POKRACUJI/);
    const jedna = spustVyhodnoceni(1);
    expect(jedna.status).toBe(0);
    expect(jedna.stdout).toMatch(/WARN env-doctor skončil kódem 1/);
    expect(jedna.stdout).toMatch(/POKRACUJI/);
    expect(spustVyhodnoceni(0).stdout.trim()).toBe("POKRACUJI");
  });

  test("oba heal passy vyhodnocují kód doktora týmž místem a stojí před krokem 4", () => {
    const bezKomentaru = SRC.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
    expect([...bezKomentaru.matchAll(/vyhodnot_env_doktora "\$_env_doktor_rc"/g)]).toHaveLength(2);
    expect(bezKomentaru, "heal pass zase polyká kód doktora").not.toMatch(/aisha-env-doctor\.mjs" \|\| warn/);
    expect(SRC.lastIndexOf('vyhodnot_env_doktora "$_env_doktor_rc"')).toBeLessThan(SRC.indexOf("node scripts/coolify-domain-doctor.mjs --apply"));
  });

  test("zastavení stojí PŘED krokem 4 (doktor domén --apply)", () => {
    const blok = SRC.indexOf('  DOMAINS_OVERLAY_FILE=""\n');
    const krok4 = SRC.indexOf("node scripts/coolify-domain-doctor.mjs --apply");
    expect(krok4, "krok 4 nenalezen").toBeGreaterThan(-1);
    expect(blok).toBeLessThan(krok4);
  });

  test("overlay se SOURCUJE (kvůli kompozitům), ne jen načítá po klíčích", () => {
    // load_env_file_keys hodnoty neexpanduje → `PUBLIC_SITE_URL=https://${APP_DOMAIN}`
    // by dosedl doslovně. Overlay proto musí projít `. "$DOMAINS_OVERLAY_FILE"`.
    expect(
      SRC,
      "overlay se nikde nesourcuje — kompozitní hodnoty by zůstaly neexpandované",
    ).toMatch(/\.\s+"\$DOMAINS_OVERLAY_FILE"/);
  });

  test("precedence: overlay bije resolver, ale operátorský vault bije overlay", () => {
    const lastOverlay = SRC.lastIndexOf('. "$DOMAINS_OVERLAY_FILE"');
    const operator = SRC.indexOf('load_env_file_keys "$ENV_PROD_BACKUP" "overwrite"  # operator has the final say');
    expect(lastOverlay, "overlay se nesourcuje").toBeGreaterThan(-1);
    expect(operator, "operátorský vault se nenačítá").toBeGreaterThan(-1);
    expect(
      lastOverlay,
      "overlay se aplikuje AŽ ZA operátorským vaultem — instance by přebila operátora",
    ).toBeLessThan(operator);
  });
});
