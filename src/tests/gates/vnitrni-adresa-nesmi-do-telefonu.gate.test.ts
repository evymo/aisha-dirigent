/**
 * Brána: do buildu appky se NESMÍ dostat adresa z mesh zóny.
 *
 * TŘÍDA VADY: týž konfigurační klíč je pro jednoho konzumenta správný a pro
 * druhého nedosažitelný — a nikdo ten rozdíl neměří. Služba uvnitř meshe smí
 * (a má) mluvit vnitřním jménem. Telefon je VENKU a takové jméno nerozloží.
 *
 * ⛔ NAMĚŘENO 2026-08-20: `EXPO_PUBLIC_LIVEKIT_URL` vycházelo jako
 * `wss://livekit.backend.<INTERNAL_TLD>`, protože se odvozovalo z
 * `LIVEKIT_DOMAIN` — a `config/domains.env` u toho klíče self-healuje právě
 * na vnitřní tvář („když operátor nevyplní"). Pro služby v meshi správně,
 * pro appku ne. Build je zelený, archiv se nahraje, appka se nainstaluje —
 * a teprve řidič v terénu uvidí „cannot join the call room".
 *
 * CO SE MĚŘÍ (chování, ne pravopis): `instance-env-derive.sh` se pustí nad
 * FIXTUROU instančního prostředí a tvrdí se, CO UDĚLÁ:
 *   - vnucená vnitřní adresa  → nenulový konec a jméno provinilého klíče,
 *   - veřejná tvář            → projde a odvodí ji,
 *   - `.internal` až v CESTĚ  → projde (rozhoduje HOSTITEL, ne řetězec).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SKRIPT = join(ROOT, "mobile-app/scripts/instance-env-derive.sh");

type Vysledek = { rc: number; vystup: string };

/** Pustí odvození nad fixturou a vrátí návratový kód + spojený výstup. */
function odvod(instanceEnv: Record<string, string>, prostredi: Record<string, string> = {}): Vysledek {
  const dir = mkdtempSync(join(tmpdir(), "aisha-derive-"));
  try {
    const envPath = join(dir, "instance.env");
    writeFileSync(
      envPath,
      Object.entries(instanceEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    );
    const versionPath = join(dir, "version.json");
    writeFileSync(versionPath, JSON.stringify({ brand: { oauthClientId: "fixture-app", scheme: "fixture" } }));

    try {
      const vystup = execFileSync(
        "bash",
        ["-c", `. "${SKRIPT}"; printf 'ODVOZENO %s\\n' "\${EXPO_PUBLIC_LIVEKIT_URL:-<none>}"`],
        {
          cwd: join(ROOT, "mobile-app"),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, AISHA_INSTANCE_ENV: envPath, VERSION_FILE: versionPath, ...prostredi },
        },
      );
      return { rc: 0, vystup };
    } catch (e: unknown) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { rc: err.status ?? 1, vystup: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ZAKLAD = {
  PUBLIC_TLD: "priklad.test",
  INTERNAL_TLD: "fixture.internal-zone",
  API_DOMAIN_PUBLIC: "api.priklad.test",
  AUTH_DOMAIN_PUBLIC: "auth.priklad.test",
  KEYCLOAK_REALM: "fixture",
  APP_DOMAIN: "web.priklad.test",
};

describe("vnitřní adresa se do telefonu nesmí dostat", () => {
  test("vnucená adresa v mesh zóně build ZASTAVÍ a pojmenuje klíč", () => {
    const r = odvod(ZAKLAD, { EXPO_PUBLIC_LIVEKIT_URL: "wss://livekit.backend.fixture.internal-zone" });
    expect(r.rc, `odvození mělo skončit nenulově, vrátilo ${r.rc}:\n${r.vystup}`).not.toBe(0);
    expect(r.vystup).toContain("VNITŘNÍ ADRESA V BUILDU APPKY");
    // Musí říct KTERÝ klíč — bez toho se to nedá opravit.
    expect(r.vystup).toContain("EXPO_PUBLIC_LIVEKIT_URL");
  });

  test("chytá i doslovné `.internal`, když INTERNAL_TLD nezná", () => {
    const r = odvod(ZAKLAD, { EXPO_PUBLIC_AISHA_GATEWAY_URL: "https://api.mesh.jina.internal" });
    expect(r.rc).not.toBe(0);
    expect(r.vystup).toContain("EXPO_PUBLIC_AISHA_GATEWAY_URL");
  });

  test("veřejná tvář projde a odvodí se — sonda musí jít zezelenat", () => {
    const r = odvod({ ...ZAKLAD, LIVEKIT_DOMAIN_PUBLIC: "live.priklad.test" });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vystup).toContain("ODVOZENO wss://live.priklad.test");
  });

  test("instance bez veřejného LiveKitu projde, klíč se NEODVODÍ", () => {
    // Mlčení znamená „tahle instance LiveKit nepublikuje", ne „vezmi vnitřní".
    const r = odvod({ ...ZAKLAD, LIVEKIT_DOMAIN: "livekit.backend.fixture.internal-zone" });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vystup).toContain("ODVOZENO <none>");
  });

  test("rozhoduje HOSTITEL, ne řetězec — `.internal` v cestě je v pořádku", () => {
    // Kdyby brána hledala podřetězec, tenhle tvar by shodila a nutila lidi
    // psát výjimky. Viz `merit-vlastnost-necitovat-data`.
    const r = odvod(ZAKLAD, { EXPO_PUBLIC_APP_URL: "https://web.priklad.test/docs/network.internal" });
    expect(r.rc, r.vystup).toBe(0);
  });
});
