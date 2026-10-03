import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  Lock,
  LogIn,
  AlertTriangle,
  Download,
  Maximize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useArchiveDocumentSignedUrl } from "@/hooks/useDocumentSignedUrl";
import { Link } from "react-router-dom";
import { safeError } from "@/lib/security/safeLogger";
import {
  areLocalPdfAssetsReachable,
  buildPdfDocumentOptions,
  resolvePdfAssetMode,
  type PdfAssetSource,
} from "./pdfAssets";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/** Signed URL lifetime in seconds — refresh before expiry */
const SIGNED_URL_TTL_SECONDS = 300;
/** Refresh the URL this many seconds before it expires */
const SIGNED_URL_REFRESH_BUFFER_SECONDS = 30;

interface DocumentViewerProps {
  /** Storage path in Supabase Storage */
  storagePath?: string | null;
  /** Is the document publicly viewable? (for preview access) */
  isPublic?: boolean;
  /** Is the document publicly downloadable? */
  isDownloadPublic?: boolean;
}

/**
 * Measures container width using ResizeObserver and returns a reactive value.
 */
function useContainerWidth(containerRef: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Use contentBoxSize when available; fallback to contentRect
        const boxWidth =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setWidth(boxWidth);
      }
    });

    observer.observe(el);
    // Initial measurement
    setWidth(el.clientWidth);

    return () => observer.disconnect();
  }, [containerRef]);

  return width;
}

export function DocumentViewer({
  storagePath,
  isPublic = false,
  isDownloadPublic = false,
}: DocumentViewerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pdfAssetMode = useMemo(
    () =>
      resolvePdfAssetMode({
        queryString: typeof window === "undefined" ? "" : window.location.search,
        envMode: import.meta.env.VITE_PDFJS_ASSETS_MODE,
      }),
    []
  );
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [pdfAssetSource, setPdfAssetSource] = useState<PdfAssetSource>(
    pdfAssetMode === "cdn" ? "cdn" : "local"
  );
  const [hasTriedCdnFallback, setHasTriedCdnFallback] = useState(pdfAssetMode === "cdn");
  const [assetsResolved, setAssetsResolved] = useState(pdfAssetMode !== "auto");
  const pdfOptions = useMemo(
    () => buildPdfDocumentOptions(pdfAssetSource, pdfjs.version),
    [pdfAssetSource]
  );

  // Responsive container width measurement
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(viewerContainerRef);
  // Inner padding (p-4 = 16px each side)
  // Fallback to viewport-based width before ResizeObserver fires so the PDF
  // renders immediately at a sensible size instead of showing a spinner.
  const fallbackWidth =
    typeof window !== "undefined" ? Math.min(window.innerWidth - 64, 800) : 600;
  const effectiveWidth =
    containerWidth > 0 ? containerWidth - 32 : fallbackWidth;

  // Root element ref for keyboard focus
  const rootRef = useRef<HTMLDivElement>(null);

  const signedUrlMutation = useArchiveDocumentSignedUrl();
  const signedUrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if user can view document preview
  const canView = isPublic || !!user;
  // Check if user can download the document
  const canDownload = !!user && (isDownloadPublic || isPublic);

  // ---- Asset resolution ----
  useEffect(() => {
    if (pdfAssetMode !== "auto") return;

    let isCancelled = false;

    async function resolveAssetSource() {
      const localAssetsReachable = await areLocalPdfAssetsReachable();
      if (isCancelled) return;

      if (!localAssetsReachable) {
        setPdfAssetSource("cdn");
        setHasTriedCdnFallback(true);
      }

      setAssetsResolved(true);
    }

    void resolveAssetSource();

    return () => {
      isCancelled = true;
    };
  }, [pdfAssetMode]);

  // ---- Signed URL fetch + auto-refresh ----
  const fetchSignedUrl = useCallback(async () => {
    if (!canView || !storagePath) return;

    try {
      const { signedUrl } = await signedUrlMutation.getSignedUrl(
        storagePath,
        SIGNED_URL_TTL_SECONDS,
      );
      setPdfUrl(signedUrl);
      setViewerError(null);
      setError(null);

      // Schedule refresh before expiry
      if (signedUrlTimerRef.current) clearTimeout(signedUrlTimerRef.current);
      const refreshMs =
        (SIGNED_URL_TTL_SECONDS - SIGNED_URL_REFRESH_BUFFER_SECONDS) * 1000;
      signedUrlTimerRef.current = setTimeout(() => {
        void fetchSignedUrl();
      }, refreshMs);
    } catch {
      setError(t("documents.viewerError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitting fetchUrl reference (stable closure)
  }, [storagePath, canView, t]);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      setError(null);

      if (!canView) {
        setIsLoading(false);
        return;
      }

      if (storagePath) {
        await fetchSignedUrl();
      } else {
        setError(t("documents.noDocument"));
      }

      setIsLoading(false);
    }

    void init();

    return () => {
      if (signedUrlTimerRef.current) clearTimeout(signedUrlTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omitting timer setup (stable closure)
  }, [storagePath, canView, t]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: pages }: { numPages: number }) => {
      setNumPages(pages);
      setPageNumber(1);
      setViewerError(null);
    },
    [],
  );

  const onDocumentLoadError = useCallback(() => {
    if (
      pdfAssetMode === "auto" &&
      pdfAssetSource === "local" &&
      !hasTriedCdnFallback
    ) {
      setPdfAssetSource("cdn");
      setHasTriedCdnFallback(true);
      setViewerError(null);
      return;
    }

    setViewerError(t("documents.viewerError"));
  }, [hasTriedCdnFallback, pdfAssetMode, pdfAssetSource, t]);

  // ---- Navigation & zoom helpers ----
  const goToPrevPage = useCallback(
    () => setPageNumber((prev) => Math.max(prev - 1, 1)),
    [],
  );
  const goToNextPage = useCallback(
    () => setPageNumber((prev) => Math.min(prev + 1, numPages)),
    [numPages],
  );
  const zoomIn = useCallback(
    () => setScale((prev) => Math.min(prev + 0.25, 2.5)),
    [],
  );
  const zoomOut = useCallback(
    () => setScale((prev) => Math.max(prev - 0.25, 0.5)),
    [],
  );
  const fitToWidth = useCallback(() => setScale(1.0), []);

  // ---- Blob download ----
  const handleDownload = useCallback(async () => {
    if (!pdfUrl) return;
    setIsDownloading(true);
    try {
      const response = await fetch(pdfUrl, { signal: AbortSignal.timeout(15_000) });
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      // Derive filename from storage path
      const filename =
        storagePath?.split("/").pop() ?? "document.pdf";
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      safeError("pdf.download.failed", err);
    } finally {
      setIsDownloading(false);
    }
  }, [pdfUrl, storagePath]);

  // ---- Keyboard shortcuts ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't intercept when user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPrevPage();
          break;
        case "ArrowRight":
          e.preventDefault();
          goToNextPage();
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
          e.preventDefault();
          zoomOut();
          break;
        case "0":
          e.preventDefault();
          fitToWidth();
          break;
      }
    },
    [goToPrevPage, goToNextPage, zoomIn, zoomOut, fitToWidth],
  );

  // Not logged in and document is not public
  if (!canView) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
        <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t("documents.signInToView")}
        </h3>
        <p className="text-muted-foreground text-sm mb-4 max-w-md mx-auto">
          {t("documents.signInToViewDescription")}
        </p>
        <p className="text-muted-foreground text-xs mb-6 max-w-md mx-auto">
          {t("documents.publicArchiveHint")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <Link to="/auth">
              <LogIn className="h-4 w-4 mr-2" />
              {t("auth.signIn")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/archive">
              {t("documents.browsePublicArchive")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div
        className="bg-muted/30 border border-border rounded-xl p-12 flex items-center justify-center"
        role="status"
        aria-label={t("common.loading")}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (error || !pdfUrl) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-8 text-center" role="alert">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t("documents.viewerUnavailable")}
        </h3>
        <p className="text-muted-foreground text-sm">
          {error || t("documents.noDocument")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="bg-card border border-border rounded-xl overflow-hidden focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="document"
      aria-label={t("documents.documentPreview")}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 sm:gap-4 p-2 sm:p-3 border-b border-border bg-muted/30"
        role="toolbar"
        aria-label={t("documents.toolbar")}
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevPage}
            disabled={pageNumber <= 1}
            className="h-8 w-8"
            aria-label={t("common.previous")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[80px] text-center" aria-live="polite">
            {t("documents.pageIndicator", { current: pageNumber, total: numPages })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextPage}
            disabled={pageNumber >= numPages}
            className="h-8 w-8"
            aria-label={t("common.next")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="h-8 w-8"
            aria-label={t("documents.zoomOut")}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[50px] text-center" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={zoomIn}
            disabled={scale >= 2.5}
            className="h-8 w-8"
            aria-label={t("documents.zoomIn")}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={fitToWidth}
            className="h-8 w-8"
            aria-label={t("documents.fitToWidth")}
          >
            <Maximize className="h-4 w-4" />
          </Button>
          {canDownload && pdfUrl && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              disabled={isDownloading}
              className="h-8 w-8"
              aria-label={t("documents.download")}
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* PDF Viewer — responsive container with min-height to prevent
          layout collapse during page transitions (avoids footer flash) */}
      <div
        ref={viewerContainerRef}
        className="overflow-auto max-h-[75vh] min-h-[50vh] bg-muted/20 p-4"
      >
        {!assetsResolved ? (
          <div className="flex items-center justify-center py-12" role="status" aria-label={t("common.loading")}>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Document
            key={`${pdfUrl}-${pdfAssetSource}`}
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            options={pdfOptions}
            loading={
              <div className="flex items-center justify-center py-12" role="status" aria-label={t("common.loading")}>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            }
            error={
              <div className="text-center py-12" role="alert">
                <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">
                  {viewerError || t("documents.viewerError")}
                </p>
              </div>
            }
          >
            {/* Use margin:auto for centering — flex justify-center would clip
                the left overflow when the page is wider than the container */}
            <div style={{ width: effectiveWidth * scale, margin: '0 auto' }}>
              <Page
                pageNumber={pageNumber}
                width={effectiveWidth * scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="shadow-lg"
                loading={
                  <div
                    className="flex items-center justify-center bg-muted/10 rounded shadow-lg"
                    style={{
                      width: effectiveWidth * scale,
                      minHeight: effectiveWidth * scale * 1.414, // A4 aspect ratio
                    }}
                    role="status"
                    aria-label={t("common.loading")}
                  >
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                }
              />
            </div>
          </Document>
        )}
      </div>

      {/* Bottom bar: page nav + keyboard hint */}
      {numPages > 1 && (
        <div className="flex items-center justify-between gap-2 p-2 sm:p-3 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground hidden sm:block">
            {t("documents.keyboardHint")}
          </p>
          <div className="flex items-center gap-2 mx-auto sm:mx-0">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevPage}
              disabled={pageNumber <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              {t("common.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextPage}
              disabled={pageNumber >= numPages}
            >
              {t("common.next")}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
