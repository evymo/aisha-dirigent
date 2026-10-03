/**
 * Brána: rezidence dat AI je DEKLARACE INSTANCE, ne výchozí hodnota kódu.
 *
 * ⛔ PROČ (naměřeno 2026-09-26/28 na riq): svc-ai-chat běžel bez
 * `AISHA_EXECUTION_MODE`, tedy v režimu `cloud` (výchozí `getExecutionMode()`).
 * Kanál `ai-chat` by pak vybral cloudový model a otázka i s daty firem by
 * odešla ven — přestože instance má model uvnitř meshe a majitel chce „vnitřek".
 * Že se to nestalo, bylo jen tím, že kanál nebyl a klíče byly prázdné.
 *
 * Řetěz, který brána drží pohromadě (jeden domov = profil instance):
 *   profil `ai.execution_mode` → derive-domains → AISHA_EXECUTION_MODE → doktor
 *   (derived) → compose ai-chat `${…:?}` (nedeklarováno = start odmítnut) →
 *   @aisha/llm-dispatch (v `local` cloudový backend neregistruje).
 *
 * Kontrolní vzorky: šablony vydají `cloud` (dnešní chování, DEKLAROVANÉ);
 * nedeklarovaný profil vydá klíč PRÁZDNÝ (ne chybějící, ne „cloud"); překlep
 * derivaci shodí.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTopology, formatShellExports, REZIMY_AI } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = resolve(__dirname, "../../..");
const cti = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

function emise(topo: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of formatShellExports(topo).split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const s = (rezim: unknown) => ({ ...buildTopology({ profileId: "cloud-single" }), ai_execution_mode: rezim });

describe("brána: rezidence dat AI z profilu instance", () => {
  it("šablony profilů režim DEKLARUJÍ (dnešní chování = cloud, ne tichý výchozí)", () => {
    for (const profileId of ["cloud-single", "cloud-multi", "local-dev"]) {
      const v = emise(buildTopology({ profileId })).get("AISHA_EXECUTION_MODE");
      expect(v, `${profileId}: ai.execution_mode musí být deklarovaný`).toBe("cloud");
    }
  });

  it("deklarace `local` projde derivací beze změny", () => {
    expect(emise(s("local")).get("AISHA_EXECUTION_MODE")).toBe("local");
  });

  it("nedeklarováno → klíč VYDANÝ a prázdný (compose pak odmítne start), ne „cloud“", () => {
    const e = emise(s(undefined));
    expect(e.has("AISHA_EXECUTION_MODE")).toBe(true);
    expect(e.get("AISHA_EXECUTION_MODE")).toBe("");
  });

  it("překlep derivaci shodí (jinak by tiše znamenal cloud)", () => {
    for (const vadny of ["Local", "lokal", "on-prem", ""]) {
      expect(() => formatShellExports(s(vadny)), `ai.execution_mode="${vadny}"`).toThrow(/ai\.execution_mode/);
    }
  });

  it("režimy derivace = režimy, které zná @aisha/llm-dispatch", () => {
    const src = cti("packages/llm-dispatch/src/executionMode.ts");
    for (const r of REZIMY_AI) expect(src, `llm-dispatch nezná režim ${r}`).toContain(`"${r}"`);
  });

  it("compose ai-chat proměnnou VYŽADUJE (`:?`), doktor ji ODVOZUJE z profilu", () => {
    expect(cti("docker-compose.coolify-ai-chat.yml")).toMatch(/AISHA_EXECUTION_MODE:\s*\$\{AISHA_EXECUTION_MODE:\?/);
    expect(cti("scripts/aisha-env-doctor.mjs")).toMatch(/\["AISHA_EXECUTION_MODE",\s*"derived",\s*derivedTopo\("AISHA_EXECUTION_MODE"\)\]/);
  });

  it("schéma profilů zná `ai.execution_mode` jako výčet (překlep v profilu = chyba schématu)", () => {
    const schema = JSON.parse(cti("config/profiles.schema.json"));
    expect(schema.properties.ai.properties.execution_mode.enum).toEqual(REZIMY_AI);
  });
});
