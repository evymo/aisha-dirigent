/**
 * ProductTransparencySection
 *
 * Embedded transparency section for product pages showing batches,
 * knowledge topics, and production variants.
 * Loaded lazily via the useProductTransparency hook.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ShieldCheck,
    Eye,
    BookOpen,
    Package,
    Layers,
} from "lucide-react";
import { useProductTransparency } from "@/hooks/useProductTransparency";
import { TransparencyBatchCard } from "./TransparencyBatchCard";
import { BatchDetailDialog } from "./BatchDetailDialog";

interface ProductTransparencySectionProps {
    productSlug: string;
}

export function ProductTransparencySection({ productSlug }: ProductTransparencySectionProps) {
    const { t } = useTranslation();
    const { data, isLoading, error } = useProductTransparency(productSlug);
    const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-32 w-full rounded-xl" />
                <Skeleton className="h-32 w-full rounded-xl" />
            </div>
        );
    }

    if (error || !data) {
        return null; // Don't render section if no transparency data
    }

    const hasBatches = data.batches.length > 0;
    const hasTopics = data.knowledge_topics.length > 0;
    const hasVariants = data.variants.length > 0;

    if (!hasBatches && !hasTopics && !hasVariants) {
        return null;
    }

    return (
        <section className="space-y-8" id="product-transparency">
            {/* Section Header */}
            <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Eye className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h2 className="font-serif text-2xl font-bold text-foreground">
                        {t("knowledge.transparency.title")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {t("knowledge.transparency.batchInfo")}
                    </p>
                </div>
            </div>

            {/* Batches */}
            {hasBatches && (
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        {t("knowledge.transparency.batchCode")} ({data.batches.length})
                    </h3>
                    <div className="space-y-3">
                        {data.batches.map((batch, idx) => (
                            <TransparencyBatchCard
                                key={batch.batch_code ?? idx}
                                batch={batch}
                                onViewDetail={setSelectedBatch}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Knowledge Topics */}
            {hasTopics && (
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        {t("knowledge.transparency.relatedTopics")}
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {data.knowledge_topics.map((topic) => (
                            <Link
                                key={topic.topic_id}
                                to={`/knowledge/${topic.slug}`}
                                className="group bg-card border border-border/60 rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all duration-300 flex items-start gap-3"
                            >
                                <BookOpen className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors line-clamp-2">
                                        {topic.title_key}
                                    </span>
                                    <div className="flex items-center gap-2 mt-1">
                                        {topic.is_verified && (
                                            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5">
                                                <ShieldCheck className="h-3 w-3" />
                                                {t("knowledge.verified_source")}
                                            </span>
                                        )}
                                        {topic.link_type && (
                                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                                {topic.link_type}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* Variants */}
            {hasVariants && (
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        {t("knowledge.transparency.variants")}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {data.variants.map((variant) => (
                            <div
                                key={variant.variant_code}
                                className="inline-flex items-center gap-2 bg-card border border-border/60 rounded-lg px-4 py-2 hover:border-primary/30 transition-colors"
                            >
                                <span className="font-medium text-sm">{variant.variant_name}</span>
                                <span className="font-mono text-xs text-muted-foreground">{variant.variant_code}</span>
                                {variant.is_default && (
                                    <Badge variant="default" className="text-[10px] h-4 px-1.5">
                                        Default
                                    </Badge>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Batch Detail Dialog */}
            <BatchDetailDialog
                batchCode={selectedBatch}
                open={!!selectedBatch}
                onOpenChange={(open) => !open && setSelectedBatch(null)}
            />
        </section>
    );
}
