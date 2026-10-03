import { useParams, Link } from "react-router-dom";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  User,
  Download,
  FileText,
  Building,
  BookOpen,
  Loader2,
  AlertTriangle,
  Info,
  FileCheck,
  Link2,
  Star
} from "lucide-react";
import { useArchiveDocument, useRelatedArchiveDocuments, getLocalizedField, getLocalizedSummary } from "@/hooks/useArchiveDocuments";
import { DocumentDownloadButton } from "@/components/common/DocumentDownloadButton";
import { DocumentViewer } from "@/components/archive/DocumentViewer";

export default function ArchiveDocument() {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const { document: doc, loading, error } = useArchiveDocument(slug || "");
  const currentLocale = getTranslationLocale(i18n.language);
  const { relatedDocuments: relatedDocs } = useRelatedArchiveDocuments(doc?.related_documents);

  const badgeLabels: Record<string, string> = {
    original_scan: t('admin.archive.provenanceBadges.original_scan'),
    translated_excerpt: t('admin.archive.provenanceBadges.translated_excerpt'),
    editorial_note: t('admin.archive.provenanceBadges.editorial_note'),
    unverified_claim: t('admin.archive.provenanceBadges.unverified_claim'),
  };

  const badgeVariants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    original_scan: "default",
    translated_excerpt: "secondary",
    editorial_note: "outline",
    unverified_claim: "destructive",
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 py-32 text-center">
          <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="font-serif text-2xl font-bold mb-2">{t('documents.notFound')}</h1>
          <p className="text-muted-foreground mb-6">{t('documents.notFoundDescription')}</p>
          <Button asChild>
            <Link to="/archive">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('documents.backToArchive')}
            </Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  const title = getLocalizedField(doc, 'title', currentLocale) || doc.title;
  const description = getLocalizedField(doc, 'description', currentLocale);
  const summary = getLocalizedSummary(doc, currentLocale);
  const editorialNote = getLocalizedField(doc, 'editorial_note', currentLocale);
  const standardsContext = getLocalizedField(doc, 'standards_context', currentLocale);
  const whatYouAreLookingAt = getLocalizedField(doc, 'what_you_are_looking_at', currentLocale);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Breadcrumb */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/archive" className="hover:text-foreground transition-colors">
              {t('navigation.archive')}
            </Link>
            <span>/</span>
            <span className="text-foreground truncate max-w-[300px]">{title}</span>
          </nav>
        </div>
      </div>

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Header */}
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <Badge variant={badgeVariants[doc.provenance_badge] || "default"}>
                  {badgeLabels[doc.provenance_badge] || doc.provenance_badge}
                </Badge>
                {doc.is_featured && (
                  <Badge className="bg-primary text-primary-foreground gap-1"><Star className="h-3 w-3" /> {t('admin.archive.featured')}</Badge>
                )}
                {doc.document_type && (
                  <Badge variant="outline">
                    {t(`admin.archive.documentTypes.${doc.document_type}`)}
                  </Badge>
                )}
              </div>
              <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">
                {title}
              </h1>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {doc.year && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    {doc.year}
                  </span>
                )}
                {doc.place && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    {doc.place}
                  </span>
                )}
                {doc.facility && (
                  <span className="flex items-center gap-1.5">
                    <Building className="h-4 w-4" />
                    {doc.facility}
                  </span>
                )}
                {doc.original_language && (
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4" />
                    {doc.original_language.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Document Preview/Viewer */}
            {doc.storage_path && (
              <div>
                <h2 className="font-serif text-xl font-semibold text-foreground mb-4">
                  {t('documents.documentPreview')}
                </h2>
                <DocumentViewer
                  storagePath={doc.storage_path}
                  isPublic={doc.is_public}
                  isDownloadPublic={doc.is_download_public}
                />
              </div>
            )}

            {/* What You're Looking At */}
            {whatYouAreLookingAt && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">{t('documents.whatYouAreLookingAt')}</h3>
                    <p className="text-muted-foreground">{whatYouAreLookingAt}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Summary */}
            {summary && (
              <div>
                <h2 className="font-serif text-xl font-semibold text-foreground mb-3">{t('documents.summary')}</h2>
                <p className="text-muted-foreground leading-relaxed">{summary}</p>
              </div>
            )}

            {/* Description / Content */}
            {(description || doc.content) && (
              <div>
                <h2 className="font-serif text-xl font-semibold text-foreground mb-3">{t('documents.description')}</h2>
                <div className="prose prose-neutral dark:prose-invert max-w-none">
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {description || doc.content}
                  </p>
                </div>
              </div>
            )}

            {/* Standards Context */}
            {standardsContext && (
              <div className="bg-muted/50 border border-border rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <FileCheck className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">{t('documents.standardsContext')}</h3>
                    <p className="text-muted-foreground text-sm">{standardsContext}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Editorial Note */}
            {editorialNote && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">{t('documents.editorialNote')}</h3>
                    <p className="text-muted-foreground text-sm">{editorialNote}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Related Documents */}
            {relatedDocs.length > 0 && (
              <div className="border-t border-border pt-8">
                <h2 className="font-serif text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Link2 className="h-5 w-5" />
                  {t('documents.relatedDocuments')}
                </h2>
                <div className="grid gap-4">
                  {relatedDocs.map((relDoc) => {
                    const relTitle = getLocalizedField(relDoc, 'title', currentLocale) || relDoc.title;
                    const relDescription = getLocalizedField(relDoc, 'description', currentLocale);
                    return (
                      <Link
                        key={relDoc.id}
                        to={`/archive/${relDoc.slug}`}
                        className="block bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <FileText className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <h3 className="font-medium text-foreground line-clamp-1">{relTitle}</h3>
                            {relDoc.year && (
                              <p className="text-xs text-muted-foreground mt-1">{relDoc.year} • {relDoc.preparation}</p>
                            )}
                            {relDescription && (
                              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{relDescription}</p>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="border-t border-border pt-6">
              <p className="text-xs text-muted-foreground italic">
                {t('provenance.disclaimer')}
              </p>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Download Actions */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-foreground mb-4">{t('documents.downloads')}</h3>
              <div className="space-y-3">
                <DocumentDownloadButton
                  storagePath={doc.storage_path}
                  isDownloadPublic={doc.is_download_public}
                  labelKey="documents.downloadScan"
                  icon={<Download className="h-4 w-4" />}
                />
                {!doc.storage_path && (
                  <p className="text-sm text-muted-foreground">{t('documents.noDownloads')}</p>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-foreground mb-4">{t('documents.metadata')}</h3>
              <dl className="space-y-3 text-sm">
                {doc.decade && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('documents.decade')}</dt>
                    <dd className="text-foreground font-medium">{doc.decade}</dd>
                  </div>
                )}
                {doc.preparation && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('documents.preparation')}</dt>
                    <dd className="text-foreground font-medium">{doc.preparation}</dd>
                  </div>
                )}
                {doc.source_publication && (
                  <div>
                    <dt className="text-muted-foreground mb-1">{t('documents.sourcePublication')}</dt>
                    <dd className="text-foreground font-medium text-xs">{doc.source_publication}</dd>
                  </div>
                )}
                {doc.page_count && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('admin.archive.pageCount')}</dt>
                    <dd className="text-foreground font-medium">{doc.page_count} {t('documents.pages')}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* People */}
            {doc.people && doc.people.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-semibold text-foreground mb-4">{t('documents.authors')}</h3>
                <ul className="space-y-2">
                  {doc.people.map((person, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{person}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Keywords */}
            {doc.keywords && doc.keywords.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-semibold text-foreground mb-4">{t('documents.keywords')}</h3>
                <div className="flex flex-wrap gap-2">
                  {doc.keywords.map((keyword, idx) => (
                    <Badge key={idx} variant="secondary">{keyword}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Back to Archive */}
            <Button variant="ghost" className="w-full" asChild>
              <Link to="/archive">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('documents.backToArchive')}
              </Link>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
