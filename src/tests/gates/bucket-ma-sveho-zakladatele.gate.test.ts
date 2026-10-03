/**
 * Gate: bucket, který někdo v běhu OSLOVUJE, musí někdo při nasazení ZALOŽIT.
 *
 * ⛔ NAMĚŘENO 2026-09-06 na produkci. `storage-auth` cílí každý presigned PUT do
 * `uploads-quarantine` a čistý objekt promuje do jeho trvalého bucketu (mimo jiné
 * `entity-evidence`). V MinIO instance bylo 13 bucketů a ANI JEDEN z těch dvou:
 * `minio-init` je nezakládal. První upload by tedy skončil na `NoSuchBucket` —
 * a protože scan→promote je fail-closed, objekt by zůstal ležet v karanténě,
 * která neexistuje.
 *
 * Je to táž třída jako mrtvý resolver: jméno vypadá platně (config ho zná, kód se
 * na něj odkazuje), ale na druhé straně není nikdo. Rozdíl proti překlepu je, že
 * tady se nic nerozbije při startu — rozbije se to až u prvního uživatele.
 *
 * ⭐ TVRZENÍ JE VLASTNOST, NE SEZNAM: kdo bucket jmenuje, ten ho musí mít mezi
 * zakládanými. Přidat bucket do konfigurace služby tedy nutně znamená přidat ho
 * i do deklarace `STORAGE_BUCKETS` — jinak brána spadne dřív, než se to dozví uživatel.
 *
 * Zakládá `storage-init` (docker/minio/Dockerfile, cíl `mc`) podle env služby
 * `minio-init`; čte se přes lib/storage-init.ts — TENTÝŽ vstup, který dostane skript.
 *
 * Zdroje jmen (obojí je KÓD, ne próza):
 *   · services/storage-auth/src/config.ts — publicBuckets / privateBuckets /
 *     uploadsQuarantineBucket (default v `??`),
 *   · docker-compose.coolify*.yml — cíle sidecarů dopravy: rclone remote
 *     `<remote>:<bucket>/…` (remote = RCLONE_CONFIG_<JMÉNO>_TYPE: s3 v téže službě),
 *     aby doprava balíků nespoléhala na bucket, který nevznikne.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CORE_COMPOSE, akceNaBucket, envMapa, storageInit } from "./lib/storage-init";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const STORAGE_CONFIG = "services/storage-auth/src/config.ts";

/** Text bez komentářů — komentář není chování (viz agent-si-pamatuje-identitu). */
const bezKomentaru = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*(\/\/|#|\*)/.test(r))
    .join("\n");

/** Buckety, které storage-init v jádru zakládá (deklarace `STORAGE_BUCKETS`). */
function zakladane(): Set<string> {
  return storageInit(ROOT).buckety;
}

/** Buckety, které storage-auth deklaruje ve své konfiguraci. */
function zeStorageAuth(): Map<string, string> {
  if (!existsSync(join(ROOT, STORAGE_CONFIG))) return new Map();
  const src = bezKomentaru(read(STORAGE_CONFIG));
  const out = new Map<string, string>();
  for (const blok of ["publicBuckets", "privateBuckets"]) {
    const m = new RegExp(`${blok}:\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
    if (!m) continue;
    for (const b of m[1]!.matchAll(/'([a-z0-9][a-z0-9.-]*)'/g)) out.set(b[1]!, `storage-auth ${blok}`);
  }
  const q = /uploadsQuarantineBucket:[^\n]*\?\?\s*'([a-z0-9][a-z0-9.-]*)'/.exec(src);
  if (q) out.set(q[1]!, "storage-auth uploadsQuarantineBucket");
  return out;
}

/** S3 remoty rclone, které si služba skládá z env (`RCLONE_CONFIG_<JMÉNO>_TYPE: s3`). */
export function s3Remoty(env: Record<string, string>): string[] {
  return Object.entries(env)
    .map(([k, v]) => [k.match(/^RCLONE_CONFIG_([A-Z0-9_]+)_TYPE$/)?.[1], v.trim()] as const)
    .filter(([jmeno, typ]) => jmeno && typ === "s3")
    .map(([jmeno]) => jmeno!.toLowerCase());
}

/** Buckety v příkazu: `<remote>:<bucket>` na řádku s `rclone`. */
export function bucketyVPrikazu(prikaz: string, remoty: readonly string[]): string[] {
  const out: string[] = [];
  for (const radek of bezKomentaru(prikaz).split("\n").filter((r) => /\brclone\b/.test(r))) {
    for (const remote of remoty) {
      // ⛔ ARGUMENT, NE PODŘETĚZEC (táž past jako u mc aliasu 2026-09-06): remote stojí
      // na začátku argumentu — `/drop/export` ani `[drop-sync]` bucket nejsou.
      for (const m of radek.matchAll(new RegExp(`(?:^|[\\s"'])${remote}:([a-z0-9][a-z0-9.-]*)`, "g"))) out.push(m[1]!);
    }
  }
  return out;
}

/** Buckety, na které míří sidecary dopravy v compose. */
function zeSidecaru(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.yml$/.test(x))) {
    const doc = parseYaml(read(f)) as { services?: Record<string, { environment?: unknown; entrypoint?: unknown; command?: unknown }> } | null;
    for (const [jmeno, sluzba] of Object.entries(doc?.services ?? {})) {
      const remoty = s3Remoty(envMapa(sluzba?.environment));
      if (!remoty.length) continue;
      const prikaz = [sluzba.entrypoint, sluzba.command].flat().filter((x) => typeof x === "string").join("\n");
      for (const b of bucketyVPrikazu(prikaz, remoty)) out.set(b, `${f} › ${jmeno}`);
    }
  }
  return out;
}

describe("objektové úložiště — kdo bucket jmenuje, ten ho musí i zakládat", () => {
  const zaklada = zakladane();

  test("storage-init vůbec nějaké buckety zakládá (jinak brána nic neměří)", () => {
    expect(zaklada.size, `${CORE_COMPOSE} nedeklaruje STORAGE_BUCKETS — detekce se rozešla se skutečností`)
      .toBeGreaterThan(5);
  });

  test("detektor vidí dopravu balíků (sidecary míří aspoň na ingest-drop)", () => {
    // Prázdná mapa sidecarů = třetí test níž zelený z nedostatku vstupu.
    expect([...zeSidecaru().keys()]).toContain("ingest-drop");
  });

  test("veřejné čtení se nastavuje jen na bucket, který vzniká", () => {
    const { verejne } = storageInit(ROOT);
    expect(verejne.size, "STORAGE_PUBLIC_READ je prázdné — archive-scans/email-assets/product-images čte web anonymně").toBeGreaterThan(0);
    expect([...verejne].filter((b) => !zaklada.has(b))).toEqual([]);
  });

  test("každý bucket z konfigurace storage-auth má svého zakladatele", () => {
    const chybi = [...zeStorageAuth().entries()]
      .filter(([b]) => !zaklada.has(b))
      .map(([b, kde]) => `${b} (${kde})`);
    expect(
      chybi,
      "Tyhle buckety služba OSLOVUJE, ale storage-init je nezakládá — první upload skončí\n" +
        "na NoSuchBucket a fail-closed promote nechá objekt v karanténě, která neexistuje.\n" +
        `Náprava: doplnit bucket do STORAGE_BUCKETS služby minio-init v ${CORE_COMPOSE}.`,
    ).toEqual([]);
  });

  test("každý bucket, na který míří sidecar dopravy, má svého zakladatele", () => {
    const chybi = [...zeSidecaru().entries()]
      .filter(([b]) => !zaklada.has(b))
      .map(([b, kde]) => `${b} (${kde})`);
    expect(
      chybi,
      "Sidecar by zrcadlil do bucketu, který nevznikne — doprava balíků by tiše stála.",
    ).toEqual([]);
  });
});

/**
 * ── Druhá půlka téhož tvrzení: kdo bucket SLEDUJE, musí na něj mít právo sledovat.
 *
 * ⛔ NAMĚŘENO 2026-09-07 na produkci, hodinu po nasazení. Sidecar `ingest-drop-pull`
 * běžel, healthcheck (`pgrep -f 'mc mirror'`) hlásil healthy — a zrcadlil NULU:
 *
 *     mc: <ERROR> Failed to perform mirroring Access Denied.
 *
 * Izolováno třemi dotazy z téhož kontejneru týmž klíčem:
 *   · `mc ls drop/ingest-drop`                 → PROŠLO (klíč i ListBucket v pořádku)
 *   · `mc mirror` BEZ `--watch`                → PROŠLO (jen prázdný prefix)
 *   · `mc mirror --watch`                      → Access Denied
 *
 * `--watch` neposlouchá data, ale UDÁLOSTI: otevírá ListenNotification, což je
 * vlastní akce MinIO mimo obvyklou čtyřku Get/Put/List/Delete. Politika dávala
 * všechno pro data a nic pro události, takže selhala jen ta jedna cesta — a to
 * tiše, protože proces žije dál a healthcheck se ptá jen na jeho existenci.
 *
 * ⭐ TÁŽ TŘÍDA JAKO BUCKET BEZ ZAKLADATELE, JEN O PATRO VÝŠ: jméno existuje,
 * data existují, chybí PRÁVO na druhé straně — a pozná se to až u toho, kdo
 * na ně sáhne. Proto tvrzení, ne seznam: kdo v compose napíše `--watch` nad
 * bucketem, ten mu musí v politice přidat i naslouchání.
 */
describe("objektové úložiště — kdo bucket sleduje, musí mít právo na jeho události", () => {
  /** Buckety, které nějaký sidecar sleduje přes `mc mirror --watch`. */
  function sledovane(): Map<string, string> {
    const out = new Map<string, string>();
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.yml$/.test(x))) {
      const src = bezKomentaru(read(f));
      for (const m of src.matchAll(/mc\s+mirror[^\n]*--watch[^\n]*?(?:^|\s)drop\/([a-z0-9][a-z0-9.-]*)/g)) {
        out.set(m[1]!, f);
      }
    }
    return out;
  }

  // Politika omezeného klíče (STORAGE_SCOPED_POLICY_JSON) — bucket-level akce,
  // tedy statementy, jejichž Resource míří na SAMOTNÝ bucket (ListenNotification).
  const politika = storageInit(ROOT).politika;

  test("politika omezeného klíče se přečte a dává něco na ingest-drop (měřidlo není slepé)", () => {
    expect(politika?.jmeno).toBe("ingest-drop-rw");
    expect(akceNaBucket(politika, "ingest-drop")).toContain("s3:ListBucket");
  });

  test("každý sledovaný bucket má v politice ListenNotification", () => {
    const chybi = [...sledovane().entries()]
      .filter(([b]) => !akceNaBucket(politika, b).some((a) => /ListenN|ListenBucketN|s3:\*/.test(a)))
      .map(([b, kde]) => `${b} (${kde} používá --watch, politika v ${CORE_COMPOSE} nedává naslouchání)`);
    expect(
      chybi,
      "Sidecar sleduje bucket, na jehož UDÁLOSTI nemá právo. `mc mirror --watch` skončí\n" +
        "na 'Access Denied', ale proces běží dál — healthcheck 'pgrep mc mirror' ho vidí\n" +
        "jako zdravého a doprava tiše zrcadlí nulu.\n" +
        "Náprava: přidat 's3:ListenNotification' do statementu s Resource arn:aws:s3:::<bucket>\n" +
        "(STORAGE_SCOPED_POLICY_JSON služby minio-init).",
    ).toEqual([]);
  });
});

describe("detektor cílů dopravy — sebetest", () => {
  test("remote se bere jen z RCLONE_CONFIG_<JMÉNO>_TYPE: s3", () => {
    expect(s3Remoty({ RCLONE_CONFIG_DROP_TYPE: "s3", RCLONE_CONFIG_NC_TYPE: "webdav", X: "s3" })).toEqual(["drop"]);
  });

  test("bucket je argument remote:bucket, ne lokální cesta ani log", () => {
    const prikaz = [
      'echo "[drop-sync] drop -> bucket"',
      "rclone copy /drop/export drop:ingest-drop/$${INGEST_DROP_PREFIX} 2>&1",
      "timeout 300 rclone copy drop:jiny-bucket/export /drop",
      "# rclone copy drop:v-komentari /x",
    ].join("\n");
    expect(bucketyVPrikazu(prikaz, ["drop"])).toEqual(["ingest-drop", "jiny-bucket"]);
  });
});

describe("objektové úložiště — prázdný zdroj není porucha dopravy", () => {
  /**
   * ⛔ NAMĚŘENO 2026-09-20 na jedné instanci forku: `ingest-drop-pull` hlásil 29 hodin
   * „zrcadlení selhalo (rc=1)" a Coolify držel celou appku `source-broker` jako
   * `unhealthy` — přitom broker i mesh-ingress vedle byly zdravé. Příčina nebyla
   * v dopravě: do bucketu nikdo ještě nenahrál první balík, takže prefix neexistoval
   * a `mc mirror` na něj odpověděl „Object does not exist".
   *
   * Vlastnost, ne jméno: smyčka, která zrcadlí PREFIX v bucketu, musí odlišit
   *   · bucket neodpovídá  → porucha doručení (značka se NEZAPÍŠE, hlásí se),
   *   · bucket odpovídá, prefix zatím není → není co vézt (značka se zapíše).
   * Bez toho sonda „poslední doručení" měří NEPŘÍTOMNOST OBSAHU jako výpadek
   * dopravy a instance bez ingestu je trvale nemocná.
   */
  type Nastroj = "mc" | "rclone";

  /**
   * Který nástroj TAHÁ z prefixu v bucketu (zdroj = `drop…`, cíl = lokální adresář).
   * Publikace do bucketu (local-ingest: `rclone copy /drop/export drop:…`) sem nepatří —
   * tam je remote CÍL, ne zdroj.
   */
  function nastrojTahuZPrefixu(src: string): Nastroj | null {
    if (/mc\s+mirror[^\n]*\sdrop\/[a-z0-9.-]+\/\$\$?\{[A-Z_]*PREFIX/.test(src)) return "mc";
    if (/rclone\s+(?:copy|sync)\s+(?:--?[\w-]+(?:[= ]\S+)?\s+)*drop:[a-z0-9.-]+\/\$\$?\{[A-Z_]*PREFIX/.test(src)) return "rclone";
    return null;
  }

  /**
   * mc: prázdný prefix vrací rc=1 („Object does not exist") — smyčka ho musí rozlišit sama.
   * rclone: rozliší ho nástroj (NAMĚŘENO 2026-09-25 proti MinIO z docker/minio: neexistující
   * prefix v existujícím bucketu rc=0; neexistující bucket rc=3; nedostupný endpoint i špatný
   * klíč rc=1) — DOKUD ho nikdo nepřepne na `--error-on-no-transfer`, které z prázdného
   * přenosu dělá rc=9. Měří se tedy to, co by vlastnost zrušilo.
   */
  function rozlisujePrazdnyPrefix(telo: string, nastroj: Nastroj): boolean {
    if (nastroj === "mc") return /does not exist/.test(telo) && /mc\s+ls\s+drop\//.test(telo);
    return !/--error-on-no-transfer|RCLONE_ERROR_ON_NO_TRANSFER/.test(telo);
  }

  test("detektor smyček — sebetest (tah z prefixu ano, publikace do bucketu ne)", () => {
    expect(nastrojTahuZPrefixu("timeout 300 rclone copy drop:ingest-drop/$${INGEST_DROP_PREFIX} /drop")).toBe("rclone");
    expect(nastrojTahuZPrefixu("rclone copy --retries 1 drop:ingest-drop/${INGEST_DROP_PREFIX} /drop")).toBe("rclone");
    expect(nastrojTahuZPrefixu("rclone copy /drop/export drop:ingest-drop/$${INGEST_DROP_PREFIX}")).toBeNull();
    expect(nastrojTahuZPrefixu("mc mirror --overwrite drop/ingest-drop/$${INGEST_DROP_PREFIX} /drop")).toBe("mc");
    expect(rozlisujePrazdnyPrefix("rclone copy drop:b/$${X_PREFIX} /drop", "rclone")).toBe(true);
    expect(rozlisujePrazdnyPrefix("rclone copy --error-on-no-transfer drop:b/$${X_PREFIX} /drop", "rclone")).toBe(false);
    expect(rozlisujePrazdnyPrefix("mc mirror drop/b/$${X_PREFIX} /drop", "mc")).toBe(false);
  });

  function smyckyZrcadleni(): { soubor: string; telo: string; nastroj: Nastroj }[] {
    const out: { soubor: string; telo: string; nastroj: Nastroj }[] = [];
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.yml$/.test(x))) {
      const src = read(f);
      // Měří se JEN smyčka, která TAHÁ z prefixu v bucketu a píše značku posledního
      // doručení (sonda „poslední doručení"). Smyčka, která naopak PUBLIKUJE
      // z lokálního adresáře do bucketu (local-ingest), má prázdný zdroj jinde —
      // chybí adresář na disku, ne prefix v bucketu — a je to jiná otázka.
      const nastroj = nastrojTahuZPrefixu(src);
      if (!nastroj) continue;
      if (!/drop-sync\.ok/.test(src)) continue;
      out.push({ soubor: f, telo: src, nastroj });
    }
    return out;
  }

  test("smyčka zrcadlení prefixu rozlišuje prázdný prefix od nedostupného bucketu", () => {
    const smycky = smyckyZrcadleni();
    expect(smycky.length, "žádná smyčka zrcadlení — brána by tvrdila prázdno").toBeGreaterThan(0);
    const bez = smycky
      .filter(({ telo, nastroj }) => !rozlisujePrazdnyPrefix(telo, nastroj))
      .map(({ soubor }) => soubor);
    expect(
      bez,
      "Smyčka zrcadlení bere prázdný prefix jako poruchu dopravy.\n" +
        "Dokud nikdo nenahraje první balík, `mc mirror` vrátí rc=1 (Object does not exist),\n" +
        "značka posledního doručení se nezapíše a sonda označí kontejner — a s ním celou\n" +
        "appku — za nemocný, ačkoli doprava funguje.\n" +
        "Náprava (mc): po nenulovém rc ověřit `mc ls drop/<bucket>`; když bucket ODPOVÍDÁ a\n" +
        "chybí jen prefix, zapsat značku (doručeno nic) a zahlásit to jednou.\n" +
        "Náprava (rclone): nepřepínat na `--error-on-no-transfer` / RCLONE_ERROR_ON_NO_TRANSFER —\n" +
        "prázdný prefix pak končí rc=9 a sonda měří nepřítomnost obsahu jako výpadek.",
    ).toEqual([]);
  });
});
