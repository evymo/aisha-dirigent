/**
 * Cold-start volá API platformy z OPERÁTOROVA stroje — tedy přes veřejnou tvář.
 *
 * ⛔ NAMĚŘENO 2026-09-17 (cold-start guru6, operátorský Mac mimo mesh):
 * krok 6b „Embed kickstart“ skončil „generate-knowledge-embeddings: HTTP chyba
 * nebo timeout“. Volání šlo na `https://${API_DOMAIN}/functions/v1/…`, jenže
 * cold-start si před krokem 6 načte .env.coolify, kde `API_DOMAIN` je mesh jméno
 * (`aisha-api.mesh.aisha.internal`) — z operátorova stroje se nepřeloží
 * (curl rc=6), kdežto `https://api.aisha.guru/health` → 200. Krok těsně před
 * tím (resolver embedding modelu) prošel, protože bral `API_DOMAIN_PUBLIC`.
 *
 * ⭐ Měří se VLASTNOST nad celým skriptem: každá https adresa API, kterou
 * cold-start skládá (mimo komentáře), začíná veřejnou tváří `API_DOMAIN_PUBLIC`.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SKRIPT = "scripts/aisha-cold-start.sh";

const ADRESY = readFileSync(join(ROOT, SKRIPT), "utf8")
  .split("\n")
  .map((radek, i) => ({ radek, cislo: i + 1 }))
  .filter(({ radek }) => !radek.trimStart().startsWith("#"))
  .flatMap(({ radek, cislo }) =>
    [...radek.matchAll(/https:\/\/\$\{?(API_DOMAIN[A-Z_]*)/g)].map((m) => ({ cislo, promenna: m[1], radek: radek.trim() })),
  );

describe("operátorská volání API z cold-startu jdou na veřejnou tvář (brána)", () => {
  test("univerzum: cold-start skládá https adresy API (migrace, verdikt n8n, health, embeddingy)", () => {
    expect(ADRESY.length, "měřidlo nenašlo žádnou https adresu API — přestalo vidět").toBeGreaterThanOrEqual(5);
  });

  test("⛔ žádná https adresa API nezačíná mesh jménem API_DOMAIN", () => {
    const vady = ADRESY.filter((a) => a.promenna !== "API_DOMAIN_PUBLIC").map((a) => `${SKRIPT}:${a.cislo}  ${a.radek.slice(0, 140)}`);
    expect(vady, `volání z operátorova stroje na mesh jméno:\n${vady.join("\n")}`).toEqual([]);
  });
});
