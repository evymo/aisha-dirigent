/**
 * EditorPageGate — Gradual migration wrapper for explicit routes.
 *
 * Checks whether a published editor page (web_pages) exists for the
 * given slug. If yes, renders it via WebPageShell (GrapesJS content).
 * If no, renders the original hardcoded children component.
 *
 * This enables zero-downtime page migration: an admin seeds the page
 * content in the editor, publishes it, and the editor version
 * automatically takes over — no deploy needed.
 *
 * React Query caching ensures the check adds negligible overhead;
 * WebPageShell re-uses the same queryKey, so the data is already
 * warm in cache.
 *
 * @example
 * ```tsx
 * <Route
 *   path="/story"
 *   element={
 *     <EditorPageGate slug="story">
 *       <Story />
 *     </EditorPageGate>
 *   }
 * />
 * ```
 *
 * @module
 */

import { lazy, Suspense } from "react";

import { useWebPage } from "@/hooks/useWebPage";

import type { ReactNode } from "react";

// Lazy so WebPageShell is a code-split chunk (matches router.tsx's lazy WebPage).
// A static import here made it BOTH statically + dynamically imported → Vite
// could not split it (build warning). The Suspense fallback is the original
// children, so there is still no blank flash while the chunk loads.
const WebPageShell = lazy(() => import("./WebPageShell"));

/** Props for EditorPageGate. */
interface EditorPageGateProps {
  /** Fallback component rendered when no editor page is published. */
  children: ReactNode;
  /** Slug to look up in web_pages. Must match the published page slug. */
  slug: string;
}

/**
 * Wrapper that checks for a published editor page and either renders
 * it (via WebPageShell) or falls through to the original component.
 */
export function EditorPageGate({ children, slug }: EditorPageGateProps) {
  const { data: page, isError, isLoading } = useWebPage(slug);

  // ⛔ ZA NEJISTOTY SE NEUKAZUJE CIZÍ STRÁNKA (naměřeno 2026-08-30).
  //
  // Tady stálo `return <>{children}</>` s odůvodněním „typically instant
  // thanks to staleTime / React Query cache". Při STUDENÉM načtení ale cache
  // prázdná je a `useWebPage` je síťové kolečko: na /news/ se několik sekund
  // kreslila PLATFORMNÍ stránka „What's New" s hlavičkou AISHA · DIRIGENT BY
  // EVYMO a hláškou „No news articles published yet", než ji nahradil náš web
  // s 92 články. Návštěvník tedy viděl cizí značku a tvrzení, že žádné články
  // nejsou — obojí nepravdu.
  //
  // Neplést s prázdnem: dokud se neví, KTERÁ stránka to je, není co ukázat.
  // Nic je poctivější než cizí obsah; jakmile odpověď dorazí, vykreslí se ta
  // správná. `null` je vědomá volba, ne opomenutí.
  if (isLoading) {
    return null;
  }

  // ⛔ SELHÁNÍ DOTAZU NENÍ „STRÁNKA NEEXISTUJE" (naměřeno 2026-08-31).
  //
  // React Query vrací při chybě `data === undefined` — tedy TÝŽ tvar jako když
  // pro slug opravdu žádná stránka z editoru není. Poslední větev pak vykreslila
  // `children`, což je PLATFORMNÍ komponenta: návštěvník sanghy dostal oranžovou
  // stránku AISHA. A protože se to děje jen při výpadku API, vypadá to jako
  // rozbitý web značky, ne jako nedostupné rozhraní.
  //
  // Rozlišení je levné a rozhodující: `isError` říká „nevím", zatímco
  // `page == null` po úspěšném dotazu říká „vím, že tu žádná není". Za nejistoty
  // platí totéž co o řádek výš — nic je poctivější než cizí obsah.
  if (isError) {
    return null;
  }

  // Published editor page found → render from GrapesJS canvas (lazy chunk;
  // fall back to the original component while the shell chunk loads).
  if (page) {
    return (
      <Suspense fallback={null}>
        <WebPageShell slug={slug} />
      </Suspense>
    );
  }

  // No editor page → render original hardcoded component
  return <>{children}</>;
}
