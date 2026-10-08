/**
 * Verze Docker Engine API jako SEGMENT CESTY: `v1.45` → `/v1.45/networks`.
 *
 * ⛔ DVA ZÁPISY TÉŽE HODNOTY (naměřeno 2026-09-30 na instanci). Doktor prostředí
 * zapisuje `DOCKER_API_VERSION=1.45` podle konvence Dockeru (tak ji čte i
 * docker CLI), výchozí hodnota v compose i tady nesla `v1.46`. Kód skládal
 * `'/' + hodnota`, takže z env vznikla cesta `/1.45/networks` a Docker vrátil
 * `404 page not found` — každý běh pluginu padl. Skryla to předchozí vada
 * (EACCES na docker.sock): k volání API se běh do té doby nedostal.
 *
 * Přijímá se proto obojí a segment se skládá tady, na jednom místě. Jiný tvar
 * není „nějaká verze“, ale chyba konfigurace — služba nenastartuje, místo aby
 * posílala cesty, na které Docker odpoví 404 až za běhu.
 */
export function dockerApiSegment(raw: string): string {
  const m = /^v?(\d+\.\d+)$/.exec(raw.trim());
  if (!m) {
    throw new Error(`DOCKER_API_VERSION „${raw}“ není verze Docker API (čekám 1.45 nebo v1.45)`);
  }
  return `v${m[1]}`;
}
