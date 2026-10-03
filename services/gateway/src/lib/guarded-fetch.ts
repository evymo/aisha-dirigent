/**
 * Odchozí HTTP gateway → vlastní upstreamy, přes SSRF guard.
 *
 * Pravidlo repa: nový odchozí povrch nesmí jít holým `fetch` (brána
 * `ssrf-no-bare-fetch`, Semgrep `aisha-raw-fetch-outside-ssrf-guard`).
 * Seznam výjimek se smí jen ZMENŠOVAT, takže zapsat se do něj není řešení,
 * ale obcházení — a whitelisty sem nepatří.
 *
 * Cíle jsou operátorská konfigurace (Keycloak, PostgREST), ne adresy od
 * uživatele. Guard tu přesto dává smysl: po DNS blokuje link-local a metadata
 * adresy, takže překlep v konfiguraci skončí chybou místo požadavku někam,
 * kam neměl mířit.
 *
 * `allowInternalNetworks: true` je nutné — obě služby běží uvnitř docker sítě
 * na RFC1918 adresách (`http://aisha-keycloak:80`, `http://postgrest:3000`).
 *
 * Jeden guard pro obě: seznam hostitelů se staví z konfigurace, takže přidání
 * dalšího upstreamu je jeden řádek a ne další kopie téhle úvahy.
 */
import { createSsrfGuard, parseHostAllowlist, type SsrfGuard } from '@aisha/security';
import { config } from '../config.js';

let guard: SsrfGuard | null = null;

function hostOf(url: string): string[] {
  try {
    return [new URL(url).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

function upstreamGuard(): SsrfGuard {
  if (guard) return guard;
  guard = createSsrfGuard({
    service: 'gateway',
    hostAllowlist: [
      ...parseHostAllowlist(process.env.SSRF_HOST_ALLOWLIST ?? ''),
      ...hostOf(config.keycloakUrl),
      ...hostOf(config.postgrestUrl),
      // Dveře (svc-knock): verdikt `/dvere` pro ohlášení tabletu (routes/zarizeni-klic.ts).
      ...hostOf(config.knockUrl),
    ],
    allowedSchemes: ['https:', 'http:'],
    allowInternalNetworks: true,
  });
  return guard;
}

/** Odchozí volání na vlastní upstream. Jediný povolený způsob v nových modulech. */
export function guardedFetch(url: string, init?: RequestInit): Promise<Response> {
  return upstreamGuard().safeFetch(url, init ?? {});
}

/** Jen pro testy — guard drží konfiguraci z okamžiku prvního použití. */
export function __resetGuard(): void {
  guard = null;
}
