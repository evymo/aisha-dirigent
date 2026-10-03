import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RatingButtons } from "@/components/ui/rating-buttons";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTrackingCheckIns, useDosingLogs } from "@/hooks/useTracking";
import { toast } from "sonner";
import { useProcessReward } from "@/hooks/useTokens";
import { Heart, Moon, Zap, Activity, Pill, MessageSquare, Coins } from "lucide-react";
import { DosingInput, type DosingInputValue } from "./DosingInput";
import { defaultDosingInputValue } from "./dosingInputDefaults";

const checkInSchema = z.object({
  check_in_type: z.enum(["morning", "evening", "weekly", "monthly"]),
  pain_level: z.number().min(0).max(10).optional(),
  pain_location: z.string().max(200).optional(),
  pain_notes: z.string().max(1000).optional(),
  sleep_quality: z.number().min(0).max(10).optional(),
  sleep_hours: z.number().min(0).max(24).optional(),
  energy_level: z.number().min(0).max(10).optional(),
  mood_level: z.number().min(0).max(10).optional(),
  steps_count: z.number().min(0).max(100000).optional(),
  activity_minutes: z.number().min(0).max(1440).optional(),
  exercise_type: z.string().max(100).optional(),
  took_medication: z.boolean().optional(),
  medication_notes: z.string().max(500).optional(),
  side_effects: z.string().max(500).optional(),
  general_notes: z.string().max(2000).optional(),
});

type CheckInFormValues = z.infer<typeof checkInSchema>;

export function TrackingCheckInForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createCheckIn, todayCheckIn } = useTrackingCheckIns();
  const { logDose } = useDosingLogs();
  const processReward = useProcessReward();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dosingValue, setDosingValue] = useState<DosingInputValue>(defaultDosingInputValue);

  const form = useForm<CheckInFormValues>({
    resolver: zodResolver(checkInSchema),
    defaultValues: {
      check_in_type: "morning",
      pain_level: 0,
      sleep_quality: 5,
      sleep_hours: 7,
      energy_level: 5,
      mood_level: 5,
      steps_count: 0,
      activity_minutes: 0,
      took_medication: false,
      pain_location: "",
      pain_notes: "",
      exercise_type: "",
      medication_notes: "",
      side_effects: "",
      general_notes: "",
    },
  });

  const onSubmit = async (data: CheckInFormValues) => {
    setIsSubmitting(true);
    try {
      const result = await createCheckIn({
        check_in_type: data.check_in_type,
        pain_level: data.pain_level,
        pain_location: data.pain_location || null,
        pain_notes: data.pain_notes || null,
        sleep_quality: data.sleep_quality,
        sleep_hours: data.sleep_hours,
        energy_level: data.energy_level,
        mood_level: data.mood_level,
        steps_count: data.steps_count,
        activity_minutes: data.activity_minutes,
        exercise_type: data.exercise_type || null,
        took_medication: data.took_medication,
        medication_notes: data.medication_notes || null,
        side_effects: data.side_effects || null,
        general_notes: data.general_notes || null,
      });

      if (result.error) {
        toast.error(t('trackingForm.messages.error'), {
          description: result.error,
        });
      } else {
        // Save dosing log if user took RTN products
        if (dosingValue.tookRtnProducts) {
          const reportType = data.check_in_type === 'weekly' ? 'weekly' : data.check_in_type === 'monthly' ? 'monthly' : 'daily';
          try {
            await logDose({
              distributionProtocolId: dosingValue.selectedProtocolId,
              doseAmount: dosingValue.isCustomDistribution ? String(dosingValue.customDoseAmount) : undefined,
              doseUnit: dosingValue.isCustomDistribution ? dosingValue.customDoseUnit : undefined,
              doseCount: dosingValue.isCustomDistribution ? (dosingValue.customDosesPerDay ?? 1) : undefined,
              doseTiming: dosingValue.isCustomDistribution ? dosingValue.customDoseTiming : undefined,
              isCustomDistribution: dosingValue.isCustomDistribution,
              reportType,
              reportPeriodStart: dosingValue.reportPeriodStart || undefined,
              reportPeriodEnd: dosingValue.reportPeriodEnd || undefined,
              notes: dosingValue.notes || undefined,
            });
          } catch {
            // Don't fail the check-in if dosing log fails
          }
        }
        // Process token reward based on check-in type
        const actionType = data.check_in_type === "weekly"
          ? "weekly_checkin"
          : data.check_in_type === "monthly"
            ? "monthly_checkin"
            : "daily_checkin";
        
        try {
          const rewardResult = await processReward.mutateAsync({
            actionType,
            referenceId: result.data?.id,
          });

          const awarded = rewardResult?.amount_awarded ?? 0;
          
          if (rewardResult?.success && awarded > 0) {
            toast.success(t('trackingForm.messages.success'), {
              description: (
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-primary" />
                  <span>{t('tokens.rewardEarned', { amount: awarded })}</span>
                </div>
              ),
            });
          } else {
            toast.success(t('trackingForm.messages.success'), {
              description: t('trackingForm.messages.successDesc'),
            });
          }
        } catch {
          // Still show success even if reward failed
          toast.success(t('trackingForm.messages.success'), {
            description: t('trackingForm.messages.successDesc'),
          });
        }
        
        navigate("/member");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (todayCheckIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('trackingForm.alreadyCheckedIn.title')}</CardTitle>
          <CardDescription>
            {t('trackingForm.alreadyCheckedIn.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-semibold">{todayCheckIn.pain_level ?? "-"}</p>
              <p className="text-sm text-muted-foreground">{t('trackingForm.alreadyCheckedIn.painLevel')}</p>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-semibold">{todayCheckIn.energy_level ?? "-"}</p>
              <p className="text-sm text-muted-foreground">{t('trackingForm.alreadyCheckedIn.energy')}</p>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-semibold">{todayCheckIn.sleep_quality ?? "-"}</p>
              <p className="text-sm text-muted-foreground">{t('trackingForm.alreadyCheckedIn.sleepQuality')}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate("/member")}>
            {t('trackingForm.alreadyCheckedIn.backToDashboard')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Check-in Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('trackingForm.checkInType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="check_in_type"
              render={({ field }) => (
                <FormItem>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('trackingForm.selectType')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="morning">{t('trackingForm.types.morning')}</SelectItem>
                      <SelectItem value="evening">{t('trackingForm.types.evening')}</SelectItem>
                      <SelectItem value="weekly">{t('trackingForm.types.weekly')}</SelectItem>
                      <SelectItem value="monthly">{t('trackingForm.types.monthly')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Pain & Discomfort */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Heart className="w-5 h-5 text-destructive" />
              {t('trackingForm.pain.title')}
            </CardTitle>
            <CardDescription>{t('trackingForm.pain.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="pain_level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.pain.level')}</FormLabel>
                  <FormControl>
                    <RatingButtons
                      value={field.value}
                      onChange={field.onChange}
                      min={0}
                      max={10}
                      labels={{
                        low: t('trackingForm.pain.noPain'),
                        high: t('trackingForm.pain.severe'),
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pain_location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.pain.location')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('trackingForm.pain.locationPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pain_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.pain.notes')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('trackingForm.pain.notesPlaceholder')}
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Sleep */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Moon className="w-5 h-5 text-secondary" />
              {t('trackingForm.sleep.title')}
            </CardTitle>
            <CardDescription>{t('trackingForm.sleep.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="sleep_quality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.sleep.quality')}</FormLabel>
                  <FormControl>
                    <RatingButtons
                      value={field.value}
                      onChange={field.onChange}
                      min={0}
                      max={10}
                      labels={{
                        low: t('trackingForm.sleep.veryPoor'),
                        high: t('trackingForm.sleep.excellent'),
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sleep_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.sleep.hours')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      placeholder="7"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Energy & Mood */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="w-5 h-5 text-primary" />
              {t('trackingForm.energy.title')}
            </CardTitle>
            <CardDescription>{t('trackingForm.energy.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="energy_level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.energy.level')}</FormLabel>
                  <FormControl>
                    <RatingButtons
                      value={field.value}
                      onChange={field.onChange}
                      min={0}
                      max={10}
                      labels={{
                        low: t('trackingForm.energy.exhausted'),
                        high: t('trackingForm.energy.energized'),
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mood_level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.energy.moodLevel')}</FormLabel>
                  <FormControl>
                    <RatingButtons
                      value={field.value}
                      onChange={field.onChange}
                      min={0}
                      max={10}
                      labels={{
                        low: t('trackingForm.energy.veryLow'),
                        high: t('trackingForm.sleep.excellent'),
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-accent" />
              {t('trackingForm.activity.title')}
            </CardTitle>
            <CardDescription>{t('trackingForm.activity.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="steps_count"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.activity.steps')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={100000}
                      placeholder="0"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription>{t('trackingForm.activity.stepsDescription')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="activity_minutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.activity.activeMinutes')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      placeholder="0"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription>{t('trackingForm.activity.activeMinutesDescription')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="exercise_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.activity.exerciseType')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('trackingForm.activity.exerciseTypePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Medication */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Pill className="w-5 h-5 text-secondary" />
              {t('trackingForm.medication.title')}
            </CardTitle>
            <CardDescription>{t('trackingForm.medication.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="took_medication"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{t('trackingForm.medication.tookToday')}</FormLabel>
                    <FormDescription>{t('trackingForm.medication.tookTodayDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="medication_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.medication.notes')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('trackingForm.medication.notesPlaceholder')}
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="side_effects"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('trackingForm.medication.sideEffects')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('trackingForm.medication.sideEffectsPlaceholder')}
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* RTN Product Dosing */}
        <DosingInput
          value={dosingValue}
          onChange={setDosingValue}
          reportType={form.watch('check_in_type') === 'weekly' ? 'weekly' : form.watch('check_in_type') === 'monthly' ? 'monthly' : 'daily'}
        />

        {/* General Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              {t('trackingForm.general.title')}
            </CardTitle>
            <CardDescription>{t('trackingForm.general.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="general_notes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder={t('trackingForm.general.notesPlaceholder')}
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-4">
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? t('trackingForm.submitting') : t('trackingForm.submit')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/member")}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
