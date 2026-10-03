/**
 * KnowledgePreviewBlock — Runtime block for a knowledge topics teaser.
 *
 * Renders a compact grid of knowledge topics using the useKnowledgeTopics
 * hook. Supports `limit` and `visibility` config options.
 *
 * Editor placeholder: `<div data-runtime-block="knowledge-preview" data-block-config='{"limit":6}'></div>`
 *
 * @module
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useKnowledgeTopics } from "@/hooks/useKnowledgeBase";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Runtime block that renders a compact grid of knowledge topics.
 * Config: `{ limit?: number, visibility?: "public" | "members" | "archived" }`
 */
export default function KnowledgePreviewBlock({ config }: RuntimeBlockProps) {
  const { t, i18n } = useTranslation();
  const limit = typeof config.limit === "number" ? config.limit : 6;
  const visibility =
    typeof config.visibility === "string" &&
    ["public", "members", "archived"].includes(config.visibility)
      ? (config.visibility as "public" | "members" | "archived")
      : "public";

  const { data: topics, isLoading } = useKnowledgeTopics({
    limit,
    locale: i18n.language,
    offset: 0,
    visibility,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!topics?.length) {
    return (
      <div className="text-center py-16">
        <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">{t("knowledge.noTopics")}</p>
      </div>
    );
  }

  return (
    <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-4xl mx-auto grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <Card
            key={topic.id}
            className="group hover:shadow-lg transition-shadow duration-300"
          >
            <CardHeader className="pb-2">
              {topic.visibility && (
                <Badge variant="outline" className="text-[10px] w-fit mb-1">
                  {topic.visibility}
                </Badge>
              )}
              <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-2">
                {topic.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topic.summary && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
                  {topic.summary}
                </p>
              )}
              <Link to={`/knowledge/${topic.slug}`}>
                <Button variant="ghost" size="sm" className="gap-2 -ml-2">
                  {t("common.readMore")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
