import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Isolated config for Node-side build/generator scripts under scripts/.
// Kept separate from the root jsdom suite (which only includes src/**) so these
// pure-Node tests never pull the .mjs generators into the TypeScript program.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.mjs"],
    // Každý soubor dostane vlastní dočasný adresář a po sobě ho smaže.
    setupFiles: [path.resolve(ROOT, "./src/test/docasny-adresar-souboru.ts")],
    globalSetup: [path.resolve(ROOT, "./src/test/docasny-adresar-behu.ts")],
  },
});
