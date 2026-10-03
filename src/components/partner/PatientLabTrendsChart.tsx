import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from "recharts";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { useBiomarkerReferenceRanges, getBiomarkerStatus, BiomarkerReferenceRange } from "@/hooks/useBiomarkerReferenceRanges";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { AlertTriangle, CheckCircle, AlertCircle } from "lucide-react";

interface LabResult {
  id: string;
  test_date: string;
  status: string;
  crp: number | null;
  esr?: number | null;
  vitamin_d: number | null;
  vitamin_b12?: number | null;
  glucose: number | null;
  hba1c?: number | null;
  insulin?: number | null;
  cholesterol_total?: number | null;
  hdl?: number | null;
  ldl?: number | null;
  triglycerides?: number | null;
  ast?: number | null;
  alt?: number | null;
  nk_cells?: number | null;
  cd4_count?: number | null;
  cd8_count?: number | null;
  il_6?: number | null;
  tnf_alpha?: number | null;
  nad_nadh_ratio?: number | null;
  omega3_index?: number | null;
}

interface UserLabTrendsChartProps {
  labResults: LabResult[];
}

const chartConfig = {
  crp: { label: "CRP", color: "hsl(var(--chart-1))" },
  esr: { label: "ESR", color: "hsl(var(--chart-2))" },
  glucose: { label: "Glucose", color: "hsl(var(--chart-3))" },
  hba1c: { label: "HbA1c", color: "hsl(var(--chart-4))" },
  vitamin_d: { label: "Vitamin D", color: "hsl(var(--chart-5))" },
  vitamin_b12: { label: "Vitamin B12", color: "hsl(var(--chart-1))" },
  cholesterol: { label: "Total Cholesterol", color: "hsl(var(--chart-2))" },
  hdl: { label: "HDL", color: "hsl(var(--chart-3))" },
  ldl: { label: "LDL", color: "hsl(var(--chart-4))" },
  triglycerides: { label: "Triglycerides", color: "hsl(var(--chart-5))" },
  ast: { label: "AST", color: "hsl(var(--chart-1))" },
  alt: { label: "ALT", color: "hsl(var(--chart-2))" },
  nk_cells: { label: "NK Cells", color: "hsl(var(--chart-3))" },
  cd4: { label: "CD4", color: "hsl(var(--chart-4))" },
  cd8: { label: "CD8", color: "hsl(var(--chart-5))" },
  il_6: { label: "IL-6", color: "hsl(var(--chart-1))" },
  tnf_alpha: { label: "TNF-α", color: "hsl(var(--chart-2))" },
  nad_nadh: { label: "NAD/NADH", color: "hsl(var(--chart-3))" },
  omega3: { label: "Omega-3 Index", color: "hsl(var(--chart-4))" },
};

// Status badge component
const StatusBadge = ({ status }: { status: ReturnType<typeof getBiomarkerStatus> }) => {
  switch (status) {
    case 'critical':
      return (
        <Badge variant="destructive" className="text-xs flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Critical
        </Badge>
      );
    case 'warning':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-amber-500 text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          Warning
        </Badge>
      );
    case 'optimal':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-green-500 text-green-600">
          <CheckCircle className="h-3 w-3" />
          Optimal
        </Badge>
      );
    default:
      return null;
  }
};

// Latest values summary component
const LatestValuesSummary = ({ 
  latestResult, 
  biomarkerKeys, 
  referenceRanges,
  translationsMap
}: { 
  latestResult: Record<string, unknown>;
  biomarkerKeys: string[];
  referenceRanges: BiomarkerReferenceRange[];
  translationsMap: Record<string, string>;
}) => {
  const rangeMap = Object.fromEntries(referenceRanges.map(r => [r.biomarker_key, r]));
  
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-4">
      {biomarkerKeys.map(key => {
        const rawValue = latestResult[key];
        if (rawValue === null || rawValue === undefined || typeof rawValue !== 'number') return null;
        const value = rawValue as number;
        
        const range = rangeMap[key];
        const status = getBiomarkerStatus(value, range);
        const name = range ? (translationsMap[range.name_key] ?? range.name_key) : key;
        const unit = range?.unit || '';
        
        return (
          <div 
            key={key} 
            className={`p-2 rounded-lg border ${
              status === 'critical' ? 'border-destructive bg-destructive/5' :
              status === 'warning' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' :
              status === 'optimal' ? 'border-green-500 bg-green-50 dark:bg-green-950/20' :
              'border-border'
            }`}
          >
            <div className="text-xs text-muted-foreground truncate">{name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="font-semibold">{value.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">{unit}</span>
            </div>
            {range && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Ref: {range.min_value ?? '—'}–{range.max_value ?? '—'}
              </div>
            )}
            <StatusBadge status={status} />
          </div>
        );
      })}
    </div>
  );
};

export function UserLabTrendsChart({ labResults }: UserLabTrendsChartProps) {
  const { t } = useTranslation();
  const { data: referenceRanges = [] } = useBiomarkerReferenceRanges();

  // Resolve biomarker name translation keys
  const biomarkerNameKeys = referenceRanges.map(r => r.name_key).filter(Boolean);
  const biomarkerTranslationsMap = useDynamicTranslationsMap(biomarkerNameKeys, 'biomarkers', 'en');

  if (labResults.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t("consultantDashboard.labChart.noData")}
      </div>
    );
  }

  // Create range lookup map
  const rangeMap = Object.fromEntries(referenceRanges.map(r => [r.biomarker_key, r]));

  // Sort by date ascending for charts
  const sortedResults = [...labResults].sort(
    (a, b) => new Date(a.test_date).getTime() - new Date(b.test_date).getTime()
  );

  const chartData = sortedResults.map((result) => ({
    date: format(new Date(result.test_date), "MMM d"),
    fullDate: result.test_date,
    crp: result.crp,
    esr: result.esr,
    glucose: result.glucose,
    hba1c: result.hba1c,
    insulin: result.insulin,
    vitamin_d: result.vitamin_d,
    vitamin_b12: result.vitamin_b12,
    cholesterol: result.cholesterol_total,
    hdl: result.hdl,
    ldl: result.ldl,
    triglycerides: result.triglycerides,
    ast: result.ast,
    alt: result.alt,
    nk_cells: result.nk_cells,
    cd4: result.cd4_count,
    cd8: result.cd8_count,
    il_6: result.il_6,
    tnf_alpha: result.tnf_alpha,
    nad_nadh: result.nad_nadh_ratio,
    omega3: result.omega3_index,
  }));

  // Get latest result for summary
  const latestResult = chartData[chartData.length - 1];

  // Check which panels have data
  const hasInflammation = chartData.some((d) => d.crp != null || d.esr != null);
  const hasMetabolic = chartData.some((d) => d.glucose != null || d.hba1c != null);
  const hasLipids = chartData.some((d) => d.cholesterol != null || d.hdl != null || d.ldl != null);
  const hasVitamins = chartData.some((d) => d.vitamin_d != null || d.vitamin_b12 != null);
  const hasLiver = chartData.some((d) => d.ast != null || d.alt != null);
  const hasImmune = chartData.some((d) => d.nk_cells != null || d.cd4 != null || d.cd8 != null);
  const hasAdvanced = chartData.some((d) => d.nad_nadh != null || d.omega3 != null);

  // Helper to render reference areas for a biomarker
  const renderReferenceAreas = (biomarkerKey: string) => {
    const range = rangeMap[biomarkerKey];
    if (!range) return null;

    const areas: ReactElement[] = [];

    // Optimal range (green)
    if (range.optimal_min !== null && range.optimal_max !== null) {
      areas.push(
        <ReferenceArea
          key={`${biomarkerKey}-optimal`}
          y1={range.optimal_min}
          y2={range.optimal_max}
          fill="hsl(142 76% 36%)"
          fillOpacity={0.1}
        />
      );
    }

    // Normal range lines
    if (range.min_value !== null) {
      areas.push(
        <ReferenceLine
          key={`${biomarkerKey}-min`}
          y={range.min_value}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
        />
      );
    }
    if (range.max_value !== null) {
      areas.push(
        <ReferenceLine
          key={`${biomarkerKey}-max`}
          y={range.max_value}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="3 3"
          strokeOpacity={0.5}
        />
      );
    }

    // Critical lines (red)
    if (range.critical_low !== null) {
      areas.push(
        <ReferenceLine
          key={`${biomarkerKey}-critical-low`}
          y={range.critical_low}
          stroke="hsl(var(--destructive))"
          strokeWidth={2}
          strokeDasharray="5 5"
        />
      );
    }
    if (range.critical_high !== null) {
      areas.push(
        <ReferenceLine
          key={`${biomarkerKey}-critical-high`}
          y={range.critical_high}
          stroke="hsl(var(--destructive))"
          strokeWidth={2}
          strokeDasharray="5 5"
        />
      );
    }

    return areas;
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue={hasInflammation ? "inflammation" : "metabolic"} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          {hasInflammation && (
            <TabsTrigger value="inflammation" className="text-xs">
              {t("consultantDashboard.labChart.inflammation")}
            </TabsTrigger>
          )}
          {hasMetabolic && (
            <TabsTrigger value="metabolic" className="text-xs">
              {t("consultantDashboard.labChart.metabolic")}
            </TabsTrigger>
          )}
          {hasLipids && (
            <TabsTrigger value="lipids" className="text-xs">
              {t("consultantDashboard.labChart.lipids")}
            </TabsTrigger>
          )}
          {hasVitamins && (
            <TabsTrigger value="vitamins" className="text-xs">
              {t("consultantDashboard.labChart.vitamins")}
            </TabsTrigger>
          )}
          {hasLiver && (
            <TabsTrigger value="liver" className="text-xs">
              {t("consultantDashboard.labChart.liver")}
            </TabsTrigger>
          )}
          {hasImmune && (
            <TabsTrigger value="immune" className="text-xs">
              {t("consultantDashboard.labChart.immune")}
            </TabsTrigger>
          )}
          {hasAdvanced && (
            <TabsTrigger value="advanced" className="text-xs">
              {t("consultantDashboard.labChart.advanced")}
            </TabsTrigger>
          )}
        </TabsList>

        {/* Inflammation Panel - CRP, ESR (Demo Product 2 indicator) */}
        {hasInflammation && (
          <TabsContent value="inflammation">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.inflammationTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.inflammationDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('crp')}
                      <Line type="monotone" dataKey="crp" name={`CRP (${rangeMap['crp']?.unit || 'mg/L'})`} stroke={chartConfig.crp.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="esr" name={`ESR (${rangeMap['esr']?.unit || 'mm/h'})`} stroke={chartConfig.esr.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['crp', 'esr', 'il_6', 'tnf_alpha']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Metabolic Panel - Glucose, HbA1c (Demo Product 1 indicator) */}
        {hasMetabolic && (
          <TabsContent value="metabolic">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.metabolicTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.metabolicDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('glucose')}
                      <Line type="monotone" dataKey="glucose" name={`Glucose (${rangeMap['glucose']?.unit || 'mmol/L'})`} stroke={chartConfig.glucose.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="hba1c" name={`HbA1c (${rangeMap['hba1c']?.unit || '%'})`} stroke={chartConfig.hba1c.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['glucose', 'hba1c', 'insulin']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Lipid Panel - Cholesterol, HDL, LDL (Demo Product 3 indicator) */}
        {hasLipids && (
          <TabsContent value="lipids">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.lipidsTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.lipidsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('cholesterol_total')}
                      <Line type="monotone" dataKey="cholesterol" name={`Total (${rangeMap['cholesterol_total']?.unit || 'mmol/L'})`} stroke={chartConfig.cholesterol.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="hdl" name={`HDL (${rangeMap['hdl']?.unit || 'mmol/L'})`} stroke={chartConfig.hdl.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="ldl" name={`LDL (${rangeMap['ldl']?.unit || 'mmol/L'})`} stroke={chartConfig.ldl.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="triglycerides" name={`TG (${rangeMap['triglycerides']?.unit || 'mmol/L'})`} stroke={chartConfig.triglycerides.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['cholesterol_total', 'hdl', 'ldl', 'triglycerides']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Vitamins Panel */}
        {hasVitamins && (
          <TabsContent value="vitamins">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.vitaminsTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.vitaminsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('vitamin_d')}
                      <Line type="monotone" dataKey="vitamin_d" name={`Vitamin D (${rangeMap['vitamin_d']?.unit || 'ng/mL'})`} stroke={chartConfig.vitamin_d.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="vitamin_b12" name={`Vitamin B12 (${rangeMap['vitamin_b12']?.unit || 'pg/mL'})`} stroke={chartConfig.vitamin_b12.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['vitamin_d', 'vitamin_b12']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Liver Panel */}
        {hasLiver && (
          <TabsContent value="liver">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.liverTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.liverDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('alt')}
                      <Line type="monotone" dataKey="ast" name={`AST (${rangeMap['ast']?.unit || 'U/L'})`} stroke={chartConfig.ast.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="alt" name={`ALT (${rangeMap['alt']?.unit || 'U/L'})`} stroke={chartConfig.alt.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['ast', 'alt', 'creatinine', 'urea']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Immune Panel (Demo Product 2 indicator) */}
        {hasImmune && (
          <TabsContent value="immune">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.immuneTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.immuneDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('nk_cells')}
                      <Line type="monotone" dataKey="nk_cells" name="NK Cells" stroke={chartConfig.nk_cells.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="cd4" name="CD4" stroke={chartConfig.cd4.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="cd8" name="CD8" stroke={chartConfig.cd8.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['nk_cells', 'cd4_count', 'cd8_count']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Advanced/Longevity Panel (Demo Product 1 indicator) */}
        {hasAdvanced && (
          <TabsContent value="advanced">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {t("consultantDashboard.labChart.advancedTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("consultantDashboard.labChart.advancedDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {renderReferenceAreas('nad_nadh_ratio')}
                      <Line type="monotone" dataKey="nad_nadh" name="NAD/NADH" stroke={chartConfig.nad_nadh.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="omega3" name="Omega-3 Index (%)" stroke={chartConfig.omega3.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <LatestValuesSummary 
                  latestResult={latestResult} 
                  biomarkerKeys={['nad_nadh_ratio', 'omega3_index']} 
                  referenceRanges={referenceRanges}
                  translationsMap={biomarkerTranslationsMap}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
