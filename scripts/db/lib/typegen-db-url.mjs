/**
 * Adresa DB pro generátor typů (CLI `gen types --db-url`, verzi pinuje gen-types.mjs).
 *
 * ⛔ NAMĚŘENO 2026-09-29 (Android, `--debug` nad zahazovací DB):
 *     {"code":"DbConnectError","message":"… tls error (The server does not support SSL
 *      connections)","suggestion":"Set `sslmode=disable` on the connection string …"}
 * CLI od 2.118 zkouší TLS. Zahazovací DB (with-throwaway-db / types-refresh-throwaway)
 * i lokální stacky běží na loopbacku BEZ SSL, takže generace padala — a skript hlásil
 * „Is the DB accessible?“, tedy hádal. Téhož dne to trefilo zvednutí verze i fork,
 * který ještě volal nepřipnutý `@latest`.
 *
 * Proto: loopback bez výslovného `sslmode` dostane `sslmode=disable` (šifrovat spojení
 * na vlastní smyčku nemá co chránit). Vzdálená adresa se NEMĚNÍ — tam o TLS rozhoduje
 * volající a tiché vypnutí by bylo downgrade. Výslovné `sslmode` se nikdy nepřepíše.
 *
 * @module
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * @param {string} url  `postgresql://user:pass@host:port/db?…`
 * @returns {string} tatáž adresa; u loopbacku bez sslmode s `sslmode=disable`
 */
export function adresaProGeneratorTypu(url) {
  // Ne-URL (conninfo `host=… port=…`) se nepřepisuje — druhý parser libpq by se
  // s prvním rozešel. `canParse` místo try/catch: tichý catch by tu schoval i vadu.
  if (!URL.canParse(url)) return url;
  const u = new URL(url);
  if (!/^postgres(ql)?:$/i.test(u.protocol)) return url;
  if (!LOOPBACK.has(u.hostname.toLowerCase())) return url;
  if (u.searchParams.has("sslmode")) return url;
  u.searchParams.set("sslmode", "disable");
  return u.toString();
}
