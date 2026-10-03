/**
 * Identita ZAŘÍZENÍ pro zbytek aplikace (F2) — registr bez nativních závislostí.
 *
 * Relaci tabletu vyrábí `relaceTabletu.ts` nad nativní kryptografií (`knock-native.ts`),
 * kterou jest nesmí načíst. API klient, offline fronta i obrazovka předání se proto ptají
 * TADY a skutečný zdroj zapojí jen `_layout.tsx` na zařízení v kiosku (vzor
 * `setIdentityProvider` / `setTrezorDeps`). Bez zapojení je všechno null — telefon
 * s přihlášeným člověkem se chová přesně jako dřív.
 */
import type { ZdrojRelace } from "./relaceTabletu";

let zdroj: ZdrojRelace | null = null;

export function nastavZdrojZarizeni(z: ZdrojRelace | null): void {
  zdroj = z;
}

/** Token relace tabletu, nebo null (není kiosk / relace nevydána). */
export async function tokenZarizeni(): Promise<string | null> {
  return zdroj ? zdroj.token().catch(() => null) : null;
}

/** Uid účtu zařízení (přežije výpadek sítě), nebo null. */
export function uzivatelZarizeni(): string | null {
  return zdroj?.uzivatel() ?? null;
}

export function zdrojZarizeni(): ZdrojRelace | null {
  return zdroj;
}
