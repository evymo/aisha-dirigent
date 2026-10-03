/**
 * Odchozí HTTP ze storage-authu → vlastní upstreamy, přes SSRF guard.
 *
 * Pravidlo repa: nový odchozí povrch nesmí jít holým `fetch` (brána
 * `ssrf-no-bare-fetch` + OWASP A10 sonda). Seznam výjimek se smí jen ZMENŠOVAT,
 * takže zapsat se do něj není řešení, ale obcházení.
 *
 * Cíl je operátorská konfigurace (PostgREST, imgproxy), ne adresa od uživatele.
 * Guard tu přesto dává smysl: po DNS blokuje link-local a metadata adresy, takže
 * překlep v konfiguraci skončí chybou místo požadavku někam, kam neměl mířit.
 *
 * `allowInternalNetworks: true` je nutné — PostgREST i imgproxy běží uvnitř
 * docker sítě / meshe na RFC1918 adrese.
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
    service: 'storage-auth',
    hostAllowlist: [
      ...parseHostAllowlist(config.ssrfHostAllowlist),
      ...hostOf(config.postgrestUrl),
      ...hostOf(config.imgproxyUrl),
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
