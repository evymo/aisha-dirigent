// Polyfill for Array.prototype.toReversed (ES2023) - needed for metro-config in Gradle builds
if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function () {
    return [...this].reverse();
  };
}

const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// ---------------------------------------------------------------------------
// Shared source packages from repo monorepo-style root.
// `@aisha/api-core` is consumed as a source module (no build step).
// ---------------------------------------------------------------------------
const repoRoot = path.resolve(__dirname, "..");
const apiCoreRoot = path.resolve(repoRoot, "packages/api-core");
// `@aisha/knock-protocol` je tu ze STEJNÉHO důvodu jako api-core: sdílený zdroj
// z kořene repa, na který `package.json` odkazuje `file:../packages/...`.
//
// ⛔ SYMLINK V `node_modules` NESTAČÍ. npm ho vyrobí, jest a tsc ho následují,
// ale Metro symlinky mimo kořen projektu ve výchozím stavu NEnásleduje — takže
// se to projeví AŽ při balení aplikace, nikdy dřív.
//
// Naměřeno 2026-08-09 na buildu do TestFlightu: `knock.ts` v repu ležel dlouho,
// ale importoval ho JEN jeho vlastní test. Jakmile ho obrazovka „Zaklepat"
// vtáhla do grafu balíčku poprvé, archiv spadl na
// `Unable to resolve module @aisha/knock-protocol`.
// ⚠️ CI byla zelená: `Mobile: TypeScript & Tests` pouští tsc + jest, a ŽÁDNÁ
// lane aplikaci nebalí. Zelená CI o rozložitelnosti balíčku nic netvrdí.
const knockProtocolRoot = path.resolve(repoRoot, "packages/knock-protocol");
// Extranet SDK (nativní kit + tokeny) — ze submodulu `packages/extranet-sdk`,
// `file:` odkaz v package.json. Tentýž důvod jako u knock-protocol: Metro
// symlink mimo kořen projektu nenásleduje, a `native` importuje tokeny
// (`@aisha/extranet-sdk-tokens/native.js`) ze SVÉHO umístění, ne z mobile-app.
const sdkNativeRoot = path.resolve(repoRoot, "packages/extranet-sdk/packages/native");
const sdkTokensRoot = path.resolve(repoRoot, "packages/extranet-sdk/packages/tokens");

config.watchFolders = [
  ...(config.watchFolders || []),
  apiCoreRoot,
  knockProtocolRoot,
  sdkNativeRoot,
  sdkTokensRoot,
];

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@aisha/api-core": apiCoreRoot,
  "@aisha/knock-protocol": knockProtocolRoot,
  "@aisha/extranet-sdk-native": sdkNativeRoot,
  "@aisha/extranet-sdk-tokens": sdkTokensRoot,
};
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths || []),
  path.resolve(__dirname, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

// ---------------------------------------------------------------------------
// Build-time secrets must never reach the bundler.
//
// `.env.build.example` tells you to put APPLE_TEAM_ID and SENTRY_AUTH_TOKEN in
// `.env.build.local` — inside this directory, which Metro watches. It is not a
// module, so Metro fails to parse it, and its dev error overlay prints the
// offending file's CONTENTS on the device screen: measured 2026-08-03, a live
// Sentry auth token rendered full-length in the simulator (and in any screenshot
// or screen recording taken at that moment). The archive build never hit this —
// only the dev server does, which is exactly where someone is most likely to be
// sharing their screen.
//
// Blocking it keeps the documented workflow usable without that hazard. The file
// is read by scripts/build-ios.sh with `source`, never by the bundler, so nothing
// legitimate needs it resolvable.
// ---------------------------------------------------------------------------
// A plain RegExp on purpose: metro's `exclusionList` helper is not a public
// export in this version (ERR_PACKAGE_PATH_NOT_EXPORTED), and blockList accepts
// a RegExp directly. Existing entries are preserved by alternation.
const blockEnvBuild = /\/\.env\.build\.[^/]*$/;
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = existingBlockList
  ? new RegExp(`(?:${existingBlockList.source})|(?:${blockEnvBuild.source})`)
  : blockEnvBuild;

module.exports = config;
