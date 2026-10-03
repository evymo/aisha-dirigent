// @ts-check
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: !watch,
  // Treat shell + markdown + node-script imports as raw text so the
  // claude-overlay generator can embed templates from
  // scripts/ide-adapters/templates/claude-overlay/ directly into the bundle
  // (no runtime workspace fs dependency). The .mjs entry covers the Vrstva 2
  // relay script (aisha-supervisor-relay.mjs) which is a Node script meant to
  // be EXTRACTED to disk, NOT executed inside the extension — bundling it as
  // text avoids esbuild trying to wrap its top-level await for CJS output.
  loader: {
    ".sh": "text",
    ".md": "text",
    ".txt": "text",
  },
};

if (watch) {
  esbuild.context(config).then((ctx) => {
    ctx.watch();
    console.log("[esbuild] Watching for changes...");
  });
} else {
  esbuild.build(config).then(() => {
    console.log("[esbuild] Build complete.");
  });
}
