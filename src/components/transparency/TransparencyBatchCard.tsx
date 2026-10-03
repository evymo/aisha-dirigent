/**
 * TransparencyBatchCard
 *
 * Displays a production batch in a visually rich card.
 * Used within product transparency sections.
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    ShieldCheck,
    Calendar,
    Clock,
    Hash,
    Package,
    Link2,
    ExternalLink,
} from "lucide-react";
import type { TransparencyBatch } from "@/lib/schemas/productTransparencySchemas";

interface TransparencyBatchCardProps {
    batch: TransparencyBatch;
    onViewDetail?: (batchCode: string) => void;
}

function statusColor(status: string | null): string {
    switch (status) {
        case "released":
            return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
        case "completed":
            return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
        case "in_progress":
            return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
        default:
            return "bg-muted text-muted-foreground";
    }
}

export function TransparencyBatchCard({ batch, onViewDetail }: TransparencyBatchCardProps) {
    const { t } = useTranslation();

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "—";
        try {
            return new Date(dateStr).toLocaleDateString();
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="group relative bg-card border border-border/60 rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-300">
            {/* Subtle gradient accent */}
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-xl bg-gradient-to-r from-primary/60 via-primary/20 to-transparent" />

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                {/* Left: Batch Info */}
                <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            variant="secondary"
                            className={statusColor(batch.status)}
                        >
                            {batch.status || "unknown"}
                        </Badge>
                        {batch.quality_approved && (
                            <Badge
                                variant="outline"
                                className="border-green-200 text-green-700 dark:border-green-800 dark:text-green-400 gap-1"
                            >
                                <ShieldCheck className="h-3 w-3" />
                                {t("knowledge.transparency.qcApproved")}
                            </Badge>
                        )}
                        {batch.blockchain_tx_hash && (
                            <Badge
                                variant="outline"
                                className="border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-400 gap-1"
                            >
                                <Link2 className="h-3 w-3" />
                                {t("knowledge.transparency.blockchainVerified")}
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-sm font-semibold text-foreground">
                            {batch.batch_code || batch.batch_number || "—"}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{t("knowledge.transparency.productionDate")}:</span>
                            <span className="text-foreground font-medium">{formatDate(batch.production_date)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{t("knowledge.transparency.expiryDate")}:</span>
                            <span className="text-foreground font-medium">{formatDate(batch.expiry_date)}</span>
                        </div>
                        {batch.total_units != null && (
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Package className="h-3.5 w-3.5" />
                                <span>{batch.available_units ?? 0}/{batch.total_units} {batch.unit || ""}</span>
                            </div>
                        )}
                    </div>

                    {batch.supplier_info && (
                        <p className="text-xs text-muted-foreground mt-1">
                            {t("knowledge.transparency.supplier")}: {batch.supplier_info}
                        </p>
                    )}
                </div>

                {/* Right: Action */}
                {batch.batch_code && onViewDetail && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewDetail(batch.batch_code!)}
                        className="shrink-0 gap-1.5 self-start"
                    >
                        {t("knowledge.transparency.viewBatch")}
                        <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>
        </div>
    );
}
