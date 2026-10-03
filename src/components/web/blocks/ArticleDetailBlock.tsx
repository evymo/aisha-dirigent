/**
 * ArticleDetailBlock — detail článku JAKO BLOK PLÁTNA, ne jako stránka platformy.
 *
 * POZOR: PROČ VZNIKL. Detail článku byl jediná veřejná stránka mimo plátno:
 * `/news` prochází `EditorPageGate`, takže může být z plátna, kdežto
 * `/news/:slug` mířil rovnou na platformní komponentu. Nesl proto platformní
 * hlavičku, patičku i písmo — a design webu (barvy, typografie, útržky) na něj
 * nedosáhl. Naměřeno 2026-08-31 na produkci: detail se lišil od zbytku webu.
 *
 * POZN.: CO SE TÍM MĚNÍ. Blok vykresluje POUZE obsah článku. Hlavičku, patičku a
 * ostatní chrome dodá plátno stejnými útržky jako všem ostatním stránkám, takže
 * detail dědí design automaticky — včetně formátování, které redaktor nastaví
 * v editoru. Není to výjimka: je to sedmnáctý blok ve stávajícím registru
 * (`news-list`, `archive-browser`, `page-body`, …).
 *
 * HRANICE: blok si slug bere z URL (`useParams`), ne z konfigurace. Detail je
 * z definice stránka „o jednom záznamu"; kdyby slug přišel z konfigurace,
 * jedna stránka plátna by uměla ukázat jen jeden článek.
 *
 * KLÍČE JSOU PŘEVZATÉ z původní stránky (`news.backToNews`, `news.notFound`),
 * ne vymyšlené. Nový klíč by musel do šesti slovníků (cs, en, de, fr, ru, th)
 * a brána `i18nKeysExist` na to upozorní — správně: klíč bez překladu se na
 * webu ukáže jako holý identifikátor.
 *
 * Zástupný symbol v editoru:
 *   <div data-runtime-block="article-detail" data-block-config='{"zpet":"/news"}'></div>
 *
 * @module
 */
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Calendar, ArrowLeft, Loader2, Newspaper } from "lucide-react";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { useNewsArticleBySlug } from "@/hooks/useNewsArticles";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PageRenderer } from "@/components/web/PageRenderer";
import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Odstavcové vykreslení textu článku: **tučně**, [odkaz](url), zalomení.
 * Sanitizace přes DOMPurify — obsah přichází z databáze, tedy zvenčí.
 */
function odstavce(text: string) {
  return text.split(/\n\n+/).map((p, i) => {
    let html = p.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-4 hover:text-primary/80">$1</a>',
    );
    html = html.replace(/\n/g, "<br />");
    return (
      <p
        key={i}
        className="text-base leading-relaxed text-foreground/90 mb-4"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    );
  });
}

/**
 * Runtime blok: detail jednoho článku podle slugu v adrese.
 * Konfigurace: `{ zpet?: string }` — kam vede odkaz „zpět“ (výchozí `/news`).
 */
export function ArticleDetailBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { article, isLoading } = useNewsArticleBySlug(slug ?? "");
  const zpet = typeof config?.zpet === "string" ? config.zpet : "/news";

  const klice = article
    ? [article.title_key, article.content_key, article.excerpt_key].filter(
        (k): k is string => !!k,
      )
    : [];
  const preklady = useDynamicTranslationsMap(klice, "news", "en");
  const text = (key?: string | null) => (key ? preklady[key] : undefined);

  // ⛔ TITULEK KARTY PATŘÍ ČLÁNKU, NE VÝPISU (naměřeno 2026-09-03, audit U1-6).
  //
  // Shell skládá titulek z `title_key` STRÁNKY, a tou je pro `/news/:slug`
  // `news-detail` s klíčem `web.news.title` — tedy „Novinky a aktuality"
  // u každého článku. Stránka proto v `page_settings` říká `title: "block"`
  // a titulek dodá tenhle blok. Dokud se článek nenačte, hook dostane
  // `undefined` a platí build-time titulek — holý slug ani prázdno se do
  // karty nepíše.
  useDocumentTitle(text(article?.title_key));

  const datum = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <Newspaper className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <p className="mb-6 text-muted-foreground">{t("news.notFound")}</p>
        <Button asChild variant="outline">
          <Link to={zpet}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("news.backToNews")}
          </Link>
        </Button>
      </div>
    );
  }

  const obsah = text(article.content_key);

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
        <Link to={zpet}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("news.backToNews")}
        </Link>
      </Button>

      <header className="mb-8">
        <h1 className="mb-3 text-4xl font-normal leading-tight">
          {text(article.title_key) ?? article.slug}
        </h1>
        {article.published_at ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {datum(article.published_at)}
          </p>
        ) : null}
      </header>

      {/*
        POZOR: DVĚ PODOBY OBSAHU, JAKO U PŮVODNÍ STRÁNKY. Článek smí nést vlastní
        plátno (`canvas_html`) — pak se vykreslí týmž `PageRenderer` jako
        stránky, takže se vyřeší `data-i18n-key` podle jazyka. Bez plátna se
        vezme prostý text z `content_key`. Kdyby blok uměl jen druhou větev,
        články s vlastním plátnem by po přechodu ztratily formátování.
      */}
      {article.canvas_html ? (
        <PageRenderer canvasHtml={article.canvas_html} canvasCss={article.canvas_css} />
      ) : obsah ? (
        <div>{odstavce(obsah)}</div>
      ) : null}
    </article>
  );
}

export default ArticleDetailBlock;
