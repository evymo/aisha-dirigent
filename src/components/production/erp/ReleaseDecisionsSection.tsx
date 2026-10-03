import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { toast } from "sonner";
import { Plus, ClipboardCheck } from "lucide-react";
import {
  useProductionReleaseDecisionsAdmin,
  useCreateProductionReleaseDecisionMutation,
  type ProductionReleaseDecision,
} from "@/hooks";

/**
 * Release decisions section for Production ERP.
 * Immutable QA records — create only.
 */
export default function ReleaseDecisionsSection() {
  const { t } = useTranslation();
  const { data: decisions, isLoading } = useProductionReleaseDecisionsAdmin();
  const createMutation = useCreateProductionReleaseDecisionMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    batch_id: "",
    decision: "released",
    reason: "",
    conditions: "",
    review_notes: "",
  });

  const resetForm = () => {
    setForm({ batch_id: "", decision: "released", reason: "", conditions: "", review_notes: "" });
  };

  const handleSubmit = () => {
    if (!form.batch_id) {
      toast.error(t("admin.productionErp.validation.requiredFields"));
      return;
    }
    createMutation.mutate(
      {
        batch_id: form.batch_id,
        decision: form.decision,
        reason: form.reason || undefined,
        conditions: form.conditions || undefined,
        review_notes: form.review_notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("admin.productionErp.releaseDecisions.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () => toast.error(t("admin.productionErp.errors.saveFailed")),
      },
    );
  };

  const decisionBadge = (decision: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      released: "default",
      conditionally_released: "secondary",
      rejected: "destructive",
      quarantine: "outline",
    };
    return <Badge variant={variants[decision] ?? "outline"}>{t(`admin.productionErp.releaseDecision.${decision}`)}</Badge>;
  };

  const columns: ColumnDef<ProductionReleaseDecision>[] = [
    {
      accessorKey: "batch_id",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.releaseDecisions.batchId")} />,
      cell: ({ row }) => row.original.batch_id.substring(0, 8) + "...",
    },
    {
      accessorKey: "decision",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.releaseDecisions.decision")} />,
      cell: ({ row }) => decisionBadge(row.original.decision),
    },
    {
      accessorKey: "decision_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.releaseDecisions.decidedAt")} />,
      cell: ({ row }) => new Date(row.original.decision_at).toLocaleString(),
    },
    {
      accessorKey: "reason",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.releaseDecisions.reason")} />,
      cell: ({ row }) => row.original.reason ?? "—",
    },
    {
      accessorKey: "conditions",
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("admin.productionErp.releaseDecisions.conditions")} />,
      cell: ({ row }) => row.original.conditions ?? "—",
    },
  ];

  const stats = {
    total: decisions?.length ?? 0,
    released: decisions?.filter((d) => d.decision === "released").length ?? 0,
    rejected: decisions?.filter((d) => d.decision === "rejected").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><ClipboardCheck className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.releaseDecisions.totalDecisions")}</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><ClipboardCheck className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.releaseDecisions.releasedCount")}</p>
                <p className="text-2xl font-semibold">{stats.released}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><ClipboardCheck className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.productionErp.releaseDecisions.rejectedCount")}</p>
                <p className="text-2xl font-semibold">{stats.rejected}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />{t("admin.productionErp.releaseDecisions.add")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("admin.productionErp.releaseDecisions.add")}</DialogTitle>
              <DialogDescription>{t("admin.productionErp.releaseDecisions.formDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.releaseDecisions.batchId")}</Label>
                  <Input value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })} placeholder="UUID" />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.productionErp.releaseDecisions.decision")}</Label>
                  <Select value={form.decision} onValueChange={(v) => setForm({ ...form, decision: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="released">{t("admin.productionErp.releaseDecision.released")}</SelectItem>
                      <SelectItem value="conditionally_released">{t("admin.productionErp.releaseDecision.conditionally_released")}</SelectItem>
                      <SelectItem value="rejected">{t("admin.productionErp.releaseDecision.rejected")}</SelectItem>
                      <SelectItem value="quarantine">{t("admin.productionErp.releaseDecision.quarantine")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.releaseDecisions.reason")}</Label>
                <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.releaseDecisions.conditions")}</Label>
                <Input value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.productionErp.releaseDecisions.reviewNotes")}</Label>
                <Textarea value={form.review_notes} onChange={(e) => setForm({ ...form, review_notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable columns={columns} data={decisions ?? []} searchKey="decision" />
    </div>
  );
}
