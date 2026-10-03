import { Header } from "@/components/layout/Header";
import { ohniskoZClanku, vyrezObrazku } from "@/lib/media/verejnaAdresaObrazku";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { Calendar, ArrowLeft, Loader2, Newspaper } from "lucide-react";
import DOMPurify from "dompurify";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useNewsArticleBySlug } from "@/hooks/useNewsArticles";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { PageRenderer } from "@/components/web";

const NewsArticleDetail = () => {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { article, isLoading } = useNewsArticleBySlug(slug ?? "");

  // Collect translation keys
  const translationKeys = article
    ? [article.title_key, article.content_key, article.excerpt_key].filter(
        (k): k is string => !!k
      )
    : [];

  const translationsMap = useDynamicTranslationsMap(translationKeys, "news", "en");
  const getText = (key?: string | null) => (key ? translationsMap[key] : undefined);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  /**
   * Tělo článku se vydá jako OŠETŘENÉ HTML — v jednom kuse.
   *
   * ⛔ CO TU BYLO A CO TO DĚLALO (naměřeno 2026-09-21 na instanci, 226 článků).
   *
   * Byl tu „jednoduchý markdown": tělo se rozdělilo na odstavce podle prázdných
   * řádků, každý se obalil do `<p>`, `**tučně**` a `[odkaz](url)` se přepsaly
   * a KAŽDÝ jednoduchý nový řádek se změnil na `<br />`.
   *
   * Jenže v datech žádný markdown není. Změřeno nad `translations`:
   *   • 226 z 226 těl obsahuje `<p`  • 119 obsahuje `<h3`
   *   • 175 obsahuje odkaz `<a `     • 120 obsahuje `<img`
   *   • 0 obsahuje `**` nebo `[…](…)`
   * Těla jsou HTML (import z WordPressu), takže se markdownová větev nikdy
   * netrefila do ničeho — zato:
   *   1. obalování do `<p>` vkládalo `<h3>`, `<ul>` a `<img>` DOVNITŘ odstavce,
   *      což je neplatné vnoření; prohlížeč `<p>` v tom místě ukončí a rozložení
   *      i styly se rozjedou;
   *   2. `\n` → `<br />` přidávalo svislé mezery mezi ZNAČKAMI (mezi `</p>`
   *      a `<h3>`), které v obsahu nikdo nenapsal;
   *   3. tělo bez prázdného řádku (u importovaného HTML běžné) skončilo celé
   *      v jednom `<p>`.
   *
   * Vydat HTML v jednom kuse ruší všechny tři naráz. Typografii dodává `prose`
   * na obalujícím `<article>`, sanitizaci `DOMPurify` (skript ani `on*` atribut
   * neprojde). Nově psané články jdou jinou cestou — editor ukládá `canvas_html`
   * a ten se vykresluje přes `PageRenderer` (větev výš) — tahle obsluhuje
   * ZDĚDĚNÁ těla.
   */
  const telo = (html: string) => (
    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
  );

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20 pb-16">
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !article ? (
          <div className="container mx-auto px-4 py-32 text-center">
            <Newspaper className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-6">{t("news.notFound")}</p>
            <Link to="/news">
              <Button variant="outline" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {t("news.backToNews")}
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Hero */}
            <section className="bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-12 md:py-20">
              <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <div className="max-w-3xl mx-auto">
                  <Link to="/news">
                    <Button variant="ghost" size="sm" className="gap-2 mb-6 -ml-2">
                      <ArrowLeft className="h-4 w-4" />
                      {t("news.backToNews")}
                    </Button>
                  </Link>
                  <Badge variant="outline" className="mb-4">
                    <Calendar className="h-3.5 w-3.5 mr-1.5" />
                    {formatDate(article.published_at)}
                  </Badge>
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                    {getText(article.title_key) || article.title_key}
                  </h1>
                </div>
              </div>
            </section>

            {/* Image */}
            {article.image_url && (
              <section className="container mx-auto px-4 sm:px-6 lg:px-8 -mt-4">
                <div className="max-w-3xl mx-auto">
                  <img
                    src={vyrezObrazku(article.image_url, { w: 1536, h: 768, ...ohniskoZClanku(article) }) ?? undefined}
                    alt=""
                    className="w-full rounded-xl shadow-lg object-cover max-h-96"
                  />
                </div>
              </section>
            )}

            {/* Content — a GrapesJS canvas renders through the SAME PageRenderer
                as web_pages (resolves data-i18n-key per locale → multilingual);
                plain articles fall back to the markdown content_key body. */}
            <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
              {article.canvas_html ? (
                <div className="max-w-3xl mx-auto">
                  <PageRenderer
                    canvasHtml={article.canvas_html}
                    canvasCss={article.canvas_css}
                  />
                </div>
              ) : (
                <article className="max-w-3xl mx-auto prose prose-lg dark:prose-invert">
                  {getText(article.content_key)
                    ? telo(getText(article.content_key)!)
                    : (
                      <p className="text-muted-foreground">
                        {article.content_key}
                      </p>
                    )}
                </article>
              )}
            </section>

            {/* Back */}
            <section className="container mx-auto px-4 sm:px-6 lg:px-8 pb-12">
              <div className="max-w-3xl mx-auto">
                <Link to="/news">
                  <Button variant="outline" className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    {t("news.backToNews")}
                  </Button>
                </Link>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
};

export default NewsArticleDetail;
