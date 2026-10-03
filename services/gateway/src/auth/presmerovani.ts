/**
 * Kam smí gateway po přihlášení poslat prohlížeč — a s ním access i refresh token.
 *
 * ⛔ NAMĚŘENO 2026-09-29 (relace Android management API) a 2026-10-01 (audit veřejného
 * vydání, bloker B4 / PR-S1): produkční gateway běžela s VÝVOJÁŘSKÝM allowlistem. Compose
 * jí nepředával FRONTEND_URL, PUBLIC_URL ani ALLOWED_REDIRECT_URIS (v trezoru nejsou),
 * takže platily výchozí hodnoty z config.ts: localhost, vlastní schémata a
 * `https://vscode.dev/redirect*` — přesměrovač, který prohlížeč pošle na URI z parametru
 * `url`. /auth/v1/callback přitom tokeny připojí k cíli.
 *
 * Pravidla:
 *   - adresy se ODVOZUJÍ z domén, které gateway dostává (API_DOMAIN_PUBLIC, APP_DOMAIN);
 *     výslovné PUBLIC_URL / FRONTEND_URL / ALLOWED_REDIRECT_URIS mají přednost (operátor);
 *   - v produkci žádné vývojářské výchozí hodnoty: co nejde odvodit, zůstane PRÁZDNÉ
 *     a trasy přihlášení odpoví 503 — tokeny nepošlou nikam jinam;
 *   - bez ALLOWED_REDIRECT_URIS pouští allowlist jen origin frontendu.
 *
 * Klienti VS Code (Dirigent) ani mobilní aplikace tenhle allowlist nepoužívají: přihlašují
 * se PŘÍMO u Keycloaku přes PKCE a redirect_uri hlídá klient realmu (změřeno:
 * extensions/aisha-dirigent/src/auth.ts loginWithPkce, mobile-app/src/config/oidc.ts).
 */

export interface Presmerovani {
  /** Veřejná adresa gatewaye (redirect_uri callbacku u Keycloaku). Prázdná = nenastaveno. */
  publicUrl: string;
  /** Kam se vrací prohlížeč po přihlášení. Prázdná = nenastaveno. */
  frontendUrl: string;
  /** Povolené cíle `redirect_to`. */
  allowedRedirectUris: string[];
}

/** Pohodlí jen pro lokální vývoj — v produkci se nepoužije nikdy. */
const VYVOJ = {
  publicUrl: 'http://localhost:3001',
  frontendUrl: 'http://localhost:5173',
  dalsiCile: ['http://localhost:8100'],
} as const;

const bezKoncovehoLomitka = (u: string | undefined): string => (u ?? '').trim().replace(/\/+$/, '');

/** Deklarovaná doména (holý host nebo URL) → `https://host`; prázdná → ''. */
function zDomeny(domena: string | undefined): string {
  const h = bezKoncovehoLomitka(domena);
  if (!h) return '';
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
}

export function odvodPresmerovani(env: Record<string, string | undefined>): Presmerovani {
  const produkce = env.NODE_ENV === 'production';

  const publicUrl =
    bezKoncovehoLomitka(env.PUBLIC_URL) || zDomeny(env.API_DOMAIN_PUBLIC) || (produkce ? '' : VYVOJ.publicUrl);
  const frontendUrl =
    bezKoncovehoLomitka(env.FRONTEND_URL) || zDomeny(env.APP_DOMAIN) || (produkce ? '' : VYVOJ.frontendUrl);

  const vyslovne = (env.ALLOWED_REDIRECT_URIS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  let allowedRedirectUris: string[];
  if (vyslovne.length > 0) allowedRedirectUris = vyslovne;
  else if (!frontendUrl) allowedRedirectUris = [];
  else if (produkce) allowedRedirectUris = [frontendUrl];
  else allowedRedirectUris = [frontendUrl, ...VYVOJ.dalsiCile.filter((u) => u !== frontendUrl)];

  return { publicUrl, frontendUrl, allowedRedirectUris };
}
