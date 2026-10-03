import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { Newspaper } from "lucide-react";

import NewsBrowserBlock from "@/components/web/blocks/NewsBrowserBlock";

/**
 * Knihovna článků (/news).
 *
 * ⛔ HLEDÁNÍ TU DŘÍV NEBYLO (naměřeno 2026-09-21).
 *
 * Stránka měla vlastní mřížku karet nad `useNewsArticles()` — prostý výpis
 * prvních 20 článků bez hledání, bez štítků a bez řazení. Parametrizovaný
 * listing (`useNewsArticlesBrowser` → `get_published_news_articles_filtered`)
 * i hotové ovládání k němu (`NewsBrowserBlock`: hledání s prodlevou 300 ms
 * v adrese, štítky z katalogu, řazení) v repu existovaly — jenže jen jako
 * BLOK do stavitele stránek, který musí někdo ručně umístit na nějakou
 * stránku webu. Na `/news`, kam vede odkaz z hlavičky, se tedy hledat nedalo.
 *
 * Stránka proto ten blok použije místo vlastní kopie mřížky. Není to obcházení
 * stavitele: blok zůstává blokem (`news-browser` je dál v registru a dál se dá
 * umístit kamkoli, i s připnutým štítkem) — jen se tu vykreslí i bez toho, aby
 * kolem něj musel vzniknout ručně postavený web. Zároveň tím zmizela druhá,
 * rozcházející se kopie vykreslování karet.
 */
const News = () => {
  const { t } = useTranslation();

  return (
    <>
      <Header />
      <main className="min-h-screen pt-20 pb-16">
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-16 md:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <Badge variant="outline" className="mb-4">
                <Newspaper className="h-3.5 w-3.5 mr-1.5" />
                {t("news.badge")}
              </Badge>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
                {t("news.title")}
              </h1>
              <p className="text-lg text-muted-foreground">
                {t("news.subtitle")}
              </p>
            </div>
          </div>
        </section>

        {/* Knihovna — hledání, štítky, řazení; stav je v adrese, takže se dá poslat odkazem. */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <NewsBrowserBlock config={{ limit: 24 }} />
        </section>
      </main>
      <Footer />
    </>
  );
};

export default News;
