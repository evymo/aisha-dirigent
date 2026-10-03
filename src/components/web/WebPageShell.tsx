/**
 * WebPageShell — Full-page wrapper for GrapeJS-rendered web pages.
 *
 * Wraps Header + PageRenderer + Footer, provides:
 * - SEO meta tags from page title_key / description_key
 * - Admin "Edit this page" floating button
 * - Loading / error / 404 states
 *
 * @module
 */

import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useWebPage } from "@/hooks/useWebPage";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { usePermissions } from "@/hooks/usePermissions";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PageRenderer } from "./PageRenderer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { ReactNode } from "react";

// =====================================================
// Component
// =====================================================

/** Props for WebPageShell. */
interface WebPageShellProps {
  /** Slug to render. Without it the shell takes `:slug` from the route. */
  slug?: string;
  /**
   * Co vykreslit, když pro slug ŽÁDNÁ stránka není.
   *
   * ⛔ `null` NEZNAMENÁ „zkus další routu" (naměřeno 2026-09-01 na
   * veřejný web instance). Tady stálo `return null` s komentářem „let router try
   * fallback routes" — jenže React Router v6 další routu NEZKOUŠÍ: `/:slug` už
   * se shodlo a prázdný element je prostě prázdno. Na produkci proto KAŽDÁ
   * neznámá jednosegmentová adresa vracela ÚPLNĚ BÍLOU stránku (`innerText`
   * délky 0), zatímco `/aaa/bbb` — které na `/:slug` nesedí — 404 ukázalo
   * správně. Rozdíl mezi „neexistuje" a „prázdno" tedy určovalo to, kolik
   * lomítek návštěvník napsal.
   *
   * Kdo shell montuje jako routu, řekne explicitně, co je za koncem
   * (`kdyzChybi={<NotFound />}`). `EditorPageGate` naopak nechává výchozí
   * `undefined`, protože o náhradě rozhoduje sám — vykreslí `children`.
   */
  kdyzChybi?: ReactNode;
}

export function WebPageShell({ slug: propSlug, kdyzChybi }: WebPageShellProps = {}) {
  const { slug: paramSlug } = useParams<{ slug?: string }>();
  const resolvedSlug = propSlug ?? paramSlug ?? "index";
  const { t, i18n } = useTranslation();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const { data: page, isLoading, error } = useWebPage(resolvedSlug);
  const pageMetaKeys = page ? [page.title_key, page.description_key].filter((key): key is string => Boolean(key)) : [];
  const pageMetaTranslations = useDynamicTranslationsMap(pageMetaKeys, "web", "en");

  // SEO title — resolve from i18n key when available. Empty string here
  // lets `useDocumentTitle` fall back to the resolved brand operator_name
  // alone (e.g. "Acme Brand"), without the awkward "Evymo — Acme
  // Brand" composition that the previous hardcoded "Evymo" subtitle produced.
  // ⛔ DVĚ HLAVIČKY NAD SEBOU (naměřeno 2026-08-29 na živém webu).
  //
  // Shell montoval platformní Header/Footer VŽDY. Jenže veřejná stránka je
  // skládaná v page builderu a vlastní hlavičku už OBSAHUJE — takže se přes ni
  // položila lišta Studia s košíkem, přepínačem měny a odkazy /guild, /partners
  // a Sign In. Chrome jednoho produktu překryl navigaci druhého.
  //
  // Rozhoduje o tom DATA, ne kód: `page_settings.chrome`. Stránka, která si
  // chrome nese sama, řekne `"none"`; ostatní se chovají jako dosud, takže se
  // pro Studio nic nemění. `page_settings` se do PageRendereru předával už
  // předtím — konvence existovala, jen ji shell sám nečetl.
  const pageSettings = (page?.page_settings ?? null) as Record<string, unknown> | null;
  const platformniChrome = pageSettings?.chrome !== "none";

  // ⛔ HOLÝ KLÍČ NENÍ TITULEK (naměřeno 2026-09-01 na živém webu instance).
  //
  // Tady stálo `pageMetaTranslations[title_key] ?? t(title_key)`. Jenže
  // i18next na NEZNÁMÝ klíč vrací ten klíč — a jmenný prostor `web.*` je
  // z 80 % schválně prázdný, protože jeho obsah dodává instance z databáze.
  // Do karty prohlížeče se proto na 1,2 s psalo doslova
  // „web.donate.title — <Značka instance>". Dosazení tedy nevyplnilo mezeru,
  // jen ji přejmenovalo na něco, co vypadá jako rozbitý web.
  //
  // Prázdný řetězec se počítá jako „nemám": 478 z 499 klíčů `web.*` je
  // prázdných, takže bez téhle podmínky by vznikl titulek „ — <Značka instance>".
  // Když nevíme, nepíšeme nic a platí build-time titulek z `index.html`.
  const nadpisZKlice = (klic?: string | null): string | undefined => {
    if (!klic) return undefined;
    const zDatabaze = pageMetaTranslations[klic];
    if (zDatabaze?.trim()) return zDatabaze;
    if (!i18n.exists(klic)) return undefined;
    const zeSlovniku = t(klic);
    return zeSlovniku.trim() && zeSlovniku !== klic ? zeSlovniku : undefined;
  };
  // ⛔ DETAIL ZÁZNAMU SI TITULEK NESE SÁM (naměřeno 2026-09-03, audit U1-6).
  //
  // Shell skládá titulek z `title_key` STRÁNKY. U `/news/:slug` je tou stránkou
  // `news-detail`, jejíž klíč je `web.news.title` — titulek VÝPISU. V kartě
  // prohlížeče i ve sdíleném odkazu tak stálo „Novinky a aktuality" bez ohledu
  // na to, který článek je otevřený.
  //
  // Rozhoduje o tom DATA, ne pořadí efektů: `page_settings.title = "block"`,
  // stejnou konvencí jako `chrome: "none"` o pár řádků výš. Stránka tím říká
  // „titulek dodá blok"; shell nedosadí nic a do té doby platí build-time
  // titulek z `index.html`. Spoléhat na to, že efekt bloku doběhne po efektu
  // shellu, by byla tichá závislost na pořadí — a ta se rozbije při prvním
  // překreslení rodiče.
  const titulekDodaBlok = pageSettings?.title === "block";
  useDocumentTitle(titulekDodaBlok ? undefined : nadpisZKlice(page?.title_key));

  // ⛔ PROBLIK CIZÍ HLAVIČKY (naměřeno 2026-08-29 na živém webu).
  //
  // Dokud `page` nedorazí, `page_settings.chrome` NENÍ ZNÁMÉ — a shell zatím
  // vykresloval platformní Header/Footer. Na veřejném webu to znamenalo, že
  // před vlastní stránkou probleskla ZELENÁ lišta Studia a teprve pak se to
  // překreslilo do modré. Uživatel to popsal jako „problikne zelená prázdná
  // stránka, než se to překreslí".
  //
  // Neznámý stav se proto řeší TICHEM, ne dosazením: během načítání se chrome
  // nekreslí vůbec. Kostra bez hlavičky je neutrální pro obě strany — Studio
  // svou hlavičku dostane hned, jak stránka dorazí, a veřejný web ji nedostane
  // nikdy. Ukázat CIZÍ chrome a pak ho vzít zpět je horší než chvíli nic.
  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-4xl space-y-8 p-8">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </main>
      </div>
    );
  }

  // ⛔ SELHÁNÍ DOTAZU NENÍ „STRÁNKA NEEXISTUJE".
  //
  // Tyhle dva stavy mají v React Query TÝŽ tvar (`data === undefined`), a
  // právě proto se musí rozlišit ručně — `EditorPageGate` to o soubor vedle
  // dělá ze stejného důvodu. Kdyby se sloučily, výpadek API by na každé
  // adrese tvrdil „404 Stránka nenalezena". To je nepravda o CIZÍ věci:
  // stránka nejspíš existuje, jen se na ni nešlo zeptat — a návštěvník by
  // odešel s tím, že web ten obsah nemá.
  //
  // `isError` říká „nevím" → nekreslí se nic (táž zásada jako u chrome).
  // Až úspěšná odpověď bez stránky říká „vím, že tu žádná není" → teprve
  // tehdy se ukáže to, co si zavolající vyžádal v `kdyzChybi`.
  if (error) {
    return null;
  }
  if (!page) {
    return <>{kdyzChybi ?? null}</>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {platformniChrome && <Header />}

      <main className="flex-1">
        <PageRenderer
          canvasCss={page.canvas_css}
          canvasHtml={page.canvas_html}
          pageSettings={page.page_settings as Record<string, unknown> | null}
        />
      </main>

      {platformniChrome && <Footer />}

      {/* Admin floating edit button */}
      {isAdmin && page.id && (
        <a
          href={`/admin/pages/${page.id}/edit`}
          className="fixed bottom-6 right-6 z-50"
        >
          <Button
            className="h-12 w-12 rounded-full shadow-lg"
            size="icon"
            title={t("admin.editPage")}
          >
            <Pencil className="h-5 w-5" />
          </Button>
        </a>
      )}
    </div>
  );
}

export default WebPageShell;
