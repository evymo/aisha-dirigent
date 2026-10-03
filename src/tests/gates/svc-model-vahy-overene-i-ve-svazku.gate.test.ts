/**
 * svc-model: váhy se ověřují proti pinu I TEHDY, když už leží ve svazku.
 *
 * ⛔ 2026-09-29 (riq): /models je trvalý svazek (soubory z 26. 8. přežily restart) a seed()
 * dřív u existujícího souboru hned vracel 0. Změna EMBED_GGUF_SHA256 (nebo URL) bez smazání
 * souboru by nechala svc-model běžet na STARÝCH vahách pod novým pinem — tiše; vektory dotazů
 * i platformního dopočtu (živá identita gguf:<pin>) by se rozešly s uloženými.
 *
 * Měří chování skutečné funkce seed() vyjmuté z entrypointu (sh, curl přes file://).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const ENTRY = readFileSync(path.join(ROOT, "scripts/deploy/svc-model-entrypoint.sh"), "utf-8");
const SEED = (() => {
  const m = ENTRY.match(/^seed\(\) \{[\s\S]*?^\}/m);
  if (!m) throw new Error("seed() v svc-model-entrypoint.sh nenalezena");
  return m[0];
})();
const sha = (b: string) => createHash("sha256").update(b).digest("hex");

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "seed-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(url: string, pin: string, dest: string) {
  return spawnSync("sh", ["-c", `${SEED}\nseed "$1" "$2" "$3"`, "seed", url, pin, dest], { encoding: "utf-8" });
}

describe("svc-model seed(): pin platí i pro soubor ve svazku", () => {
  it("existující soubor se správným sha zůstane (bez stahování)", () => {
    const dest = path.join(dir, "embed.gguf");
    writeFileSync(dest, "VAHY-A");
    const r = seed(`file://${path.join(dir, "neexistuje")}`, sha("VAHY-A"), dest);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(dest, "utf-8")).toBe("VAHY-A");
  });

  it("existující soubor s JINÝM sha se stáhne znovu a ověří", () => {
    const dest = path.join(dir, "embed.gguf");
    const zdroj = path.join(dir, "zdroj.gguf");
    writeFileSync(dest, "STARE-VAHY");
    writeFileSync(zdroj, "NOVE-VAHY");
    const r = seed(`file://${zdroj}`, sha("NOVE-VAHY"), dest);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("stahuji znovu");
    expect(readFileSync(dest, "utf-8")).toBe("NOVE-VAHY");
  });

  it("jiný sha a zdroj taky nesedí → exit 1, žádné váhy (fail-closed)", () => {
    const dest = path.join(dir, "embed.gguf");
    const zdroj = path.join(dir, "zdroj.gguf");
    writeFileSync(dest, "STARE-VAHY");
    writeFileSync(zdroj, "CIZI-VAHY");
    const r = seed(`file://${zdroj}`, sha("NOVE-VAHY"), dest);
    expect(r.status).toBe(1);
    expect(existsSync(dest)).toBe(false);
  });
});
