import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Brain, Lightbulb, Tag, Database, Calendar, FileText, Award } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TrackingDocument } from '@/hooks/useTrackingDocuments';
import { documentAiInsightsSchema, documentExtractedDataSchema } from '@/lib/validation/rpcSchemas';
import { safeError } from '@/lib/security/safeLogger';

interface DocumentAnalysisViewProps {
  document: TrackingDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentAnalysisView({ document, open, onOpenChange }: DocumentAnalysisViewProps) {
  const { t } = useTranslation();

  // Validate AI insights with Zod
  const insightsResult = documentAiInsightsSchema.safeParse(document.ai_insights);
  if (!insightsResult.success && document.ai_insights != null) {
    safeError("documentAnalysis.insightsParseFailed", { documentId: document.id, issues: insightsResult.error.issues.length });
  }
  const insights = insightsResult.success ? insightsResult.data : null;
  
  // Validate extracted data with Zod
  const extractedResult = documentExtractedDataSchema.safeParse(document.extracted_data);
  if (!extractedResult.success && document.extracted_data != null) {
    safeError("documentAnalysis.extractedDataParseFailed", { documentId: document.id, issues: extractedResult.error.issues.length });
  }
  const extractedData = extractedResult.success ? extractedResult.data : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {t('member.documents.analysis.title')}
          </DialogTitle>
          <DialogDescription>
            {document.title || document.file_name}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Document info */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                <span>{t(`member.documents.categories.${document.category}`)}</span>
              </div>
              {document.document_date && (
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>{format(new Date(document.document_date), 'PP')}</span>
                </div>
              )}
              {document.tokens_awarded > 0 && (
                <div className="flex items-center gap-1">
                  <Award className="h-4 w-4 text-amber-500" />
                  <span>+{document.tokens_awarded} {t('member.documents.tokens')}</span>
                </div>
              )}
            </div>

            {/* AI Summary */}
            {document.ai_summary && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    {t('member.documents.analysis.summary')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{document.ai_summary}</p>
                </CardContent>
              </Card>
            )}

            {/* Insights */}
            {insights && insights.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" />
                    {t('member.documents.analysis.insights')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.map((insight, index) => (
                      <li key={index} className="text-sm flex items-start gap-2">
                        <span className="text-primary mt-1">•</span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Extracted Data */}
            {extractedData && Object.keys(extractedData).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    {t('member.documents.analysis.extractedData')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2">
                    {Object.entries(extractedData).map(([key, value]) => (
                      <div key={key} className="flex justify-between items-center py-1 border-b border-border/50 last:border-0">
                        <span className="text-sm text-muted-foreground capitalize">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <span className="text-sm font-medium">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Categories */}
            {document.ai_categories && document.ai_categories.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    {t('member.documents.analysis.categories')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {document.ai_categories.map((category, index) => (
                      <Badge key={index} variant="secondary">
                        {category}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Processing info */}
            {document.processed_at && (
              <div className="text-xs text-muted-foreground text-center">
                {t('member.documents.analysis.processedAt')}: {format(new Date(document.processed_at), 'PPp')}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
