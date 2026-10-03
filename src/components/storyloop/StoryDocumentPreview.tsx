import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  FileText, 
  Image, 
  File,
  ExternalLink,
  Loader2,
  X,
  Download,
  Share2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DocumentViewer } from '@/components/archive/DocumentViewer';
import { useTrackingDocumentSignedUrl } from '@/hooks/useDocumentSignedUrl';
import { safeInfo, safeError } from '@/lib/security/safeLogger';
import { toast } from 'sonner';

interface StoryDocumentPreviewProps {
  /** Document ID for audit/tracking */
  documentId: string;
  fileName: string;
  mimeType?: string | null;
  filePath: string;
  category?: string;
  /** Show inline preview instead of button */
  inline?: boolean;
  /** Callback when document is opened */
  onOpen?: (documentId: string) => void;
  /** Callback for download action */
  onDownload?: (documentId: string) => void;
}

export function StoryDocumentPreview({
  documentId,
  fileName,
  mimeType,
  filePath,
  category,
  inline = false,
  onOpen,
  onDownload,
}: StoryDocumentPreviewProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  const signedUrlMutation = useTrackingDocumentSignedUrl();

  const isPdf = mimeType?.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
  const isImage = mimeType?.startsWith('image/') || 
    /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);

  const getFileIcon = () => {
    if (isPdf) return FileText;
    if (isImage) return Image;
    return File;
  };

  const FileIcon = getFileIcon();

  // Track document open for audit
  useEffect(() => {
    if (isOpen && onOpen) {
      onOpen(documentId);
    }
  }, [isOpen, onOpen, documentId]);
  
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  // Load image URL for inline preview
  const loadImageUrl = async () => {
    if (!isImage || imageUrl) return;
    
    setIsLoadingImage(true);
    try {
      const { signedUrl } = await signedUrlMutation.getSignedUrl(filePath, 300);
      setImageUrl(signedUrl);
    } catch {
      // Error handled by hook
    } finally {
      setIsLoadingImage(false);
    }
  };

  // Handle download
  const handleDownload = async () => {
    try {
      const { signedUrl } = await signedUrlMutation.getSignedUrl(filePath, 60);
      window.open(signedUrl, '_blank');
      onDownload?.(documentId);
    } catch {
      // Error handled by hook
    }
  };

  // Inline image preview
  if (inline && isImage) {
    return (
      <div className="mt-2">
        {isLoadingImage ? (
          <div className="h-32 bg-muted rounded flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : imageUrl ? (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <button className="block rounded overflow-hidden hover:opacity-90 transition-opacity">
                <img 
                  src={imageUrl} 
                  alt={fileName}
                  className="max-h-48 rounded object-contain"
                />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>{fileName}</DialogTitle>
              </DialogHeader>
              <img 
                src={imageUrl} 
                alt={fileName}
                className="w-full h-auto rounded"
              />
            </DialogContent>
          </Dialog>
        ) : (
          <button 
            onClick={loadImageUrl}
            className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm"
          >
            <Image className="h-4 w-4" />
            <span>{t('storyloop.loadPreview')}</span>
          </button>
        )}
      </div>
    );
  }

  // Share document via signed URL — native share API or clipboard fallback
  const handleShare = async () => {
    try {
      const { signedUrl } = await signedUrlMutation.getSignedUrl(filePath, 3600);
      safeInfo('storyloop.document.share', { documentId });

      // Try native share API first (mobile / supporting browsers)
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: fileName,
          url: signedUrl,
        });
        return;
      }

      // Fallback: copy to clipboard
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(signedUrl);
        toast.success(t('storyloop.documentLinkCopied'));
        return;
      }

      toast.error(t('common.error'));
    } catch (err) {
      // navigator.share can throw AbortError if user cancels — that's OK
      if (err instanceof DOMException && err.name === 'AbortError') return;
      safeError('storyloop.document.shareFailed', err);
      toast.error(t('common.error'));
    }
  };

  // PDF or general document preview with full controls
  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm group">
          <FileIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate max-w-[200px]">{fileName}</span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </DialogTrigger>
      
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileIcon className="h-5 w-5" />
              {fileName}
            </DialogTitle>
            <div className="flex items-center gap-1">
              {category && (
                <span className="text-xs px-2 py-1 bg-muted rounded mr-2">
                  {category}
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleShare}>
                    <Share2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common.share')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownload}>
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common.download')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common.close')}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto">
          {isPdf ? (
            <DocumentViewer 
              storagePath={filePath}
              isPublic={false}
              isDownloadPublic={false}
            />
          ) : isImage ? (
            <div className="flex items-center justify-center p-4">
              <ImagePreview filePath={filePath} fileName={fileName} />
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <File className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>{t('storyloop.previewNotAvailable')}</p>
              <p className="text-xs mt-1">{mimeType || t('common.unknown')}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Separate component for loading image
function ImagePreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const signedUrlMutation = useTrackingDocumentSignedUrl();

  useEffect(() => {
    async function loadUrl() {
      try {
        const { signedUrl } = await signedUrlMutation.getSignedUrl(filePath, 300);
        setUrl(signedUrl);
      } catch {
        setError(true);
      } finally {
        setIsLoading(false);
      }
    }
    loadUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadUrl is a stable local closure
  }, [filePath]);

  if (isLoading) {
    return <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />;
  }

  if (error || !url) {
    return <p className="text-muted-foreground">{t('storyloop.imageLoadFailed')}</p>;
  }

  return (
    <img 
      src={url} 
      alt={fileName}
      className="max-w-full max-h-[60vh] object-contain rounded"
    />
  );
}
