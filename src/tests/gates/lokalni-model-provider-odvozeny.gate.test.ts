/**
 * Brána: provider `vllm-local` se odvozuje z topologie — a ta hodnota k migrate DOJDE.
 *
 * ⛔ NAMĚŘENO 2026-09-13: seed zakládá `vllm-local` vypnutý s aliasem `http://vllm:8000`
 * a nic ho nezapínalo ani nepřesměrovalo na svc-model. Resolver topologie přitom
 * adresu lokálního modelu vydává (`VLLM_GENERATION_URL`, katalog `model.internal_url.
 * env_aliases`) — jen ji nikdo nečetl tam, kde se provider řádek dá nastavit.
 *
 * Logika reconcile (povolit + endpoint / vypnout nahlas) je ověřená runtime testem
 * src/tests/db/lokalni-model-provider-runtime.test.ts na čisté DB. Tahle brána drží
 * DORUČENÍ, které runtime test nevidí — třída „deklarace, kterou nikdo neplní":
 *   1. katalog odvozenou adresu opravdu vydává pod jménem, které entrypoint čte,
 *   2. core compose tu proměnnou migrate kontejneru předává,
 *   3. entrypoint pouští TÝŽ SQL soubor, který testuje runtime test, s adresou jako
 *      psql proměnnou (SQL literál), ne vlepenou do řetězce příkazu,
 *   4. soubor žije mimo aisha/db/sql — není to schéma, nesmí do baseline,
 *   5. SELHÁNÍ reconcile dojde k cold-startu: entrypoint jím migrate neshazuje (gateway čeká na
 *      service_completed_successfully), ale zapíše tail-stabilní RECONCILE_VERDIKT na
 *      konec výstupu v migration_log_dump — a fáze G cold-startu ho z řádku TOHOTO
 *      běhu čte a selhání i chybění verdiktu zapíše jako nedokončené — obojí se SPOUŠTÍ
 *      (blok entrypointu nad podvrženým psql, blok cold-startu nad řádkem ve tvaru
 *      odpovědi PostgRESTu), protože čtení textu neřekne, jestli grep/sed/escapování JSON
 *      verdikt opravdu doručí.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const SQL = "scripts/deploy/reconcile-local-model-provider.sql";

/** Text bez komentářů — komentář není chování. */
const bezKomentaru = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

/**
 * Doručí entrypoint selhání reconcile do kanálu, který cold-start čte? Vrací nálezy.
 *
 * ⛔ NAMĚŘENO 2026-09-13: selhání končilo `log "WARN vllm-local reconcile FAILED"`
 * a exit se neměnil — do výstupu šla jen věta, kterou nikdo nečetl, a řádek se
 * navíc mohl z `tail -n 400` vytlačit výstupem hooku instančních dat.
 */
function doruceniReconcile(ep: string): string[] {
  const kod = bezKomentaru(ep);
  const iSql = kod.indexOf(`-f ${SQL}`);
  const iDump = kod.lastIndexOf('write_dump "$STATUS" "$FINAL_EXIT"');
  if (iSql < 0 || iDump < 0) return ["reconcile nebo write_dump v entrypointu nenalezen — měřidlo přestalo sedět"];
  const nalezy: string[] = [];
  const zaSql = kod.slice(iSql);
  if (!/RECONCILE_VERDIKT="RECONCILE_VERDIKT slug=vllm-local status=failed duvod=/.test(zaSql))
    nalezy.push("selhání reconcile nenastaví verdikt status=failed s důvodem");
  if (!/RECONCILE_VERDIKT="RECONCILE_VERDIKT slug=vllm-local status=ok"/.test(zaSql))
    nalezy.push("úspěch reconcile nenastaví verdikt status=ok (chybění verdiktu by nešlo odlišit od selhání)");
  const iLog = kod.lastIndexOf('log "$RECONCILE_VERDIKT"');
  const iProvision = kod.lastIndexOf("provision-operators.mjs --apply");
  if (iLog < 0 || iLog > iDump) nalezy.push("verdikt se nezapíše do výstupu PŘED write_dump");
  else if (iProvision > iLog) nalezy.push("verdikt se zapíše před provisioningem — tail -n 400 ho může vytlačit");
  // Blok reconcile končí prvním `fi` na začátku řádku (vnořené podmínky jsou odsazené).
  const konecBloku = kod.indexOf("\nfi\n", iSql);
  const blokReconcile = kod.slice(iSql, konecBloku < 0 ? iDump : konecBloku);
  if (/\bFINAL_EXIT=/.test(blokReconcile)) nalezy.push("selhání reconcile mění FINAL_EXIT — shodilo by gateway (service_completed_successfully)");
  return nalezy;
}

/** Čte cold-start verdikt reconcile z řádku TOHOTO běhu a zapíše selhání/chybění? Vrací nálezy. */
function cteVerdiktReconcile(cs: string): string[] {
  const kod = bezKomentaru(cs);
  const i = kod.indexOf("RECONCILE_VERDIKT slug=vllm-local status=(ok|failed)");
  if (i < 0) return ["cold-start RECONCILE_VERDIKT nečte"];
  const nalezy: string[] = [];
  const radek = kod.slice(kod.lastIndexOf("\n", i), i);
  if (!/printf '%s' "\$_mig_row"/.test(radek)) nalezy.push("verdikt se nečte z řádku migrate korelovaného s tímto během ($_mig_row)");
  const okoli = kod.slice(i, i + 1500);
  if (!/\*"status=failed"\*\)\s*\n\s*nedokonceno "/.test(okoli)) nalezy.push("status=failed se nezapíše jako nedokonceno");
  if (!/\n\s*\*\)\s*\n\s*nedokonceno "[^"]*NEZMĚŘENO/.test(okoli)) nalezy.push("chybějící verdikt se nezapíše jako nedokonceno (NEZMĚŘENO)");
  return nalezy;
}

/** Text od prvního řádku, který odpovídá `zacatek`, po první řádek za ním, který odpovídá `konec` (včetně). */
function blokOd(text: string, zacatek: RegExp, konec: RegExp): string {
  const z = text.search(zacatek);
  if (z < 0) return "";
  const zbytek = text.slice(z);
  const prvniRadek = zbytek.indexOf("\n") + 1;
  const k = zbytek.slice(prvniRadek).search(konec);
  if (k < 0) return "";
  const kLine = zbytek.slice(prvniRadek + k);
  return zbytek.slice(0, prvniRadek + k + kLine.indexOf("\n"));
}

/** Spustí blok reconcile z entrypointu (sh) s podvrženým psql; vrátí verdikt, FINAL_EXIT a výstup migrate. */
function spustReconcile(blok: string, psqlExit: number, psqlRadky: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "reconcile-verdikt-"));
  try {
    const psql = join(dir, "psql");
    writeFileSync(psql, `#!/bin/sh\ncat <<'VYSTUP'\n${psqlRadky.join("\n")}\nVYSTUP\nexit ${psqlExit}\n`);
    chmodSync(psql, 0o755);
    writeFileSync(join(dir, "blok.sh"), blok);
    const out = join(dir, "migrate.log");
    const r = spawnSync(
      "sh",
      ["-c", 'log() { echo "[migrate] $1" | tee -a "$MIGRATE_OUT" >/dev/null; }; . "$BLOK"; printf "VERDIKT=%s\\nFINAL_EXIT=%s\\n" "$RECONCILE_VERDIKT" "$FINAL_EXIT"'],
      { encoding: "utf-8", env: { PATH: `${dir}:${process.env.PATH ?? ""}`, MIGRATE_OUT: out, FINAL_EXIT: "0", DB_URL: "postgresql://x", BLOK: join(dir, "blok.sh") } },
    );
    const vystup = existsSync(out) ? readFileSync(out, "utf-8") : "";
    return {
      verdikt: r.stdout.match(/^VERDIKT=(.*)$/m)?.[1] ?? `<nespuštěno: ${r.stderr}>`,
      finalExit: r.stdout.match(/^FINAL_EXIT=(.*)$/m)?.[1] ?? "",
      vystup,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Spustí blok čtení verdiktu z cold-startu (bash, set -uo pipefail jako skript) nad `_mig_row`. */
function spustColdStart(blok: string, migRow: string): string {
  const r = spawnSync(
    "bash",
    ["-c", 'set -uo pipefail; ok() { echo "OK $*"; }; nedokonceno() { echo "NEDOKONCENO $*"; }; APP_NAME_PREFIX=testfork; _mig_row="$MIG_ROW"; eval "$BLOK"'],
    { encoding: "utf-8", env: { PATH: process.env.PATH ?? "", MIG_ROW: migRow, BLOK: blok } },
  );
  return r.stdout + r.stderr;
}

/** Blok služby v compose (od `  <jméno>:` po další službu na téže úrovni). */
function blokSluzby(compose: string, jmeno: string): string {
  const radky = compose.split("\n");
  const od = radky.findIndex((l) => l === `  ${jmeno}:`);
  if (od === -1) return "";
  let doRadku = radky.length;
  for (let i = od + 1; i < radky.length; i++) {
    if (/^ {2}[a-z0-9-]+:\s*$/.test(radky[i]) || /^[a-z]/.test(radky[i])) {
      doRadku = i;
      break;
    }
  }
  return radky.slice(od, doRadku).join("\n");
}

describe("vllm-local je odvozený z topologie a hodnota k migrate dojde", () => {
  test("katalog vydává adresu lokálního modelu jako VLLM_GENERATION_URL", () => {
    const cat = JSON.parse(read("config/services.json"));
    expect(cat.services.model?.internal_url?.env_aliases ?? []).toContain("VLLM_GENERATION_URL");
  });

  test("⛔ core compose předává VLLM_GENERATION_URL migrate kontejneru", () => {
    const migrate = blokSluzby(read("docker-compose.coolify.yml"), "migrate");
    expect(migrate, "compose nemá službu migrate — měřidlo je slepé").toMatch(/dockerfile: Dockerfile\.migrate/);
    expect(migrate).toMatch(/^\s+VLLM_GENERATION_URL: \$\{VLLM_GENERATION_URL:-\}$/m);
  });

  test("⛔ entrypoint pouští reconcile soubor s adresou jako psql proměnnou", () => {
    const ep = read("scripts/docker-migrate-entrypoint.sh");
    expect(ep).toContain(`-f ${SQL}`);
    expect(ep).toMatch(/-v ep="\$\{VLLM_GENERATION_URL:-\}"/);
    expect(ep, "adresa vlepená do SQL řetězce = injekce i rozbitý quoting").not.toMatch(/-c\s+"[^"]*\$\{?VLLM_GENERATION_URL/);
  });

  test("⛔ seed s derivací NEBOJUJE: vllm-local nepřepisuje endpoint/health_url/is_enabled a nevypíná ho", () => {
    // Seed běží při KAŽDÉM migrate PŘED reconcile. Kdyby ON CONFLICT vracel placeholder
    // adresu nebo blok „Default-disabled" provider vypínal, reconcile by adresu pokaždé
    // „měnil": audit při každém deployi a lokální modely nedostupné do další discovery.
    const seed = read("aisha/db/seed/core/19_ai_provider_catalog.sql");
    const inserty = seed.split(/(?=INSERT INTO public\.ai_provider_registry)/);
    const vllm = inserty.filter((b) => /\(\s*'vllm-local'/.test(b));
    expect(vllm, "vllm-local musí mít vlastní INSERT (ne společný s providery, jejichž endpoint je literál)").toHaveLength(1);
    const setCast = vllm[0].split(/ON CONFLICT \(slug\) DO UPDATE/)[1]?.split(";")[0] ?? "";
    expect(setCast, "ON CONFLICT chybí — metadata by se nikdy neobnovila").not.toBe("");
    for (const sloupec of ["endpoint_url", "health_url", "is_enabled", "last_health_status"]) {
      expect(setCast, `seed přepisuje odvozený sloupec ${sloupec}`).not.toMatch(new RegExp(`\\b${sloupec}\\s*=`));
    }
    const vypinaci = [...seed.matchAll(/UPDATE public\.ai_provider_registry\s+SET is_enabled = false[\s\S]*?;/g)].map((m) => m[0]);
    expect(vypinaci.length, "fixture: blok Default-disabled").toBeGreaterThan(0);
    for (const blok of vypinaci) expect(blok, "seed vypíná odvozený provider").not.toContain("'vllm-local'");
  });

  test("⛔ selhání reconcile se doručí do migration_log_dump jako RECONCILE_VERDIKT (exit se nemění)", () => {
    expect(doruceniReconcile(read("scripts/docker-migrate-entrypoint.sh"))).toEqual([]);
  });

  test("⛔ cold-start fáze G čte RECONCILE_VERDIKT z řádku TOHOTO běhu a selhání přizná", () => {
    expect(cteVerdiktReconcile(read("scripts/aisha-cold-start.sh"))).toEqual([]);
  });

  test("sondy doručení jdou rozsvítit — tvar do 2026-09-13 by chytily", () => {
    const staryEntrypoint = [
      'if [ "$FINAL_EXIT" = "0" ]; then',
      '  if psql "$DB_URL" -v ON_ERROR_STOP=1 -v ep="${VLLM_GENERATION_URL:-}" \\',
      `       -f ${SQL} >>"$MIGRATE_OUT" 2>&1; then`,
      '    log "Reconciled vllm-local"',
      "  else",
      '    log "WARN vllm-local reconcile FAILED — see $MIGRATE_OUT (provider state unchanged)"',
      "  fi",
      "fi",
      "node scripts/db/provision-operators.mjs --apply",
      'write_dump "$STATUS" "$FINAL_EXIT"',
    ].join("\n");
    expect(doruceniReconcile(staryEntrypoint)).toEqual([
      "selhání reconcile nenastaví verdikt status=failed s důvodem",
      "úspěch reconcile nenastaví verdikt status=ok (chybění verdiktu by nešlo odlišit od selhání)",
      "verdikt se nezapíše do výstupu PŘED write_dump",
    ]);
    // Exit-cesta by gateway shodila celou — i ta se chytí.
    const shazujici = read("scripts/docker-migrate-entrypoint.sh").replace(
      'log "WARN vllm-local reconcile FAILED',
      'FINAL_EXIT=1\n    log "WARN vllm-local reconcile FAILED',
    );
    expect(doruceniReconcile(shazujici)).toContain(
      "selhání reconcile mění FINAL_EXIT — shodilo by gateway (service_completed_successfully)",
    );
    expect(cteVerdiktReconcile('ok "  Operator provisioning VERIFIED"\n')).toEqual(["cold-start RECONCILE_VERDIKT nečte"]);
  });

  test("⛔ chování: blok reconcile z entrypointu nad selhávajícím psql vydá verdikt s první chybou, exit nemění", () => {
    const blok = blokOd(read("scripts/docker-migrate-entrypoint.sh"), /^RECONCILE_VERDIKT=""$/m, /^fi$/m);
    expect(blok, "fixture: blok reconcile v entrypointu nenalezen").toContain(SQL);
    const selhani = spustReconcile(blok, 3, [
      'psql:x.sql:12: ERROR:  invalid "endpoint" \\ value: ž',
      "psql: second ERROR: následek",
    ]);
    expect(selhani.verdikt).toBe("RECONCILE_VERDIKT slug=vllm-local status=failed duvod=psql:x.sql:12: ERROR:  invalid endpoint  value: ");
    expect(selhani.finalExit).toBe("0");
    expect(selhani.vystup, "celý výstup psql zůstane ve výstupu migrate").toContain("second ERROR");
    const uspech = spustReconcile(blok, 0, ["NOTICE: vllm-local enabled"]);
    expect(uspech.verdikt).toBe("RECONCILE_VERDIKT slug=vllm-local status=ok");
  });

  test("⛔ chování: blok cold-startu přečte verdikt z řádku ve tvaru odpovědi PostgRESTu", () => {
    const cs = read("scripts/aisha-cold-start.sh");
    const i = cs.indexOf("RECONCILE_VERDIKT slug=vllm-local status=(ok|failed)");
    expect(i, "fixture: čtení verdiktu v cold-startu nenalezeno").toBeGreaterThan(-1);
    const od = cs.lastIndexOf('if [ -n "$_mig_row" ]; then', i);
    const blok = blokOd(cs.slice(od), /^\s*if \[ -n "\$_mig_row" \]; then$/m, /^\s{10}fi$/m);
    const radek = (vystup: string) => JSON.stringify([{ id: 7, output: vystup }]);
    const selhani = spustColdStart(blok, radek("[migrate] a\n[migrate] RECONCILE_VERDIKT slug=vllm-local status=failed duvod=ERROR:  x y\n[migrate] === DONE"));
    expect(selhani).toMatch(/^NEDOKONCENO Fáze G: migrate NESROVNAL provider vllm-local s topologií — ERROR: {2}x y \(/m);
    expect(spustColdStart(blok, radek("[migrate] RECONCILE_VERDIKT slug=vllm-local status=ok\n"))).toMatch(/^OK .*RECONCILE_VERDIKT/m);
    expect(spustColdStart(blok, radek("[migrate] PROVISION_GRANTED email_sha256=0000000000000000000000000000000000000000000000000000000000000000 roles=admin\n"))).toMatch(/^NEDOKONCENO .*NEZMĚŘENO/m);
  });

  test("reconcile soubor existuje, čte :'ep' a do migrate image se dostane (COPY . .)", () => {
    expect(existsSync(join(ROOT, SQL))).toBe(true);
    expect(read(SQL)).toContain(":'ep'");
    expect(read(SQL)).toMatch(/slug = 'vllm-local'/);
    expect(read("Dockerfile.migrate")).toMatch(/^COPY \. \.$/m);
    expect(SQL.startsWith("aisha/db/sql/"), "reconcile není schéma — baseline by ho pouštěl při každém cold startu").toBe(false);
  });
});
