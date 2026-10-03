/**
 * Admin: knowledge quarantine review queue (Step 4 systemic).
 *
 * Lists items the ingestion safety scanner tagged as flagged or
 * quarantined. Admin can reinstate (with reason) — fn_reinstate_knowledge_item_audited
 * writes an audit row tying the override to the operator.
 *
 * Hook-Only Data Access: all calls via aisha.rpc through useQuarantinedKnowledge
 * + useReinstateKnowledgeItem.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, ShieldCheck, AlertCircle, RotateCcw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQuarantinedKnowledge, useReinstateKnowledgeItem } from "@/hooks/useQuarantinedKnowledge";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";

export default function AdminKnowledgeQuarantine() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_panel");
  const { toast } = useToast();

  const [reinstateId, setReinstateId] = useState<string | null>(null);
  const [reinstateReason, setReinstateReason] = useState<string>("");

  const { data: items, isLoading, refetch } = useQuarantinedKnowledge(50, 0);
  const reinstateMutation = useReinstateKnowledgeItem();

  if (!canView) {
    return (
      <>
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </>
    );
  }

  const handleReinstate = async (itemId: string) => {
    if (!reinstateReason.trim()) {
      toast({
        title: t("rag.quarantine.reasonRequired"),
        variant: "destructive",
      });
      return;
    }
    try {
      await reinstateMutation.mutateAsync({ itemId, reason: reinstateReason.trim() });
      toast({
        title: t("rag.quarantine.reinstated"),
        description: t("rag.quarantine.reinstatedDescription"),
      });
      setReinstateId(null);
      setReinstateReason("");
      refetch();
    } catch (err) {
      safeError("AdminKnowledgeQuarantine.reinstate.failed", err);
      toast({
        title: t("rag.quarantine.reinstateError"),
        variant: "destructive",
      });
    }
  };

  const statusIcon = (status: string) => {
    if (status === "quarantined") return <ShieldAlert className="h-4 w-4 text-rose-600" />;
    if (status === "flagged") return <AlertCircle className="h-4 w-4 text-amber-600" />;
    return <ShieldCheck className="h-4 w-4 text-emerald-600" />;
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("rag.quarantine.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("rag.quarantine.subtitle")}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              {t("rag.quarantine.queueTitle")}
            </CardTitle>
            <CardDescription>
              {t("rag.quarantine.queueDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : !items || items.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {t("rag.quarantine.empty")}
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.id} className="rounded-md border bg-card p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {statusIcon(item.quarantine_status)}
                        <div>
                          <h3 className="font-medium text-sm">{item.title}</h3>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Badge variant="outline">{item.item_type}</Badge>
                            <Badge variant={item.quarantine_status === "quarantined" ? "destructive" : "secondary"}>
                              {item.quarantine_status}
                            </Badge>
                            {item.safety_score !== null && (
                              <span>
                                {t("rag.quarantine.score")}: {item.safety_score.toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReinstateId(reinstateId === item.id ? null : item.id);
                          setReinstateReason("");
                        }}
                        disabled={reinstateMutation.isPending}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        {t("rag.quarantine.reinstate")}
                      </Button>
                    </div>

                    {item.quarantine_reason && (
                      <p className="text-xs text-muted-foreground mb-2">
                        <span className="font-medium">{t("rag.quarantine.reason")}:</span>{" "}
                        {item.quarantine_reason}
                      </p>
                    )}

                    {reinstateId === item.id && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <Textarea
                          placeholder={t("rag.quarantine.reinstateReasonPlaceholder")}
                          value={reinstateReason}
                          onChange={(e) => setReinstateReason(e.target.value)}
                          className="text-sm min-h-[60px]"
                          maxLength={500}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReinstateId(null);
                              setReinstateReason("");
                            }}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleReinstate(item.id)}
                            disabled={!reinstateReason.trim() || reinstateMutation.isPending}
                          >
                            {t("rag.quarantine.confirmReinstate")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
