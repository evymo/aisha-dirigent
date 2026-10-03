import { forwardRef } from "react";
import { useTranslation } from "react-i18next";

import {
  SignatureCanvas as SharedSignatureCanvas,
  type SignatureCanvasRef,
} from "@aisha/capture-ui";

/**
 * Consent-flow skin over the shared signature primitive.
 *
 * The drawing itself moved to `@aisha/capture-ui` so other surfaces can take a
 * signature too — notably the extranet, which ships neither a component library
 * nor an i18n runtime, and which a driver holds in the cab. What stays here is
 * only what belongs to THIS app: the translated labels and the shadcn look.
 *
 * The imperative API is unchanged (getSignatureData / isEmpty / clear), so
 * InformedConsentForm and StudyConsentSigning keep working without edits.
 */

export type { SignatureCanvasRef };

interface SignatureCanvasProps {
  onSignatureChange?: (hasSignature: boolean) => void;
}

export const SignatureCanvas = forwardRef<SignatureCanvasRef, SignatureCanvasProps>(
  ({ onSignatureChange }, ref) => {
    const { t } = useTranslation();

    return (
      <SharedSignatureCanvas
        ref={ref}
        onSignatureChange={onSignatureChange}
        placeholder={t("consent.signature.placeholder")}
        clearLabel="Vymazat / Clear"
        strokeStyle="hsl(var(--foreground))"
        className="space-y-2"
        canvasClassName="h-36 border-2 border-dashed border-border rounded-lg bg-card"
        clearButtonClassName="ml-auto flex items-center gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
      />
    );
  }
);

SignatureCanvas.displayName = "SignatureCanvas";
