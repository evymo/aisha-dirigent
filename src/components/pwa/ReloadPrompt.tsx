import { useRegisterSW } from "virtual:pwa-register/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Headless PWA service-worker registration component.
 *
 * - Shows a brief toast when offline caching is complete (offlineReady).
 * - Silently activates waiting SW updates without page reload (needRefresh).
 */
export function ReloadPrompt() {
    const { t } = useTranslation();

    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered() {
            // SW registered — no user-facing action needed
        },
        onRegisterError(error) {
            safeError("pwa.registerError", error);
        },
    });

    // Notify user that app is ready for offline use
    useEffect(() => {
        if (offlineReady) {
            toast.info(t("pwa.offlineReadyTitle"), {
                description: t("pwa.offlineReadyMessage"),
                duration: 5000,
            });
            setOfflineReady(false); // Show only once
        }
    }, [offlineReady, setOfflineReady, t]);

    // Silently activate waiting SW — no page reload, no toast
    useEffect(() => {
        if (needRefresh) {
            updateServiceWorker(false);
        }
    }, [needRefresh, updateServiceWorker]);

    return null;
}
