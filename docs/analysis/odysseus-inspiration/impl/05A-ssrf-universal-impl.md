# Impl 05A — SSRF guard: univerzální vynucení + DNS pinning (implementačně připraveno)

> Navazuje na spec `05-additional-patterns.md §5A`. **Pořadí:** 4. v sekvenci (rychlý security win, prerekvizit pro 04/06).

## 1. Reálný stav (ověřeno)
- `packages/security/src/ssrf.ts` je **silný**: `createSsrfGuard({ service, hostAllowlist, allowedSchemes, allowInternalNetworks })`, `safeFetch`, `check`, `parseHostAllowlist`, blokuje loopback/link-local/RFC1918/CGNAT/metadata (IPv4+IPv6).
- Používá se v ~20 souborech svc-ai-chat, ALE v `services/*/src` je **~177 bare `fetch(`** mimo guard → guard **není univerzální**.
- `safeFetch` přiznává: re-resolve při fetch, bez connector pinningu (úzké rebinding okno zůstává).

## 2. Cíl
1. **Deklarativní univerzální vynucení** — žádná LLM-driven / untrusted-driven odchozí cesta nesmí volat bare `fetch`.
2. **DNS pinning** pro high-stakes cesty (undici dispatcher).
3. **Architektonický test** + integrační SSRF rejection testy.

## 3. Sdílený guarded klient
`packages/security/src/ssrf.ts` rozšířit o pinned variantu:
```ts
import { Agent, type Dispatcher } from 'undici';

/** Pinned fetch: resolvuje host, ověří IP, a připojí se PŘÍMO na ověřenou IP (zavře rebinding okno). */
export function createPinnedSsrfGuard(opts: SsrfGuardOptions): SsrfGuard {
  const base = createSsrfGuard(opts);
  async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
    const { url: parsed, ip } = await base.check(url);
    const dispatcher: Dispatcher = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, ip, ip.includes(':') ? 6 : 4) }, // pin na ověřenou IP
    });
    return fetch(parsed, { ...init, dispatcher, signal: init?.signal ?? AbortSignal.timeout(30_000) } as any);
  }
  return { check: base.check, safeFetch };
}
```
Cesty konzumující untrusted/web (criticLoop, mcpToolProxy, deep research, SearXNG — impl 04/06) přepnout na `createPinnedSsrfGuard`.

## 4. Univerzální vynucení (lint/gate)
Nový gate `src/tests/gates/ssrf-no-bare-fetch.gate.test.ts`:
- prochází `services/*/src/**/*.ts`,
- hledá `fetch(` mimo allowlist souborů (kde je guarded klient legitimně definovaný),
- **fail** na bare `fetch` v untrusted/LLM-driven modulech (providers, criticLoop, mcpToolProxy, web-search, ragnarok fetch, hippocampus, proactiveEngine).
- Známé výjimky (interní mesh s host-allowlistem) v `ssrf-known-exemptions.ts` (jako security-known-issues vzor).

To přesně kopíruje filozofii Odysseus `THREAT_MODEL.md` (vyjmenované untrusted surfaces musí jít přes wrapper).

## 5. Integrační SSRF testy
`packages/security/src/__tests__/ssrf.pin.test.ts`:
- rebinding payload (host → veřejná IP při check, → 127.0.0.1 při fetch) **odmítnut** (pinned guard se připojí na ověřenou IP, ne na rebind).
- metadata IP (169.254.169.254) blokováno.
- IPv6 ULA/link-local blokováno.
- per-service host allowlist respektován.

## 6. Task checklist
- [ ] `createPinnedSsrfGuard` (undici dispatcher) v `ssrf.ts`.
- [ ] Migrace untrusted/web cest na pinned guard (criticLoop, mcpToolProxy, providers, ragnarok fetch).
- [ ] Gate `ssrf-no-bare-fetch` + exemptions soubor.
- [ ] Integrační rebinding/metadata testy.
- [ ] Audit ~177 bare fetch: rozdělit na (a) interní mesh s allowlistem → ponechat/zdokumentovat, (b) untrusted → na guard.

## 7. Vazby
- **Prerekvizit pro impl 04/06** — SearXNG dotaz i fetch výsledných stránek MUSÍ přes pinned guard.
- Doplňuje impl 02 (untrusted wrapper) — SSRF chrání síťovou stranu, wrapper prompt stranu.
