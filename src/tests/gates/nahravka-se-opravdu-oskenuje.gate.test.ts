/**
 * Brána: nahrávka se OPRAVDU oskenuje — ne že to tvrdí konfigurace.
 *
 * ⛔ CO SE NAMĚŘILO 2026-09-21 (zdroj + živá instance `<fork>`).
 *
 * `scanAndPromote` je fail-closed orchestrace, `clamd` na instanci BĚŽÍ a odpovídá
 * `PONG` (měřeno TCP z netns storage-authu), `AV_SCAN_ENABLED=true`. A přesto se
 * neoskenovala ani jedna nahrávka, protože cesta k němu byla přerušená na TŘECH
 * nezávislých místech:
 *
 *   1. `upload-preflight` podepisoval PUT přímo do CÍLOVÉHO bucketu, zatímco
 *      `config.uploadsQuarantineBucket` tvrdil „landing bucket for EVERY pre-signed
 *      upload". Karanténní bucket na instanci existuje a měl 0 objektů — stejně jako
 *      všechny ostatní uploadové buckety, což je nezávislé potvrzení, že nahrávání
 *      nefungovalo vůbec.
 *   2. `storage_events` NIKDO nevyráběl: v repu není žádné `pg_notify('storage_events')`
 *      ani `mc event add`, a na instanci nemá `uploads-quarantine` žádnou notifikační
 *      konfiguraci.
 *   3. event-worker `storage_events` POSLOUCHÁ (v logu „Listening on PG channel"), ale
 *      nemá v prostředí `STORAGE_AUTH_URL` — jeho přeposlání na sken je pod podmínkou
 *      `config.storageAuthUrl`, takže by nevystřelilo ani s emitorem.
 *
 * ⚠️ PROČ NESTAČILA STÁVAJÍCÍ BRÁNA `remediation/av-scan-pipeline-wired`: její bod (b)
 * hledá „soubor, který zmiňuje `storage_events` A míří na sken". To splňuje sám
 * PŘÍJEMCE (relay v event-workeru) — brána tedy měřila konzumenta a říkala mu emitor.
 * Prose v její hlavičce to dokonce popisuje správně („merely relaying … does NOT count"),
 * jen to nikdy nezměřila. Zelená znamenala „existuje kód, který by to přeposlal", ne
 * „něco to spustí".
 *
 * Tahle brána proto měří SPOUŠTĚČ: kdo a kdy zavolá sken.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { storageInit } from "./lib/storage-init";

const ROOT = process.cwd();
const cti = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
/** Kód bez komentářů — próza nesmí měnit verdikt (ta past je popsaná výš). */
const bezKomentaru = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PREFLIGHT = "services/storage-auth/src/routes/upload-preflight.ts";
const ROUTY_DIR = "services/storage-auth/src/routes";
const SERVER = "services/storage-auth/src/server.ts";
const KONFIG = "services/storage-auth/src/config.ts";
const KLIENT = "src/integrations/api/storage.ts";

describe("nahrávka nekončí v cílovém bucketu bez skenu", () => {
  it("preflight podepisuje do KARANTÉNY, ne do cílového bucketu", () => {
    const src = bezKomentaru(cti(PREFLIGHT));
    // Od kola 4 (#1043) se adresa vydává přes `createUploadUrl` (PUT přes API, protože
    // presigned URL nese mesh host); `createSignedUploadUrl` zůstává jako jeho vnitřek.
    // Měří se OBĚ podoby — cíl je stejný: první argument je bucket, do kterého PUT míří.
    const podpisy = [...src.matchAll(/create(?:Signed)?UploadUrl\(\s*([^,]+),/g)].map((m) => m[1].trim());

    expect(podpisy.length, "nenašel jsem žádné podepsání PUT — brána by měřila prázdno")
      .toBeGreaterThan(0);
    expect(
      podpisy.filter((p) => !/uploadsQuarantineBucket/.test(p)),
      "každé podepsané PUT musí mířit do config.uploadsQuarantineBucket; podepsat přímo " +
        "cílový bucket znamená, že se do něj soubor dostane bez skenu",
    ).toEqual([]);
  });

  it("karanténní klíč nese cílový bucket jako první segment", () => {
    const src = bezKomentaru(cti(PREFLIGHT));
    expect(
      src,
      "klíč musí mít tvar `<durableBucket>/<userId>/<uuid>_<jméno>` — jinak promoce neví, " +
        "kam objekt patří (splitQuarantineKey na tom trvá)",
    ).toMatch(/\$\{bucket\}\/\$\{objectKey\}|\$\{durableBucket\}\/|`\$\{[A-Za-z]+\}\/\$\{objectKey\}`/);
  });
});

describe("existuje spouštěč skenu, který smí zavolat uživatel", () => {
  /**
   * Od 2026-09-23 volají sken DVA spouštěče přes jednoho pomocníka (`lib/promoce.ts`):
   * konec PUTu `/nahrani` (autorizace = podepsaný token z preflightu) a `/upload-complete`
   * (autorizace = token uživatele, pro presigned cestu). Měří se proto řetěz: pomocník
   * volá `scanAndPromote` a aspoň jedna routa, kterou volá KLIENT (ne servisní token),
   * volá pomocníka. Kopie závislostí v každé routě by se rozešly právě ve stropu skenu.
   */
  it("klientská routa spouští sken přes sdíleného pomocníka", () => {
    const pomocnik = bezKomentaru(cti("services/storage-auth/src/lib/promoce.ts"));
    expect(pomocnik, "lib/promoce.ts musí volat scanAndPromote").toMatch(/scanAndPromote\s*\(/);

    const soubory = readdirSync(join(ROOT, ROUTY_DIR)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    const klientske = soubory.filter((f) => {
      const src = bezKomentaru(cti(`${ROUTY_DIR}/${f}`));
      const autorizaceKlienta = /verifyToken\s*\(/.test(src) || /overToken\s*\(/.test(src);
      return autorizaceKlienta && /promujZKaranteny\s*\(/.test(src);
    });

    expect(
      klientske,
      "sken musí umět spustit ten, kdo nahrání dokončil. Interní routa se servisním " +
        "tokenem (scan-object) závisí na emitoru, který v repu ani na instanci neexistuje.",
    ).not.toEqual([]);
  });

  it("/nahrani spouští sken NA KONCI PUTU, když token míří do karantény", () => {
    // Tablety řidičů (1.0.0/1.1.0) `upload-complete` neznají a klíč z preflightu ukládají
    // rovnou. Bez skenu na konci PUTu by fotka zůstala v karanténě a doklad by se nikdy
    // neukázal (RIQ Driver, změřeno v mobile-app 2026-09-23).
    const src = bezKomentaru(cti(`${ROUTY_DIR}/nahrani.ts`));
    expect(src, "nahrani.ts nerozlišuje token do karantény").toMatch(/uploadsQuarantineBucket/);
    expect(src, "nahrani.ts nespouští sken").toMatch(/promujZKaranteny\s*\(/);
    expect(src, "neprovedený sken musí skončit chybou, ne 200").toMatch(/502/);
  });

  it("strop synchronního skenu je pod stropem gateway (300 s)", () => {
    const pomocnik = bezKomentaru(cti("services/storage-auth/src/lib/promoce.ts"));
    expect(pomocnik, "pomocník musí skenovat se stropem synchronní cesty").toMatch(/uploadScanBudgetMs/);
    // Strop je KONSTANTA (ne env s výchozím — fallback nad env repo nepřidává).
    const vychozi = /uploadScanBudgetMs:\s*([\d_]+)\s*,/.exec(cti(KONFIG))?.[1];
    expect(vychozi, "nenašel jsem strop jako konstantu v config.ts").toBeTruthy();
    expect(
      Number(String(vychozi).replace(/_/g, "")),
      "strop skenu musí být pod 300 s gateway — jinak rozhodne proxy useknutím, ne storage-auth",
    ).toBeLessThan(300_000);
  });

  it("spouštěč je zaregistrovaný v serveru", () => {
    expect(bezKomentaru(cti(SERVER))).toMatch(/uploadCompleteRoute/);
  });

  it("spouštěč ověřuje vlastnictví z KLÍČE, ne z těla požadavku", () => {
    const src = bezKomentaru(cti(`${ROUTY_DIR}/upload-complete.ts`));
    expect(src, "vlastník se čte z karanténního klíče").toMatch(/user\.userId/);
    expect(src, "cizí klíč musí skončit 403").toMatch(/403/);
    expect(src, "nedokončená promoce musí skončit 502, ne úspěchem").toMatch(/nedokonceno[\s\S]{0,400}502/);
  });

  it("klient po PUT ohlásí dokončení — jinak objekt zůstane v karanténě", () => {
    const src = bezKomentaru(cti(KLIENT));

    // Samotné volání smí žít v pomocné funkci (sdílí ho obecný upload i zdravotní
    // dokumenty) — proto se pořadí NEMĚŘÍ přes celý soubor, ale UVNITŘ těla metody
    // `upload`: tam musí být PUT a až po něm ohlášení. Měřit pozice přes soubor by
    // znamenalo, že přesun kódu do funkce bránu rozsvítí bez změny chování.
    expect(src, "klient nikde nevolá /upload-complete").toMatch(/\/storage\/v1\/upload-complete/);

    const od = src.indexOf("async upload(");
    expect(od, "v klientovi nevidím metodu upload()").toBeGreaterThan(-1);
    const telo = src.slice(od, src.indexOf("async remove(", od));
    const put = telo.indexOf("method: 'PUT'");
    const ohlaseni = telo.search(/dokonciNahrani\s*\(|upload-complete/);

    expect(put, "upload() nePUTne bajty na podepsanou adresu").toBeGreaterThan(-1);
    expect(ohlaseni, "upload() nikde neohlásí dokončení").toBeGreaterThan(-1);
    expect(ohlaseni > put, "ohlášení musí následovat PO nahrání bajtů").toBe(true);
  });
});

describe("karanténa se z ničeho neservíruje a existuje", () => {
  it("karanténní bucket není mezi veřejnými ani privátními", () => {
    const src = cti(KONFIG);
    const verejne = /publicBuckets:\s*new Set\(\[([^\]]*)\]/.exec(src)?.[1] ?? "";
    const privatni = /privateBuckets:\s*new Set\(\[([^\]]*)\]/.exec(src)?.[1] ?? "";
    for (const [jmeno, blok] of [["publicBuckets", verejne], ["privateBuckets", privatni]] as const) {
      expect(
        /uploads-quarantine/.test(blok),
        `${jmeno} nesmí obsahovat karanténní bucket — servírovala by se neoskenovaná data`,
      ).toBe(false);
    }
  });

  // Měří se DEKLARACE storage-init (STORAGE_BUCKETS jádrového compose), ne text
  // příkazů: buckety zakládá jediný vstupní bod správy úložiště, ne `mc mb`.
  // Veřejné čtení karanténa mít nesmí ani tam.
  it("karanténní bucket zakládá storage-init jádra a není veřejně čitelný", () => {
    const { sluzba, buckety, verejne } = storageInit(ROOT);
    expect(buckety.size, "deklarace bucketů se nepřečetla — měření by bylo slepé").toBeGreaterThan(5);
    expect([...buckety], `${sluzba}: STORAGE_BUCKETS nezakládá karanténu`).toContain("uploads-quarantine");
    expect([...verejne], `${sluzba}: karanténa je ve STORAGE_PUBLIC_READ`).not.toContain("uploads-quarantine");
  });
});

describe("deklarovaná záložní cesta nesmí být slepá", () => {
  /**
   * event-worker přeposílá `storage_events` na sken jen `if (config.storageAuthUrl)`.
   * Na instanci ta proměnná NEBYLA (naměřeno v env kontejneru), takže ta větev
   * nemohla nikdy vystřelit — a přitom v kódu vypadá zapojeně. Když cesta v kódu je,
   * musí být deklarovaná i v compose; jinak patří pryč.
   */
  it("event-worker má v compose STORAGE_AUTH_URL, když na sken přeposílá", () => {
    const worker = bezKomentaru(cti("services/event-worker/src/worker.ts"));
    if (!/scan-object/.test(worker)) return; // cesta neexistuje → není co deklarovat

    // ⛔ Služba NEŽIJE v docker-compose.coolify.yml (první verze téhle brány tam
    // hledala a našla prázdno). Compose je rozdělený na soubory podle vln, takže se
    // prohledají všechny — jinak by verdikt závisel na tom, ve kterém souboru zrovna
    // služba je.
    const composeSoubory = readdirSync(join(ROOT, "."))
      .filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
      .map((f) => cti(f))
      .filter((src) => /^\s{2}event-worker:/m.test(src));

    expect(
      composeSoubory.length,
      "službu event-worker nenašel v žádném compose souboru — brána by měřila prázdno",
    ).toBeGreaterThan(0);

    expect(
      composeSoubory.some((src) => /STORAGE_AUTH_URL/.test(src)),
      "event-worker přeposílá storage_events na sken, ale STORAGE_AUTH_URL mu compose " +
        "nedává — podmínka `config.storageAuthUrl` tu větev tiše vypne",
    ).toBe(true);
  });
});
