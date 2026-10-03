import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Lock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArchiveDocumentSignedUrl } from "@/hooks/useDocumentSignedUrl";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface DocumentDownloadButtonProps {
  /** Storage path in the archive-documents bucket */
  storagePath?: string | null;
  /** Is the document publicly downloadable without auth? */
  isDownloadPublic?: boolean;
  /** Label key for translation */
  labelKey: string;
  /** Icon to display */
  icon?: React.ReactNode;
}

export function DocumentDownloadButton({
  storagePath,
  isDownloadPublic = false,
  labelKey,
  icon = <Download className="h-4 w-4" />,
}: DocumentDownloadButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const signedUrlMutation = useArchiveDocumentSignedUrl();

  // No download available
  if (!storagePath) {
    return null;
  }

  // Check if user can download (public or authenticated)
  const canDownload = isDownloadPublic || !!user;

  // User not logged in and document is not public - show sign-in prompt
  if (!canDownload) {
    return (
      <div className="space-y-2">
        <Button variant="outline" className="w-full justify-start" asChild>
          <Link to="/auth">
            <Lock className="h-4 w-4" />
            <span className="ml-2">{t("documents.signInToDownload")}</span>
            <LogIn className="h-3 w-3 ml-auto" />
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          {t("documents.registerForAccess")}
        </p>
      </div>
    );
  }



  const handleDownload = async () => {
    if (!storagePath) return;

    try {
      const { signedUrl } = await signedUrlMutation.getSignedUrl(storagePath, 60);
      window.open(signedUrl, "_blank");
    } catch {
      toast.error(t("errors.downloadFailed"));
    }
  };

  return (
    <Button
      variant="outline"
      className="w-full justify-start"
      onClick={handleDownload}
      disabled={signedUrlMutation.isPending}
    >
      {icon}
      <span className="ml-2">{t(labelKey)}</span>
      <ExternalLink className="h-3 w-3 ml-auto" />
    </Button>
  );
}
