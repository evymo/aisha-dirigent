/**
 * REMEDIATION GATE — GW-08: the AV scan→promote pipeline must be wired end-to-end.
 *
 * CONTRACT
 * --------
 * `scanAndPromote` (services/storage-auth/src/lib/upload-scan-promote.ts) is the
 * FAIL-CLOSED orchestration that streams a freshly-uploaded quarantine object to
 * clamd and promotes it to its durable bucket only when clean. For that logic to
 * protect anything in production TWO things must be true:
 *
 *   (a) PRODUCTION CALLER — a registered route in services/storage-auth/src
 *       (e.g. /internal/scan-object) invokes `scanAndPromote`. A caller that
 *       lives ONLY in the module's own *.test.ts / *.it.test.ts files means the
 *       scanner is dead code: uploads are never scanned in prod.
 *
 *   (b) EMITTER OF `storage_events` — something actually triggers that route when
 *       an object lands. Either a `pg_notify('storage_events', …)` in aisha/db/sql
 *       OR a bucket-notification / event-worker consumer that routes the
 *       `storage_events` channel to the scan endpoint. The event-worker LISTENs on
 *       `storage_events` today but only relays it to a websocket redis channel
 *       (`ws:storage`) — it never drives the scan. That is NOT an emitter for this
 *       contract; the scan is never invoked.
 *
 * STAV 2026-09-21: (a) má produkčního volajícího (routa /internal/scan-object) a (b) se
 * měří jinak — viz rozvahu u toho testu. Původní KNOWN-RED text zůstává jako záznam
 * toho, proč brána vznikla.
 *
 * KNOWN-RED (the reason this gate exists):
 *   • scanAndPromote has NO production caller — only its own unit + integration
 *     tests reference it; no route under services/storage-auth/src/routes calls it.
 *   • Nothing emits `storage_events` toward the scanner: no pg_notify in the SQL
 *     source, and the event-worker branch for `storage_events` fans out to
 *     `ws:storage`, not to /internal/scan-object.
 *
 * A fix (register the scan route + wire an emitter) turns this GREEN.
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/av-scan-pipeline-wired.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STORAGE_AUTH_SRC = path.resolve(ROOT, "services/storage-auth/src");
const DB_SQL_DIR = path.resolve(ROOT, "aisha/db/sql");
const EVENT_WORKER_SRC = path.resolve(ROOT, "services/event-worker/src");

/** The scanner module's own path — a self-reference is a definition, not a caller. */
const SCANNER_MODULE = path.resolve(
  STORAGE_AUTH_SRC,
  "lib/upload-scan-promote.ts",
);

/** Recursively collect .ts files under a dir (skips node_modules / dist). */
function collectTs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** A test file (unit or integration) — a caller here is NOT a production caller. */
function isTestFile(file: string): boolean {
  return /\.(test|it\.test|spec)\.ts$/.test(path.basename(file));
}

/** References `scanAndPromote` as a call/import, not merely inside a comment line. */
function referencesScanAndPromote(src: string): boolean {
  return src
    .split("\n")
    .some(
      (line) =>
        !line.trimStart().startsWith("*") &&
        !line.trimStart().startsWith("//") &&
        /\bscanAndPromote\b/.test(line),
    );
}

describe("GW-08 — AV scan→promote pipeline is wired end-to-end", () => {
  it("(a) scanAndPromote has a PRODUCTION caller (a route, not just its own tests)", () => {
    // Every non-test .ts under services/storage-auth/src except the scanner
    // module's own definition — a self-reference is the export, not a caller.
    const productionCallers = collectTs(STORAGE_AUTH_SRC)
      .filter((f) => f !== SCANNER_MODULE && !isTestFile(f))
      .filter((f) => referencesScanAndPromote(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));

    expect(
      productionCallers,
      `scanAndPromote must be invoked by a PRODUCTION route under ` +
        `services/storage-auth/src (e.g. /internal/scan-object). Found no ` +
        `non-test caller — the scanner is dead code and uploads are never ` +
        `scanned in production.`,
    ).not.toHaveLength(0);
  });

  /**
   * ⛔ ZMĚNA TVRZENÍ, NE ÚSTUPEK (2026-09-21).
   *
   * Bod (b) hledal „soubor, který zmiňuje `storage_events` A míří na sken". To ale
   * splňuje sám PŘÍJEMCE — relay v event-workeru. Brána tedy měřila konzumenta
   * a říkala mu emitor: zelená znamenala „existuje kód, který by to přeposlal", ne
   * „něco ten sken spustí". Próza v hlavičce to popisovala správně
   * („merely relaying … does NOT count"), jen to nikdy neměřila.
   *
   * Naměřeno na instanci `<fork>`: `uploads-quarantine` existuje a má 0 objektů,
   * žádnou notifikační konfiguraci, a event-worker nemá v prostředí `STORAGE_AUTH_URL`
   * (jeho přeposlání je pod `if (config.storageAuthUrl)`), takže ta větev nemohla nikdy
   * vystřelit. Přitom `clamd` běží a odpovídá PONG.
   *
   * SPOUŠTĚČ je proto jen jedno z těchto tří, a relay se NEPOČÍTÁ:
   *   1. `pg_notify('storage_events', …)` v SQL SoT,
   *   2. routa ve storage-auth, kterou volá UŽIVATEL po dokončení nahrání
   *      (`verifyToken` + `scanAndPromote`) — dnešní cesta,
   *   3. notifikace z MinIO na karanténní bucket deklarovaná v compose (`mc event add`).
   */
  it("(b) něco sken SPOUSTÍ, když objekt dopadne (pg_notify, routa po dokončení nahrání, nebo notifikace MinIO) — relay se nepočítá", () => {
    const sqlFiles = collectSql(DB_SQL_DIR);
    const pgNotifyEmitter = sqlFiles.some((f) =>
      /pg_notify\s*\(\s*['"]storage_events['"]/.test(fs.readFileSync(f, "utf8")),
    );

    // Forma 2: routa storage-authu, kterou volá KLIENT (token uživatele nebo podepsaný
    // nahrávací token, ne servisní token) a která sken spustí — přímo, nebo přes
    // sdíleného pomocníka `promujZKaranteny` (lib/promoce.ts, od 2026-09-23), který
    // `scanAndPromote` volá. Pomocník bez volání scanAndPromote se nepočítá.
    const routeDir = path.resolve(STORAGE_AUTH_SRC, "routes");
    const promoce = path.resolve(STORAGE_AUTH_SRC, "lib/promoce.ts");
    const pomocnikSkenuje =
      fs.existsSync(promoce) && /\bscanAndPromote\s*\(/.test(fs.readFileSync(promoce, "utf8"));
    const userTriggered = fs.existsSync(routeDir)
      ? fs
          .readdirSync(routeDir)
          .filter((f) => f.endsWith(".ts") && !isTestFile(f))
          .some((f) => {
            const src = fs.readFileSync(path.join(routeDir, f), "utf8");
            const klient = /\bverifyToken\s*\(/.test(src) || /\boverToken\s*\(/.test(src);
            const skenuje =
              /\bscanAndPromote\s*\(/.test(src) || (pomocnikSkenuje && /\bpromujZKaranteny\s*\(/.test(src));
            return klient && skenuje;
          })
      : false;

    // Forma 3: notifikace z MinIO na karanténní bucket, deklarovaná v compose.
    const composeFiles = fs
      .readdirSync(ROOT)
      .filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
      .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"));
    const minioNotify = composeFiles.some((src) => /mc\s+event\s+add/.test(src));

    expect(
      pgNotifyEmitter || userTriggered || minioNotify,
      `Sken nikdo NESPOUSTÍ. Relay v event-workeru je konzument, ne spouštěč — a na ` +
        `instanci navíc nemá STORAGE_AUTH_URL, takže je i tak slepý. Čekám jedno z: ` +
        `pg_notify('storage_events') v SQL, routu po dokončení nahrání (verifyToken + ` +
        `scanAndPromote), nebo 'mc event add' pro karanténní bucket v compose.`,
    ).toBe(true);
  });
});

/** Recursively collect .sql files under a dir. */
function collectSql(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSql(full));
    else if (entry.name.endsWith(".sql")) out.push(full);
  }
  return out;
}
