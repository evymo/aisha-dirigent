import { ReactNode, useCallback, useEffect, useRef } from "react";
import { useInRouterContext, useLocation } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { Button } from "@/components/ui/button";
import { safeError } from "@/lib/security/safeLogger";
import { useTranslation } from "react-i18next";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface FallbackProps {
  error: Error;
  onRetry: () => void;
}

const FallbackContent = ({ error, onRetry }: FallbackProps) => {
  const { t } = useTranslation();
  // Only show detailed error messages in development to prevent information disclosure
  const isDevelopment = import.meta.env.DEV;
  
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center gap-4">
      <div className="space-y-2 max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("errors.genericError")}
        </h1>
        <p className="text-muted-foreground">
          {t("errors.pageLoadError")}
        </p>
        {isDevelopment && (
          <div className="text-left border rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">
              {t("errors.devDetails")}
            </p>
            <p className="break-words">{error?.message ?? "Unknown error"}</p>
          </div>
        )}
      </div>
      <Button onClick={onRetry} variant="default">
        {t("common.retry")}
      </Button>
    </div>
  );
};

/**
 * ⛔ CHYBOVÁ STRÁNKA SE PO PŘECHODU JINAM SAMA ZAVŘE (2026-10-01, naměřeno na instanci).
 * Hranice obaluje celou aplikaci a bez resetu zůstala chybová stránka na
 * KAŽDÉ další trase — autorka ji viděla, dokud se znovu nepřihlásila (plné
 * načtení). Mimo router (testy, izolované vykreslení) se nesleduje nic.
 */
function ResetPriNavigaci({ reset }: { reset: () => void }) {
  return useInRouterContext() ? <SledovaniCesty reset={reset} /> : null;
}

function SledovaniCesty({ reset }: { reset: () => void }) {
  const { pathname } = useLocation();
  const cestaPriChybe = useRef(pathname);
  useEffect(() => {
    if (pathname !== cestaPriChybe.current) reset();
  }, [pathname, reset]);
  return null;
}

/**
 * Safely converts unknown error to Error instance.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Application-level error boundary using Sentry.ErrorBoundary.
 * Catches React errors, logs them via safeError (which reports to Sentry in production),
 * and explicitly captures them with component stack context.
 */
const AppErrorBoundary = ({ children }: AppErrorBoundaryProps) => {
  const handleError = useCallback((error: unknown, componentStack: string, _eventId: string) => {
    const errorObj = toError(error);
    
    // Log via safeError (which sends to Sentry in production)
    safeError("AppErrorBoundary.componentDidCatch", errorObj);
    
    // Also explicitly capture with component stack for better debugging
    Sentry.captureException(errorObj, {
      level: "error",
      extra: {
        componentStack,
      },
    });
  }, []);

  const handleReset = useCallback((_error: unknown, _componentStack: string, _eventId: string) => {
    // Reset logic can be extended (e.g., clearing caches) if needed
  }, []);

  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <>
          <ResetPriNavigaci reset={resetError} />
          <FallbackContent
            error={toError(error)}
            onRetry={resetError}
          />
        </>
      )}
      onError={handleError}
      onReset={handleReset}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
};

export default AppErrorBoundary;
