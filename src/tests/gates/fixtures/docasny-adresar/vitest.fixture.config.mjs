// Fixture brány testy-uklidi-docasne-adresare: nejmenší konfigurace, která
// zapojí TÝŽ modul jako skutečné konfigurace (vitest*.config.* v kořeni).
// Kořenové konfigurace soubor nevyberou (.fixture.mjs neodpovídá jejich include).
import path from "node:path";
import { fileURLToPath } from "node:url";

const TADY = path.dirname(fileURLToPath(import.meta.url));

export default {
  test: {
    environment: "node",
    dir: TADY,
    include: ["*.fixture.mjs"],
    setupFiles: [path.resolve(TADY, "../../../../test/docasny-adresar-souboru.ts")],
    globalSetup: [path.resolve(TADY, "../../../../test/docasny-adresar-behu.ts")],
  },
};
