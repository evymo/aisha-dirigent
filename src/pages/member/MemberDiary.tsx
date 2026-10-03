/**
 * Member Diary Page
 * Main entry point for member health diary and product tracking
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MemberDiaryLayout,
  DashboardGrid,
  DiaryCalendar,
  ProductList,
  TrackingStateList,
  type DiarySection,
} from "@/components/member-diary";
import {
  useMemberDiaryData,
  useMemberDiaryCalendar,
  useConfirmProductTaken,
  useCreateTrackingState,
  useCreateProductPlan,
  useCreateWidget,
  useLogTrackingState,
} from "@/hooks/useMemberDiary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  TRACKING_STATE_PRESETS,
  type MemberProductPlan,
  type MemberTrackingState,
  type MemberDashboardWidget,
} from "@/lib/schemas/memberDiarySchemas";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function MemberDiary() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<DiarySection>("dashboard");
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [addStateOpen, setAddStateOpen] = useState(false);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [logStateOpen, setLogStateOpen] = useState(false);
  const [stateToLogId, setStateToLogId] = useState<string | null>(null);
  const [selectedProductForPlan, setSelectedProductForPlan] = useState<string>("");
  const [newStatePreset, setNewStatePreset] = useState<string>(TRACKING_STATE_PRESETS[0]?.key ?? "custom");
  const [newStateScale, setNewStateScale] = useState<5 | 10>(5);
  const [logSeverity, setLogSeverity] = useState<number>(3);
  const [widgetType, setWidgetType] = useState<"product" | "health_state" | "quick_log" | "calendar" | "distribution">("calendar");
  const [widgetReferenceId, setWidgetReferenceId] = useState<string>("");

  // Data hooks
  const {
    products,
    healthStates,
    plans,
    widgets,
    distributions,
    isLoading,
  } = useMemberDiaryData();

  const { data: calendarData, isLoading: calendarLoading } = useMemberDiaryCalendar(selectedMonth);

  // Mutations
  const confirmTaken = useConfirmProductTaken();
  const createState = useCreateTrackingState();
  const logState = useLogTrackingState();
  const createPlan = useCreateProductPlan();
  const createWidget = useCreateWidget();

  const selectedDayData = useMemo(() => {
    if (!selectedDay || !calendarData?.days) return null;
    const dayKey = selectedDay.toISOString().slice(0, 10);
    return calendarData.days.find((entry) => entry.date === dayKey) ?? null;
  }, [calendarData?.days, selectedDay]);

  const handleConfirmTaken = (planId: string) => {
    // Note: Zod schema expects snake_case 'plan_id', not camelCase
    confirmTaken.mutate({ plan_id: planId });
  };

  const handleSelectPlan = (plan: MemberProductPlan) => {
    setSelectedPlanId(plan.id);
  };

  const handleSelectState = (state: MemberTrackingState) => {
    setSelectedStateId(state.id);
  };

  const handleWidgetClick = (widget: MemberDashboardWidget) => {
    if (widget.widget_type === "product" && widget.reference_id) {
      setActiveSection("products");
      setSelectedPlanId(widget.reference_id);
    } else if (widget.widget_type === "health_state" && widget.reference_id) {
      setActiveSection("health-states");
      setSelectedStateId(widget.reference_id);
    }
  };

  const handleDayClick = (date: Date) => {
    setSelectedDay(date);
    setDayDetailOpen(true);
  };

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
      const createdId = await createPlan.mutateAsync({
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

      setSelectedPlanId(createdId);
      setActiveSection("products");
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
      const createdId = await createState.mutateAsync({
        name_key: selectedPreset.key,
        severity_scale: newStateScale,
        icon: selectedPreset.icon,
        color: selectedPreset.color,
        show_on_dashboard: true,
      });

      setSelectedStateId(createdId);
      setActiveSection("health-states");
      setAddStateOpen(false);
      toast.success(t("common.success"));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  const openLogStateDialog = (stateId: string) => {
    const state = healthStates.data?.find((item) => item.id === stateId);
    setStateToLogId(stateId);
    setLogSeverity(state?.current_severity ?? Math.ceil((state?.severity_scale ?? 5) / 2));
    setLogStateOpen(true);
  };

  const handleLogState = async () => {
    if (!stateToLogId) return;

    try {
      await logState.mutateAsync({
        state_id: stateToLogId,
        severity: logSeverity,
      });
      setSelectedStateId(stateToLogId);
      setLogStateOpen(false);
      toast.success(t("common.success"));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  const openAddWidgetDialog = () => {
    const defaultType = selectedPlanId ? "product" : selectedStateId ? "health_state" : "calendar";
    setWidgetType(defaultType);
    setWidgetReferenceId(
      defaultType === "product"
        ? selectedPlanId ?? ""
        : defaultType === "health_state"
          ? selectedStateId ?? ""
          : "",
    );
    setAddWidgetOpen(true);
  };

  const handleCreateWidget = async () => {
    try {
      await createWidget.mutateAsync({
        widgetType,
        referenceId:
          widgetType === "product" || widgetType === "health_state"
            ? widgetReferenceId || undefined
            : undefined,
      });
      setAddWidgetOpen(false);
      toast.success(t("common.success"));
    } catch {
      toast.error(t("errors.genericError"));
    }
  };

  // List content based on active section
  const renderListContent = () => {
    switch (activeSection) {
      case "products":
        return (
          <ProductList
            plans={plans.data ?? []}
            selectedPlanId={selectedPlanId}
            onSelectPlan={handleSelectPlan}
            onAddPlan={openAddPlanDialog}
            onConfirmTaken={handleConfirmTaken}
            isLoading={plans.isLoading}
          />
        );
      case "health-states":
        return (
          <TrackingStateList
            healthStates={healthStates.data ?? []}
            selectedStateId={selectedStateId}
            onSelectState={handleSelectState}
            onAddState={() => setAddStateOpen(true)}
            onLogState={openLogStateDialog}
            isLoading={healthStates.isLoading}
          />
        );
      case "calendar":
      case "dashboard":
      case "distributions":
        return null; // These sections don't have a list panel
      default:
        return null;
    }
  };

  // Detail content based on active section
  const renderDetailContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    switch (activeSection) {
      case "dashboard":
        return (
          <DashboardGrid
            widgets={widgets.data ?? []}
            plans={plans.data ?? []}
            healthStates={healthStates.data ?? []}
            onWidgetClick={handleWidgetClick}
            onAddWidget={openAddWidgetDialog}
          />
        );
      case "calendar":
        return (
          <DiaryCalendar
            calendarData={calendarData}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            onDayClick={handleDayClick}
            isLoading={calendarLoading}
          />
        );
      case "products": {
        const selectedPlan = plans.data?.find((p) => p.id === selectedPlanId);
        if (!selectedPlan) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {t("memberDiary.selectProduct")}
            </div>
          );
        }
        return (
          <div className="p-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedPlan.product_name || selectedPlan.product_name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("memberDiary.distribution")}</p>
                    <p className="font-medium">
                      {t("memberDiary.doseFormat", {
                        amount: selectedPlan.dose_amount,
                        unit: selectedPlan.dose_unit,
                        count: selectedPlan.doses_per_day,
                        daily: t("memberDiary.daily")
                      })}
                    </p>
                  </div>
                  {selectedPlan.dose_timing && selectedPlan.dose_timing.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">{t("memberDiary.timing")}</p>
                      <p className="font-medium">{selectedPlan.dose_timing.join(", ")}</p>
                    </div>
                  )}
                  {selectedPlan.remaining_doses !== undefined && selectedPlan.remaining_doses !== null && (
                    <div>
                      <p className="text-sm text-muted-foreground">{t("memberDiary.remaining")}</p>
                      <p className="font-medium">{Math.round(selectedPlan.remaining_doses)} {t("memberDiary.doses")}</p>
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => handleConfirmTaken(selectedPlan.id)}
                    disabled={confirmTaken.isPending}
                  >
                    {confirmTaken.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    {t("memberDiary.confirmTaken")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }
      case "health-states": {
        const selectedState = healthStates.data?.find((s) => s.id === selectedStateId);
        if (!selectedState) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {t("memberDiary.selectState")}
            </div>
          );
        }
        return (
          <div className="p-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedState.custom_name || t(`healthStates.${selectedState.name_key}`, selectedState.name_key)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("memberDiary.severityScale")}</p>
                    <p className="font-medium">{t("memberDiary.severityRange", { scale: selectedState.severity_scale })}</p>
                  </div>
                  {selectedState.current_severity !== null && selectedState.current_severity !== undefined && (
                    <div>
                      <p className="text-sm text-muted-foreground">{t("memberDiary.currentSeverity")}</p>
                      <p className="font-medium text-warning">
                        {selectedState.current_severity} / {selectedState.severity_scale}
                      </p>
                    </div>
                  )}
                  <Button className="w-full" onClick={() => openLogStateDialog(selectedState.id)}>
                    {t("memberDiary.logNewEntry")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }
      case "distributions":
        return (
          <div className="p-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("memberDiary.distributionHistory")}</CardTitle>
              </CardHeader>
              <CardContent>
                {distributions.data && distributions.data.length > 0 ? (
                  <div className="space-y-3">
                    {distributions.data.map((dist) => (
                      <div
                        key={dist.id}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <div>
                          <p className="font-medium">{dist.study_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {dist.status}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{t("memberDiary.vialCount", { count: dist.vial_count })}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(dist.scheduled_date).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    {t("memberDiary.noDistributions")}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        );
      default:
        return null;
    }
  };

  const getListTitle = () => {
    switch (activeSection) {
      case "products":
        return t("memberDiary.myProducts");
      case "health-states":
        return t("memberDiary.myTrackingStates");
      default:
        return undefined;
    }
  };

  return (
    <>
      <MemberDiaryLayout
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        listContent={renderListContent()}
        detailContent={renderDetailContent()}
        listTitle={getListTitle()}
      />

      <Dialog open={dayDetailOpen} onOpenChange={setDayDetailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? selectedDay.toLocaleDateString() : t("memberDiary.today")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{t("memberDiary.productsTaken", { count: selectedDayData?.products_taken ?? 0 })}</p>
            <p>{t("memberDiary.statesLogged", { count: selectedDayData?.states_logged ?? 0 })}</p>
            <p>{selectedDayData?.distribution_received ? t("memberDiary.distributionReceived") : t("memberDiary.noDistributions")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDayDetailOpen(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addPlanOpen} onOpenChange={setAddPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.addProduct")}</DialogTitle>
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

      <Dialog open={addStateOpen} onOpenChange={setAddStateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.addState")}</DialogTitle>
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

      <Dialog open={logStateOpen} onOpenChange={setLogStateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.logNewEntry")}</DialogTitle>
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

      <Dialog open={addWidgetOpen} onOpenChange={setAddWidgetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memberDiary.addWidget")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("common.select")}</Label>
            <Select
              value={widgetType}
              onValueChange={(value) => {
                const nextType = value as typeof widgetType;
                setWidgetType(nextType);
                setWidgetReferenceId(
                  nextType === "product"
                    ? selectedPlanId ?? ""
                    : nextType === "health_state"
                      ? selectedStateId ?? ""
                      : "",
                );
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="product">{t("memberDiary.widgetType.products")}</SelectItem>
                <SelectItem value="health_state">{t("memberDiary.widgetType.health_states")}</SelectItem>
                <SelectItem value="quick_log">{t("memberDiary.widgetType.notes")}</SelectItem>
                <SelectItem value="calendar">{t("memberDiary.widgetType.calendar")}</SelectItem>
                <SelectItem value="distribution">{t("memberDiary.widgetType.distributions")}</SelectItem>
              </SelectContent>
            </Select>

            {(widgetType === "product" || widgetType === "health_state") && (
              <>
                <Label>{t("common.select")}</Label>
                <Select value={widgetReferenceId} onValueChange={setWidgetReferenceId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {widgetType === "product"
                      ? (plans.data ?? []).map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.product_name || plan.product_name}
                        </SelectItem>
                      ))
                      : (healthStates.data ?? []).map((state) => (
                        <SelectItem key={state.id} value={state.id}>
                          {state.custom_name || t(`healthStates.${state.name_key}`)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddWidgetOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreateWidget}
              disabled={
                createWidget.isPending ||
                ((widgetType === "product" || widgetType === "health_state") && !widgetReferenceId)
              }
            >
              {createWidget.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
