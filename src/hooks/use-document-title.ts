import { useEffect } from "react";
import { useBrand } from "@/components/branding/useBrand";

/**
 * Drive `document.title` from React, composing an optional per-page
 * subtitle with the resolved tenant brand name.
 *
 * Examples:
 *   useDocumentTitle();              // → "Acme Brand"
 *   useDocumentTitle("Longevity");   // → "Longevity — Acme Brand"
 *
 * Before this hook was brand-aware, every page produced
 * `<page> — Evymo s.r.o.` regardless of which tenant served it,
 * which collided with the BrandContext landing — the React tree showed
 * the right tenant brand in Header/Footer but the browser tab + bookmarks
 * kept saying the platform operator.
 */
export function useDocumentTitle(subtitle?: string) {
  const brand = useBrand();
  const znacka = brand?.operator_name;

  // ⛔ NEZNÁMÁ ZNAČKA SE NEDOSAZUJE (naměřeno 2026-09-01 na živém webu instance).
  //
  // Tady stálo `brand?.operator_name ?? "Evymo s.r.o."`. Titulek karty se pak
  // přepisoval TŘIKRÁT — změřeno vzorkováním `document.title` po 250 ms:
  //     0 ms  → „Evymo s.r.o."                       ← cizí značka
  //   497 ms  → „web.donate.title — <Značka instance>"   ← holý i18n klíč
  //  1676 ms  → „Donate — <Značka instance>"             ← teprve teď pravda
  //
  // Přitom `index.html` nese SPRÁVNÝ titulek už z buildu (VITE_PUBLIC_BRAND_*).
  // Dosazení tedy nic nezachraňovalo — jen na půl vteřiny přebilo správnou
  // hodnotu špatnou. Kdo si stránku sdílel nebo ji sebral crawler v tom okně,
  // dostal jméno provozovatele platformy místo instance.
  //
  // Neznámý stav se řeší TICHEM, ne dosazením — táž zásada, jakou o patro výš
  // uplatňuje `EditorPageGate` na chrome („nic je poctivější než cizí obsah").
  // Když značka nedorazí vůbec, zůstane build-time titulek, což je pro instanci
  // i pro vanilla `git clone` právě ta správná odpověď.
  useEffect(() => {
    if (!znacka) return;
    document.title = subtitle ? `${subtitle} — ${znacka}` : znacka;
  }, [subtitle, znacka]);
}
