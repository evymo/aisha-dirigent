import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { 
  FileText, 
  Upload, 
  Trash2, 
  Share2, 
  Brain, 
  BarChart3,
  Download,
  Eye,
  Shield,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  useTrackingDocuments,
  useUploadTrackingDocument,
  useDeleteTrackingDocument,
  useAnalyzeDocument,
  useContributeToStatistics,
  getDocumentUrl,
  TrackingDocument,
  TrackingDocumentCategory,
} from '@/hooks/useTrackingDocuments';
import { useSecureMode } from '@/hooks/useSecureMode';
import { DocumentSharingDialog } from './DocumentSharingDialog';
import { DocumentAnalysisView } from './DocumentAnalysisView';

const DOCUMENT_CATEGORIES: { value: TrackingDocumentCategory; labelKey: string }[] = [
  { value: 'lab_results', labelKey: 'labResults' },
  { value: 'imaging', labelKey: 'imaging' },
  { value: 'prescription', labelKey: 'prescription' },
  { value: 'medical_report', labelKey: 'medicalReport' },
  { value: 'consultation_notes', labelKey: 'consultationNotes' },
  { value: 'diagnostic_test', labelKey: 'diagnosticTest' },
  { value: 'vaccination_record', labelKey: 'vaccinationRecord' },
  { value: 'other', labelKey: 'other' },
];

export function TrackingDocumentsManager() {
  const { t } = useTranslation();
  const { secureClient } = useSecureMode();
  const { data: documents, isLoading } = useTrackingDocuments();
  const uploadMutation = useUploadTrackingDocument();
  const deleteMutation = useDeleteTrackingDocument();
  const analyzeMutation = useAnalyzeDocument();
  const contributeMutation = useContributeToStatistics();

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [sharingDocument, setSharingDocument] = useState<TrackingDocument | null>(null);
  const [analysisDocument, setAnalysisDocument] = useState<TrackingDocument | null>(null);
  const [analyzeDialogDocument, setAnalyzeDialogDocument] = useState<TrackingDocument | null>(null);
  const [analysisPreviewUrl, setAnalysisPreviewUrl] = useState<string | null>(null);
  const [analysisPreviewLoading, setAnalysisPreviewLoading] = useState(false);
  const [analysisCustomRedactions, setAnalysisCustomRedactions] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    category: 'other' as TrackingDocumentCategory,
    title: '',
    description: '',
    documentDate: '',
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!uploadForm.title) {
        setUploadForm(prev => ({ ...prev, title: file.name.replace(/\.[^/.]+$/, '') }));
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    await uploadMutation.mutateAsync({
      file: selectedFile,
      category: uploadForm.category,
      title: uploadForm.title || undefined,
      description: uploadForm.description || undefined,
      documentDate: uploadForm.documentDate || undefined,
    });

    setUploadDialogOpen(false);
    setSelectedFile(null);
    setUploadForm({
      category: 'other',
      title: '',
      description: '',
      documentDate: '',
    });
  };

  const handleDownload = async (document: TrackingDocument) => {
    if (!secureClient) return;

    const url = await getDocumentUrl(document.id, secureClient);
    if (url) {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank');
      }
    }
  };

  const openAnalyzeDialog = async (document: TrackingDocument) => {
    setAnalyzeDialogDocument(document);
    setAnalysisCustomRedactions('');
    setAnalysisPreviewUrl(null);

    if (!secureClient) return;

    setAnalysisPreviewLoading(true);
    try {
      const signedUrl = await getDocumentUrl(document.id, secureClient);
      setAnalysisPreviewUrl(signedUrl);
    } finally {
      setAnalysisPreviewLoading(false);
    }
  };

  const closeAnalyzeDialog = () => {
    setAnalyzeDialogDocument(null);
    setAnalysisPreviewUrl(null);
    setAnalysisCustomRedactions('');
  };

  const handleAnalyzeWithRedaction = async () => {
    if (!analyzeDialogDocument) return;

    const customRedactions = analysisCustomRedactions
      .split(/\n|,/g)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 50);

    await analyzeMutation.mutateAsync({
      documentId: analyzeDialogDocument.id,
      customRedactions,
    });

    closeAnalyzeDialog();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getCategoryLabel = (category: TrackingDocumentCategory) => {
    const cat = DOCUMENT_CATEGORIES.find(c => c.value === category);
    return cat ? t(`member.documents.categories.${cat.labelKey}`) : category;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with privacy notice */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          {t('member.documents.privacyNotice')}
        </AlertDescription>
      </Alert>

      {/* Upload button */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">{t('member.documents.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('member.documents.description')}
          </p>
        </div>
        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="h-4 w-4 mr-2" />
              {t('member.documents.upload')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('member.documents.uploadTitle')}</DialogTitle>
              <DialogDescription>
                {t('member.documents.uploadDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="file">{t('member.documents.selectFile')}</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={handleFileSelect}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="category">{t('member.documents.category')}</Label>
                <Select
                  value={uploadForm.category}
                  onValueChange={(value) => setUploadForm(prev => ({ ...prev, category: value as TrackingDocumentCategory }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {t(`member.documents.categories.${cat.labelKey}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="title">{t('member.documents.documentTitle')}</Label>
                <Input
                  id="title"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, title: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="date">{t('member.documents.documentDate')}</Label>
                <Input
                  id="date"
                  type="date"
                  value={uploadForm.documentDate}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, documentDate: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="description">{t('member.documents.documentDescription')}</Label>
                <Textarea
                  id="description"
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button 
                onClick={handleUpload} 
                disabled={!selectedFile || uploadMutation.isPending}
              >
                {uploadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('member.documents.upload')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Documents list */}
      {!documents?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('member.documents.noDocuments')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="p-2 rounded-lg bg-muted">
                      <FileText className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium truncate">{doc.title || doc.file_name}</h4>
                        <Badge variant="outline">{getCategoryLabel(doc.category)}</Badge>
                        <div className="flex items-center gap-1">
                          {getStatusIcon(doc.processing_status)}
                          <span className="text-xs text-muted-foreground">
                            {t(`member.documents.status.${doc.processing_status}`)}
                          </span>
                        </div>
                      </div>
                      {doc.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {doc.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {doc.document_date && (
                          <span>{format(new Date(doc.document_date), 'PP')}</span>
                        )}
                        <span>{format(new Date(doc.created_at), 'PP')}</span>
                        {doc.tokens_awarded > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            +{doc.tokens_awarded} {t('member.documents.tokens')}
                          </Badge>
                        )}
                        {doc.contributed_to_statistics && (
                          <Badge variant="secondary" className="text-xs">
                            <BarChart3 className="h-3 w-3 mr-1" />
                            {t('member.documents.contributedToStats')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(doc)}
                      title={t('member.documents.download')}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {doc.processing_status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void openAnalyzeDialog(doc)}
                        disabled={analyzeMutation.isPending}
                        title={t('member.documents.analyze')}
                      >
                        {analyzeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Brain className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {doc.processing_status === 'completed' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setAnalysisDocument(doc)}
                        title={t('member.documents.viewAnalysis')}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSharingDocument(doc)}
                      title={t('member.documents.manageSharing')}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                    {doc.processing_status === 'completed' && !doc.contributed_to_statistics && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => contributeMutation.mutate(doc.id)}
                        disabled={contributeMutation.isPending}
                        title={t('member.documents.contributeToStats')}
                      >
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(doc)}
                      disabled={deleteMutation.isPending}
                      title={t('member.documents.delete')}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sharing dialog */}
      {sharingDocument && (
        <DocumentSharingDialog
          document={sharingDocument}
          open={!!sharingDocument}
          onOpenChange={() => setSharingDocument(null)}
        />
      )}

      {/* Analysis view dialog */}
      {analysisDocument && (
        <DocumentAnalysisView
          document={analysisDocument}
          open={!!analysisDocument}
          onOpenChange={() => setAnalysisDocument(null)}
        />
      )}

      {analyzeDialogDocument && (
        <Dialog open={!!analyzeDialogDocument} onOpenChange={(open) => !open && closeAnalyzeDialog()}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t('member.documents.analyze')}</DialogTitle>
              <DialogDescription>{analyzeDialogDocument.title || analyzeDialogDocument.file_name}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-2">
                {analysisPreviewLoading ? (
                  <div className="flex h-60 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : analysisPreviewUrl ? (
                  analyzeDialogDocument.mime_type?.startsWith('image/') ? (
                    <img
                      src={analysisPreviewUrl}
                      alt={analyzeDialogDocument.file_name}
                      className="max-h-80 w-full rounded object-contain"
                    />
                  ) : analyzeDialogDocument.mime_type?.includes('pdf') ? (
                    <iframe
                      src={analysisPreviewUrl}
                      title={analyzeDialogDocument.file_name}
                      className="h-80 w-full rounded border"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      {t('member.documents.download')}
                    </div>
                  )
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    {t('common.noData')}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="analysis-redactions">{t('member.documents.documentDescription')}</Label>
                <Textarea
                  id="analysis-redactions"
                  rows={4}
                  value={analysisCustomRedactions}
                  onChange={(event) => setAnalysisCustomRedactions(event.target.value)}
                  placeholder={t('common.optional')}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeAnalyzeDialog}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleAnalyzeWithRedaction} disabled={analyzeMutation.isPending}>
                {analyzeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('member.documents.analyze')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
