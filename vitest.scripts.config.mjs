import { defineConfig } from "vitest/config";

// Isolated config for Node-side build/generator scripts under scripts/.
// Kept separate from the root jsdom suite (which only includes src/**) so these
// pure-Node tests never pull the .mjs generators into the TypeScript program.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.mjs"],
  },
});
