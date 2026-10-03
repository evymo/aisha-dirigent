/**
 * Služba registruje hooky a pluginy Fastify PŘED `listen()`, nikdy po něm.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru): services/svc-plugin-system/src/server.ts volal
 * `app.addHook('onClose', …)` až po `await app.listen(…)`. Fastify to odmítne
 * výjimkou „Fastify instance is already listening. Cannot call addHook!", catch
 * ji zapsal jako fatal a zavolal `process.exit(1)` — při KAŽDÉM startu, protože
 * na produkci je AGENT_RUNNER_ENABLED zapnutý. Kontejner padal dokola, po 11
 * restartech Coolify spustil StopApplication a smazal CELÝ aisha-core
 * (00:35 UTC). API guru bylo ~6 h dole, přestože build i nasazení hlásily úspěch.
 *
 * Jednotkové testy to neviděly: startovací skript serveru nespouští žádný test.
 * Proto se měří ze ZDROJE vstupního bodu každé služby: po prvním volání
 * `.listen(` už nesmí následovat `addHook`, `register`, `decorate`,
 * `addContentTypeParser`, `setErrorHandler` ani `setNotFoundHandler` — Fastify
 * je po spuštění všechny odmítá stejnou výjimkou.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SLUZBY = join(ROOT, "services");

/** Zdroj bez komentářů — zmínka v komentáři není volání. */
function bezKomentaru(zdroj: string): string {
  return zdroj.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const ZAKAZANE_PO_LISTEN = /\.(addHook|register|decorate|addContentTypeParser|setErrorHandler|setNotFoundHandler)\s*\(/g;

/** Volání zakázaná po `listen()` v jednom vstupním souboru. */
export function registracePoListen(zdroj: string): string[] {
  const kod = bezKomentaru(zdroj);
  const listen = /\.listen\s*\(/.exec(kod);
  if (!listen) return [];
  const po = kod.slice(listen.index + listen[0].length);
  return [...po.matchAll(ZAKAZANE_PO_LISTEN)].map((m) => m[1]);
}

const VSTUPY = readdirSync(SLUZBY)
  .map((s) => join(SLUZBY, s, "src", "server.ts"))
  .filter((p) => existsSync(p));

describe("Fastify: registrace před listen() (brána)", () => {
  test("univerzum: měřidlo vidí vstupní body služeb a většina z nich volá listen()", () => {
    expect(VSTUPY.length, "žádný services/*/src/server.ts — měřidlo přestalo vidět").toBeGreaterThan(20);
    const sListen = VSTUPY.filter((p) => /\.listen\s*\(/.test(readFileSync(p, "utf8")));
    expect(sListen.length, "skoro žádná služba nevolá listen() — vzor se rozešel s kódem").toBeGreaterThan(15);
  });

  test("detektor: přesně tvar, který shodil plugin-system, najde; zmínku v komentáři ne", () => {
    const vadny = "await app.listen({ port });\nif (x) {\n  app.addHook('onClose', async () => stop());\n}";
    expect(registracePoListen(vadny)).toEqual(["addHook"]);
    const opraveny = "app.addHook('onClose', async () => stop?.());\nawait app.listen({ port });\nstop = start();";
    expect(registracePoListen(opraveny)).toEqual([]);
    expect(registracePoListen("await app.listen({ port });\n// app.addHook('x') by tu nesmělo být")).toEqual([]);
  });

  test("⛔ žádná služba po listen() neregistruje hook ani plugin", () => {
    const vady = VSTUPY.flatMap((p) =>
      registracePoListen(readFileSync(p, "utf8")).map((volani) => `${p.slice(ROOT.length + 1)}: .${volani}() po listen()`),
    );
    expect(vady, vady.join("\n")).toEqual([]);
  });
});
