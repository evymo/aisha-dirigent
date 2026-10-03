import { useMemo, useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
// Calendar component available if needed for date picking
import { safeError } from "@/lib/security/safeLogger";
import { 
  Calendar as CalendarIcon,
  Package,
  Truck,
  RefreshCw,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
  PackageCheck,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { 
  useExpeditionCalendar, 
  useBatchInventory, 
  useBatchAllocation,
  useBatchAvailability,
} from "@/hooks/useExpedition";
import type { ExpeditionCalendarEntry } from "@/hooks/useExpedition";

const STATUS_CONFIG = {
  planned: { color: "bg-blue-100 text-blue-800", icon: CalendarIcon },
  in_preparation: { color: "bg-yellow-100 text-yellow-800", icon: Package },
  ready_to_ship: { color: "bg-green-100 text-green-800", icon: PackageCheck },
  shipped: { color: "bg-purple-100 text-purple-800", icon: Truck },
  delivered: { color: "bg-gray-100 text-gray-800", icon: CheckCircle },
  cancelled: { color: "bg-red-100 text-red-800", icon: AlertTriangle },
} as const;

export default function AdminExpeditionCalendar() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedStudyId, setSelectedStudyId] = useState<string>("");
  const [generatePlanDialog, setGeneratePlanDialog] = useState(false);
  const [planExpeditionDate, setPlanExpeditionDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [planCutOffDate, setPlanCutOffDate] = useState<string>("");
  const [allocationDialog, setAllocationDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ExpeditionCalendarEntry | null>(null);
  const [availabilityForEntry, setAvailabilityForEntry] = useState<
    | { entryId: string; data: { requested: number; available: number; shortage: number; sufficient: boolean; batches: Array<{ batch_id: string; batch_number: string; available_units: number; expiry_date: string | null }> } }
    | null
  >(null);
  
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  
  // Hook for expedition calendar data
  const expeditionQuery = useExpeditionCalendar(monthStart, monthEnd);
  const expeditions = useMemo(() => expeditionQuery.data ?? [], [expeditionQuery.data]);
  const expeditionsLoading = expeditionQuery.isLoading;
  const refetchExpeditions = expeditionQuery.refetch;

  const productOptions = useMemo(() => {
    const seen = new Set<string>();
    return expeditions
      .filter((entry): entry is typeof entry & { product_id: string } => Boolean(entry.product_id))
      .filter((entry) => {
        if (seen.has(entry.product_id)) return false;
        seen.add(entry.product_id);
        return true;
      })
      .map((entry) => ({
        id: entry.product_id as string,
        name: entry.product_name,
      }));
  }, [expeditions]);

  const studyOptions = useMemo(() => {
    const seen = new Set<string>();
    return expeditions
      .filter((entry) => Boolean(entry.study_id && entry.study_name))
      .filter((entry) => {
        if (!entry.study_id) return false;
        if (seen.has(entry.study_id)) return false;
        seen.add(entry.study_id);
        return true;
      })
      .map((entry) => ({
        id: entry.study_id as string,
        name: entry.study_name as string,
      }));
  }, [expeditions]);

  const filteredExpeditions = useMemo(
    () =>
      expeditions.filter((entry) => {
        if (selectedProductId && entry.product_id !== selectedProductId) return false;
        if (selectedStudyId && entry.study_id !== selectedStudyId) return false;
        return true;
      }),
    [expeditions, selectedProductId, selectedStudyId],
  );
  
  // Hook for batch inventory list (for inventory view)
  const batchInventoryQuery = useBatchInventory(
    selectedProductId || undefined,
    undefined,
    false // exclude empty batches by default
  );
  const batchInventory = batchInventoryQuery.batches;
  const batchLoading = batchInventoryQuery.isLoading;
  
  // Hook for batch allocation
  const batchAllocationHook = useBatchAllocation();
  const isAllocating = batchAllocationHook.isAllocating;

  // Hook for batch availability
  const batchAvailabilityHook = useBatchAvailability();
  const isCheckingAvailability = batchAvailabilityHook.loading;

  const handlePreviousMonth = () => {
    setSelectedMonth(prev => addMonths(prev, -1));
  };

  const handleNextMonth = () => {
    setSelectedMonth(prev => addMonths(prev, 1));
  };

  const handleAllocateBatch = (entry: ExpeditionCalendarEntry) => {
    setSelectedEntry(entry);
    setAvailabilityForEntry(null);
    setAllocationDialog(true);
  };

  const openGeneratePlanDialog = () => {
    setPlanExpeditionDate(format(new Date(), "yyyy-MM-dd"));
    setPlanCutOffDate("");
    setGeneratePlanDialog(true);
  };

  const confirmGeneratePlan = async () => {
    const expeditionDate = new Date(planExpeditionDate);

    try {
      await expeditionQuery.generatePlan.mutateAsync({
        expeditionDate,
        cutOffDate: planCutOffDate ? new Date(planCutOffDate) : undefined,
      });

      toast.success(t("admin.expedition.generateSuccess"));
      setGeneratePlanDialog(false);
      refetchExpeditions();
    } catch (error) {
      safeError("Generate expedition plan failed", error);
      toast.error(t("admin.expedition.generateError"));
    }
  };

  const confirmAllocation = async () => {
    if (!selectedEntry?.id || !selectedEntry.product_id) return;
    
    try {
      const result = await batchAllocationHook.allocate({
        shipmentId: selectedEntry.id,
        productId: selectedEntry.product_id,
        quantity: selectedEntry.planned_shipments,
      });
      
      if (result.success) {
        toast.success(t("admin.expedition.allocationSuccess"));
        refetchExpeditions();
      } else {
        toast.error(t("admin.expedition.allocationFailed"));
      }
      setAllocationDialog(false);
      setSelectedEntry(null);
    } catch (error) {
      safeError("Allocation failed", error);
      toast.error(t("admin.expedition.allocationFailed"));
    }
  };

  const checkAvailabilityForSelectedEntry = async () => {
    if (!selectedEntry?.id || !selectedEntry.product_id) return;

    try {
      const result = await batchAvailabilityHook.checkAvailability(
        selectedEntry.product_id,
        selectedEntry.planned_shipments
      );

      setAvailabilityForEntry({
        entryId: selectedEntry.id,
        data: {
          requested: result.requested,
          available: result.available,
          shortage: result.shortage,
          sufficient: result.sufficient,
          batches: result.batches,
        },
      });
    } catch (error) {
      safeError("Batch availability check failed", error);
      toast.error(t("admin.expedition.batchAllocation.error"));
      setAvailabilityForEntry(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.planned;
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="h-3 w-3" />
        {t(`admin.expedition.status.${status}`)}
      </Badge>
    );
  };

  const groupedExpeditions = filteredExpeditions.reduce((acc, exp) => {
    const date = exp.expedition_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(exp);
    return acc;
  }, {} as Record<string, ExpeditionCalendarEntry[]>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.expedition.title")}</h1>
          <p className="text-muted-foreground">{t("admin.expedition.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openGeneratePlanDialog} disabled={expeditionsLoading || expeditionQuery.generatePlan.isPending}>
            <Package className="mr-2 h-4 w-4" />
            {t("admin.expedition.generatePlan")}
          </Button>
          <Button onClick={() => refetchExpeditions()} disabled={expeditionsLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${expeditionsLoading ? 'animate-spin' : ''}`} />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.expedition.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Month selector */}
            <div className="space-y-2">
              <Label>{t("admin.expedition.month")}</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handlePreviousMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="flex-1 text-center font-medium">
                  {format(selectedMonth, "LLLL yyyy", { locale: dateLocale })}
                </span>
                <Button variant="outline" size="sm" onClick={handleNextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("admin.expedition.product")}</Label>
              <Select value={selectedProductId || "__all__"} onValueChange={(v) => setSelectedProductId(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.expedition.allProducts")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.expedition.allProducts")}</SelectItem>
                  {productOptions.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("admin.expedition.study")}</Label>
              <Select value={selectedStudyId || "__all__"} onValueChange={(v) => setSelectedStudyId(v === "__all__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.expedition.allStudies")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("admin.expedition.allStudies")}</SelectItem>
                  {studyOptions.map((study) => (
                    <SelectItem key={study.id} value={study.id}>
                      {study.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {t("admin.expedition.calendarView")}
          </TabsTrigger>
          <TabsTrigger value="list">
            <Package className="mr-2 h-4 w-4" />
            {t("admin.expedition.listView")}
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <PackageCheck className="mr-2 h-4 w-4" />
            {t("admin.expedition.inventoryView")}
          </TabsTrigger>
        </TabsList>

        {/* Calendar View */}
        <TabsContent value="calendar" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              {expeditionsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedExpeditions)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, entries]) => (
                      <div key={date} className="border rounded-lg p-4">
                        <h3 className="font-semibold mb-3">
                          {format(new Date(date), "EEEE, d. MMMM yyyy", { locale: dateLocale })}
                        </h3>
                        <div className="space-y-2">
                          {entries.map((entry) => (
                            <div 
                              key={entry.id} 
                              className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                            >
                              <div className="flex items-center gap-3">
                                {getStatusBadge(entry.status)}
                                <span className="font-medium">{entry.product_name}</span>
                                {entry.study_name && (
                                  <span className="text-muted-foreground">
                                    ({entry.study_name})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-sm text-muted-foreground">
                                  {entry.planned_shipments} {t("common.units")}
                                </span>
                                {entry.status === 'planned' && (
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => handleAllocateBatch(entry)}
                                  >
                                    <Package className="mr-1 h-3 w-3" />
                                    {t("admin.expedition.allocateBatch")}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  {Object.keys(groupedExpeditions).length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      {t("admin.expedition.noExpeditions")}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* List View */}
        <TabsContent value="list">
          <Card>
            <CardContent className="pt-6">
              {expeditionsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.expedition.date")}</TableHead>
                      <TableHead>{t("admin.expedition.product")}</TableHead>
                      <TableHead>{t("admin.expedition.study")}</TableHead>
                      <TableHead>{t("admin.expedition.quantity")}</TableHead>
                      <TableHead>{t("admin.expedition.batch")}</TableHead>
                      <TableHead>{t("common.status")}</TableHead>
                      <TableHead>{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredExpeditions.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          {format(new Date(entry.expedition_date), "d.M.yyyy", { locale: dateLocale })}
                        </TableCell>
                        <TableCell className="font-medium">{entry.product_name}</TableCell>
                        <TableCell>{entry.study_name || "-"}</TableCell>
                        <TableCell>{entry.planned_shipments}</TableCell>
                        <TableCell>
                          {entry.allocated_batches && entry.allocated_batches.length > 0 ? (
                            entry.allocated_batches.map(b => b.batch_number).join(", ")
                          ) : (
                            <span className="text-muted-foreground">
                              {t("admin.expedition.notAllocated")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(entry.status)}</TableCell>
                        <TableCell>
                          {entry.status === 'planned' && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleAllocateBatch(entry)}
                            >
                              <Package className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredExpeditions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {t("admin.expedition.noExpeditions")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory View */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.expedition.batchAvailability")}</CardTitle>
              <CardDescription>{t("admin.expedition.batchAvailabilityDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {batchLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.expedition.batchNumber")}</TableHead>
                      <TableHead>{t("admin.expedition.product")}</TableHead>
                      <TableHead>{t("admin.expedition.expiryDate")}</TableHead>
                      <TableHead>{t("admin.expedition.totalUnits")}</TableHead>
                      <TableHead>{t("admin.expedition.availableUnits")}</TableHead>
                      <TableHead>{t("admin.expedition.utilizationRate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchInventory?.map((batch) => {
                      const utilization = batch.total_units > 0 
                        ? ((batch.total_units - batch.available_units) / batch.total_units * 100).toFixed(1)
                        : 0;
                      return (
                        <TableRow key={batch.batch_id}>
                          <TableCell className="font-mono font-medium">
                            {batch.batch_number}
                          </TableCell>
                          <TableCell>{batch.product_name}</TableCell>
                          <TableCell>
                            {batch.expiry_date 
                              ? format(new Date(batch.expiry_date), "d.M.yyyy", { locale: dateLocale })
                              : "-"
                            }
                          </TableCell>
                          <TableCell>{batch.total_units}</TableCell>
                          <TableCell>
                            <span className={batch.available_units < 10 ? "text-red-600 font-bold" : ""}>
                              {batch.available_units}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div 
                                  className="bg-primary h-2 rounded-full" 
                                  style={{ width: `${utilization}%` }}
                                />
                              </div>
                              <span className="text-sm">{utilization}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(!batchInventory || batchInventory.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          {t("admin.expedition.noBatches")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Batch Allocation Dialog */}
      <Dialog open={allocationDialog} onOpenChange={setAllocationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.expedition.batchAllocation.title")}</DialogTitle>
            <DialogDescription>{t("admin.expedition.allocateBatchDesc")}</DialogDescription>
          </DialogHeader>
          
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("admin.expedition.product")}:</span>
                  <p className="font-medium">{selectedEntry.product_name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("admin.expedition.quantity")}:</span>
                  <p className="font-medium">{selectedEntry.planned_shipments} {t("common.units")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("admin.expedition.date")}:</span>
                  <p className="font-medium">
                    {format(new Date(selectedEntry.expedition_date), "d.M.yyyy", { locale: dateLocale })}
                  </p>
                </div>
                {selectedEntry.study_name && (
                  <div>
                    <span className="text-muted-foreground">{t("admin.expedition.study")}:</span>
                    <p className="font-medium">{selectedEntry.study_name}</p>
                  </div>
                )}
              </div>
              
              <div className="bg-muted p-3 rounded-md text-sm">
                <p className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t("admin.expedition.batchAllocation.fefo")}
                </p>
                <p className="text-muted-foreground mt-1">{t("admin.expedition.batchAllocation.fefoDescription")}</p>
              </div>

              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={checkAvailabilityForSelectedEntry}
                  disabled={isCheckingAvailability || !selectedEntry.product_id}
                  className="w-full"
                >
                  {isCheckingAvailability ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {t("admin.expedition.batchAllocation.checkAvailability")}
                </Button>

                {availabilityForEntry?.entryId === selectedEntry.id && (
                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-muted-foreground">{t("admin.expedition.batchAllocation.requested")}: {availabilityForEntry.data.requested}</div>
                      <div className="text-sm text-muted-foreground">{t("admin.expedition.batchAllocation.available")}: {availabilityForEntry.data.available}</div>
                      <div className="text-sm text-muted-foreground">{t("admin.expedition.batchAllocation.shortage")}: {availabilityForEntry.data.shortage}</div>
                      <Badge variant={availabilityForEntry.data.sufficient ? "default" : "destructive"}>
                        {availabilityForEntry.data.sufficient
                          ? t("admin.expedition.batchAllocation.sufficient")
                          : t("admin.expedition.batchAllocation.insufficient")}
                      </Badge>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("admin.expedition.batchAllocation.batchNumber")}</TableHead>
                          <TableHead>{t("admin.expedition.batchAllocation.expiryDate")}</TableHead>
                          <TableHead className="text-right">{t("admin.expedition.batchAllocation.available")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {availabilityForEntry.data.batches.map((b) => (
                          <TableRow key={b.batch_id}>
                            <TableCell className="font-mono font-medium">{b.batch_number}</TableCell>
                            <TableCell>
                              {b.expiry_date
                                ? format(new Date(b.expiry_date), "d.M.yyyy", { locale: dateLocale })
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right">{b.available_units}</TableCell>
                          </TableRow>
                        ))}
                        {availabilityForEntry.data.batches.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground">
                              {t("admin.expedition.batchAllocation.insufficient")}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocationDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmAllocation} disabled={isAllocating}>
              {isAllocating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              {isAllocating
                ? t("admin.expedition.batchAllocation.allocating")
                : t("admin.expedition.batchAllocation.allocate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Plan Dialog */}
      <Dialog open={generatePlanDialog} onOpenChange={setGeneratePlanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.expedition.generatePlan")}</DialogTitle>
            <DialogDescription>{t("admin.expedition.generatePlanDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="expedition-date">{t("admin.expedition.expeditionDate")}</Label>
              <Input
                id="expedition-date"
                type="date"
                value={planExpeditionDate}
                onChange={(e) => setPlanExpeditionDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cutoff-date">{t("admin.expedition.cutOffDate")}</Label>
              <Input
                id="cutoff-date"
                type="date"
                value={planCutOffDate}
                onChange={(e) => setPlanCutOffDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("admin.expedition.cutOffDateHelp")}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGeneratePlanDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={confirmGeneratePlan}
              disabled={expeditionQuery.generatePlan.isPending || !planExpeditionDate}
            >
              {expeditionQuery.generatePlan.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Package className="mr-2 h-4 w-4" />
              )}
              {t("admin.expedition.generatePlan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
