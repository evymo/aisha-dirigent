/**
 * BatchDetailDialog
 *
 * Full batch transparency modal with QC, protocol steps, materials,
 * and related knowledge topics.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
    ShieldCheck,
    Calendar,
    Clock,
    Hash,
    Link2,
    FlaskConical,
    ListChecks,
    Package,
    Loader2,
    BookOpen,
    AlertCircle,
    CheckCircle2,
    Circle,
    ArrowRight,
    Check,
} from "lucide-react";
import { useBatchTransparency } from "@/hooks/useProductTransparency";

interface BatchDetailDialogProps {
    batchCode: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function BatchDetailDialog({ batchCode, open, onOpenChange }: BatchDetailDialogProps) {
    const { t } = useTranslation();
    const { data, isLoading, error } = useBatchTransparency(batchCode ?? "");

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "—";
        try {
            return new Date(dateStr).toLocaleDateString();
        } catch {
            return dateStr;
        }
    };

    const completedSteps = data?.protocol_steps.filter(s => s.is_completed).length ?? 0;
    const totalSteps = data?.protocol_steps.length ?? 0;
    const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 font-serif text-xl">
                        <Package className="h-5 w-5 text-primary" />
                        {t("knowledge.transparency.batchInfo")}
                    </DialogTitle>
                </DialogHeader>

                {isLoading && (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <AlertCircle className="h-10 w-10 mb-3 opacity-50" />
                        <p className="text-sm">{t("knowledge.transparency.noData")}</p>
                    </div>
                )}

                {data && (
                    <div className="space-y-6">
                        {/* Batch Header */}
                        <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Hash className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-mono font-semibold">
                                        {data.batch.batch_code || data.batch.batch_number}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {data.batch.quality_approved && (
                                        <Badge variant="outline" className="border-green-200 text-green-700 dark:border-green-800 dark:text-green-400 gap-1">
                                            <ShieldCheck className="h-3 w-3" />
                                            {t("knowledge.transparency.qcApproved")}
                                        </Badge>
                                    )}
                                    {data.batch.blockchain_tx_hash && (
                                        <Badge variant="outline" className="border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-400 gap-1">
                                            <Link2 className="h-3 w-3" />
                                            {t("knowledge.transparency.blockchainVerified")}
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <span className="text-muted-foreground flex items-center gap-1.5">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {t("knowledge.transparency.productionDate")}
                                    </span>
                                    <span className="font-medium block mt-0.5">{formatDate(data.batch.production_date)}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5" />
                                        {t("knowledge.transparency.expiryDate")}
                                    </span>
                                    <span className="font-medium block mt-0.5">{formatDate(data.batch.expiry_date)}</span>
                                </div>
                                {data.batch.raw_material_lot && (
                                    <div>
                                        <span className="text-muted-foreground">{t("knowledge.transparency.materialLot")}</span>
                                        <span className="font-mono text-xs font-medium block mt-0.5">{data.batch.raw_material_lot}</span>
                                    </div>
                                )}
                                {data.batch.supplier_info && (
                                    <div>
                                        <span className="text-muted-foreground">{t("knowledge.transparency.supplier")}</span>
                                        <span className="font-medium block mt-0.5">{data.batch.supplier_info}</span>
                                    </div>
                                )}
                            </div>

                            {data.batch.purpose && (
                                <p className="text-sm text-muted-foreground italic">{data.batch.purpose}</p>
                            )}
                        </div>

                        {/* Product Reference */}
                        {data.product && (
                            <div className="flex items-center gap-3 px-1">
                                {data.product.image_url && (
                                    <img
                                        src={data.product.image_url}
                                        alt={data.product.name}
                                        className="h-10 w-10 rounded-lg object-cover border border-border/40"
                                    />
                                )}
                                <div>
                                    <p className="font-medium text-sm">{data.product.name}</p>
                                    {data.product.category && (
                                        <Badge variant="secondary" className="text-xs mt-0.5">{data.product.category}</Badge>
                                    )}
                                </div>
                                <Button variant="ghost" size="sm" asChild className="ml-auto gap-1">
                                    <Link to={`/shop/${data.product.slug}`}>
                                        {t("knowledge.transparency.viewProduct")}
                                        <ArrowRight className="h-3.5 w-3.5" />
                                    </Link>
                                </Button>
                            </div>
                        )}

                        <Separator />

                        {/* Protocol Steps */}
                        {data.protocol_steps.length > 0 && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold flex items-center gap-2 text-sm">
                                        <ListChecks className="h-4 w-4 text-primary" />
                                        {t("knowledge.transparency.protocolSteps")}
                                    </h3>
                                    <span className="text-xs text-muted-foreground">
                                        {completedSteps}/{totalSteps}
                                    </span>
                                </div>

                                <Progress value={progressPercent} className="h-2" />

                                <div className="space-y-2 pl-1">
                                    {data.protocol_steps
                                        .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
                                        .map((step, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors"
                                            >
                                                <div className="mt-0.5">
                                                    {step.is_completed ? (
                                                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                                                    ) : (
                                                        <Circle className="h-4 w-4 text-muted-foreground/50" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-sm font-medium ${step.is_completed ? "text-foreground" : "text-muted-foreground"}`}>
                                                        {step.step_name}
                                                    </p>
                                                    {step.description && (
                                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                                            {step.description}
                                                        </p>
                                                    )}
                                                    {step.completed_at && (
                                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                                                            <Check className="h-3 w-3" /> {formatDate(step.completed_at)}
                                                        </p>
                                                    )}
                                                </div>
                                                {step.step_type && (
                                                    <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                                                        {step.step_type}
                                                    </Badge>
                                                )}
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}

                        {/* Materials */}
                        {data.materials.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-sm">
                                    <FlaskConical className="h-4 w-4 text-primary" />
                                    {t("knowledge.transparency.materials")}
                                </h3>
                                <div className="border border-border rounded-lg overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                                                <th className="px-3 py-2 font-medium">{t("knowledge.transparency.materialName")}</th>
                                                <th className="px-3 py-2 font-medium">{t("knowledge.transparency.materialCode")}</th>
                                                <th className="px-3 py-2 font-medium text-right">{t("knowledge.transparency.materialQty")}</th>
                                                <th className="px-3 py-2 font-medium">{t("knowledge.transparency.materialLot")}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {data.materials.map((mat, idx) => (
                                                <tr key={idx} className="hover:bg-muted/20 transition-colors">
                                                    <td className="px-3 py-2 font-medium">{mat.material_name || "—"}</td>
                                                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{mat.item_code || "—"}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">
                                                        {mat.actual_qty ?? mat.planned_qty ?? "—"}
                                                        {mat.unit ? ` ${mat.unit}` : ""}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-xs">{mat.lot_number || "—"}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Related Knowledge Topics */}
                        {data.knowledge_topics.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-sm">
                                    <BookOpen className="h-4 w-4 text-primary" />
                                    {t("knowledge.transparency.relatedTopics")}
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {data.knowledge_topics.map((topic) => (
                                        <Button
                                            key={topic.topic_id}
                                            variant="outline"
                                            size="sm"
                                            asChild
                                            className="gap-1.5 text-xs"
                                        >
                                            <Link to={`/knowledge/${topic.slug}`}>
                                                <BookOpen className="h-3 w-3" />
                                                {topic.title_key}
                                                {topic.is_verified && (
                                                    <ShieldCheck className="h-3 w-3 text-green-600" />
                                                )}
                                            </Link>
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
