import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MemberTimelineView } from "@/components/member/MemberTimelineView";
import {
  useMemberDiaryData,
  useCreateTrackingState,
  useCreateProductPlan,
  useLogTrackingState,
} from "@/hooks/useMemberDiary";
import { useUploadTrackingDocument } from "@/hooks/useTrackingDocuments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, Heart, Pill, ArrowLeft, Bot, Coins } from "lucide-react";
import { toast } from "sonner";
import {
  TRACKING_STATE_PRESETS,
} from "@/lib/schemas/memberDiarySchemas";
import { DocumentUploadZone } from "@/components/common/DocumentUploadZone";
import { StoryDetail } from "@/components/storyloop/StoryDetail";
import { StoryComposer } from "@/components/storyloop/StoryComposer";
import { AishaConsultPanel } from "@/components/storyloop";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useWalletBalance } from "@/hooks/useRewardShop";
import { useStoryDetail } from "@/hooks/useStoryLoop";
import { useMyStories } from "@/hooks/useMyTimeline";
import { useChatAccessLevel } from "@/hooks/useChatAccessLevel";
import { useEnsureMemberStory } from "@/hooks/useEnsureMemberStory";

/**
 * Unified Member Story Page
 * Combines Dashboard (Diary) and Timeline (Story) into a single view.
 */
export default function MemberStory() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Ensure member has at least one story (auto-create on first visit if eligible)
  useEnsureMemberStory();

  // Deep link support: /member/story?view=stories&story=X&post=Y
  const storyView = searchParams.get("view") === "stories";
  const deepLinkedStoryId = searchParams.get("story");
  const [isAishaOpen, setIsAishaOpen] = useState(false);

  const { data: storyData } = useStoryDetail(storyView ? deepLinkedStoryId : null);
  const { data: myStories } = useMyStories();
  const defaultStory = myStories?.[0];

  const chatAccessQuery = useChatAccessLevel();

  const hasQualifiedMemberAishaAccess =
    (chatAccessQuery.data?.has_completed_questionnaire ?? false) ||
    ["qualified", "certified", "premium"].includes(chatAccessQuery.data?.access_level ?? "");

  const handleBackToTimeline = () => {
    setSearchParams({});
  };

  // -- State --
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [addStateOpen, setAddStateOpen] = useState(false);
  const [logStateOpen, setLogStateOpen] = useState(false);
  const [uploadDocumentOpen, setUploadDocumentOpen] = useState(false);

  const [stateToLogId, setStateToLogId] = useState<string | null>(null);

  const [selectedProductForPlan, setSelectedProductForPlan] = useState<string>("");
  const [newStatePreset, setNewStatePreset] = useState<string>(TRACKING_STATE_PRESETS[0]?.key ?? "custom");
  const [newStateScale, setNewStateScale] = useState<5 | 10>(5);
  const [logSeverity, setLogSeverity] = useState<number>(3);

  // -- Data Hooks --
  const {
    products,
    healthStates,
  } = useMemberDiaryData();

  const createState = useCreateTrackingState();
  const logState = useLogTrackingState();
  const createPlan = useCreateProductPlan();
  const uploadDocument = useUploadTrackingDocument();
  const { data: wallet } = useWalletBalance();
  const platformBalance = wallet?.aisha_tokens ?? 0;

  // -- Handlers --

  const openAddPlanDialog = () => {
    const firstProductId = products.data?.[0]?.id ?? "";
    setSelectedProductForPlan(firstProductId);
    setAddPlanOpen(true);
  };

  const handleCreatePlan = async () => {
    const selectedProduct = products.data?.find((product) => product.id === selectedProductForPlan);
    if (!selectedProduct) {
      toast.error(t("memberDiary.noProducts"));
      return;
    }

    try {
      await createPlan.mutateAsync({
        product_id: selectedProduct.id,
        dose_amount: selectedProduct.default_dose_amount ?? 1,
        dose_unit: selectedProduct.default_dose_unit ?? "mg",
        doses_per_day: selectedProduct.default_doses_per_day ?? 1,
        dose_timing: selectedProduct.default_dose_timing && selectedProduct.default_dose_timing.length > 0
          ? selectedProduct.default_dose_timing
          : ["morning"],
        package_quantity: Math.max(1, Math.round(selectedProduct.package_size ?? 1)),
        reminder_enabled: true,
        reminder_minutes_before: 15,
      });

      setAddPlanOpen(false);
      toast.success(t("common.success"));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  const handleCreateState = async () => {
    const selectedPreset = TRACKING_STATE_PRESETS.find((preset) => preset.key === newStatePreset);
    if (!selectedPreset) {
      toast.error(t("errors.genericError"));
      return;
    }

    try {
      await createState.mutateAsync({
        name_key: selectedPreset.key,
        severity_scale: newStateScale,
        icon: selectedPreset.icon,
        color: selectedPreset.color,
        show_on_dashboard: true,
      });

      setAddStateOpen(false);
      toast.success(t("common.success"));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  const handleLogState = async () => {
    if (!stateToLogId) return;

    try {
      await logState.mutateAsync({
        state_id: stateToLogId,
        severity: logSeverity,
      });
      setLogStateOpen(false);
      toast.success(t("common.success"));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  const handleDocumentSelected = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0]; // Handle single file for now

    try {
      await uploadDocument.mutateAsync({
        file,
        category: 'other', // Default category
        title: file.name
      });
      setUploadDocumentOpen(false);
    } catch {
      // Error handled in hook
    }
  };


  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-8">
        {storyView && deepLinkedStoryId ? (
          <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={handleBackToTimeline}
            >
              <ArrowLeft className="h-4 w-4" />
              {t("common.back")}
            </Button>
            <div className="rounded-lg border border-border bg-card min-h-[60vh]">
              <StoryDetail
                storyId={deepLinkedStoryId}
                canOpenAisha={hasQualifiedMemberAishaAccess}
                onOpenAisha={() => setIsAishaOpen(true)}
                standalone
              />
            </div>
          </div>
        ) : (
        <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">

          {/* Title + Aisha */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-serif font-bold text-foreground">
                  {t("myTimeline.title")}
                </h1>
                <p className="text-muted-foreground">{t("myTimeline.subtitle")}</p>
              </div>
              {hasQualifiedMemberAishaAccess && defaultStory && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setIsAishaOpen(true)}
                >
                  <Bot className="h-4 w-4" />
                  {t("storyloop.aisha.name")}
                </Button>
              )}
            </div>
          </section>

          {/* Quick Actions Toolbar */}
          <section className="flex flex-wrap items-center gap-4 p-4 rounded-lg bg-muted/30 border border-border">
            <Button size="sm" className="gap-2" onClick={() => setAddStateOpen(true)}>
              <Heart className="h-4 w-4" />
              {t("memberDiary.addState")}
            </Button>
            <Button size="sm" className="gap-2" onClick={openAddPlanDialog}>
              <Pill className="h-4 w-4" />
              {t("memberDiary.addProduct")}
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setUploadDocumentOpen(true)}>
              <FileText className="h-4 w-4" />
              {t("common.uploadDocument")}
            </Button>

            {/* Wallet Balance */}
            <div className="ml-auto flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium">
              <Coins className="h-4 w-4 text-primary" />
              <span>{platformBalance}</span>
              <span className="text-muted-foreground">{t("rewardShop.tokenUnit")}</span>
            </div>
          </section>

          {/* StoryComposer for member entries */}
          {defaultStory && (
            <section className="rounded-lg border border-border bg-card">
              <StoryComposer storyId={defaultStory.id} memberMode />
            </section>
          )}

          {/* Timeline Section */}
          <section className="space-y-4">
            <MemberTimelineView maxHeight="800px" />
          </section>
        </div>
        )}
      </main>

      <Sheet open={isAishaOpen} onOpenChange={setIsAishaOpen}>
        <SheetContent className="w-full sm:w-[540px] p-0">
          <div className="h-[100dvh] sm:h-[100dvh]">
            {deepLinkedStoryId && storyData ? (
              <AishaConsultPanel
                storyId={deepLinkedStoryId}
                storyTitle={storyData.title}
                userName={storyData.user_display_name}
                embedded
                onClose={() => setIsAishaOpen(false)}
              />
            ) : defaultStory ? (
              <AishaConsultPanel
                storyId={defaultStory.id}
                storyTitle={defaultStory.title}
                userName={defaultStory.partner_name ?? undefined}
                embedded
                onClose={() => setIsAishaOpen(false)}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
      <Footer />

      {/* --- Dialogs --- */}

      {/* Add Product Plan Dialog */}
      <Dialog open={addPlanOpen} onOpenChange={setAddPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.addProduct")}</DialogTitle>
            <DialogDescription className="sr-only">{t("memberDiary.addProduct")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("common.select")}</Label>
            <Select value={selectedProductForPlan} onValueChange={setSelectedProductForPlan}>
              <SelectTrigger>
                <SelectValue placeholder={t("common.select")} />
              </SelectTrigger>
              <SelectContent>
                {(products.data ?? []).map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPlanOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreatePlan}
              disabled={!selectedProductForPlan || createPlan.isPending}
            >
              {createPlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Tracking State Dialog */}
      <Dialog open={addStateOpen} onOpenChange={setAddStateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.addState")}</DialogTitle>
            <DialogDescription className="sr-only">{t("memberDiary.addState")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("common.select")}</Label>
            <Select value={newStatePreset} onValueChange={setNewStatePreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRACKING_STATE_PRESETS.map((preset) => (
                  <SelectItem key={preset.key} value={preset.key}>
                    {t(`healthStates.${preset.key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>{t("memberDiary.severityScale")}</Label>
            <Select value={String(newStateScale)} onValueChange={(value) => setNewStateScale(value === "10" ? 10 : 5)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">{t("memberDiary.severityRange", { scale: 5 })}</SelectItem>
                <SelectItem value="10">{t("memberDiary.severityRange", { scale: 10 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreateState} disabled={createState.isPending}>
              {createState.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Tracking State Dialog */}
      <Dialog open={logStateOpen} onOpenChange={setLogStateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.logNewEntry")}</DialogTitle>
            <DialogDescription className="sr-only">{t("memberDiary.logNewEntry")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("memberDiary.currentSeverity")}</Label>
            <Input
              type="number"
              min={1}
              max={healthStates.data?.find((state) => state.id === stateToLogId)?.severity_scale ?? 10}
              value={logSeverity}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) {
                  setLogSeverity(parsed);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogStateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleLogState} disabled={!stateToLogId || logState.isPending}>
              {logState.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("memberDiary.log")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Document Dialog */}
      <Dialog open={uploadDocumentOpen} onOpenChange={setUploadDocumentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.uploadDocument")}</DialogTitle>
            <DialogDescription className="sr-only">{t("common.uploadDocument")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <DocumentUploadZone
              onFilesSelected={handleDocumentSelected}
              isUploading={uploadDocument.isPending}
              maxFiles={1}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDocumentOpen(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



    </div>
  );
}
