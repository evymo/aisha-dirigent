/**
 * host.mjs — KDE plugin běží. Jediné místo, kde se to rozhoduje.
 *
 * ⛔ NAMĚŘENO 2026-09-13. Pod `kind: data_source` + `source_spec.adapter_entry`
 * žijí dva různé druhy kódu a platforma je nerozlišovala:
 *
 *   1. SANDBOXOVÝ KONEKTOR (eurowag-telematics, tcars-fleet, webdispecink-fleet)
 *      — exportuje `init`/`handle`, mluví přes `ctx.fetch`, build ho zabalí do
 *      IIFE a shim ho pustí v `node:vm` bez `require`/`process`/`globalThis`.
 *   2. ADAPTÉR BROKERU (IDataSource) — exportuje `createDataSource`, plugin host
 *      `svc-source-broker` ho načte `import()` z cesty v obrazu a běží V PROCESU.
 *      Smí tedy to, co sandbox vypíná — třeba čisté `pg` přes read-only roli.
 *
 * Schéma `source_spec` popisovalo druhý případ, build ale každý `adapter_entry`
 * balil jako první. Adaptér s `pg` pak build shodil (esbuild na `net`/`tls`)
 * a publish-plugins.sh nevyrobil dist pro ŽÁDNÝ plugin. Doplnit pole naslepo
 * by rozbilo publikaci všem.
 *
 * Proto se host DEKLARUJE. Výchozí je `sandbox`, takže existující pluginy
 * nemění chování ani bajt artefaktu. Adaptér brokeru se přihlásí výslovně
 * `source_spec.host: "source-broker"` — nehádá se z exportů ani z cest.
 *
 * Čte build (scripts/plugins/build.mjs) i brány, aby se nemohly rozejít.
 *
 * @module
 */

/** Známé hosty. Pořadí je jen pro čitelné hlášky. */
export const HOSTS = Object.freeze(["sandbox", "source-broker"]);

/**
 * Host pluginu podle manifestu.
 *
 * Neznámá hodnota je CHYBA, ne tichý sandbox: překlep typu `source_broker`
 * by jinak adaptér brokeru poslal do sandboxového buildu — přesně do pasti,
 * kterou tohle pole zavírá.
 *
 * @param {Record<string, unknown> | null | undefined} manifest
 * @returns {"sandbox" | "source-broker"}
 */
export function hostOf(manifest) {
  const spec = manifest?.source_spec;
  const host = spec && typeof spec === "object" ? spec.host : undefined;
  if (host === undefined || host === null) return "sandbox";
  if (!HOSTS.includes(host)) {
    throw new Error(`source_spec.host '${String(host)}' není známý host (${HOSTS.join(" | ")})`);
  }
  return host;
}
