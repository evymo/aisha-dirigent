/**
 * Brána: čtení kolokačních vstupů z payloadu v coolify-sync-envs.sh nesmí
 * skončit na SIGPIPE.
 *
 * ⛔ NAMĚŘENO 2026-09-23 (cheers, vlny 6–7): env-sync před nasazením padal
 *     FATAL coolify-sync-envs.sh: řádek 384 skončil s kódem 141
 * u registry, keycloak a observability — u jiných aplikací ne. Tvar byl
 * `X=$(echo "$ENV_PAIRS" | awk '…{print $2; exit}')`: awk po nálezu skončí
 * a zavře rouru, echo, které ještě píše payload větší než buffer roury,
 * dostane SIGPIPE, a `set -o pipefail` z toho udělá chybu celého skriptu.
 * Záviselo to na velikosti payloadu a pozici klíče — proto „jen někdy".
 *
 * Měří se CHOVÁNÍ: brána vyřízne ze skriptu skutečné řádky čtení a pustí je
 * pod `set -euo pipefail` nad payloadem mnohem větším než buffer roury,
 * s hledaným klíčem NA ZAČÁTKU (nejhorší případ). Kontrola, že hodnota
 * opravdu přijde, brání tomu, aby „prošlo" prázdné čtení.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const SRC = readFileSync(join(ROOT, "scripts/coolify-sync-envs.sh"), "utf-8");

function radekCteni(klic: string): string {
  const radek = SRC.split("\n").find((r) => r.trim().startsWith(`${klic}=$(`) && r.includes("ENV_PAIRS"));
  expect(radek, `čtení ${klic} z ENV_PAIRS nenalezeno — přejmenovalo se?`).toBeDefined();
  return radek!.trim();
}

function spust(klic: string): string {
  const vypln = Array.from({ length: 40000 }, (_, i) => `VYPLN_${i}\t${"x".repeat(40)}`).join("\n");
  const payload = `${klic}\thledana-hodnota\n${vypln}\n`;
  const skript = ["set -euo pipefail", 'ENV_PAIRS="$(cat)"', radekCteni(klic), `printf '%s' "$${klic}"`].join("\n");
  return execFileSync("bash", ["-c", skript], { input: payload, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
}

describe("sync-envs čte kolokační vstupy bez SIGPIPE", () => {
  for (const klic of ["PKI_COLOCATED_SLOTS", "PKI_BRIDGE_URL_COLOCATED"]) {
    test(`${klic}: velký payload, klíč na začátku → hodnota, žádný kód 141`, () => {
      expect(spust(klic)).toBe("hledana-hodnota");
    });
  }
});
