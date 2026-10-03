/**
 * Dialog for creating a correction or storno of a flow record.
 * Manages own dialog state; parent triggers open via imperative ref.
 * @module FlowCorrectionDialog
 */

import { useImperativeHandle, useState, forwardRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import type { UseMutationResult } from "@tanstack/react-query";

/** Handle exposed to parent to open the correction dialog. */
export interface FlowCorrectionDialogHandle {
  open: (recordId: string, storno: boolean) => void;
}

interface FlowCorrectionDialogProps {
  correctionMutation: UseMutationResult<unknown, Error, Record<string, unknown>>;
}

const FlowCorrectionDialog = forwardRef<
  FlowCorrectionDialogHandle,
  FlowCorrectionDialogProps
>(function FlowCorrectionDialog({ correctionMutation }, ref) {
  const { t } = useTranslation();

  const [isCorrectionOpen, setIsCorrectionOpen] = useState(false);
  const [correctionRecordId, setCorrectionRecordId] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionNewVolume, setCorrectionNewVolume] = useState("");
  const [correctionNewConcentration, setCorrectionNewConcentration] = useState("");
  const [isStorno, setIsStorno] = useState(false);

  useImperativeHandle(ref, () => ({
    open(recordId: string, storno: boolean) {
      setCorrectionRecordId(recordId);
      setIsStorno(storno);
      setCorrectionReason("");
      setCorrectionNewVolume("");
      setCorrectionNewConcentration("");
      setIsCorrectionOpen(true);
    },
  }));

  const handleCorrectionSubmit = () => {
    if (!correctionRecordId || !correctionReason) {
      toast.error(t("admin.production.flow.validation.requiredFields"));
      return;
    }
    correctionMutation.mutate(
      {
        correction_reason: correctionReason,
        new_concentration_pct: correctionNewConcentration
          ? parseFloat(correctionNewConcentration)
          : undefined,
        new_volume_l: isStorno
          ? undefined
          : correctionNewVolume
            ? parseFloat(correctionNewVolume)
            : undefined,
        original_record_id: correctionRecordId,
      },
      {
        onSuccess: () => {
          toast.success(
            isStorno
              ? t("admin.production.flow.corrections.stornoCreated")
              : t("admin.production.flow.corrections.correctionCreated"),
          );
          setIsCorrectionOpen(false);
        },
        onError: () => {
          toast.error(t("admin.production.flow.corrections.errors.createFailed"));
        },
      },
    );
  };

  return (
    <Dialog open={isCorrectionOpen} onOpenChange={setIsCorrectionOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isStorno
              ? t("admin.production.flow.corrections.createStorno")
              : t("admin.production.flow.corrections.createCorrection")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.production.flow.corrections.originalRecord")}: {correctionRecordId.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>{t("admin.production.flow.corrections.correctionReason")}</Label>
            <Textarea
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder={t("admin.production.flow.corrections.correctionReasonPlaceholder")}
              rows={2}
            />
          </div>
          {!isStorno && (
            <>
              <div className="space-y-2">
                <Label>{t("admin.production.flow.corrections.newVolume")}</Label>
                <Input
                  type="number"
                  step={0.001}
                  min={0.001}
                  value={correctionNewVolume}
                  onChange={(e) => setCorrectionNewVolume(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.production.flow.corrections.newConcentration")}</Label>
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  max={100}
                  value={correctionNewConcentration}
                  onChange={(e) => setCorrectionNewConcentration(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsCorrectionOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleCorrectionSubmit}
            disabled={correctionMutation.isPending}
            variant={isStorno ? "destructive" : "default"}
          >
            {correctionMutation.isPending
              ? t("common.saving")
              : isStorno
                ? t("admin.production.flow.corrections.createStorno")
                : t("admin.production.flow.corrections.createCorrection")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default FlowCorrectionDialog;
