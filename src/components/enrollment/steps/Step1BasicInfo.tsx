import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { StepProps } from "../types";

export function Step1BasicInfo({ form, isLoggedIn, dateLocale }: StepProps) {
  const { t } = useTranslation();
  const [dateOfBirthOpen, setDateOfBirthOpen] = useState(false);
  const [dateOfBirthMonth, setDateOfBirthMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear() - 30, 0, 1);
  });

  const defaultDateOfBirthMonth = () => {
    const now = new Date();
    return new Date(now.getFullYear() - 30, 0, 1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("study.registration.basicInfoTitle")}</CardTitle>
        <CardDescription>{t("study.registration.basicInfoDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.email")} *</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder={t("study.form.emailPlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isLoggedIn && (
          <>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("study.form.password")} *</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t("study.form.passwordPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t("study.form.passwordDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("study.form.confirmPassword")} *</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t("study.form.confirmPasswordPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        <FormField
          control={form.control}
          name="dateOfBirth"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>{t("study.form.dateOfBirth")} *</FormLabel>
              <Popover
                open={dateOfBirthOpen}
                onOpenChange={(open) => {
                  setDateOfBirthOpen(open);
                  if (!open) return;
                  setDateOfBirthMonth(field.value ?? defaultDateOfBirthMonth());
                }}
              >
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP", { locale: dateLocale })
                      ) : (
                        <span>{t("study.form.pickDate")}</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={(date) => {
                      if (!date) return;
                      field.onChange(date);
                      setDateOfBirthOpen(false);
                    }}
                    month={dateOfBirthMonth}
                    onMonthChange={setDateOfBirthMonth}
                    locale={dateLocale}
                    captionLayout="dropdown"
                    fromYear={1900}
                    toYear={new Date().getFullYear()}
                    disabled={(date) =>
                      date > new Date() || date < new Date("1900-01-01")
                    }
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="membershipType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.membershipType")} *</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="flex flex-col space-y-2"
                >
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="individual" />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {t("study.form.individual")}
                    </FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center space-x-3 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="professional" />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {t("study.form.professional")}
                    </FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="invitationCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("invitations.code")} ({t("common.optional")})
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t("invitations.code_placeholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <p>{t("study.registration.registrationDisclaimer")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
