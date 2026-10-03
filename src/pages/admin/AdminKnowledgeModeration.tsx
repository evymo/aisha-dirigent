import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useModerationQueue, useReviewModerationItem } from "@/hooks/useKnowledgeBase";
import { Loader2, CheckCircle, XCircle, AlertCircle, ExternalLink, Bot, Shield, Sparkles, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { safeError } from "@/lib/security/safeLogger";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import type { AishaEvaluation } from "@/lib/schemas/knowledgeBaseSchemas";

export default function AdminKnowledgeModeration() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState("pending");

    // We only fetch for the active tab to save resources
    const { data: queueItems, isLoading, error, refetch } = useModerationQueue(activeTab);
    const reviewMutation = useReviewModerationItem();
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [expandedAisha, setExpandedAisha] = useState<Set<string>>(new Set());

    const toggleAishaExpand = (id: string) => {
        setExpandedAisha(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleReview = async (id: string, decision: "approved" | "rejected") => {
        setProcessingId(id);
        try {
            await reviewMutation.mutateAsync({ queue_id: id, decision });
            refetch();
        } catch (error) {
            safeError("AdminKnowledgeModeration.review", error);
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-serif font-bold text-foreground">{t("adminModeration.title")}</h1>
                    <p className="text-muted-foreground mt-1">{t("adminModeration.subtitle")}</p>
                </div>

                <Tabs defaultValue="pending" className="w-full" onValueChange={setActiveTab}>
                    <TabsList className="mb-4">
                        <TabsTrigger value="pending">{t("adminModeration.tabPending")}</TabsTrigger>
                        <TabsTrigger value="approved">{t("adminModeration.tabApproved")}</TabsTrigger>
                        <TabsTrigger value="rejected">{t("adminModeration.tabRejected")}</TabsTrigger>
                    </TabsList>

                    <TabsContent value={activeTab}>
                        {isLoading ? (
                            <div className="flex justify-center p-8">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                        ) : error ? (
                            <div className="p-8 text-center text-destructive">
                                <AlertCircle className="mx-auto h-8 w-8 mb-2" />
                                {t("adminModeration.loadError")}
                            </div>
                        ) : queueItems?.length === 0 ? (
                            <div className="text-center p-12 border rounded-lg bg-slate-50 dark:bg-slate-900 border-dashed">
                                <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4 opacity-50" />
                                <h3 className="text-lg font-medium">{t("adminModeration.allCaughtUp")}</h3>
                                <p className="text-muted-foreground">{t("adminModeration.noItemsInQueue", { tab: activeTab })}</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {queueItems?.map((item) => (
                                    <Card key={item.id} className="overflow-hidden">
                                        <div className="flex flex-col md:flex-row">
                                            <div className="p-6 flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge variant="outline" className="capitalize">
                                                        {item.resource_type}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {t("adminModeration.createdAgo", { time: formatDistanceToNow(new Date(item.created_at)) })}
                                                    </span>
                                                    {item.risk_score && item.risk_score > 0.5 && (
                                                        <Badge variant="destructive">{t("adminModeration.highRisk", { score: item.risk_score })}</Badge>
                                                    )}
                                                    {item.auto_decision && (
                                                        <Badge variant="secondary" className="gap-1">
                                                            <Bot className="h-3 w-3" />
                                                            {t("adminModeration.autoDecision")}
                                                        </Badge>
                                                    )}
                                                </div>

                                                <div className="mb-4">
                                                    {item.resource_type === 'post' ? (
                                                        <div>
                                                            <div className="text-sm font-medium text-muted-foreground mb-1">
                                                                {t("adminModeration.user", { name: item.post_author_name || t("adminModeration.userUnknown") })}
                                                                <span className="mx-2">•</span>
                                                                {t("adminModeration.topic")} <Link to={`/knowledge/${item.topic_slug}`} target="_blank" className="text-primary hover:underline flex items-center inline-flex gap-1">{item.topic_title} <ExternalLink className="h-3 w-3" /></Link>
                                                            </div>
                                                            <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap">
                                                                "{item.post_body}"
                                                            </div>
                                                        </div>
                                                    ) : item.resource_type === 'expert_rule' ? (
                                                        <div>
                                                            <div className="text-sm font-medium mb-1 flex items-center gap-2">
                                                                <Shield className="h-4 w-4 text-primary" />
                                                                {item.rule_title || t("adminModeration.unknownRule")}
                                                            </div>
                                                            {/* AISHA Evaluation */}
                                                            {item.aisha_evaluation && (
                                                                <AishaEvaluationCard
                                                                    evaluation={item.aisha_evaluation as AishaEvaluation}
                                                                    expanded={expandedAisha.has(item.id)}
                                                                    onToggle={() => toggleAishaExpand(item.id)}
                                                                    t={t}
                                                                />
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm">{t("adminModeration.unknownResourceType", { type: item.resource_type, id: item.resource_id })}</div>
                                                    )}
                                                </div>

                                                {item.risk_tags && item.risk_tags.length > 0 && (
                                                    <div className="flex gap-2">
                                                        {item.risk_tags.map(tag => (
                                                            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {activeTab === 'pending' && (
                                                <div className="bg-muted/30 p-4 min-w-[200px] flex flex-row md:flex-col justify-center gap-3 border-t md:border-t-0 md:border-l">
                                                    <Button
                                                        className="w-full bg-green-600 hover:bg-green-700 text-white"
                                                        onClick={() => handleReview(item.id, "approved")}
                                                        disabled={processingId === item.id}
                                                    >
                                                        {processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                                                        {t("adminModeration.approve")}
                                                    </Button>
                                                    <Button
                                                        variant="destructive"
                                                        className="w-full"
                                                        onClick={() => handleReview(item.id, "rejected")}
                                                        disabled={processingId === item.id}
                                                    >
                                                        {processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                                        {t("adminModeration.reject")}
                                                    </Button>
                                                </div>
                                            )}
                                            {activeTab !== 'pending' && (
                                                <div className="bg-muted/30 p-4 min-w-[200px] flex items-center justify-center border-t md:border-t-0 md:border-l">
                                                    <Badge variant={item.status === 'approved' ? 'secondary' /* green-ish usually but default badge is black */ : 'destructive'} className="text-lg capitalize">
                                                        {item.status}
                                                    </Badge>
                                                </div>
                                            )}
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </>
    );
}

/** Score bar label + visual progress */
function ScoreRow({ label, value, icon }: { label: string; value?: number; icon: React.ReactNode }) {
    if (value == null) return null;
    const pct = Math.round(value * 100);
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
                <span className="font-medium">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5" />
        </div>
    );
}

/** Collapsible AISHA evaluation display within moderation cards */
function AishaEvaluationCard({
    evaluation,
    expanded,
    onToggle,
    t,
}: {
    evaluation: AishaEvaluation;
    expanded: boolean;
    onToggle: () => void;
    t: (key: string, opts?: Record<string, unknown>) => string;
}) {
    if (!evaluation) return null;

    const verdict = evaluation.verdict;
    const verdictVariant: "default" | "secondary" | "destructive" =
        verdict === "approve" ? "default" : verdict === "reject" ? "destructive" : "secondary";

    return (
        <Collapsible open={expanded} onOpenChange={onToggle}>
            <CollapsibleTrigger asChild>
                <button className="w-full mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs hover:bg-muted transition-colors">
                    <span className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-primary" />
                        <span className="font-medium">{t("adminModeration.aishaEvaluation")}</span>
                        {verdict && (
                            <Badge variant={verdictVariant} className="text-[10px] px-1.5 capitalize">
                                {verdict}
                            </Badge>
                        )}
                        {evaluation.confidence != null && (
                            <span className="text-muted-foreground">
                                {t("adminModeration.confidence", { value: Math.round(evaluation.confidence * 100) })}
                            </span>
                        )}
                    </span>
                    <Sparkles className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="mt-2 space-y-3 rounded-md border p-3 bg-background">
                    {/* Score bars */}
                    <div className="space-y-2">
                        <ScoreRow label={t("adminModeration.alignmentScore")} value={evaluation.alignment_score} icon={<Star className="h-3 w-3" />} />
                        <ScoreRow label={t("adminModeration.securityScore")} value={evaluation.security_score} icon={<Shield className="h-3 w-3" />} />
                        <ScoreRow label={t("adminModeration.qualityScore")} value={evaluation.quality_score} icon={<Sparkles className="h-3 w-3" />} />
                    </div>

                    {/* Reason */}
                    {evaluation.reason && (
                        <div className="text-xs">
                            <span className="font-medium text-muted-foreground">{t("adminModeration.reason")}:</span>
                            <p className="mt-0.5 text-foreground">{evaluation.reason}</p>
                        </div>
                    )}

                    {/* Suggestions */}
                    {evaluation.suggestions && evaluation.suggestions.length > 0 && (
                        <div className="text-xs">
                            <span className="font-medium text-muted-foreground">{t("adminModeration.suggestions")}:</span>
                            <ul className="mt-0.5 list-disc list-inside space-y-0.5">
                                {evaluation.suggestions.map((s, i) => (
                                    <li key={i}>{s}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
