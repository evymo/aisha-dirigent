/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Build-time defines injected by Vite (see vite.config.ts). Each is
// captured at `npm run build` time from git / CI environment and embedded
// as a string literal in the bundle. May be undefined at runtime if the
// build wasn't done through the configured Vite pipeline (e.g. raw vitest
// in a fresh worktree).
declare const __RELEASE_TAG__: string | undefined;
declare const __GIT_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;
declare const __REPO_SLUG__: string | undefined;
declare const __GITHUB_SERVER_URL__: string | undefined;
declare const __GITHUB_WORKFLOW__: string | undefined;
declare const __GITHUB_RUN_ID__: string | undefined;
declare const __GITHUB_RUN_NUMBER__: string | undefined;
declare const __GITHUB_REF_NAME__: string | undefined;
