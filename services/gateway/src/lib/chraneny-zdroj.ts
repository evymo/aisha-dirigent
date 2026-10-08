/**
 * Chráněný zdroj OAuth: koncový bod serveru znalostí (MCP) za proxy `/functions/v1`.
 *
 * Klient MCP se přihlašuje u Keycloaku instance (autorizační kód + PKCE). Kam se má jít
 * přihlásit, se dozví z odpovědi 401: hlavička `WWW-Authenticate` nese adresu METADAT
 * ZDROJE (RFC 9728 §5.1) a ta jmenují autorizační server. Specifikace autorizace MCP
 * tuhle hlavičku od serveru vyžaduje.
 *
 * JEDEN domov: z těchto funkcí bere výzvu proxy (routes/functions.ts) i trasu metadat
 * (routes/oauth-metadata.ts). Hlavička tak nemůže ukazovat na adresu, kterou nikdo
 * neobsluhuje, a `resource` v metadatech se nemůže rozejít s adresou koncového bodu.
 *
 * ⛔ Veřejná adresa se NEHÁDÁ. Bere se z `config.publicUrl`; když chybí (produkce bez
 * API_DOMAIN_PUBLIC / PUBLIC_URL), výzva se neposílá a metadata zdroje se nevydají.
 * Z hlavičky `Host` se neodvozuje — tu si píše volající.
 *
 * ⚠ Zdroj má pro OAuth JEDNU adresu: tu na veřejné adrese gatewaye. Edge týž koncový bod
 * zveřejňuje i pod doménou MCP (docker-compose.coolify-prebuilt.yml, `@mcpRpc` — směruje
 * jen cestu funkce, metadata tam obsloužená nejsou). Výzva i `resource` proto vždy popisují
 * adresu na veřejné adrese gatewaye; klient připojený přes doménu MCP adresy neshodne.
 */

/**
 * Klient realmu jen pro přihlášení klientů MCP (IDE, CLI) a audience, kterou jeho tokeny nesou.
 * Token toho klienta patří JEN serveru MCP: gateway ho za JWT PostgRESTu NEVYMĚNÍ
 * (auth/postgrest-jwt.ts), server MCP vyžaduje audience. Shodu s realmem a se službou
 * svc-mcp-knowledge (src/mcp-zdroj.ts) drží brána mcp-token-patri-jen-serveru-mcp.
 */
export const KLIENT_MCP = 'aisha-mcp-client';
export const AUDIENCE_SERVERU_ZNALOSTI = 'aisha-mcp-knowledge';

/** Kořen metadat chráněného zdroje (RFC 9728 §3). */
export const CESTA_METADAT_ZDROJE = '/.well-known/oauth-protected-resource';

/** Cesta koncového bodu serveru znalostí na veřejné adrese gatewaye. */
export const CESTA_SERVERU_ZNALOSTI = '/functions/v1/mcp-knowledge-server';

/** Metadata TOHOTO zdroje: kořen metadat + cesta zdroje (RFC 9728 §3.1). */
export const CESTA_METADAT_SERVERU_ZNALOSTI = `${CESTA_METADAT_ZDROJE}${CESTA_SERVERU_ZNALOSTI}`;

/**
 * Origin veřejné adresy gatewaye, nebo `null`, když z ní adresu zdroje složit nejde:
 * není nastavená, není to http(s) URL, nebo nese cestu, dotaz či přihlašovací údaje.
 *
 * Adresa s cestou se ODMÍTÁ: metadata zdroje leží podle RFC 9728 na kořeni hostitele
 * a kam by takový prefix směrovala vrstva před gatewayí, odsud zjistit nejde.
 */
function verejnyOrigin(publicUrl: string): string | null {
  const hodnota = publicUrl.trim();
  if (!hodnota) return null;
  let url: URL;
  try {
    url = new URL(hodnota);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  return url.origin;
}

/** Veřejná adresa koncového bodu serveru znalostí — hodnota `resource` v jeho metadatech. */
export function adresaServeruZnalosti(publicUrl: string): string | null {
  const origin = verejnyOrigin(publicUrl);
  return origin ? `${origin}${CESTA_SERVERU_ZNALOSTI}` : null;
}

/** Veřejná adresa metadat serveru znalostí — kam ukazuje výzva k přihlášení. */
export function adresaMetadatServeruZnalosti(publicUrl: string): string | null {
  const origin = verejnyOrigin(publicUrl);
  return origin ? `${origin}${CESTA_METADAT_SERVERU_ZNALOSTI}` : null;
}

/**
 * Hodnota hlavičky `WWW-Authenticate` pro 401 ze serveru znalostí, nebo `null`, když
 * veřejnou adresu nejde složit — pak se hlavička neposílá vůbec.
 */
export function vyzvaKPrihlaseni(publicUrl: string): string | null {
  const metadata = adresaMetadatServeruZnalosti(publicUrl);
  return metadata ? `Bearer resource_metadata="${metadata}"` : null;
}
