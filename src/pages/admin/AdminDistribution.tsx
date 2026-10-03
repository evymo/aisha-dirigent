import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useEffect, useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
// Select components available if needed
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
import { Calendar } from "@/components/ui/calendar";
import {
  useShipmentSettings,
  useDistributionSchedules,
  useSaveShipmentSettings,
  useCreateDistributionSchedule,
  useProcessDistributionSchedule,
  DEFAULT_SHIPMENT_SETTINGS,
  type ShipmentSettings,
  type DistributionSchedule,
} from "@/hooks";
import { 
  Settings,
  Calendar as CalendarIcon,
  Clock,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  Plus,
  Package,
  Truck
} from "lucide-react";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { format, isSameDay } from "date-fns";
const DAYS_OF_WEEK = [
  { value: 'monday', labelKey: 'common.days.monday' },
  { value: 'tuesday', labelKey: 'common.days.tuesday' },
  { value: 'wednesday', labelKey: 'common.days.wednesday' },
  { value: 'thursday', labelKey: 'common.days.thursday' },
  { value: 'friday', labelKey: 'common.days.friday' },
  { value: 'saturday', labelKey: 'common.days.saturday' },
  { value: 'sunday', labelKey: 'common.days.sunday' },
];

type ShippingMethodKey = "packeta_pickup" | "packeta_home" | "personal_pickup";

const SHIPPING_METHODS: Array<{ key: ShippingMethodKey; labelKey: string }> = [
  { key: "packeta_pickup", labelKey: "checkout.shipping.packetaPickup" },
  { key: "packeta_home", labelKey: "checkout.shipping.packetaHome" },
  { key: "personal_pickup", labelKey: "checkout.shipping.personalPickup" },
];

export default function AdminDistribution() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [localSettings, setLocalSettings] = useState<ShipmentSettings>(DEFAULT_SHIPMENT_SETTINGS);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newScheduleDate, setNewScheduleDate] = useState<Date | undefined>(undefined);
  const [newScheduleTime, setNewScheduleTime] = useState('14:00');
  const [shippingOverrides, setShippingOverrides] = useState<Record<ShippingMethodKey, string>>(() => ({
    packeta_pickup: JSON.stringify(DEFAULT_SHIPMENT_SETTINGS.shipping_rates?.methods?.packeta_pickup?.by_country ?? {}, null, 2),
    packeta_home: JSON.stringify(DEFAULT_SHIPMENT_SETTINGS.shipping_rates?.methods?.packeta_home?.by_country ?? {}, null, 2),
    personal_pickup: JSON.stringify(DEFAULT_SHIPMENT_SETTINGS.shipping_rates?.methods?.personal_pickup?.by_country ?? {}, null, 2),
  }));

  // React Query hooks
  const { data: settings, isLoading: settingsLoading } = useShipmentSettings();
  const { data: schedules = [], isLoading: schedulesLoading } = useDistributionSchedules(selectedDate);
  const saveSettingsMutation = useSaveShipmentSettings();
  const createScheduleMutation = useCreateDistributionSchedule();
  const processScheduleMutation = useProcessDistributionSchedule();
  
  const processing = createScheduleMutation.isPending || processScheduleMutation.isPending;

  const loading = settingsLoading || schedulesLoading;

  // Sync remote settings to local state
  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  useEffect(() => {
    const rates = localSettings.shipping_rates ?? DEFAULT_SHIPMENT_SETTINGS.shipping_rates;
    setShippingOverrides({
      packeta_pickup: JSON.stringify(rates?.methods?.packeta_pickup?.by_country ?? {}, null, 2),
      packeta_home: JSON.stringify(rates?.methods?.packeta_home?.by_country ?? {}, null, 2),
      personal_pickup: JSON.stringify(rates?.methods?.personal_pickup?.by_country ?? {}, null, 2),
    });
  }, [localSettings.shipping_rates]);

  const saveSettings = async () => {
    try {
      await saveSettingsMutation.mutateAsync(localSettings);
      toast.success(t("admin.distribution.settingsSaved"));
    } catch {
      toast.error(t("admin.distribution.settingsError"));
    }
  };

  const createSchedule = async () => {
    if (!newScheduleDate) return;
    
    try {
      await createScheduleMutation.mutateAsync({
        scheduledDate: format(newScheduleDate, 'yyyy-MM-dd'),
        scheduledTime: newScheduleTime,
      });
      toast.success(t("admin.distribution.scheduleCreated"));
      setCreateDialogOpen(false);
      setNewScheduleDate(undefined);
    } catch {
      toast.error(t("admin.distribution.createError"));
    }
  };

  const processSchedule = async (scheduleId: string) => {
    try {
      const result = await processScheduleMutation.mutateAsync(scheduleId);
      toast.success(t("admin.distribution.scheduleProcessed", { 
        processed: result.processed 
      }));
    } catch {
      toast.error(t("admin.distribution.processError"));
    }
  };

  const getScheduleForDate = (date: Date): DistributionSchedule | undefined => {
    return schedules.find(s => isSameDay(new Date(s.scheduled_date), date));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />{t("admin.distribution.status.completed")}</Badge>;
      case 'processing':
        return <Badge variant="default"><Loader2 className="w-3 h-3 mr-1 animate-spin" />{t("admin.distribution.status.processing")}</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{t("admin.distribution.status.failed")}</Badge>;
      case 'cancelled':
        return <Badge variant="outline"><XCircle className="w-3 h-3 mr-1" />{t("admin.distribution.status.cancelled")}</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />{t("admin.distribution.status.pending")}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.distribution.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.distribution.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t("admin.distribution.createSchedule")}
        </Button>
      </div>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">
            <CalendarIcon className="w-4 h-4 mr-2" />
            {t("admin.distribution.tabs.calendar")}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="w-4 h-4 mr-2" />
            {t("admin.distribution.tabs.settings")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-6">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Calendar */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t("admin.distribution.calendarTitle")}</CardTitle>
                <CardDescription>{t("admin.distribution.calendarDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  locale={dateLocale}
                  className="rounded-md border"
                  modifiers={{
                    scheduled: schedules.map(s => new Date(s.scheduled_date)),
                    completed: schedules.filter(s => s.status === 'completed').map(s => new Date(s.scheduled_date)),
                  }}
                  modifiersStyles={{
                    scheduled: { backgroundColor: 'hsl(var(--primary) / 0.1)', fontWeight: 'bold' },
                    completed: { backgroundColor: 'hsl(142 76% 36% / 0.1)' },
                  }}
                />
                
                {/* Legend */}
                <div className="flex items-center gap-4 mt-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-primary/10" />
                    <span>{t("admin.distribution.legend.scheduled")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500/10" />
                    <span>{t("admin.distribution.legend.completed")}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Schedule Details */}
            <Card>
              <CardHeader>
                <CardTitle>{format(selectedDate, 'PPP', { locale: dateLocale })}</CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const schedule = getScheduleForDate(selectedDate);
                  if (!schedule) {
                    return (
                      <div className="text-center py-8">
                        <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground">{t("admin.distribution.noSchedule")}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          onClick={() => {
                            setNewScheduleDate(selectedDate);
                            setCreateDialogOpen(true);
                          }}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          {t("admin.distribution.createForDate")}
                        </Button>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("admin.distribution.status.label")}</span>
                        {getStatusBadge(schedule.status)}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("admin.distribution.time")}</span>
                        <span className="font-medium">{schedule.scheduled_time}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("admin.distribution.ordersCount")}</span>
                        <span className="font-medium">{schedule.orders_count}</span>
                      </div>
                      {schedule.status === 'completed' && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">{t("admin.distribution.processed")}</span>
                            <span className="font-medium text-green-600">{schedule.processed_count}</span>
                          </div>
                          {schedule.failed_count > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">{t("admin.distribution.failed")}</span>
                              <span className="font-medium text-red-600">{schedule.failed_count}</span>
                            </div>
                          )}
                        </>
                      )}
                      {schedule.status === 'pending' && (
                        <Button
                          onClick={() => processSchedule(schedule.id)}
                          disabled={createScheduleMutation.isPending || processScheduleMutation.isPending}
                          className="w-full mt-4"
                        >
                          {(createScheduleMutation.isPending || processScheduleMutation.isPending) ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4 mr-2" />
                          )}
                          {t("admin.distribution.processNow")}
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Upcoming Schedules */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("admin.distribution.upcomingTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {schedules.filter(s => s.status === 'pending').length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    {t("admin.distribution.noUpcoming")}
                  </p>
                ) : (
                  schedules
                    .filter(s => s.status === 'pending')
                    .map(schedule => (
                      <div
                        key={schedule.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                        onClick={() => setSelectedDate(new Date(schedule.scheduled_date))}
                      >
                        <div className="flex items-center gap-3">
                          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">
                              {format(new Date(schedule.scheduled_date), 'EEEE, d. MMMM', { locale: dateLocale })}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {schedule.scheduled_time} • {schedule.orders_count} {t("admin.distribution.orders")}
                            </p>
                          </div>
                        </div>
                        {getStatusBadge(schedule.status)}
                      </div>
                    ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <div className="grid gap-6">
            {/* Auto-create Packeta */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  {t("admin.distribution.settings.autoCreate.title")}
                </CardTitle>
                <CardDescription>{t("admin.distribution.settings.autoCreate.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-create">{t("admin.distribution.settings.autoCreate.enabled")}</Label>
                  <Switch
                    id="auto-create"
                    checked={localSettings.auto_create_packeta.enabled}
                    onCheckedChange={(checked) => 
                      setLocalSettings(prev => ({
                        ...prev,
                        auto_create_packeta: { ...prev.auto_create_packeta, enabled: checked }
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.distribution.settings.autoCreate.delay")}</Label>
                  <Input
                    type="number"
                    min="0"
                    value={localSettings.auto_create_packeta.delay_minutes}
                    onChange={(e) => 
                      setLocalSettings(prev => ({
                        ...prev,
                        auto_create_packeta: { ...prev.auto_create_packeta, delay_minutes: parseInt(e.target.value) || 0 }
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("admin.distribution.settings.autoCreate.delayHelp")}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Schedule Days */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5" />
                  {t("admin.distribution.settings.scheduleDays.title")}
                </CardTitle>
                <CardDescription>{t("admin.distribution.settings.scheduleDays.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>{t("admin.distribution.settings.scheduleDays.enabled")}</Label>
                  <Switch
                    checked={localSettings.auto_ship_days.enabled}
                    onCheckedChange={(checked) => 
                      setLocalSettings(prev => ({
                        ...prev,
                        auto_ship_days: { ...prev.auto_ship_days, enabled: checked }
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <div key={day.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={day.value}
                        checked={localSettings.auto_ship_days.days.includes(day.value)}
                        onCheckedChange={(checked) => {
                          const newDays = checked
                            ? [...localSettings.auto_ship_days.days, day.value]
                            : localSettings.auto_ship_days.days.filter(d => d !== day.value);
                          setLocalSettings(prev => ({
                            ...prev,
                            auto_ship_days: { ...prev.auto_ship_days, days: newDays }
                          }));
                        }}
                      />
                      <Label htmlFor={day.value}>{t(day.labelKey)}</Label>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.distribution.settings.scheduleDays.time")}</Label>
                  <Input
                    type="time"
                    value={localSettings.auto_ship_time.time}
                    onChange={(e) => 
                      setLocalSettings(prev => ({
                        ...prev,
                        auto_ship_time: { ...prev.auto_ship_time, time: e.target.value }
                      }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Packeta Defaults */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  {t("admin.distribution.settings.defaults.title")}
                </CardTitle>
                <CardDescription>{t("admin.distribution.settings.defaults.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("admin.distribution.settings.defaults.weight")}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={localSettings.packeta_defaults.default_weight}
                      onChange={(e) => 
                        setLocalSettings(prev => ({
                          ...prev,
                          packeta_defaults: { ...prev.packeta_defaults, default_weight: parseFloat(e.target.value) || 0.5 }
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.distribution.settings.defaults.value")}</Label>
                    <Input
                      type="number"
                      min="0"
                      value={localSettings.packeta_defaults.default_value}
                      onChange={(e) => 
                        setLocalSettings(prev => ({
                          ...prev,
                          packeta_defaults: { ...prev.packeta_defaults, default_value: parseInt(e.target.value) || 50 }
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.distribution.settings.defaults.senderName")}</Label>
                  <Input
                    value={localSettings.packeta_defaults.sender_name}
                    onChange={(e) => 
                      setLocalSettings(prev => ({
                        ...prev,
                        packeta_defaults: { ...prev.packeta_defaults, sender_name: e.target.value }
                      }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Shipping Rates */}
            <Card>
              <CardHeader>
                <CardTitle>{t("admin.distribution.settings.shippingRates.title")}</CardTitle>
                <CardDescription>{t("admin.distribution.settings.shippingRates.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>{t("admin.distribution.settings.shippingRates.baseCurrency")}</Label>
                  <Input
                    value={localSettings.shipping_rates?.base_currency || BASE_CURRENCY_FALLBACK}
                    onChange={(e) => {
                      const baseCurrency = e.target.value.toUpperCase();
                      setLocalSettings((prev) => ({
                        ...prev,
                        shipping_rates: {
                          ...(prev.shipping_rates ?? DEFAULT_SHIPMENT_SETTINGS.shipping_rates),
                          base_currency: baseCurrency || BASE_CURRENCY_FALLBACK,
                        },
                      }));
                    }}
                  />
                </div>

                <div className="space-y-4">
                  {SHIPPING_METHODS.map((method) => {
                    const currentRates = (settings ?? DEFAULT_SHIPMENT_SETTINGS).shipping_rates ?? DEFAULT_SHIPMENT_SETTINGS.shipping_rates;
                    const methodSettings = currentRates?.methods?.[method.key] ?? {
                      default: 0,
                      by_country: {},
                    };

                    return (
                      <div key={method.key} className="rounded-lg border border-border p-4 space-y-3">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="font-medium">{t(method.labelKey)}</div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">
                              {t("admin.distribution.settings.shippingRates.defaultRate")}
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              className="w-28"
                              value={methodSettings.default ?? 0}
                              onChange={(e) => {
                                const nextValue = Number(e.target.value);
                                setLocalSettings((prev) => {
                                  const prevRates = prev.shipping_rates ?? DEFAULT_SHIPMENT_SETTINGS.shipping_rates;
                                  const prevMethod = prevRates?.methods?.[method.key] ?? {
                                    default: 0,
                                    by_country: {},
                                  };
                                  return {
                                    ...prev,
                                    shipping_rates: {
                                      ...prevRates,
                                      methods: {
                                        ...prevRates.methods,
                                        [method.key]: {
                                          ...prevMethod,
                                          default: Number.isFinite(nextValue) ? nextValue : 0,
                                        },
                                      },
                                    },
                                  };
                                });
                              }}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>{t("admin.distribution.settings.shippingRates.countryOverrides")}</Label>
                          <Textarea
                            value={shippingOverrides[method.key]}
                            onChange={(e) =>
                              setShippingOverrides((prev) => ({
                                ...prev,
                                [method.key]: e.target.value,
                              }))
                            }
                            onBlur={() => {
                              try {
                                const raw = shippingOverrides[method.key]?.trim() || "{}";
                                const parsed = JSON.parse(raw);
                                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                                  throw new Error("Invalid overrides");
                                }
                                setLocalSettings((prev) => {
                                  const prevRates = prev.shipping_rates ?? DEFAULT_SHIPMENT_SETTINGS.shipping_rates;
                                  const prevMethod = prevRates?.methods?.[method.key] ?? {
                                    default: 0,
                                    by_country: {},
                                  };
                                  return {
                                    ...prev,
                                    shipping_rates: {
                                      ...prevRates,
                                      methods: {
                                        ...prevRates.methods,
                                        [method.key]: {
                                          ...prevMethod,
                                          by_country: parsed,
                                        },
                                      },
                                    },
                                  };
                                });
                              } catch (error) {
                                safeError("admin.distribution.shippingRates.invalidOverrides", error);
                                toast.error(t("admin.distribution.settings.shippingRates.invalidOverrides"));
                                const currentByCountry =
                                  (settings ?? DEFAULT_SHIPMENT_SETTINGS).shipping_rates?.methods?.[method.key]?.by_country ?? {};
                                setShippingOverrides((prev) => ({
                                  ...prev,
                                  [method.key]: JSON.stringify(currentByCountry, null, 2),
                                }));
                              }
                            }}
                            className="font-mono text-xs"
                            rows={4}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t("admin.distribution.settings.shippingRates.countryOverridesHelp")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Notifications */}
            <Card>
              <CardHeader>
                <CardTitle>{t("admin.distribution.settings.notifications.title")}</CardTitle>
                <CardDescription>{t("admin.distribution.settings.notifications.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("admin.distribution.settings.notifications.email")}</Label>
                  <Input
                    type="email"
                    value={localSettings.notification_email.email || ''}
                    onChange={(e) => 
                      setLocalSettings(prev => ({
                        ...prev,
                        notification_email: { ...prev.notification_email, email: e.target.value || null }
                      }))
                    }
                    placeholder={t("admin.distribution.settings.notifications.emailPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="notify-new-order"
                      checked={localSettings.notification_email.send_on_new_order}
                      onCheckedChange={(checked) => 
                        setLocalSettings(prev => ({
                          ...prev,
                          notification_email: { ...prev.notification_email, send_on_new_order: !!checked }
                        }))
                      }
                    />
                    <Label htmlFor="notify-new-order">{t("admin.distribution.settings.notifications.newOrder")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="notify-shipment"
                      checked={localSettings.notification_email.send_on_shipment}
                      onCheckedChange={(checked) => 
                        setLocalSettings(prev => ({
                          ...prev,
                          notification_email: { ...prev.notification_email, send_on_shipment: !!checked }
                        }))
                      }
                    />
                    <Label htmlFor="notify-shipment">{t("admin.distribution.settings.notifications.shipment")}</Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={saveSettingsMutation.isPending}>
                {saveSettingsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {t("common.save")}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Schedule Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.distribution.createDialog.title")}</DialogTitle>
            <DialogDescription>{t("admin.distribution.createDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.distribution.createDialog.date")}</Label>
              <Calendar
                mode="single"
                selected={newScheduleDate}
                onSelect={setNewScheduleDate}
                locale={dateLocale}
                disabled={(date) => date < new Date()}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.distribution.createDialog.time")}</Label>
              <Input
                type="time"
                value={newScheduleTime}
                onChange={(e) => setNewScheduleTime(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={createSchedule} disabled={!newScheduleDate || processing}>
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
