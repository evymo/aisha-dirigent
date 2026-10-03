/**
 * ArchivePreviewBlock — Runtime block for a lightweight archive document listing.
 *
 * Shows a preview of archive documents using the useArchiveDocuments hook.
 * Supports config options: `limit`, `decade`, `documentType`.
 *
 * Editor placeholder: `<div data-runtime-block="archive-preview" data-block-config='{"limit":6}'></div>`
 *
 * @module
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Archive, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useArchiveDocuments } from "@/hooks/useArchiveDocuments";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Runtime block that renders a compact archive document listing.
 * Config: `{ limit?: number, decade?: string, documentType?: string }`
 */
export default function ArchivePreviewBlock({ config }: RuntimeBlockProps) {
  const { t, i18n } = useTranslation();
  const limit = typeof config.limit === "number" ? config.limit : 6;

  const { documents, loading: isLoading } = useArchiveDocuments({
    decade: typeof config.decade === "string" ? config.decade : undefined,
    documentType: typeof config.documentType === "string" ? config.documentType : undefined,
    locale: i18n.language,
  });

  const items = (documents ?? []).slice(0, limit);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="text-center py-16">
        <Archive className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">{t("archive.noDocuments")}</p>
      </div>
    );
  }

  return (
    <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-4xl mx-auto grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((doc) => (
          <Card
            key={doc.id}
            className="group hover:shadow-lg transition-shadow duration-300"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {doc.document_type && (
                  <Badge variant="outline" className="text-[10px]">
                    {doc.document_type}
                  </Badge>
                )}
                {doc.decade && (
                  <Badge variant="secondary" className="text-[10px]">
                    {doc.decade}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-2">
                {doc.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {doc.summary && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
                  {doc.summary}
                </p>
              )}
              <Link to={`/archive/${doc.slug}`}>
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
