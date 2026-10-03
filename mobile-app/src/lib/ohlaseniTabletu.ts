/**
 * Ohlášení TABLETU v kiosku — bez přihlášeného člověka.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-28): „po kliknutí na zavedení zařízení se klíč
 * odešle na backend, protože je odemčeno, a následně to zařízení můžeme
 * permanentně v administraci schválit, aby si tablet mohl ťukat sám" a „to
 * zařízení samozřejmě musí umět samo klepat, když je schválené".
 *
 * Telefon řidiče ohlašuje průkaz po přihlášení (`ohlaseniZarizeni.ts`,
 * `register_knock_device`). Tablet v kiosku nikoho přihlášeného nemá, takže
 * ohlašuje bráně sám: `POST /auth/v1/device/enrol`, podepsané TÍMŽ klíčem,
 * který ohlašuje (AISHA-REQ1). Brána ho přijme jen z adresy, kterou právě
 * otevřelo zaťukání technika — kořen důvěry zůstává ruční zaťukání člověkem.
 *
 * ⛔ OHLÁŠENÍ NIC NEPOVOLUJE. Průkaz vznikne jako ČEKAJÍCÍ; schvaluje ho správce
 * v administraci (Zařízení → Průkazy pro dveře). Stav se tablet dozví jen
 * podepsaným dotazem — kdo klíč nedrží, nedozví se nic.
 *
 * ⭐ ČISTÉ JÁDRO. Síť, podpis i čas přicházejí parametrem (vzor `knock.ts` ×
 * `knock-native.ts`), takže tentýž kód běží v jestu i na tabletu.
 */
import { signDeviceRequest, utf8Encode, type KnockCrypto } from "@aisha/knock-protocol";
import type { PovereniZarizeni } from "./poverovani-zarizeni";

/** Komu je podepsaný požadavek určený — TÝŽ řetězec ověřuje brána (`zarizeni-klic.ts`). */
export const DEVICE_AUDIENCE = "aisha-gateway";
export const CESTA_OHLASENI = "/auth/v1/device/enrol";
export const CESTA_STAVU = "/auth/v1/device/stav";

export type StavPrukazu = "ceka" | "schvaleno" | "odvolano";

export type VysledekTabletu =
  | { stav: StavPrukazu; kid: string }
  /** 403 — ohlásit se jde jen ze sítě, kterou právě otevřelo zaťukání. */
  | { stav: "dvere-zavrene" }
  /** 404 — brána průkaz nezná (ještě neohlášený, nebo smazaný). */
  | { stav: "nezname" }
  | { stav: "selhalo"; duvod: string };

export interface TabletDeps {
  /** Adresa brány bez koncového lomítka (`getBackendUrl`). */
  zakladUrl: () => Promise<string>;
  crypto: Pick<KnockCrypto, "randomBytes">;
  /** ECDSA-SHA256 (r||s) soukromým klíčem průkazu. */
  podepis: (privateKeyPem: string, zprava: Uint8Array) => Uint8Array;
  nowSec: () => number;
  fetch: typeof fetch;
}

const STAVY: readonly StavPrukazu[] = ["ceka", "schvaleno", "odvolano"];

function hlavicky(p: PovereniZarizeni, method: string, target: string, telo: Uint8Array, deps: TabletDeps) {
  return signDeviceRequest(
    deps.crypto,
    { audience: DEVICE_AUDIENCE, method, target, body: telo, kid: p.kid, ts: deps.nowSec() },
    (zprava) => deps.podepis(p.privateKeyPem, zprava),
  );
}

async function precti(odpoved: Response, kid: string): Promise<VysledekTabletu> {
  let telo: unknown = null;
  try {
    telo = await odpoved.json();
  } catch {
    // Tělo, které nejde přečíst, se hlásí níž jako selhání se stavovým kódem.
  }
  const t = (telo ?? {}) as { stav?: unknown; error?: unknown; duvod?: unknown };
  // ⛔ O PRŮKAZU A DVEŘÍCH ROZHODUJE VÝSLOVNÁ ODPOVĚĎ BRÁNY, NE STAVOVÝ KÓD (naměřeno
  // 29. 9.): server bez nasazené cesty vrací 404 „Route … not found" a proxy před bránou
  // umí 403. Holá 404 tu byla „brána tablet nezná" → průvodce by technika poslal tablet
  // zavést znovu, ačkoli klíč je v pořádku. Brána odpovídá vždy s `error`.
  if (odpoved.status === 403 && t.error === "dvere_zavrene") return { stav: "dvere-zavrene" };
  if (odpoved.status === 404 && t.error === "nezname") return { stav: "nezname" };
  if (odpoved.ok && typeof t.stav === "string" && (STAVY as readonly string[]).includes(t.stav)) {
    return { stav: t.stav as StavPrukazu, kid };
  }
  // Důvod od brány (`podpis`/`replay`, `kid_nesedi`, …) se nese dál celý — „nepovedlo se"
  // bez důvodu by nešlo odlišit od zavřených dveří.
  const duvod = [t.error, t.duvod].filter((x) => typeof x === "string").join(": ");
  return { stav: "selhalo", duvod: `HTTP ${odpoved.status}${duvod ? ` ${duvod}` : ""}` };
}

/**
 * Ohlásí průkaz bráně. Opakované ohlášení je v pořádku: brána jen obnoví
 * „naposledy viděn", adresu a verze a vrátí stav — schválení nemění.
 */
export async function ohlasTablet(
  p: PovereniZarizeni,
  verze: Record<string, string>,
  deps: TabletDeps,
): Promise<VysledekTabletu> {
  try {
    const json = JSON.stringify({ kid: p.kid, publicKeyHex: p.publicKeyHex, scope: p.scope, verze });
    // Podpis kryje tělo přesně v bajtech, jak odejde — proto se odesílá TENTÝŽ řetězec.
    const telo = utf8Encode(json);
    const url = `${(await deps.zakladUrl()).replace(/\/+$/, "")}${CESTA_OHLASENI}`;
    const odpoved = await deps.fetch(url, {
      body: json,
      headers: { "Content-Type": "application/json", ...hlavicky(p, "POST", CESTA_OHLASENI, telo, deps) },
      method: "POST",
    });
    return await precti(odpoved, p.kid);
  } catch (e) {
    return { stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) };
  }
}

/** Zeptá se, jestli správce průkaz už schválil. */
export async function zjistiStavTabletu(p: PovereniZarizeni, deps: TabletDeps): Promise<VysledekTabletu> {
  try {
    const url = `${(await deps.zakladUrl()).replace(/\/+$/, "")}${CESTA_STAVU}`;
    const odpoved = await deps.fetch(url, {
      headers: hlavicky(p, "GET", CESTA_STAVU, new Uint8Array(0), deps),
      method: "GET",
    });
    return await precti(odpoved, p.kid);
  } catch (e) {
    return { stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) };
  }
}
