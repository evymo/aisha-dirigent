import { Fragment, Suspense, lazy, useEffect, useRef } from "react";
import { ScrollRestoration, useOutlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { SessionTimeoutProvider } from "@/components/session/SessionTimeoutProvider";
import AppErrorBoundary from "@/components/layout/AppErrorBoundary";
import { SessionProvider } from "@/hooks/useSession";
import { PhiModeProvider } from "@/hooks/useSecureMode";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { ReloadPrompt } from "@/components/pwa/ReloadPrompt";
import { PageLoader } from "./PageLoader";
import { preloadPublicPages } from "@/lib/perf/preloadPublicPages";
import { useAuthReturnTracker } from "@/hooks/useAuthReturnTracker";
// ⛔ STATICKY NE: AiChatWidget táhne 20 dalších importů (ChatMarkdown,
// CitationPanel, ExplainabilityPanel, AskAishaPanel, ConversationList…)
// a renderuje se i NEPŘIHLÁŠENÉMU návštěvníkovi veřejného webu, který
// chat nikdy neotevře. Statický import ho navíc vtahoval do `shared`
// chunku i po rozdělení — dynamický import je jediné, co tu hranici
// v build fázi udrží (manualChunks má přednost před lazy jen u STATICKÝCH
// hran; dynamická hrana chunk neslévá).
const AiChatWidget = lazy(() =>
  import("@/components/chat/AiChatWidget").then((m) => ({ default: m.AiChatWidget })),
);
import { AccountDeletionBanner } from "@/components/session/AccountDeletionBanner";
import { TermsConsentGate } from "@/components/session/TermsConsentGate";
import { BetaBanner } from "@/components/layout/BetaBanner";
import { DataConsentBanner } from "@/components/layout/DataConsentBanner";

/**
 * Dismisses the HTML preloader (Aisha mascot) once mounted.
 * Placed inside <Suspense> so it only renders after the lazy route loads.
 * This ensures the user sees the fully rendered page when Aisha fades out.
 */
const PreloaderDismisser = () => {
    const called = useRef(false);

    useEffect(() => {
        if (called.current) return;
        called.current = true;

        const w = window as unknown as Record<string, unknown>;
        const fn = w.__dismissPreloader;
        if (typeof fn === "function") {
            void (fn as () => Promise<void>)();
            // Clean up global reference
            delete w.__dismissPreloader;
        }
    }, []);

    return null;
};

export const RootLayout = () => {
    const outlet = useOutlet();
    useAuthReturnTracker();

    // Preload public pages in idle time for snappy navigation
    useEffect(() => {
        const idle = typeof requestIdleCallback === "function" 
            ? requestIdleCallback 
            : (cb: () => void) => setTimeout(cb, 200);
        
        idle(() => preloadPublicPages());
    }, []);

    return (
        <Fragment>
            <SessionProvider>
                <PhiModeProvider>
                    <SessionTimeoutProvider>
                        {/* Global UI Components */}
                        <Toaster />
                        <ReloadPrompt />

                        {/* Scroll Handling */}
                        <ScrollToTop />
                        <ScrollRestoration />

                        {/* App Shell - No page transition animations for instant navigation */}
                        <AppErrorBoundary>
                            <div className="flex min-h-screen flex-col font-sans antialiased">
                                <BetaBanner />
                                <TermsConsentGate>
                                    <Suspense fallback={<PageLoader />}>
                                        {outlet}
                                        <PreloaderDismisser />
                                    </Suspense>
                                </TermsConsentGate>
                                <AccountDeletionBanner />
                                <Suspense fallback={null}>
                                  <AiChatWidget />
                                </Suspense>
                                <DataConsentBanner />
                            </div>
                        </AppErrorBoundary>
                    </SessionTimeoutProvider>
                </PhiModeProvider>
            </SessionProvider>
        </Fragment>
    );
};
