/**
 * Vstupy pověření n8n, které doručuje PLATFORMA, projdou celým řetězcem doručení.
 *
 * ⛔ NAMĚŘENO 2026-09-17 (guru): `N8N_WEBHOOK_AUTH_TOKEN` negeneroval nikdo — ani
 * .env.coolify, ani trezor ho neměly. Compose ho přitom init předával
 * (`${N8N_WEBHOOK_AUTH_TOKEN:-}`), provision-credentials pověření „AISHA Webhook
 * Auth“ tiše přeskočil („missing env“) a 17 uzlů v aktivních cron workflowech
 * padalo na „Credentials not found“ (WF_OPENCLAW_NOTIFY 1009×, PUSH_CAMPAIGN 504×,
 * PUSH_REMINDER 502× za 9 h). Deklarace bez plniče.
 *
 * ⭐ Měří se VLASTNOST: každý vstup pověření označeného `platforma: true`
 * v scripts/n8n/provision-credentials.mjs — pokud ho init nedosazuje sám
 * (API klíč n8n mintuje entrypoint) — musí:
 *   1. vydat generate-secrets (`emit('<KLÍČ>'`),
 *   2. zapsat cold-start do .env.coolify (`<KLÍČ>=${<KLÍČ>}` v heredocu),
 *   3. stát v kontraktu env-doktora (podle něj sync-envs a doktor ověřuje),
 *   4. dostat init v compose jako `${<KLÍČ>}` (sync-envs posílá jen referované).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(__dirname, "../../..");
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PROVISION = cti("scripts/n8n/provision-credentials.mjs");
const ENTRYPOINT = cti("scripts/n8n-deploy-entrypoint.sh");
const GENERATOR = cti("scripts/generate-secrets.mjs");
const COLD_START = cti("scripts/aisha-cold-start.sh");
const DOKTOR = cti("scripts/aisha-env-doctor.mjs");

/** Položky DESIRED s `platforma: true` → jméno a vstupy (`needs`). */
function platformniPovereni(text: string): Array<{ nazev: string; vstupy: string[] }> {
  const out: Array<{ nazev: string; vstupy: string[] }> = [];
  for (const m of text.matchAll(/name:\s*"([^"]+)",\s*type:\s*"[^"]+",\s*platforma:\s*true,\s*needs:\s*\[([^\]]*)\]/g)) {
    out.push({ nazev: m[1], vstupy: [...m[2].matchAll(/"([A-Z0-9_]+)"/g)].map((v) => v[1]) });
  }
  return out;
}

/** Proměnné, které entrypoint dosazuje přímo na řádku volání provision-credentials. */
const DOSAZUJE_ENTRYPOINT = new Set(
  ENTRYPOINT.split("\n")
    .filter((r) => r.includes("provision-credentials.mjs"))
    .flatMap((r) => [...r.matchAll(/\b([A-Z][A-Z0-9_]*)="\$/g)].map((m) => m[1])),
);

const INIT_ENV = (() => {
  const dok = parseYaml(cti("docker-compose.coolify-n8n.yml"), { merge: true }) as {
    services?: Record<string, { environment?: string[] }>;
  };
  return dok?.services?.["n8n-workflow-init"]?.environment ?? [];
})();

const POVERENI = platformniPovereni(PROVISION);
const VSTUPY = [...new Set(POVERENI.flatMap((p) => p.vstupy))].filter((v) => !DOSAZUJE_ENTRYPOINT.has(v)).sort();

describe("vstupy platformních pověření n8n jsou doručené (brána)", () => {
  test("univerzum: měřidlo vidí platformní pověření i to, co dosazuje entrypoint", () => {
    expect(POVERENI.length, "žádné `platforma: true` — měřidlo přestalo číst DESIRED").toBeGreaterThanOrEqual(3);
    expect(DOSAZUJE_ENTRYPOINT.has("N8N_API_KEY"), "entrypoint už nedosazuje N8N_API_KEY — přečti znovu").toBe(true);
    expect(INIT_ENV.length, "init v compose nemá environment — měřidlo nevidí").toBeGreaterThan(10);
    expect(VSTUPY.length).toBeGreaterThanOrEqual(2);
  });

  test.each(VSTUPY)("⛔ %s: generátor → .env.coolify → kontrakt doktora → compose initu", (klic) => {
    // Odvozená hodnota (adresa z topologie, ne tajemství): init ji dostává jako
    // POVINNOU jinou proměnnou `KLIC=${ODVOZENA:?…}` — řetězec ODVOZENA hlídá
    // topologie a doručení povinných proměnných, tady stačí, že init bez ní
    // nenaběhne (fail-closed), místo aby dostal prázdno.
    const odvozena = INIT_ENV.some((r) => new RegExp(`^${klic}=\\$\\{(?!${klic}[:}])[A-Z0-9_]+:\\?`).test(r));
    if (odvozena) return;
    const vady: string[] = [];
    if (!new RegExp(`emit\\('${klic}'`).test(GENERATOR)) vady.push("generate-secrets ho nevydává");
    if (!new RegExp(`^${klic}=\\$\\{${klic}\\}$`, "m").test(COLD_START)) vady.push("cold-start ho nezapisuje do .env.coolify");
    if (!new RegExp(`\\["${klic}",\\s*"`).test(DOKTOR)) vady.push("není v kontraktu env-doktora");
    if (!INIT_ENV.some((r) => new RegExp(`^[A-Z0-9_]+=\\$\\{${klic}(\\}|:\\?)`).test(r))) {
      vady.push("init ho v compose nedostává jako ${" + klic + "} (bez prázdného defaultu)");
    }
    expect(vady, `${klic}: ${vady.join("; ")}`).toEqual([]);
  });
});
