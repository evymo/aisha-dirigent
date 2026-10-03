import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { safeError } from "@/lib/security/safeLogger";
import { 
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
  Pause,
  TrendingUp,
  TrendingDown,
  Calendar as CalendarIcon,
  History,
  User,
  Repeat,
  Settings
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { 
  useDistributionAdjustments,
  adjustmentTypeLabels,
  type DistributionAdjustmentType,
  type DistributionAdjustment,
  type CreateDistributionAdjustmentParams
} from "@/hooks/useDistributionAdjustments";

// Configuration for adjustment type badges - aligned with DistributionAdjustmentType
const ADJUSTMENT_TYPE_CONFIG: Record<DistributionAdjustmentType, { icon: typeof TrendingUp; color: string }> = {
  dose_increase: { icon: TrendingUp, color: "bg-green-100 text-green-800" },
  dose_decrease: { icon: TrendingDown, color: "bg-orange-100 text-orange-800" },
  frequency_change: { icon: Repeat, color: "bg-blue-100 text-blue-800" },
  timing_change: { icon: Clock, color: "bg-cyan-100 text-cyan-800" },
  temporary_pause: { icon: Pause, color: "bg-yellow-100 text-yellow-800" },
  arm_switch: { icon: AlertTriangle, color: "bg-red-100 text-red-800" },
  custom: { icon: Settings, color: "bg-gray-100 text-gray-800" },
};

export default function AdminDistributionAdjustments() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  const lang = i18n.language as 'cs' | 'en';
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterActive, setFilterActive] = useState<string>("all");
  
  // Form state for new adjustment
  const [formData, setFormData] = useState<Partial<CreateDistributionAdjustmentParams>>({
    adjustmentType: "dose_increase",
    newDoseAmount: undefined,
    newDosesPerDay: undefined,
    reason: "",
    memberToken: "",
  });
  const [effectiveFromDate, setEffectiveFromDate] = useState<Date>(new Date());
  const [effectiveUntilDate, setEffectiveUntilDate] = useState<Date | undefined>();
  
  const { 
    adjustments, 
    isLoading,
    createAdjustment,
    refresh: refetch
  } = useDistributionAdjustments(selectedUserId || undefined);
  
  const [isCreating, setIsCreating] = useState(false);

  // Filter adjustments locally based on type and active status
  const filteredAdjustments = (adjustments || []).filter(adj => {
    if (filterType && adj.adjustment_type !== filterType) return false;
    if (filterActive === "active" && !isAdjustmentActive(adj)) return false;
    if (filterActive === "inactive" && isAdjustmentActive(adj)) return false;
    return true;
  });

  const handleCreateAdjustment = async () => {
    if (!formData.memberToken || !formData.adjustmentType || !formData.reason) {
      toast.error(t("admin.distributionAdjustments.missingFields"));
      return;
    }
    
    setIsCreating(true);
    try {
      await createAdjustment.mutateAsync({
        memberToken: formData.memberToken,
        adjustmentType: formData.adjustmentType as DistributionAdjustmentType,
        newDoseAmount: formData.newDoseAmount,
        newDosesPerDay: formData.newDosesPerDay,
        reason: formData.reason || "",
        effectiveFrom: effectiveFromDate,
        effectiveUntil: effectiveUntilDate || null,
      });
      toast.success(t("admin.distributionAdjustments.createSuccess"));
      setDialogOpen(false);
      resetForm();
      refetch();
    } catch (error) {
      safeError("Failed to create adjustment", error);
      toast.error(t("admin.distributionAdjustments.createFailed"));
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setFormData({
      adjustmentType: "dose_increase",
      newDoseAmount: undefined,
      newDosesPerDay: undefined,
      reason: "",
      memberToken: "",
    });
    setEffectiveFromDate(new Date());
    setEffectiveUntilDate(undefined);
  };

  const isAdjustmentActive = (adj: DistributionAdjustment): boolean => {
    const now = new Date();
    const from = new Date(adj.effective_from);
    const until = adj.effective_until ? new Date(adj.effective_until) : null;
    
    return from <= now && (!until || until >= now);
  };

  const getAdjustmentBadge = (type: string) => {
    const adjustmentType = type as DistributionAdjustmentType;
    const config = ADJUSTMENT_TYPE_CONFIG[adjustmentType] || ADJUSTMENT_TYPE_CONFIG.custom;
    const Icon = config.icon;
    const label = adjustmentTypeLabels[adjustmentType]?.[lang] || type;
    
    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  const formatDateRange = (from: string, until: string | null): string => {
    const fromDate = format(new Date(from), "d.M.yyyy", { locale: dateLocale });
    if (!until) return `${fromDate} - ${t("admin.distributionAdjustments.ongoing")}`;
    const untilDate = format(new Date(until), "d.M.yyyy", { locale: dateLocale });
    return `${fromDate} - ${untilDate}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.distributionAdjustments.title")}</h1>
          <p className="text-muted-foreground">{t("admin.distributionAdjustments.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => refetch()} disabled={isLoading} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t("common.refresh")}
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("admin.distributionAdjustments.createNew")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.distributionAdjustments.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* User search - placeholder */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.member")}</Label>
              <Input 
                placeholder={t("admin.distributionAdjustments.searchMember")}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              />
            </div>

            {/* Adjustment type filter */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.adjustmentType")}</Label>
              <Select value={filterType || "__all__"} onValueChange={(v) => setFilterType(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.distributionAdjustments.allTypes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.distributionAdjustments.allTypes")}</SelectItem>
                  {Object.entries(adjustmentTypeLabels).map(([key, labels]) => (
                    <SelectItem key={key} value={key}>
                      {labels[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Active status filter */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.status")}</Label>
              <Select value={filterActive} onValueChange={setFilterActive}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.distributionAdjustments.allStatuses")}</SelectItem>
                  <SelectItem value="active">{t("admin.distributionAdjustments.activeOnly")}</SelectItem>
                  <SelectItem value="inactive">{t("admin.distributionAdjustments.inactiveOnly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionAdjustments.totalAdjustments")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{adjustments?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionAdjustments.activeAdjustments")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {adjustments?.filter(isAdjustmentActive).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionAdjustments.pausedDistributions")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {adjustments?.filter(a => a.adjustment_type === 'temporary_pause' && isAdjustmentActive(a)).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("admin.distributionAdjustments.armSwitches")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {adjustments?.filter(a => a.adjustment_type === 'arm_switch').length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Adjustments Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.distributionAdjustments.adjustmentsList")}</CardTitle>
          <CardDescription>{t("admin.distributionAdjustments.adjustmentsListDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.distributionAdjustments.member")}</TableHead>
                  <TableHead>{t("admin.distributionAdjustments.type")}</TableHead>
                  <TableHead>{t("admin.distributionAdjustments.newDose")}</TableHead>
                  <TableHead>{t("admin.distributionAdjustments.period")}</TableHead>
                  <TableHead>{t("admin.distributionAdjustments.reason")}</TableHead>
                  <TableHead>{t("admin.distributionAdjustments.status")}</TableHead>
                  <TableHead>{t("admin.distributionAdjustments.createdBy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-xs">
                          {adjustment.member_token.slice(0, 8)}...
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getAdjustmentBadge(adjustment.adjustment_type)}
                    </TableCell>
                    <TableCell>
                      {adjustment.new_dose_amount ? (
                        <span>
                          {adjustment.new_dose_amount}
                          {adjustment.new_doses_per_day && ` × ${adjustment.new_doses_per_day}/den`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateRange(adjustment.effective_from, adjustment.effective_until)}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={adjustment.reason}>
                      {adjustment.reason}
                    </TableCell>
                    <TableCell>
                      {isAdjustmentActive(adjustment) ? (
                        <Badge variant="default" className="bg-green-500">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          {t("admin.distributionAdjustments.active")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <History className="mr-1 h-3 w-3" />
                          {t("admin.distributionAdjustments.inactive")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(adjustment.created_at), "d.M.yyyy HH:mm", { locale: dateLocale })}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredAdjustments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t("admin.distributionAdjustments.noAdjustments")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Adjustment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("admin.distributionAdjustments.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.distributionAdjustments.createDesc")}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Member Token */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.memberToken")} *</Label>
              <Input 
                placeholder={t("admin.distributionAdjustments.memberUuidPlaceholder")}
                value={formData.memberToken}
                onChange={(e) => setFormData(prev => ({ ...prev, memberToken: e.target.value }))}
              />
            </div>

            {/* Adjustment Type */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.adjustmentType")} *</Label>
              <Select 
                value={formData.adjustmentType} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, adjustmentType: v as DistributionAdjustmentType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(adjustmentTypeLabels).map(([key, labels]) => (
                    <SelectItem key={key} value={key}>
                      {labels[lang]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* New Dose Amount & Frequency */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.distributionAdjustments.newDoseAmount")}</Label>
                <Input 
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder={t("admin.distributionAdjustments.newDoseAmountPlaceholder")}
                  value={formData.newDoseAmount || ""}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    newDoseAmount: e.target.value ? parseFloat(e.target.value) : undefined 
                  }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.distributionAdjustments.newDosesPerDay")}</Label>
                <Input 
                  type="number"
                  min={1}
                  max={10}
                  placeholder={t("admin.distributionAdjustments.newDosesPerDayPlaceholder")}
                  value={formData.newDosesPerDay || ""}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    newDosesPerDay: e.target.value ? parseInt(e.target.value) : undefined 
                  }))}
                />
              </div>
            </div>

            {/* Effective From */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.effectiveFrom")} *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(effectiveFromDate, "PPP", { locale: dateLocale })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={effectiveFromDate}
                    onSelect={(date) => date && setEffectiveFromDate(date)}
                    locale={dateLocale}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Effective Until */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.effectiveUntil")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {effectiveUntilDate 
                      ? format(effectiveUntilDate, "PPP", { locale: dateLocale })
                      : t("admin.distributionAdjustments.noEndDate")
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={effectiveUntilDate}
                    onSelect={(date) => setEffectiveUntilDate(date)}
                    locale={dateLocale}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label>{t("admin.distributionAdjustments.reason")} *</Label>
              <Textarea 
                placeholder={t("admin.distributionAdjustments.reasonPlaceholder")}
                value={formData.reason || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreateAdjustment} disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t("admin.distributionAdjustments.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
