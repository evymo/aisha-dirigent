/**
 * Brána: schopnost „zařízení“ (tablety s Kiosk Adminem) je VOLITELNÁ a drží
 * kontrakt po celé dráze: data instance → hák (databáze) → storage-auth, a CI
 * „Kiosk: balíčky z CI“ jako producent artefaktů v téže deklaraci.
 *
 * PROČ: majitel 2026-09-18 — schopnost se staví koncepčně v upstreamu, volitelně
 * přes data instance, zapnutá jen u instance, která ji chce. Každý článek umí
 * selhat TIŠE: šablona, která ji rozsvítí všem; producent, jehož výstup
 * storage-auth neumí přečíst (administrace pak řekne „vypnuto“ u instance, která
 * ji zapnula); druhý zdroj pravdy vedle databáze.
 *
 * 2026-09 (PR-B2): env `ZARIZENI_HLIDAC` a jeho derivace doktorem odešly spolu
 * se čtenářem; storage-auth čte deklaraci jen z databáze.
 *
 * Měří se bez podprocesů: pravidlo producenta (lib/zarizeni-deklarace.mjs,
 * scripts/ci/kiosk-balicky.mjs) a čtení v storage-auth (lib/zarizeni.ts) se
 * volají přímo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { normalizuj } from "../../../scripts/lib/zarizeni-deklarace.mjs";
import { nactiDeklaraci } from "../../../scripts/ci/kiosk-balicky.mjs";
import { overZarizeni, zeSuroveDeklarace } from "../../../services/storage-auth/src/lib/zarizeni";
import { storageInit } from "./lib/storage-init";

const ROOT = process.cwd();
const VZOR = readFileSync(path.join(ROOT, "apps/hlidac/hlidac.example.json"), "utf8");
const OTISK = "4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00";
const identita = (zmena: Record<string, unknown> = {}) =>
  JSON.stringify({ ...JSON.parse(VZOR), signing: { certSha256: OTISK }, ...zmena });
const soubory = (mapa: Record<string, string>) => (cesta: string) => mapa[cesta] ?? null;
const profil = (zarizeni: unknown) => [{ soubor: "profiles/x.json", obsah: JSON.stringify(zarizeni === undefined ? {} : { zarizeni }) }];
const DEKL = { hlidac: "zarizeni/hlidac.json" };

describe("deklarace v datech instance (producent)", () => {
  it("bez deklarace je schopnost vypnutá a nic se nečte", () => {
    expect(nactiDeklaraci({ profily: profil(undefined), cti: () => { throw new Error("nemá číst"); } })).toBeNull();
  });

  it("platnou deklaraci storage-auth přečte z databáze jako zapnutou", () => {
    const d = nactiDeklaraci({ profily: profil(DEKL), cti: soubory({ "zarizeni/hlidac.json": identita() }) });
    // Hák ji zapíše DOSLOVNĚ — konzument dostane týž objekt, který producent ověřil.
    const stav = zeSuroveDeklarace(d!.j);
    expect(stav.zapnuto).toBe(true);
    if (stav.zapnuto) {
      expect(stav.hlidac).toMatchObject({
        applicationId: "com.example.hlidac",
        kioskPackage: "com.example.kiosk",
        certSha256: OTISK,
        versionCode: 1,
        timeZone: "Europe/Prague",
      });
    }
  });

  it("`zdroj` balíčků (Kiosk Admin i appky) projde až ke storage-auth; co konzument odmítne, producent nepustí", () => {
    const zdroj = "https://registr.example.test/api/packages/org/generic/kiosk/1.1.0-14/kiosk.apk";
    const appka = { balicek: "com.example.kiosk", versionCode: 14, versionName: "1.1.0", sha256: "a".repeat(64), zdroj };
    const surova = JSON.parse(identita({ apk: { sha256: "b".repeat(64), zdroj }, appky: [appka] }));
    expect(() => normalizuj(surova)).not.toThrow();
    expect(zeSuroveDeklarace(surova)).toMatchObject({ zapnuto: true, hlidac: { apkZdroj: zdroj, appky: [{ balicek: "com.example.kiosk", zdroj }] } });
    for (const spatny of ["http://registr.example.test/x.apk", "https://a:b@registr.example.test/x.apk"]) {
      expect(() => normalizuj(JSON.parse(identita({ appky: [{ ...appka, zdroj: spatny }] })))).toThrow(/zdroj/);
    }
    // Zdroj bez otisku nejde ověřit → producent ho nepustí.
    expect(() => normalizuj(JSON.parse(identita({ apk: { zdroj } })))).toThrow(/apk\.zdroj/);
  });

  it("vadná deklarace je CHYBA nahlas, ne tiché vypnutí", () => {
    const ok = soubory({ "zarizeni/hlidac.json": identita() });
    expect(() => nactiDeklaraci({ profily: profil("zarizeni/hlidac.json"), cti: ok })).toThrow(/objekt/);
    expect(() => nactiDeklaraci({ profily: profil({ ...DEKL, hlidač: 1 }), cti: ok })).toThrow(/jen klíč/);
    expect(() => nactiDeklaraci({ profily: profil({ hlidac: "../mimo/hlidac.json" }), cti: ok })).toThrow(/uvnitř dat instance/);
    expect(() => nactiDeklaraci({ profily: profil({ hlidac: "/etc/passwd" }), cti: ok })).toThrow(/uvnitř dat instance/);
    expect(() => nactiDeklaraci({ profily: profil({ hlidac: "zarizeni/jiny.json" }), cti: ok })).toThrow(/soubor v datech instance není/);
    // Vzor identity má otisk null — bez něj QR nevznikne, takže to musí spadnout.
    expect(() => nactiDeklaraci({ profily: profil({ hlidac: "v.json" }), cti: soubory({ "v.json": VZOR }) })).toThrow(/certSha256/);
  });
});

describe("parita: producent (CI a data instance) = konzument (storage-auth z databáze)", () => {
  // ⛔ JEDNO PRAVIDLO, DVA JAZYKY. Z téhož `hlidac.json` musí producent i konzument
  //    vyrobit TOTÉŽ — jinak by CI deklarovalo něco, co storage-auth vypne, nebo
  //    obráceně. Třetí kopie v SQL záměrně není (hák zapisuje doslovně).
  const zdroj = "https://registr.example.test/api/packages/org/generic/kiosk/1.1.0-14/kiosk.apk";
  const varianty: Record<string, Record<string, unknown>> = {
    "vzor": {},
    "se zdrojem u appky i Kiosk Admina": {
      apk: { sha256: "B".repeat(64), zdroj },
      appky: [{ balicek: "com.example.kiosk", versionCode: 14, versionName: "1.1.0", sha256: "A".repeat(64), zdroj }],
    },
    "bez appek a bez výbavy": { appky: undefined, vybava: undefined },
    "⛔ neúplné dveře": { vybava: { apiUrl: "https://api.example.cz", knock: { host: "k.example.cz", port: 7443 } } },
    "⛔ http zdroj": { appky: [{ balicek: "com.example.kiosk", versionCode: 1, versionName: "1", sha256: "a".repeat(64), zdroj: "http://x.example/a.apk" }] },
    "⛔ vadný otisk podpisu": { signing: { certSha256: "abc" } },
    "s otiskem podpisu appky (ověřuje CI)": {
      appky: [{ balicek: "com.example.kiosk", versionCode: 14, versionName: "1.1.0", sha256: "a".repeat(64), certSha256: OTISK.toLowerCase() }],
    },
    "⛔ vadný otisk podpisu appky": {
      appky: [{ balicek: "com.example.kiosk", versionCode: 14, versionName: "1.1.0", sha256: "a".repeat(64), certSha256: "abc" }],
    },
  };
  for (const [jmeno, zmena] of Object.entries(varianty)) {
    it(jmeno, () => {
      const surova = JSON.parse(identita(zmena));
      let producent: ReturnType<typeof overZarizeni>;
      try {
        producent = overZarizeni(normalizuj(surova));
      } catch {
        producent = { zapnuto: false, chyba: "producent odmítl" };
      }
      const konzument = zeSuroveDeklarace(surova);
      expect(konzument.zapnuto, `producent: ${JSON.stringify(producent)}\nkonzument: ${JSON.stringify(konzument)}`).toBe(producent.zapnuto);
      if (producent.zapnuto && konzument.zapnuto) expect(konzument.hlidac).toEqual(producent.hlidac);
    });
  }
});

describe("výchozí stav platformy", () => {
  it("žádná platformní šablona profilu schopnost nerozsvítí", () => {
    const dir = path.join(ROOT, "config/profiles");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const profil = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      expect(profil.zarizeni, `config/profiles/${f}`).toBeUndefined();
    }
  });
});

describe("dráha klíčů k storage-auth", () => {
  const compose = readFileSync(path.join(ROOT, "docker-compose.coolify-domain-services.yml"), "utf8");
  const sekce = compose.slice(compose.indexOf("\n  storage-auth:"), compose.indexOf("healthcheck:", compose.indexOf("\n  storage-auth:")));

  // Prázdné smí být jen to, co prázdné něco ZNAMENÁ: presigned záloha pro
  // lokální vývoj. Tajemství, které platforma sama generuje, musí selhat
  // nahlas (brána coolify-compose-compliance).
  it.each(["STORAGE_PUBLIC_URL"])(
    "compose storage-auth jmenuje %s s prázdným výchozím (prázdné = záloha)",
    (klic) => {
      expect(sekce).toMatch(new RegExp(`\\b${klic}: \\$\\{${klic}:-\\}`));
    },
  );

  // Tajemství: ani `:-` (tiše prázdné — coolify-compose-compliance), ani `:?`
  // (vtáhne ho do build-time množiny a zapeče do `docker history` —
  // build-time-mnozina-vsech-compose). Holé `${…}` doručí sync-envs za běhu.
  it("tajemství nahrávacích tokenů jde holým ${…}, ne do buildu ani tiše prázdné", () => {
    expect(sekce).toMatch(/\bSTORAGE_UPLOAD_TOKEN_SECRET: \$\{STORAGE_UPLOAD_TOKEN_SECRET\}\n/);
  });

  it("veřejná adresa storage se skládá z API_DOMAIN_PUBLIC, ne z mesh jména MinIA", () => {
    const domeny = readFileSync(path.join(ROOT, "config/domains.env"), "utf8");
    expect(domeny).toMatch(/^STORAGE_PUBLIC_URL=https:\/\/\$\{API_DOMAIN_PUBLIC\}\/storage\/v1$/m);
  });

  // ⛔ Naměřeno 2026-09-25: jako `static` doktor zachoval PRÁZDNOU uloženou hodnotu
  // při každém apply, takže instance s prázdným řádkem v trezoru nahrávala na mesh
  // host navždy. `derived` ji srovná s odvozením; jiné rozhodnutí operátora patří
  // do .env-prod-backup, které dom() čte jako první.
  it("doktor vede STORAGE_PUBLIC_URL jako odvozený klíč, ne jako static", () => {
    const doktor = readFileSync(path.join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    expect(doktor).toMatch(/\["STORAGE_PUBLIC_URL", "derived", domZTopologie\("STORAGE_PUBLIC_URL"\)\]/);
  });

  // ⛔ Naměřeno 2026-09-25: `dom()` rozvíjí šablonu jen proti process.env, a bez
  // exportované topologie by doktor zapsal `https://${API_DOMAIN_PUBLIC:-}/storage/v1`.
  // Složenina se proto rozvíjí proti topologii a nerozvinutá šablona se nezapíše nikdy.
  it("odvozená hodnota se šablonou ${…} se nezapisuje a složenina se rozvíjí proti topologii", () => {
    const doktor = readFileSync(path.join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    const fn = doktor.slice(doktor.indexOf("function domZTopologie("), doktor.indexOf("function domZTopologie(") + 1500);
    expect(fn, "rozvíjí proti topologii").toMatch(/derivedTopo\(n\)/);
    expect(fn, "chybějící proměnná = prázdné, ne šablona").toMatch(/return chybi \? "" : hodnota;/);
    expect(doktor, "drift se šablonou se nezapíše").toMatch(/!String\(rest\[0\] \?\? ""\)\.includes\("\$\{"\)/);
  });

  // Bucket si zakládá storage-auth sám při prvním nahrání, a jen tam, kde je
  // schopnost zapnutá — instance bez schopnosti nemá mít prázdný bucket navíc.
  // (Původně i kvůli stropu ARG_MAX jádra, riq 34 993 / 35 000 B.) Měří se
  // deklarace storage-init (STORAGE_BUCKETS), ne text příkazů.
  it("bucket pro hlídače NEzakládá jádrový compose, ale storage-auth", () => {
    const { buckety } = storageInit(ROOT);
    expect(buckety.size, "deklarace bucketů se nepřečetla — měření by bylo slepé").toBeGreaterThan(5);
    expect([...buckety]).not.toContain("zarizeni");
    const trasa = readFileSync(path.join(ROOT, "services/storage-auth/src/routes/zarizeni.ts"), "utf8");
    expect(trasa).toMatch(/zajistiBucket\(config\.zarizeniBucket\)/);
  });

  // ⛔ JEDEN ZDROJ (PR-B2). Env `ZARIZENI_HLIDAC` a jeho derivace odešly spolu se
  //    čtenářem. Kdyby se kterýkoli článek vrátil, vznikla by druhá pravda vedle
  //    databáze — přesně ta „záloha“, kterou zákon o fallbackech zakazuje.
  it("storage-auth čte deklaraci jen z databáze; ZARIZENI_HLIDAC nikdo nedoručuje ani nečte", () => {
    expect(sekce).not.toMatch(/ZARIZENI_HLIDAC/);
    const doktor = readFileSync(path.join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    expect(doktor).not.toMatch(/\["ZARIZENI_HLIDAC"/);
    const derivace = readFileSync(path.join(ROOT, "scripts/lib/derive-domains.mjs"), "utf8");
    expect(derivace).not.toMatch(/ZARIZENI_HLIDAC/);
    const zdrojSa = ["config.ts", "routes/zarizeni.ts", "lib/zdroj-deklarace.ts", "lib/zarizeni.ts", "server.ts"]
      .map((f) => readFileSync(path.join(ROOT, "services/storage-auth/src", f), "utf8")).join("\n");
    expect(zdrojSa).not.toMatch(/process\.env\.ZARIZENI_HLIDAC/);
    const trasa = readFileSync(path.join(ROOT, "services/storage-auth/src/routes/zarizeni.ts"), "utf8");
    expect(trasa).toMatch(/deklaraceZDb\(/);
  });
});
