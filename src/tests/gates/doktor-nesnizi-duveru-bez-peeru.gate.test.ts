/**
 * Doktor nesmí snížit důvěru v mesh peery jen proto, že nevidí svůj vstup
 *
 * TŘÍDA VADY: odvozená hodnota spočítaná BEZ svého vstupu vypadá jako drift.
 * `GATEWAY_TRUSTED_PROXIES` je funkcí `MESH_PEER_IPS` — placeholderu, který plní
 * až discovery. Když chybí, `gatewayTrustedProxies('')` vrátí jen dockerové CIDR:
 * neprázdně, syntakticky správně, a jinak než uložená hodnota. Doktor to vzal
 * jako zastaralý klíč a „srovnal" ho.
 *
 * NAMĚŘENO 2026-09-13 doktorem z `riq/main` nad zkušebním souborem s 23 peery a
 * bez `MESH_PEER_IPS`: 27 položek → 4, výstup o klíči ANI SLOVO. Nasazený na
 * core a edge by tím seznam přestal znát mesh skok, klientskou adresu by nešlo
 * spočítat a dveře by nepustily nikoho, kdo jde přes mesh.
 *
 * Rozhodnutí je čistá funkce `srovnaniTrustedProxies` (test u ní). Tahle brána
 * měří ZAPOJENÍ: že ji skutečný doktor volá a že se podle ní řídí zápis.
 *
 * ⛔ MĚŘÍ SE ZAPSANÝ SOUBOR, NE VÝPIS. První verze četla `--dry-run` sekci
 * „Keys to add" — ta je ale useknutá na 50 položek na skupinu a klíč v ní
 * nebyl ani tehdy, když se zapisoval. Test „nezapíše" tím procházel naslepo;
 * odhalil to až kontrolní vzorek níž, kterému chyběl řádek, jenž tam být musel.
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatewayTrustedProxies } from "../../../scripts/lib/derive-subnets.mjs";

const ROOT = process.cwd();
const DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
const ZALOHY = path.join(ROOT, ".backup");
const KLIC = "GATEWAY_TRUSTED_PROXIES";

const PEERY = Array.from({ length: 23 }, (_, i) => `100.90.${i + 1}.7`).join(",");
const S_PEERY = gatewayTrustedProxies(PEERY);
const BEZ_PEERU = gatewayTrustedProxies("");

const docasne: string[] = [];
const semena = new Set<string>();

/** Doktor v APPLY nad souborem v tempu; vrátí zapsané hodnoty klíče a výstup. */
function doktorZapise(obsah: string): { hodnoty: string[]; vystup: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-doktor-duvera-"));
  docasne.push(dir);
  const envFile = path.join(dir, "env.test");
  writeFileSync(envFile, obsah);
  semena.add(obsah);
  const r = spawnSync(process.execPath, [DOCTOR, "--no-external"], {
    cwd: ROOT,
    encoding: "utf8",
    // Doktor prochází celý sledovaný strom; pod zátěží násobně déle než lokálně
    // (viz external-klic-je-opravdu-operatorsky).
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ENV_FILE: envFile },
  });
  // ESC jako viditelný escape, ne doslovný bajt: ten se při kopírování textu
  // ztratí a regex pak barvy tiše NEodstraňuje (stalo se při psaní téhle brány).
  // eslint-disable-next-line no-control-regex
  const vystup = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  if (r.error || r.signal || r.status !== 0) {
    throw new Error(
      `env-doktor nedoběhl — soubor NENÍ měření: signal=${r.signal ?? "—"} ` +
        `error=${r.error ? (r.error as Error).message : "—"} status=${r.status}\n` +
        vystup.trimEnd().split("\n").slice(-15).join("\n"),
    );
  }
  const hodnoty = readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`${KLIC}=`))
    .map((l) => l.slice(KLIC.length + 1));
  return { hodnoty, vystup };
}

afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
  // Apply zakládá zálohu cílového souboru v `<ROOT>/.backup/`. Smazat se smí
  // JEN záloha, která je bajt po bajtu semenem téhle brány — ve stejném adresáři
  // leží zálohy skutečného `.env.coolify` z jiných běhů.
  if (!existsSync(ZALOHY)) return;
  for (const f of readdirSync(ZALOHY)) {
    const p = path.join(ZALOHY, f);
    try {
      if (semena.has(readFileSync(p, "utf8"))) rmSync(p);
    } catch {
      // Adresář nebo cizí soubor — nesahat.
    }
  }
});

describe("doktor nesníží důvěru v mesh peery bez MESH_PEER_IPS", () => {
  test("⛔ uložený seznam s peery zůstane a doktor řekne proč", () => {
    const { hodnoty, vystup } = doktorZapise(`${KLIC}=${S_PEERY}\n`);
    expect(hodnoty, "klíč musí v souboru zůstat právě jednou").toHaveLength(1);
    expect(hodnoty[0], "doktor seznam s peery přepsal").toBe(S_PEERY);
    expect(vystup).toContain(`${KLIC}: MESH_PEER_IPS chybí`);
  });

  test("kontrolní vzorek: zakázaný rozsah bez peerů doktor PŘEPÍŠE", () => {
    // Bez tohohle by předchozí test prošel i doktorovi, který soubor nezapisuje
    // vůbec — měřidlo musí umět odpovědět „ano, přepsal".
    const { hodnoty } = doktorZapise(`${KLIC}=${BEZ_PEERU},100.64.0.0/10\n`);
    expect(hodnoty).toHaveLength(1);
    expect(hodnoty[0]).toBe(BEZ_PEERU);
  });

  test("s MESH_PEER_IPS se odvozuje jako dosud", () => {
    const { hodnoty } = doktorZapise(`MESH_PEER_IPS=${PEERY}\n${KLIC}=${BEZ_PEERU}\n`);
    expect(hodnoty).toHaveLength(1);
    expect(hodnoty[0]).toBe(S_PEERY);
  });
});
