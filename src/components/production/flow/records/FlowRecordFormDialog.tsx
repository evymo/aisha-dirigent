/**
 * Dialog for creating a new flow record.
 * Manages own form state internally.
 * @module FlowRecordFormDialog
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type { FlowNode, FlowSubstance } from "@/hooks/useAdminProductionFlow";
import type { UseMutationResult } from "@tanstack/react-query";

import { defaultForm } from "./flowRecordsUtils";
import type { FlowRecordForm } from "./flowRecordsUtils";

/** Minimal batch shape required by this dialog. */
interface BatchOption {
  id: string;
  batch_code: string;
}

interface FlowRecordFormDialogProps {
  batches: BatchOption[] | undefined;
  createMutation: UseMutationResult<unknown, Error, Record<string, unknown>>;
  nodes: FlowNode[] | undefined;
  substances: FlowSubstance[] | undefined;
}

export default function FlowRecordFormDialog({
  batches,
  createMutation,
  nodes,
  substances,
}: FlowRecordFormDialogProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<FlowRecordForm>(defaultForm);

  const resetForm = () => setForm(defaultForm);

  const handleSubmit = () => {
    if (
      !form.batch_id ||
      !form.substance_id ||
      !form.source_node_id ||
      !form.target_node_id ||
      !form.volume_l ||
      !form.concentration_pct
    ) {
      toast.error(t("admin.production.flow.validation.requiredFields"));
      return;
    }
    if (form.source_node_id === form.target_node_id) {
      toast.error(t("admin.production.flow.validation.sameNode"));
      return;
    }
    createMutation.mutate(
      {
        batch_id: form.batch_id,
        concentration_pct: parseFloat(form.concentration_pct),
        notes: form.notes || undefined,
        source_node_id: form.source_node_id,
        substance_id: form.substance_id,
        target_node_id: form.target_node_id,
        temperature_c: form.temperature_c
          ? parseFloat(form.temperature_c)
          : undefined,
        volume_l: parseFloat(form.volume_l),
      },
      {
        onSuccess: () => {
          toast.success(t("admin.production.flow.records.created"));
          setIsOpen(false);
          resetForm();
        },
        onError: () =>
          toast.error(t("admin.production.flow.errors.saveFailed")),
      },
    );
  };

  return (
    <div className="flex justify-end print:hidden">
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            {t("admin.production.flow.records.add")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("admin.production.flow.records.add")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.production.flow.records.formDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Batch + Substance */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.batch")}
                </Label>
                <Select
                  value={form.batch_id}
                  onValueChange={(v) =>
                    setForm({ ...form, batch_id: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "admin.production.flow.records.selectBatch",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {batches?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.batch_code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.substance")}
                </Label>
                <Select
                  value={form.substance_id}
                  onValueChange={(v) => {
                    const sub = substances?.find((s) => s.id === v);
                    const updates: Partial<FlowRecordForm> = { substance_id: v };
                    if (sub?.default_concentration_pct != null && !form.concentration_pct) {
                      updates.concentration_pct = String(sub.default_concentration_pct);
                    }
                    setForm({ ...form, ...updates });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "admin.production.flow.records.selectSubstance",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {substances?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.substance_code} — {s.substance_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Source → Target */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.sourceNode")}
                </Label>
                <Select
                  value={form.source_node_id}
                  onValueChange={(v) => {
                    const node = nodes?.find((n) => n.id === v);
                    const updates: Partial<FlowRecordForm> = { source_node_id: v };
                    if (node?.default_concentration_pct != null && !form.concentration_pct) {
                      updates.concentration_pct = String(node.default_concentration_pct);
                    }
                    setForm({ ...form, ...updates });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "admin.production.flow.records.selectNode",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes?.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.node_code} — {n.node_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.targetNode")}
                </Label>
                <Select
                  value={form.target_node_id}
                  onValueChange={(v) =>
                    setForm({ ...form, target_node_id: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "admin.production.flow.records.selectNode",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes
                      ?.filter((n) => n.id !== form.source_node_id)
                      .map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.node_code} — {n.node_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Volume, Concentration, Temperature */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.volume")}
                </Label>
                <Input
                  type="number"
                  step={0.001}
                  min={0.001}
                  value={form.volume_l}
                  onChange={(e) =>
                    setForm({ ...form, volume_l: e.target.value })
                  }
                  placeholder="10.5"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.concentration")}
                </Label>
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  max={100}
                  value={form.concentration_pct}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      concentration_pct: e.target.value,
                    })
                  }
                  placeholder="96"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {t("admin.production.flow.records.temperature")}
                </Label>
                <Input
                  type="number"
                  step={0.1}
                  value={form.temperature_c}
                  onChange={(e) =>
                    setForm({ ...form, temperature_c: e.target.value })
                  }
                  placeholder="20.0"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>{t("admin.production.flow.common.notes")}</Label>
              <Textarea
                value={form.notes}
                onChange={(e) =>
                  setForm({ ...form, notes: e.target.value })
                }
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsOpen(false);
                resetForm();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? t("common.saving")
                : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
