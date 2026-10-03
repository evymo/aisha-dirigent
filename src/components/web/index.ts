export { PageRenderer } from "./PageRenderer";
// WebPageShell is intentionally NOT re-exported: it is loaded as a lazy chunk
// by router.tsx and EditorPageGate.tsx via a dynamic import("./WebPageShell").
// A static barrel re-export made it a mixed import Vite could not split.
