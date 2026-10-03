import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HostnameBrandingBridge } from "@/components/branding/HostnameBrandingBridge";
import { queryClient } from "@/lib/reactQuery/client";
import { webPageQuery } from "@/hooks/useWebPage";
import { webPartialsQuery } from "@/hooks/useWebPartials";
import { router } from "./router";
import { initI18n } from "./i18n";
import "./index.css";

// Ensure i18n is initialized before render
void initI18n();

// ⛔ DESIGN SE NESMÍ ZAČÍT STAHOVAT AŽ PO ZBYTKU (naměřeno 2026-08-30 na živém webu).
//
// Vodopád při studeném načtení `/` byl:
//   177–440 ms   8× paralelně: branding, config, měny, jazyky, hero, statistiky
//   699–1097 ms  get_web_page_by_slug  ← teprve TEĎ obsah, který uživatel vidí
//   1473–1740 ms články, štítky, překlady
//
// Stránka na ničem z první vlny NEZÁVISÍ — čekala jen na to, až se skrz i18n
// a routovací lazy chunky domountuje `EditorPageGate`. Do té doby byla obrazovka
// prázdná. Odpálením dotazu tady jde na drát v ~60 ms, tedy SOUČASNĚ s první
// vlnou, a než se komponenta domountuje, odpověď už v cache leží.
//
// Klíč i queryFn jsou sdílené (webPageQuery) — jinak by prefetch plnil jinou
// přihrádku, než hook čte, a nezrychlil by nic. Chyba se polyká záměrně: tohle
// je jen zahřátí cache, autoritativní dotaz pořád dělá hook (a ošetří chybu).
const slugZCesty = (() => {
  const p = window.location.pathname.replace(/^\/|\/$/g, "");
  return p === "" ? "index" : p;
})();
if (!slugZCesty.includes("/")) {
  void queryClient.prefetchQuery(webPageQuery(slugZCesty)).catch(() => undefined);
  // ⛔ ÚTRŽKY SOUČASNĚ, NE POTOM. Hlavička a patička jsou sdílený obsah, který
  // stránka potřebuje stejně nutně jako sebe samu — `PageRenderer` bez nich
  // vykreslí ticho. Sériové načtení by přidalo celý okruh k času do prvního
  // pixelu; odpálené tady jdou na drát v téže vlně jako stránka.
  void queryClient.prefetchQuery(webPartialsQuery()).catch(() => undefined);
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found in DOM");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
       * HostnameBrandingBridge resolves window.location.hostname against
       * `branding_hostname_mapping` (via the `get_branding_for_hostname`
       * RPC) and feeds the resolved profile to BrandingThemeProvider.
       * For unmapped hostnames it falls through to the global default
       * brand — matching the previous single-brand behaviour.
       */}
      <HostnameBrandingBridge>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </HostnameBrandingBridge>
    </QueryClientProvider>
  </StrictMode>
);
