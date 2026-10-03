export { default as Index } from "../Index";
// Story is intentionally NOT re-exported here: it is dynamically imported by
// both router.tsx and lib/perf/preloadPublicPages.ts via "@/pages/Story".
// Re-exporting it statically here made it a mixed static+dynamic import that
// Vite could not code-split (build warning).
export { default as Whitepaper } from "../Whitepaper";
export { default as Partners } from "../Partners";
export { default as Research } from "../Research";
export { default as FAQ } from "../FAQ";
export { default as RTNProtocol } from "../RTNProtocol";
