/**
 * NewsListBlock — Runtime block for displaying recent news articles.
 *
 * Renders a configurable list of published news articles using the
 * useNewsArticles hook. Supports a `limit` config option.
 *
 * Editor placeholder: `<div data-runtime-block="news-list" data-block-config='{"limit":6}'></div>`
 *
 * @module
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Newspaper, Calendar, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNewsArticles } from "@/hooks/useNewsArticles";
import { ohniskoZClanku, vyrezObrazku } from "@/lib/media/verejnaAdresaObrazku";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Runtime block that renders a list of recent news articles.
 * Config: `{ limit?: number }`
 */
export default function NewsListBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const limit = typeof config.limit === "number" ? config.limit : 6;
  const { articles, isLoading } = useNewsArticles(limit, 0);

  // Collect all translation keys from articles
  const translationKeys = (articles ?? []).flatMap((a) => [
    a.title_key,
    a.excerpt_key,
  ].filter((k): k is string => !!k));

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!articles?.length) {
    return (
      <div className="text-center py-16">
        <Newspaper className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">{t("news.noArticles")}</p>
      </div>
    );
  }

  return (
    <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-4xl mx-auto grid gap-6">
        {articles.map((article) => {
          const title = getText(article.title_key) || article.title_key;
          const excerpt = article.excerpt_key ? getText(article.excerpt_key) : "";

          return (
            <Card
              key={article.id}
              className="group hover:shadow-lg transition-shadow duration-300"
            >
              <div className="flex flex-col md:flex-row">
                {article.image_url && (
                  <div className="md:w-64 md:shrink-0">
                    <img
                      src={vyrezObrazku(article.image_url, { w: 512, h: 384, ...ohniskoZClanku(article) }) ?? undefined}
                      alt=""
                      className="h-48 md:h-full w-full object-cover rounded-t-lg md:rounded-l-lg md:rounded-tr-none"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <CardHeader>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(article.published_at)}
                    </div>
                    <CardTitle className="text-xl group-hover:text-primary transition-colors">
                      {title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {excerpt && (
                      <p className="text-muted-foreground mb-4 line-clamp-3">
                        {excerpt}
                      </p>
                    )}
                    <Link to={`/news/${article.slug}`}>
                      <Button variant="ghost" size="sm" className="gap-2 -ml-2">
                        {t("news.readMore")}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </CardContent>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
