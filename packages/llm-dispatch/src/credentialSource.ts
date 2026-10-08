/**
 * Zdroj klíčů poskytovatelů pro cloudové backendy (OpenAI, Gemini, Anthropic, xAI).
 *
 * Každý fork AISHY si klíče poskytovatelů nastaví v administraci do SVÉHO trezoru
 * (pověření `credential:<JMÉNO>`). Služba, která dispatch používá, při startu předá
 * svou čtečku pověření (`@aisha/security` createCredentialReader → `get`) přes
 * `setProviderKeySource` a backendy si klíč berou V OKAMŽIKU VOLÁNÍ — ne z
 * process.env při sestavení backendu. Tenhle modul žádný trezor nečte: je to jen
 * kanál k té jediné čtečce služby (brána jeden-ctenar-povereni).
 *
 * Pořadí:
 *   1. pevný klíč z konstruktoru — volající ho předal výslovně (např. resolver
 *      svc-mcp-knowledge, který klíč backendu už vyřešil čtečkou),
 *   2. služba předala zdroj → JEN zdroj (čtečka: trezor → přechodně env s hlasitým
 *      varováním → null); výpadek trezoru = výjimka, žádný tichý env,
 *   3. bez zdroje (CLI, skripty, testy bez DB) → process.env jako dřív.
 */

/** Vrátí hodnotu pověření (jméno proměnné prostředí → hodnota), nebo null. */
export type ProviderKeySource = (envVar: string) => Promise<string | null>;

let zdroj: ProviderKeySource | null = null;

/** Služba předá svou čtečku pověření (null = zpět na process.env, jen pro testy). */
export function setProviderKeySource(source: ProviderKeySource | null): void {
  zdroj = source;
}

/** Má služba předaný zdroj pověření? (registr podle toho smí sladit backendy s trezorem) */
export function hasProviderKeySource(): boolean {
  return zdroj !== null;
}

const neprazdny = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** Klíč poskytovatele v okamžiku volání — viz pořadí v hlavičce modulu. */
export async function resolveProviderKey(envVar: string, fixed?: string): Promise<string | null> {
  if (neprazdny(fixed)) return fixed as string;
  if (zdroj) return neprazdny(await zdroj(envVar));
  return neprazdny(process.env[envVar]);
}

/** Hláška pro chybějící klíč — co chybí a kde se nastavuje (nikdy hodnota). */
export function chybiKlic(provider: string, envVar: string): Error {
  return new Error(
    `[${provider}] ${envVar} not configured — pověření nastavte v administraci instance (Poskytovatelé AI a tokeny)`,
  );
}
