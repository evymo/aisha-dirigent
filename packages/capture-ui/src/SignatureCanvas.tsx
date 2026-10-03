import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";

/**
 * Hand-drawn signature on a canvas — the one thing in a handover that no machine
 * can supply.
 *
 * Extracted from the study-consent flow so every surface can reuse it: the same
 * drawing lives on an informed consent, on a delivery handover, on an acceptance
 * protocol. What it is attached to is the caller's business; this component only
 * knows how to take a signature and hand it back.
 *
 * DELIBERATELY DEPENDENCY-LIGHT. The main web app ships a component library and
 * an i18n runtime; the extranet shell ships neither (eight files, no framework
 * beyond React). A shared primitive that imported either would be unusable in
 * exactly the surface a driver holds in the cab. So: labels come in as props and
 * the button is a plain element the caller styles. The consent flow keeps its
 * own look by wrapping this, not by forking it.
 *
 * The value is a PNG data URI. That matches how this stack already stores
 * signatures — `study_consent_acceptances.signature_data text`, written through
 * an audited RPC that refuses a blank one and never overwrites a recorded one.
 * A signature is evidence attached to a record, not a file in a bucket.
 */

export interface SignatureCanvasRef {
  /** PNG data URI, or null when nothing has been drawn. */
  getSignatureData: () => string | null;
  isEmpty: () => boolean;
  clear: () => void;
}

export interface SignatureCanvasProps {
  /** Shown until the first stroke. The caller translates it. */
  placeholder?: string;
  /** Label of the clear button. The caller translates it. */
  clearLabel?: string;
  /** Fires on the first stroke and on clear, so the caller can gate its submit. */
  onSignatureChange?: (hasSignature: boolean) => void;
  /** Escape hatches for the host's styling — no library is assumed. */
  className?: string;
  canvasClassName?: string;
  clearButtonClassName?: string;
  /** Stroke colour. Defaults to `currentColor` so it follows the host's theme. */
  strokeStyle?: string;
  width?: number;
  height?: number;
}

export const SignatureCanvas = forwardRef<SignatureCanvasRef, SignatureCanvasProps>(
  (
    {
      placeholder,
      clearLabel = "Clear",
      onSignatureChange,
      className,
      canvasClassName,
      clearButtonClassName,
      strokeStyle,
      width = 500,
      height = 150,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);

    useImperativeHandle(ref, () => ({
      getSignatureData: () => {
        if (!canvasRef.current || !hasSignature) return null;
        return canvasRef.current.toDataURL("image/png");
      },
      isEmpty: () => !hasSignature,
      clear: () => clearCanvas(),
    }));

    useEffect(() => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      // `currentColor` resolves against the canvas element, so the stroke follows
      // whatever theme the host applies without this package knowing any tokens.
      ctx.strokeStyle = strokeStyle ?? "currentColor";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }, [strokeStyle]);

    // The canvas backing store is a fixed size while the element is laid out
    // fluidly, so pointer coordinates must be scaled — without this the stroke
    // lands away from the finger on any width but the declared one.
    const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      if ("touches" in e) {
        // touches can be empty on touchend, and a shell compiled with
        // noUncheckedIndexedAccess is right to insist: reading .clientX off
        // undefined would throw mid-stroke rather than just skip a point.
        const touch = e.touches[0];
        if (!touch) return { x: 0, y: 0 };
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        };
      }

      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const { x, y } = getCoordinates(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;

      const { x, y } = getCoordinates(e);
      ctx.lineTo(x, y);
      ctx.stroke();

      if (!hasSignature) {
        setHasSignature(true);
        onSignatureChange?.(true);
      }
    };

    const stopDrawing = () => setIsDrawing(false);

    const clearCanvas = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasSignature(false);
      onSignatureChange?.(false);
    };

    return (
      <div className={className}>
        <div style={{ position: "relative" }}>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={canvasClassName}
            // touchAction none: without it the browser scrolls the page instead
            // of drawing — the whole component is unusable on a phone.
            style={{ touchAction: "none", width: "100%", cursor: "crosshair" }}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
          {!hasSignature && placeholder ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                opacity: 0.6,
              }}
            >
              <span>{placeholder}</span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={clearCanvas}
          disabled={!hasSignature}
          className={clearButtonClassName}
        >
          {clearLabel}
        </button>
      </div>
    );
  }
);

SignatureCanvas.displayName = "SignatureCanvas";
