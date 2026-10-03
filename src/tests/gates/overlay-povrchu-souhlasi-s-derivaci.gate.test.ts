/**
 * Brána: overlay povrchu nese TYTÉŽ adresy, jaké platforma odvodí.
 *
 * ⛔ NAMĚŘENO 2026-09-13. `surfaces/<instance>/app.config.json` v instančním
 * repu nese `api.postgrest_url`, `auth.issuer` a `auth.client_id` jako
 * LITERÁLY; `apps/workbench-shell/vite.config.ts` je čte doslova a nic je
 * neporovnávalo s tím, co platforma vydává:
 *
 *   · API_DOMAIN_PUBLIC / KEYCLOAK_DOMAIN_PUBLIC — derive-domains.mjs,
 *   · KC_ISSUER = https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}
 *     — tím issuerem gateway token ověřuje (docker-compose.coolify.yml),
 *   · klient `${APP_NAME_PREFIX}-${surface}` — zakládá provision-surfaces.sh.
 *
 * U naší instance dnes hodnoty sedí (změřeno derivací s jejími vstupy), ale
 * rozejít se mohou tiše: povrch se postaví a pozná se to až na přihlašovací
 * obrazovce. Kontrola proto žije tam, kde se overlay už čte (derive-domains,
 * u kontroly existence app.config.json), a doktor (fáze S) její pád hlásí
 * jako nález — dřív ho spolkl `2>/dev/null || true` a četl jako „bez povrchů".
 *
 * CO SE MĚŘÍ (vlastnost, se sondou na každou stranu):
 *   1. porovnání samo — shoda projde, KAŽDÉ z polí rozladěné zvlášť je nález
 *      jmenující obě hodnoty; chybějící realm se PŘIZNÁ jako nezměřený;
 *   2. klient se počítá jako shell (`<sekce>.client_id ?? auth.client_id`) —
 *      pinuje se proti zdroji shellu, ne proti opisu;
 *   3. prefix PostgREST se čte ze zdroje gateway a umí selhat nahlas;
 *   4. derivace nad dočasným overlayem: shoda → výstup, nesoulad → výjimka
 *      s oběma hodnotami, realm nedeklarovaný → WARN, ne ticho; topologie na
 *      referenčních TLD (`.json.example`) se neporovnává, ale řekne to;
 *   5. doktor pád derivace v fázi S nespolkne.
 *
 * Měří se v procesu (bez podprocesu) a s izolovaným prostředím — viz
 * lib/izolovana-derivace.ts, proč bez izolace brána měří běžce.
 *
 * Spouští se přes: npm run test:gates
 */
import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";
import {
  efektivniKlient,
  gatewayRestPrefix,
  GATEWAY_SERVER_SOUBOR,
  nesouladyPovrchu,
} from "../../../scripts/lib/povrch-shoda-s-derivaci.mjs";
import {
  DEKLAROVANE_TLD,
  docasnyOverlay,
  hodnotaZVystupu,
  PROMENNA_OVERLAYE,
  sIzolovanymVstupem,
  souhlasnyAppConfig,
} from "./lib/izolovana-derivace";

const ROOT = resolve(__dirname, "../../..");
const IDENTITA = "zkouska";
const REALM = "zkouska-realm";
const POVRCH = { name: "povrch", shell: "workbench-shell", subdomain: "povrch" };
const KLIENT = `${IDENTITA}-${POVRCH.name}`;

const derivuj = () => formatShellExports(buildTopology({ profileId: "cloud-multi", meshEnabled: true })) as string;

/** Domény, které derivace profilu s DEKLAROVANÝMI TLD vydá — zdroj pravdy pro fixture. */
const ref = sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA, ...DEKLAROVANE_TLD }, derivuj);
const API = hodnotaZVystupu(ref, "API_DOMAIN_PUBLIC") ?? "";
const KC = hodnotaZVystupu(ref, "KEYCLOAK_DOMAIN_PUBLIC") ?? "";
const REST = gatewayRestPrefix(ROOT);
const souhlasny = () =>
  souhlasnyAppConfig({ apiDomena: API, keycloakDomena: KC, restPrefix: REST, realm: REALM, klient: KLIENT }) as {
    api: { postgrest_url: string };
    auth: { issuer: string; client_id: string };
    workbench?: { client_id?: string };
  };

const vstup = (config: unknown, realm = REALM) => ({
  config,
  soubor: "surfaces/zkouska/app.config.json",
  povrchy: [POVRCH],
  prefix: IDENTITA,
  apiDomena: API,
  keycloakDomena: KC,
  restPrefix: REST,
  realm,
});

const docasne: string[] = [];
afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
});

describe("overlay povrchu souhlasí s derivací topologie", () => {
  test("premisa: derivace s deklarovanými TLD vydá obě domény (jinak fixture nemá z čeho vzniknout)", () => {
    expect(API, "API_DOMAIN_PUBLIC nevydán — měřidlo je slepé").toMatch(/\./);
    expect(KC, "KEYCLOAK_DOMAIN_PUBLIC nevydán — měřidlo je slepé").toMatch(/\./);
  });

  test("shoda projde bez nálezu i bez přiznaného nezměřena", () => {
    expect(nesouladyPovrchu(vstup(souhlasny()))).toEqual({ nesoulady: [], nezmereno: [] });
    // Koncové lomítko v URL není rozdíl adresy.
    const c = souhlasny();
    c.api.postgrest_url += "/";
    expect(nesouladyPovrchu(vstup(c)).nesoulady).toEqual([]);
  });

  test("⛔ každé pole rozladěné ZVLÁŠŤ je nález, který jmenuje obě hodnoty", () => {
    // [popis, rozladění, pole v hlášce, hodnota z overlaye, odvozená hodnota]
    const pripady: [string, (c: ReturnType<typeof souhlasny>) => void, string, string, string][] = [
      ["cizí host API", (c) => (c.api.postgrest_url = `https://cizi.invalid${REST}`), "api.postgrest_url", `https://cizi.invalid${REST}`, `https://${API}${REST}`],
      ["jiná cesta PostgREST", (c) => (c.api.postgrest_url = `https://${API}/postgrest`), "api.postgrest_url", `https://${API}/postgrest`, `https://${API}${REST}`],
      ["cizí IdP", (c) => (c.auth.issuer = `https://idp.example.invalid/realms/${REALM}`), "auth.issuer", "https://idp.example.invalid", `https://${KC}/realms/${REALM}`],
      ["jiný realm", (c) => (c.auth.issuer = `https://${KC}/realms/main`), "auth.issuer", `https://${KC}/realms/main`, `https://${KC}/realms/${REALM}`],
      ["cizí klient", (c) => (c.auth.client_id = "surface-shell"), "client_id povrchu", "surface-shell", KLIENT],
      ["přepis klienta ve shellu ukazuje jinam", (c) => (c.workbench = { client_id: "jiny-klient" }), "client_id povrchu", "jiny-klient", KLIENT],
    ];
    for (const [popis, rozlad, pole, zOverlaye, zDerivace] of pripady) {
      const c = souhlasny();
      rozlad(c);
      const { nesoulady } = nesouladyPovrchu(vstup(c));
      expect(nesoulady.length, `${popis}: nesoulad nenalezen (nebo nahlášen víckrát)`).toBe(1);
      expect(nesoulady[0], `${popis}: nález nejmenuje pole`).toContain(pole);
      // Obě strany do hlášky — bez nich se oprava hádá.
      expect(nesoulady[0], `${popis}: nález nejmenuje hodnotu z overlaye`).toContain(`overlay '${zOverlaye}`);
      expect(nesoulady[0], `${popis}: nález nejmenuje odvozenou hodnotu`).toContain(`derivace '${zDerivace}'`);
    }
  });

  test("přepis klienta, který SEDÍ, je shoda (shell ho má přednost před auth.client_id)", () => {
    const c = souhlasny();
    c.auth.client_id = "sdileny-klient";
    c.workbench = { client_id: KLIENT };
    expect(nesouladyPovrchu(vstup(c)).nesoulady).toEqual([]);
  });

  test("realm nedeklarovaný: přizná se jako NEZMĚŘENO, ale původ issueru se měří dál", () => {
    const shoda = nesouladyPovrchu(vstup(souhlasny(), ""));
    expect(shoda.nesoulady).toEqual([]);
    expect(shoda.nezmereno.join("\n"), "chybějící realm se zamlčel").toMatch(/KEYCLOAK_REALM/);

    const c = souhlasny();
    c.auth.issuer = `https://idp.example.invalid/realms/${REALM}`;
    expect(nesouladyPovrchu(vstup(c, "")).nesoulady.length, "cizí IdP prošel jen proto, že realm chyběl").toBe(1);
  });

  test("prázdná derivace není shoda — je to nález", () => {
    const { nesoulady } = nesouladyPovrchu({ ...vstup(souhlasny()), apiDomena: "" });
    expect(nesoulady.join("\n")).toMatch(/derivace nevydala API_DOMAIN_PUBLIC/);
  });

  test("klient se počítá jako ve shellu — pinováno proti zdroji shellu", () => {
    const auth = readFileSync(join(ROOT, "apps/workbench-shell/src/auth.ts"), "utf8");
    expect(
      auth,
      "shell už nepočítá klienta jako `cfg.workbench?.client_id ?? cfg.auth.client_id` — " +
        "efektivniKlient() v povrch-shoda-s-derivaci.mjs modeluje jiné chování, než jaké se nasadí",
    ).toMatch(/cfg\.workbench\?\.client_id\s*\?\?\s*cfg\.auth\.client_id/);
    expect(efektivniKlient({ auth: { client_id: "a" }, workbench: { client_id: "b" } }, "workbench-shell")).toBe("b");
    expect(efektivniKlient({ auth: { client_id: "a" } }, "workbench-shell")).toBe("a");
  });

  test("prefix PostgREST se čte ze zdroje gateway — a když tam není, selže nahlas", () => {
    expect(REST, `${GATEWAY_SERVER_SOUBOR}: prefix musí být cesta`).toMatch(/^\/[^\s]+$/);
    expect(readFileSync(join(ROOT, GATEWAY_SERVER_SOUBOR), "utf8")).toContain(`prefix: '${REST}'`);

    const prazdny = mkdtempSync(join(tmpdir(), "aisha-gateway-bez-rest-"));
    docasne.push(prazdny);
    mkdirSync(join(prazdny, "services/gateway/src"), { recursive: true });
    writeFileSync(join(prazdny, GATEWAY_SERVER_SOUBOR), "await app.register(jinyPlugin, { prefix: '/x' });\n");
    expect(() => gatewayRestPrefix(prazdny)).toThrow(/restProxy/);
  });

  test("derivace nad overlayem: shoda projde, nesoulad ji SHODÍ s oběma hodnotami", () => {
    const dobry = docasnyOverlay({ profil: "cloud-multi", povrchy: [POVRCH], identita: IDENTITA, appConfig: souhlasny() });
    docasne.push(dobry);
    const out = sIzolovanymVstupem(
      { APP_NAME_PREFIX: IDENTITA, KEYCLOAK_REALM: REALM, ...DEKLAROVANE_TLD, [PROMENNA_OVERLAYE]: dobry },
      derivuj,
    );
    expect(hodnotaZVystupu(out, "SURFACE_OVERLAY_PATH")).toBe(`surfaces/${IDENTITA}`);

    const c = souhlasny();
    c.auth.issuer = `https://idp.example.invalid/realms/main`;
    const spatny = docasnyOverlay({ profil: "cloud-multi", povrchy: [POVRCH], identita: IDENTITA, appConfig: c });
    docasne.push(spatny);
    expect(() =>
      sIzolovanymVstupem(
        { APP_NAME_PREFIX: IDENTITA, KEYCLOAK_REALM: REALM, ...DEKLAROVANE_TLD, [PROMENNA_OVERLAYE]: spatny },
        derivuj,
      ),
    ).toThrow(new RegExp(`idp\\.example\\.invalid/realms/main' × derivace 'https://${KC.replace(/\./g, "\\.")}/realms/${REALM}'`));
  });

  test("derivace bez deklarovaného realmu: projde, ale NEZMĚŘENO řekne na stderr", () => {
    const dobry = docasnyOverlay({ profil: "cloud-multi", povrchy: [POVRCH], identita: IDENTITA, appConfig: souhlasny() });
    docasne.push(dobry);
    const zapisy: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      zapisy.push(String(chunk));
      return true;
    }) as never);
    try {
      sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA, ...DEKLAROVANE_TLD, [PROMENNA_OVERLAYE]: dobry }, derivuj);
    } finally {
      spy.mockRestore();
    }
    expect(zapisy.join(""), "realm se nezměřil a nikdo to neřekl").toMatch(/WARN overlay povrchu NEZMĚŘENO: realm/);
  });

  test("referenční topologie (PUBLIC_TLD z .example) se s overlayem nesrovnává — ale NAHLAS", () => {
    // Naměřeno 2026-09-13: jen AISHA_INSTANCE_CONFIG_DIR bez TLD dá topologii
    // `api.aisha.example.com` — s instančním overlayem by to byl „nesoulad",
    // jehož příčinou jsou chybějící vstupy, ne overlay. Neshodí se nic, ale
    // WARN to řekne. Kontrolní vzorek: TÝŽ rozladěný overlay s deklarovanými
    // TLD derivaci shodí (test výš) — referenční větev tedy nic nespolkne.
    const c = souhlasny();
    c.auth.issuer = "https://idp.example.invalid/realms/main";
    const spatny = docasnyOverlay({ profil: "cloud-multi", povrchy: [POVRCH], identita: IDENTITA, appConfig: c });
    docasne.push(spatny);
    const zapisy: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      zapisy.push(String(chunk));
      return true;
    }) as never);
    let out = "";
    try {
      out = sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA, KEYCLOAK_REALM: REALM, [PROMENNA_OVERLAYE]: spatny }, derivuj);
    } finally {
      spy.mockRestore();
    }
    expect(hodnotaZVystupu(out, "SURFACE_OVERLAY_PATH"), "referenční větev nesmí shodit derivaci").toBe(`surfaces/${IDENTITA}`);
    expect(zapisy.join(""), "overlay se nezměřil a nikdo to neřekl").toMatch(
      /WARN overlay povrchu NEZMĚŘENO: PUBLIC_TLD je z referenčního \.json\.example/,
    );
  });

  test("doktor (fáze S) pád derivace nespolkne a nečte ho jako „bez povrchů“", () => {
    const doktor = readFileSync(join(ROOT, "scripts/cold-start-doctor.sh"), "utf8");
    const faze = doktor.slice(doktor.indexOf('phase "S"'), doktor.indexOf("fi  # should_run_phase S"));
    expect(faze.length, "fáze S v cold-start-doctor.sh nenalezena — brána ztratila předmět").toBeGreaterThan(200);
    const kod = faze.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
    const volani = kod.split("\n").filter((r) => r.includes("derive-domains.mjs --shell"));
    expect(volani.length, "fáze S derivaci nevolá").toBeGreaterThan(0);
    for (const r of volani) {
      expect(r, "pád derivace se zahazuje (`|| true`) — vada povrchu by se ohlásila jako „bez povrchů“").not.toMatch(
        /\|\|\s*true/,
      );
      expect(r, "stderr derivace se zahazuje — nález by neměl text").not.toMatch(/2>\s*\/dev\/null/);
    }
    expect(kod, "nenulový návrat derivace musí být `fail`, ne větev „bez povrchů“").toMatch(
      /if \[\[ "\$_surf_rc" -ne 0 \]\]; then\s*\n\s*fail /,
    );
    expect(kod, "realm se doktorovi do derivace nepředává — issuer by změřil jen napůl").toMatch(
      /KEYCLOAK_REALM="\$_surf_realm" node scripts\/lib\/derive-domains\.mjs --shell/,
    );
  });
});
