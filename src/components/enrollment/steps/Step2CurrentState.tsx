import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import type { RegistrationFormProps } from "../types";

export function Step2CurrentState({ form }: RegistrationFormProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("study.registration.currentStateTitle")}</CardTitle>
        <CardDescription>{t("study.registration.currentStateDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <FormField
          control={form.control}
          name="physicalState"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.physicalState")}</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <Slider
                    min={1}
                    max={10}
                    step={1}
                    value={[field.value]}
                    onValueChange={(value) => field.onChange(value[0])}
                  />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{t("study.form.veryPoor")}</span>
                    <span className="font-medium text-foreground">{field.value}</span>
                    <span>{t("study.form.excellent")}</span>
                  </div>
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="mentalState"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.mentalState")}</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <Slider
                    min={1}
                    max={10}
                    step={1}
                    value={[field.value]}
                    onValueChange={(value) => field.onChange(value[0])}
                  />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{t("study.form.veryPoor")}</span>
                    <span className="font-medium text-foreground">{field.value}</span>
                    <span>{t("study.form.excellent")}</span>
                  </div>
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="energyLevel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.energyLevel")}</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <Slider
                    min={1}
                    max={10}
                    step={1}
                    value={[field.value]}
                    onValueChange={(value) => field.onChange(value[0])}
                  />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{t("study.form.veryLow")}</span>
                    <span className="font-medium text-foreground">{field.value}</span>
                    <span>{t("study.form.fullEnergy")}</span>
                  </div>
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="stressLevel"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.stressLevel")}</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <Slider
                    min={1}
                    max={10}
                    step={1}
                    value={[field.value]}
                    onValueChange={(value) => field.onChange(value[0])}
                  />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{t("study.form.noStress")}</span>
                    <span className="font-medium text-foreground">{field.value}</span>
                    <span>{t("study.form.extremeStress")}</span>
                  </div>
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="professionalFindings"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.professionalFindings")}</FormLabel>
              <FormDescription>{t("study.form.professionalFindingsDesc")}</FormDescription>
              <FormControl>
                <Textarea
                  placeholder={t("study.form.professionalFindingsPlaceholder")}
                  className="resize-none"
                  rows={4}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.note")}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t("study.form.notePlaceholder")}
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
  );
}
