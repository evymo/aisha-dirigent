import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Pill, Droplets, Clock, Info } from "lucide-react";
import { useMyDistributionPlans, useMyEffectiveDistribution, calculateBottleDuration } from "@/hooks/useDistributionProtocols";

export interface DosingInputValue {
  tookRtnProducts: boolean;
  selectedProtocolId: string | null;
  isCustomDistribution: boolean;
  customDoseAmount: number | null;
  customDoseUnit: string;
  customDosesPerDay: number | null;
  customDoseTiming: string[];
  notes: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'retrospective';
  reportPeriodStart?: string;
  reportPeriodEnd?: string;
}

interface DosingInputProps {
  value: DosingInputValue;
  onChange: (value: DosingInputValue) => void;
  reportType: 'daily' | 'weekly' | 'monthly' | 'retrospective';
}

const DOSE_UNITS = ['drops', 'ml', 'sprays', 'capsules'] as const;
const DOSE_TIMINGS = ['morning', 'noon', 'afternoon', 'evening', 'night', 'with_meals'] as const;

export function DosingInput({ value, onChange, reportType }: DosingInputProps) {
  const { t } = useTranslation();
  const { distributions, loading: distributionsLoading } = useMyEffectiveDistribution();
  const { loading: plansLoading } = useMyDistributionPlans();

  const loading = distributionsLoading || plansLoading;

  // Get user's available protocols from their registrations
  const availableProtocols = distributions.filter(d => d.protocol_id);

  // Note: selectedProtocol is available for future use if needed
  // const selectedProtocol = value.selectedProtocolId 
  //   ? availableProtocols.find(p => p.protocol_id === value.selectedProtocolId)
  //   : null;

  const handleTookProductsChange = (took: boolean) => {
    onChange({
      ...value,
      tookRtnProducts: took,
      reportType,
    });
  };

  const handleProtocolSelect = (protocolId: string) => {
    if (protocolId === 'custom') {
      onChange({
        ...value,
        selectedProtocolId: null,
        isCustomDistribution: true,
        reportType,
      });
    } else {
      const protocol = availableProtocols.find(p => p.protocol_id === protocolId);
      onChange({
        ...value,
        selectedProtocolId: protocolId,
        isCustomDistribution: false,
        customDoseAmount: protocol?.dose_amount ?? null,
        customDoseUnit: protocol?.dose_unit ?? 'drops',
        customDosesPerDay: protocol?.doses_per_day ?? null,
        customDoseTiming: protocol?.dose_timing ?? [],
        reportType,
      });
    }
  };

  const handleCustomValueChange = (field: keyof DosingInputValue, fieldValue: unknown) => {
    onChange({
      ...value,
      [field]: fieldValue,
      reportType,
    });
  };

  const toggleTiming = (timing: string) => {
    const newTimings = value.customDoseTiming.includes(timing)
      ? value.customDoseTiming.filter(t => t !== timing)
      : [...value.customDoseTiming, timing];
    onChange({
      ...value,
      customDoseTiming: newTimings,
      reportType,
    });
  };

  // Calculate consumption for display
  const consumption = value.customDoseAmount && value.customDosesPerDay
    ? calculateBottleDuration(
      value.customDoseAmount,
      value.customDosesPerDay,
      value.customDoseUnit
    )
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Pill className="w-5 h-5 text-primary" />
          {t('checkIn.dosing.title')}
        </CardTitle>
        <CardDescription>
          {t('checkIn.dosing.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Did you take RTN products? */}
        <div className="flex items-center justify-between">
          <Label htmlFor="took-rtn" className="flex items-center gap-2">
            <Droplets className="w-4 h-4" />
            {t('checkIn.dosing.tookProducts')}
          </Label>
          <Switch
            id="took-rtn"
            checked={value.tookRtnProducts}
            onCheckedChange={handleTookProductsChange}
          />
        </div>

        {value.tookRtnProducts && (
          <>
            {/* Protocol Selection */}
            {loading ? (
              <div className="text-sm text-muted-foreground">
                {t('common.loading')}
              </div>
            ) : availableProtocols.length > 0 ? (
              <div className="space-y-3">
                <Label>{t('checkIn.dosing.selectProtocol')}</Label>
                <RadioGroup
                  value={value.isCustomDistribution ? 'custom' : (value.selectedProtocolId ?? '')}
                  onValueChange={handleProtocolSelect}
                  className="space-y-2"
                >
                  {availableProtocols.map((protocol) => (
                    <div key={protocol.protocol_id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                      <RadioGroupItem value={protocol.protocol_id} id={protocol.protocol_id} />
                      <Label htmlFor={protocol.protocol_id} className="flex-1 cursor-pointer">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{protocol.protocol_name}</div>
                            <div className="text-sm text-muted-foreground">
                              {protocol.doses_per_day}× {protocol.dose_amount} {t(`distribution.units.${protocol.dose_unit}`)}
                            </div>
                          </div>
                          <div className="text-right">
                            {protocol.study_name && (
                              <Badge variant="outline" className="text-xs">
                                {protocol.study_name}
                              </Badge>
                            )}
                            <div className="text-xs text-muted-foreground mt-1">
                              ~{protocol.ml_per_day.toFixed(1)} ml/{t('distribution.perDayShort')}
                            </div>
                          </div>
                        </div>
                      </Label>
                    </div>
                  ))}

                  {/* Custom option */}
                  <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                    <RadioGroupItem value="custom" id="custom" />
                    <Label htmlFor="custom" className="flex-1 cursor-pointer">
                      <div className="font-medium">{t('checkIn.dosing.customDistribution')}</div>
                      <div className="text-sm text-muted-foreground">
                        {t('checkIn.dosing.enterManually')}
                      </div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            ) : (
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    {t('checkIn.dosing.noProtocols')}
                  </div>
                </div>
              </div>
            )}

            {/* Custom Distribution Form */}
            {(value.isCustomDistribution || availableProtocols.length === 0) && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                <h4 className="font-medium">{t('checkIn.dosing.customValues')}</h4>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('checkIn.dosing.doseAmount')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={value.customDoseAmount ?? ''}
                      onChange={(e) => handleCustomValueChange('customDoseAmount', parseInt(e.target.value) || null)}
                      placeholder="10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t('checkIn.dosing.doseUnit')}</Label>
                    <Select
                      value={value.customDoseUnit}
                      onValueChange={(v) => handleCustomValueChange('customDoseUnit', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOSE_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {t(`distribution.units.${unit}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('checkIn.dosing.timesPerDay')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={value.customDosesPerDay ?? ''}
                    onChange={(e) => handleCustomValueChange('customDosesPerDay', parseInt(e.target.value) || null)}
                    placeholder="2"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('checkIn.dosing.whenTaken')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {DOSE_TIMINGS.map((timing) => (
                      <Badge
                        key={timing}
                        variant={value.customDoseTiming.includes(timing) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleTiming(timing)}
                      >
                        {t(`distribution.timing.${timing}`)}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Consumption calculation */}
                {consumption && (
                  <div className="p-3 bg-primary/5 rounded-lg">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="text-muted-foreground">{t('checkIn.dosing.consumption')}:</span>
                      <span className="font-medium">{consumption.mlPerDay.toFixed(1)} ml</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground">{t('checkIn.dosing.bottleLasts')}:</span>
                      <span className="font-medium">{t('distribution.days', { count: consumption.daysPerBottle })}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>{t('checkIn.dosing.notes')}</Label>
              <Textarea
                value={value.notes}
                onChange={(e) => handleCustomValueChange('notes', e.target.value)}
                placeholder={t('checkIn.dosing.notesPlaceholder')}
                rows={2}
              />
            </div>

            {/* Period for retrospective/summary reports */}
            {(reportType === 'weekly' || reportType === 'monthly' || reportType === 'retrospective') && (
              <div className="space-y-3 p-4 border rounded-lg">
                <Label className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {t('checkIn.dosing.reportPeriod')}
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">{t('common.from')}</Label>
                    <Input
                      type="date"
                      value={value.reportPeriodStart ?? ''}
                      onChange={(e) => handleCustomValueChange('reportPeriodStart', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">{t('common.to')}</Label>
                    <Input
                      type="date"
                      value={value.reportPeriodEnd ?? ''}
                      onChange={(e) => handleCustomValueChange('reportPeriodEnd', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
