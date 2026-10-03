/**
 * Fail fast with a clear message if Node < 22.
 *
 * Wired as the root `preinstall` so a wrong Node (e.g. an old system default)
 * is caught the moment you run `npm install`, instead of a cryptic syntax/ABI
 * error deep in a build step. Deliberately written in ES5 CommonJS so it runs
 * (and prints) on ANY Node version, including legacy ones.
 *
 * The repo pins Node 22 via .nvmrc + root package.json engines.
 */
"use strict";

var major = parseInt(String(process.versions.node).split(".")[0], 10);

if (isNaN(major) || major < 22) {
  process.stderr.write(
    "\n❌  Node 22+ is required (you are on " + process.versions.node + ").\n" +
      "   This repo pins Node 22 (.nvmrc). Run:  nvm use   — or install Node 22.\n\n"
  );
  process.exit(1);
}
