/**
 * Šev mezi dveřníkem a frontou — CELÝ řetěz, ne jen jeho konce.
 *
 * Zadání majitele (2026-08-19): *„vyhodnocení odpovědi edge musí být
 * jednoznačné — buď ho to přesměruje pryč a tím pádem je problém s dveřníkem,
 * nebo mu to řekne ty chyby a tím pádem víme, že je to na úrovni perms."*
 *
 * ⛔ PROČ SE TO TESTUJE PŘES CELÝ ŘETĚZ. Vada nebyla ani u dveřníka (403 posílal
 * správně), ani v `classifyFailure` (pravidlo dávalo smysl). Byla UPROSTŘED:
 * `throwRpcError` skládal chybu jen z `message` + `status` a `code` zahodil —
 * takže rozlišení, na kterém všechno stojí, se nikdy nedoneslo ke spotřebiteli.
 * Testy obou konců byly přitom zelené. Doložit to jde jedině průchodem.
 *
 * Táž třída jako PR #154, o patro dál: tehdy se ztrácel `status`, teď `code`.
 */
import { createApiCore } from "@aisha/api-core";
import { classifyFailure, RpcFailure } from "@/services/offline";

// `@aisha/api-core` se bere SKUTEČNÝ — je to jeden z článků, které se měří.
// Podvrhuje se jen appkový singleton, který by cestou přitáhl OIDC a expo-linking.
jest.mock("@/config/api", () => ({ api: { rpc: jest.fn() } }));
jest.mock("@/lib/security/safeLogger", () => ({
  safeError: jest.fn(), safeInfo: jest.fn(), safeWarn: jest.fn(),
}));

const puvodniFetch = global.fetch;
afterEach(() => { global.fetch = puvodniFetch; });

/** Odpověď edge/serveru, jak dorazí na drát. */
function odpovezServer(status: number, body: string, headers: Record<string, string> = {}) {
  global.fetch = jest.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

const klient = () => createApiCore({ gatewayUrl: "https://api.test", getToken: async () => "t" });

/** Projde celý řetěz: drát → api-core → chyba fronty → klasifikace. */
async function projdiRetezec(): Promise<{ kind: string; code?: string }> {
  const { error } = await klient().rpc("cokoli" as never, {} as never);
  // Fronta chyby dostává jako `RpcFailure` — tenhle převod je to místo, kde se
  // `code` ztrácel. Testuje se ROVNOU s ním, ne kolem něj.
  const chyba = new RpcFailure(error!.message, error!.status, error!.code);
  return { code: chyba.code, kind: classifyFailure(chyba) };
}

describe("dveřník × nárok — jednoznačné vyhodnocení odpovědi edge", () => {
  it("dveřník: 403 se značkou → okolnost, běh stojí a má smysl zaťukat", async () => {
    // Dveřník odmítá BEZ TĚLA (nesmí prozradit PROČ), ale SE ZNAČKOU (čí to je).
    odpovezServer(403, "", { "x-aisha-door": "locked" });
    expect(await projdiRetezec()).toEqual({ code: "AISHA_DOOR_LOCKED", kind: "denied" });
  });

  it("perms: 403 s errcode 42501 → vada té mutace, zbytek fronty jede dál", async () => {
    // Přesně to, co server vrátí, když dispečer přehodí dodávku jinému řidiči.
    odpovezServer(
      403,
      JSON.stringify({ code: "42501", message: "milestone not completed: not allowed to complete this step" }),
      { "content-type": "application/json" },
    );
    expect(await projdiRetezec()).toEqual({ code: "42501", kind: "rejected" });
  });

  it("401 zůstává identitou i s tělem — vypršelý token není vada mutace", async () => {
    odpovezServer(401, JSON.stringify({ code: "PGRST301", message: "JWT expired" }), {
      "content-type": "application/json",
    });
    expect((await projdiRetezec()).kind).toBe("denied");
  });

  /**
   * ⚠️ POŘADÍ NASAZENÍ: appka může jít ven dřív než brána, která značku posílá.
   * Holé 403 se proto čte jako dosud — dveřník. Vědomě v bezpečném směru:
   * horší než dnešek to nebude, jen to zůstane stejné, dokud jedna ze stran
   * nezačne mluvit.
   */
  it("stará brána bez značky: holé 403 se chová jako dosud", async () => {
    odpovezServer(403, "");
    expect((await projdiRetezec()).kind).toBe("denied");
  });

  it("značka se nepřilepí k úspěchu — pass nesmí vypadat jako zamčeno", async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" }, status: 200,
    })) as unknown as typeof fetch;
    const { error } = await klient().rpc("cokoli" as never, {} as never);
    expect(error).toBeNull();
  });
});
