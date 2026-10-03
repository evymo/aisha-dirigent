import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Lightweight page loader for Suspense fallback.
 * Uses opacity transition for smooth appearance without layout shift.
 */
export const PageLoader = () => {
    const { t } = useTranslation();
    
    return (
        <div className="flex min-h-[60vh] w-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
            </div>
        </div>
    );
};
