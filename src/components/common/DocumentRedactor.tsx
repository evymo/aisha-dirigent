import { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Save, Undo, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { pdfjs } from "react-pdf";
import { PDFDocument } from "pdf-lib";

// ── Types ────────────────────────────────────────────────────
interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface DocumentRedactorProps {
    file: File;
    isOpen: boolean;
    onClose: () => void;
    onSave: (redactedFile: File) => void;
}

/** MIME types the redactor can handle. */
export const REDACTOR_SUPPORTED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
] as const;

// ── Helpers ──────────────────────────────────────────────────
function isPdfFile(file: File): boolean {
    return file.type === "application/pdf";
}

/**
 * Renders a single PDF page (1-indexed) to an offscreen canvas
 * at full resolution and returns its ImageBitmap-backed data URL.
 */
async function renderPdfPageToCanvas(
    pdfDoc: pdfjs.PDFDocumentProxy,
    pageNumber: number,
    maxWidth: number,
): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const displayScale = Math.min(1, maxWidth / viewport.width);
    const scaledViewport = page.getViewport({ scale: displayScale });

    const canvas = document.createElement("canvas");
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    await page.render({ canvas: null, canvasContext: ctx, viewport: scaledViewport }).promise;

    return { canvas, scale: displayScale };
}

/**
 * Generates a flat-image PDF from an array of canvases (one per page).
 * Each canvas is exported as PNG and embedded as a full-page image,
 * ensuring all redaction rectangles are permanently baked in.
 */
async function buildRedactedPdf(
    pageCanvases: HTMLCanvasElement[],
): Promise<Blob> {
    const pdfDoc = await PDFDocument.create();

    for (const canvas of pageCanvases) {
        const pngDataUrl = canvas.toDataURL("image/png");
        const pngBytes = Uint8Array.from(
            atob(pngDataUrl.split(",")[1]),
            (c) => c.charCodeAt(0),
        );
        const pngImage = await pdfDoc.embedPng(pngBytes);
        const page = pdfDoc.addPage([canvas.width, canvas.height]);
        page.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
        });
    }

    const bytes = await pdfDoc.save();
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

// ── Component ────────────────────────────────────────────────
export function DocumentRedactor({ file, isOpen, onClose, onSave }: DocumentRedactorProps) {
    const { t } = useTranslation();

    // Canvas refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Shared drawing state
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentStart, setCurrentStart] = useState<{ x: number; y: number } | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Image mode state
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);

    // PDF mode state
    const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const pdfPageCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // Per-page rects (key = page number; images use page 1)
    const [pageRects, setPageRects] = useState<Record<number, Rect[]>>({});

    const currentRects = pageRects[currentPage] ?? [];

    // ── Reset state on open/file change ──────────────────────
    useEffect(() => {
        if (!isOpen) return;
        setPageRects({});
        setCurrentPage(1);
        setNumPages(0);
        setPdfDoc(null);
        setImageUrl(null);
        imgRef.current = null;
        pdfPageCanvasRef.current = null;
        setIsDrawing(false);
        setCurrentStart(null);
        setIsSaving(false);
    }, [file, isOpen]);

    // ── Load image ───────────────────────────────────────────
    useEffect(() => {
        if (!isOpen || !file || isPdfFile(file)) return;
        if (!file.type.startsWith("image/")) return;

        const url = URL.createObjectURL(file);
        setImageUrl(url);

        const img = new Image();
        img.src = url;
        img.onload = () => {
            imgRef.current = img;
            setNumPages(1);
        };

        return () => URL.revokeObjectURL(url);
    }, [file, isOpen]);

    // ── Load PDF ─────────────────────────────────────────────
    useEffect(() => {
        if (!isOpen || !file || !isPdfFile(file)) return;

        let cancelled = false;

        // Use FileReader as fallback for environments where File.arrayBuffer() is unavailable
        const readFile = (): Promise<ArrayBuffer> => {
            if (typeof file.arrayBuffer === "function") {
                return file.arrayBuffer();
            }
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(file);
            });
        };

        readFile().then(async (buf) => {
            if (cancelled) return;
            const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
            if (cancelled) return;
            setPdfDoc(doc);
            setNumPages(doc.numPages);
        });

        return () => {
            cancelled = true;
        };
    }, [file, isOpen]);

    // ── Render current page/image to visible canvas ──────────
    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const rects = pageRects[currentPage] ?? [];

        if (isPdfFile(file) && pdfPageCanvasRef.current) {
            // PDF: draw the pre-rendered page image
            const src = pdfPageCanvasRef.current;
            canvas.width = src.width;
            canvas.height = src.height;
            ctx.drawImage(src, 0, 0);
        } else if (imgRef.current) {
            // Image: scale to container
            const img = imgRef.current;
            const containerWidth = container.clientWidth || 600;
            const scale = Math.min(1, containerWidth / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } else {
            return; // Nothing to draw yet
        }

        // Draw committed redaction rects
        ctx.fillStyle = "black";
        rects.forEach((r) => ctx.fillRect(r.x, r.y, r.w, r.h));
    }, [file, currentPage, pageRects]);

    // Render PDF page when currentPage or pdfDoc changes
    useEffect(() => {
        if (!pdfDoc || !isOpen) return;
        let cancelled = false;
        const containerWidth = containerRef.current?.clientWidth || 600;

        renderPdfPageToCanvas(pdfDoc, currentPage, containerWidth).then(({ canvas }) => {
            if (cancelled) return;
            pdfPageCanvasRef.current = canvas;
            redrawCanvas();
        });

        return () => {
            cancelled = true;
        };
    }, [pdfDoc, currentPage, isOpen, redrawCanvas]);

    // Re-draw when rects change (image mode or after PDF page rendered)
    useEffect(() => {
        redrawCanvas();
    }, [redrawCanvas]);

    // ── Drawing handlers ─────────────────────────────────────
    const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (isSaving) return;
        setIsDrawing(true);
        setCurrentStart(getCoords(e));
    };

    const handleDraw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !currentStart || !canvasRef.current || isSaving) return;

        const ctx = canvasRef.current.getContext("2d");
        if (!ctx) return;

        // Full redraw from source
        redrawCanvas();

        const current = getCoords(e);
        const w = current.x - currentStart.x;
        const h = current.y - currentStart.y;

        // Preview rectangle (semi-transparent)
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(currentStart.x, currentStart.y, w, h);
    };

    const stopDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !currentStart) return;

        const current = getCoords(e);
        const w = current.x - currentStart.x;
        const h = current.y - currentStart.y;

        if (Math.abs(w) > 5 && Math.abs(h) > 5) {
            setPageRects((prev) => ({
                ...prev,
                [currentPage]: [...(prev[currentPage] ?? []), { x: currentStart.x, y: currentStart.y, w, h }],
            }));
        }

        setIsDrawing(false);
        setCurrentStart(null);
    };

    // ── Undo (current page) ─────────────────────────────────
    const handleUndo = () => {
        setPageRects((prev) => ({
            ...prev,
            [currentPage]: (prev[currentPage] ?? []).slice(0, -1),
        }));
    };

    // ── Page navigation ──────────────────────────────────────
    const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
    const goToNextPage = () => setCurrentPage((p) => Math.min(numPages, p + 1));

    // ── Save ─────────────────────────────────────────────────
    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);

        try {
            if (isPdfFile(file) && pdfDoc) {
                // Render ALL pages with redactions to individual canvases
                const containerWidth = containerRef.current?.clientWidth || 600;
                const pageCanvases: HTMLCanvasElement[] = [];

                for (let i = 1; i <= numPages; i++) {
                    const { canvas } = await renderPdfPageToCanvas(pdfDoc, i, containerWidth);
                    const rects = pageRects[i] ?? [];
                    if (rects.length > 0) {
                        const ctx = canvas.getContext("2d");
                        if (ctx) {
                            ctx.fillStyle = "black";
                            rects.forEach((r) => ctx.fillRect(r.x, r.y, r.w, r.h));
                        }
                    }
                    pageCanvases.push(canvas);
                }

                const blob = await buildRedactedPdf(pageCanvases);
                const newFile = new File([blob], file.name, {
                    type: "application/pdf",
                    lastModified: Date.now(),
                });
                onSave(newFile);
                onClose();
            } else if (canvasRef.current) {
                // Image: export canvas directly
                canvasRef.current.toBlob(
                    (blob) => {
                        if (blob) {
                            const newFile = new File([blob], file.name, {
                                type: file.type,
                                lastModified: Date.now(),
                            });
                            onSave(newFile);
                            onClose();
                        }
                        setIsSaving(false);
                    },
                    file.type,
                );
                return; // isSaving reset happens in blob callback
            }
        } finally {
            setIsSaving(false);
        }
    };

    // ── Total rects across all pages ─────────────────────────
    const totalRects = Object.values(pageRects).reduce((sum, arr) => sum + arr.length, 0);
    const isReady = isPdfFile(file) ? !!pdfDoc && !!pdfPageCanvasRef.current : !!imgRef.current;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{t("common.redactDocument")}</DialogTitle>
                </DialogHeader>

                {/* Page navigation for PDFs */}
                {isPdfFile(file) && numPages > 1 && (
                    <div className="flex items-center justify-center gap-3 py-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={goToPrevPage}
                            disabled={currentPage <= 1 || isSaving}
                            aria-label={t("common.previous")}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground tabular-nums">
                            {t("common.pageOf", { current: currentPage, total: numPages })}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={goToNextPage}
                            disabled={currentPage >= numPages || isSaving}
                            aria-label={t("common.next")}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {/* Canvas area */}
                <div
                    className="flex-1 overflow-auto bg-muted/20 rounded-md flex items-center justify-center p-4 relative"
                    ref={containerRef}
                >
                    {isReady ? (
                        <canvas
                            ref={canvasRef}
                            onMouseDown={startDrawing}
                            onMouseMove={handleDraw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={handleDraw}
                            onTouchEnd={stopDrawing}
                            className="cursor-crosshair shadow-lg"
                        />
                    ) : (
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("common.loading")}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="flex justify-between sm:justify-between items-center">
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleUndo}
                            disabled={currentRects.length === 0 || isSaving}
                        >
                            <Undo className="h-4 w-4 mr-1" />
                            {t("common.undo")}
                        </Button>
                        <span className="text-xs text-muted-foreground flex items-center">
                            {t("common.redactHint")}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving || totalRects === 0}>
                            {isSaving ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-1" />
                            )}
                            {t("common.save")}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
