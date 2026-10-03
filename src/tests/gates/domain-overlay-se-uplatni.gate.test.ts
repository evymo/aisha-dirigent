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
import { readFileSync } from "node:fs";
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

  test("nenalezený, ale vyžádaný overlay se ohlásí — nepropadne tiše", () => {
    // Tichý propad je přesně ta třída vady, kterou tahle brána hlídá.
    expect(
      SRC,
      "chybí varování, když je overlay vyžádaný a nenajde se",
    ).toMatch(/warn\s+"\s*Domain overlay '\$\{DOMAINS_OVERLAY_REQUESTED\}' requested but not found/);
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
