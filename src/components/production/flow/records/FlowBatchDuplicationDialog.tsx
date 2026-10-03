/**
 * Dialog for duplicating flow records from one batch to another.
 * Self-contained state management.
 * @module FlowBatchDuplicationDialog
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import type { UseMutationResult } from "@tanstack/react-query";

/** Minimal batch shape required by this dialog. */
interface BatchOption {
  id: string;
  batch_code: string;
  product?: { name: string } | null;
}

interface FlowBatchDuplicationDialogProps {
  batches: BatchOption[] | undefined;
  dupMutation: UseMutationResult<unknown, Error, Record<string, unknown>>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function FlowBatchDuplicationDialog({
  batches,
  dupMutation,
  isOpen,
  onOpenChange,
}: FlowBatchDuplicationDialogProps) {
  const { t } = useTranslation();
  const [dupSourceBatchId, setDupSourceBatchId] = useState("");
  const [dupTargetBatchId, setDupTargetBatchId] = useState("");

  const handleDuplicate = () => {
    if (!dupSourceBatchId || !dupTargetBatchId) {
      toast.error(t("admin.production.flow.validation.requiredFields"));
      return;
    }
    if (dupSourceBatchId === dupTargetBatchId) {
      toast.error(t("admin.production.flow.validation.sameNode"));
      return;
    }
    dupMutation.mutate(
      {
        source_batch_id: dupSourceBatchId,
        target_batch_id: dupTargetBatchId,
      },
      {
        onSuccess: () => {
          toast.success(t("admin.production.flow.batchDuplication.success"));
          onOpenChange(false);
          setDupSourceBatchId("");
          setDupTargetBatchId("");
        },
        onError: (err) => {
          if (err instanceof Error && err.message === "NO_RECORDS") {
            toast.error(t("admin.production.flow.batchDuplication.noRecords"));
          } else {
            toast.error(t("admin.production.flow.batchDuplication.error"));
          }
        },
      },
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) {
          setDupSourceBatchId("");
          setDupTargetBatchId("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("admin.production.flow.batchDuplication.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>
              {t("admin.production.flow.batchDuplication.sourceBatch")}
            </Label>
            <Select
              value={dupSourceBatchId}
              onValueChange={setDupSourceBatchId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "admin.production.flow.batchDuplication.selectSource",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {batches?.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.batch_code} — {b.product?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              {t("admin.production.flow.batchDuplication.targetBatch")}
            </Label>
            <Select
              value={dupTargetBatchId}
              onValueChange={setDupTargetBatchId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "admin.production.flow.batchDuplication.selectTarget",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {batches
                  ?.filter((b) => b.id !== dupSourceBatchId)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.batch_code} — {b.product?.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleDuplicate} disabled={dupMutation.isPending}>
            {dupMutation.isPending
              ? t("admin.production.flow.batchDuplication.duplicating")
              : t("admin.production.flow.batchDuplication.duplicate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
